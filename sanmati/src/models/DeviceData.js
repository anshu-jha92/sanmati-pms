/**
 * DeviceData — open IoT ingestion model.
 *
 * Two collections work together here:
 *
 *   1. DeviceData          → CURRENT state per device (one row per machine)
 *                            Upserted on every POST. This is what the
 *                            dashboard reads — a single fast point lookup
 *                            per machine.
 *
 *   2. DeviceDataHistory   → APPEND-ONLY log of every POST received.
 *                            For audit / charts / debugging. Capped to
 *                            stay within Atlas free-tier storage.
 *
 * Why split them?
 *   - The dashboard needs the LATEST snapshot fast. A separate "current"
 *     collection with one doc per machine is a point read — sub-1ms.
 *   - History is append-only and grows fast (7 machines × 1 Hz =
 *     ~600k docs/day). Keeping it separate lets us cap/TTL it without
 *     affecting the live read.
 *
 * Both schemas are intentionally **schema-less** for the payload — the
 * `data` field is `Mixed` so the IoT engineer can POST any key/value
 * pairs without us needing to update the model.
 *
 *   POST { deviceId, machineName, ...anything else } →
 *     DeviceData.findOneAndUpdate({ deviceId }, { ...payload, lastSeenAt: now }, { upsert: true })
 *     DeviceDataHistory.create({ deviceId, ...payload, ts: now })
 */

import mongoose from 'mongoose';

/* ────────────────────────────────────────────────────────────────────────
 * Current state — one document per device. Identified by deviceId.
 * ──────────────────────────────────────────────────────────────────────── */
const deviceDataSchema = new mongoose.Schema(
  {
    // Identity — provided in every POST body
    deviceId:    { type: String, required: true, unique: true, index: true, trim: true },
    machineName: { type: String, required: true, trim: true, index: true },

    // Free-form payload — whatever the device sends ends up here.
    // Mixed type means Mongoose won't enforce any structure.
    data: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Server-managed metadata
    lastSeenAt:    { type: Date, default: Date.now, index: true },
    lastClientIp:  { type: String },
    updateCount:   { type: Number, default: 0 },   // increments on every POST
  },
  {
    timestamps: true,
    minimize: false,       // keep empty objects in `data` if the device sends one
    strict: false,         // allow extra top-level fields the device might send
  }
);

export const DeviceData = mongoose.model('DeviceData', deviceDataSchema);

/* ────────────────────────────────────────────────────────────────────────
 * History — every POST is appended here. Capped collection so it self-
 * trims at a fixed size and never blows up storage.
 *
 * Default cap: 100 MB total / 1 million documents (whichever first).
 * Adjust via env vars DEVICE_HISTORY_SIZE_MB and DEVICE_HISTORY_MAX_DOCS.
 * ──────────────────────────────────────────────────────────────────────── */
const historySizeMB = Number(process.env.DEVICE_HISTORY_SIZE_MB || 100);
const historyMaxDocs = Number(process.env.DEVICE_HISTORY_MAX_DOCS || 1_000_000);

const deviceDataHistorySchema = new mongoose.Schema(
  {
    deviceId:    { type: String, required: true },
    machineName: { type: String, required: true },
    data:        { type: mongoose.Schema.Types.Mixed, default: {} },
    receivedAt:  { type: Date, default: Date.now },
    clientIp:    { type: String },
  },
  {
    minimize: false,
    strict: false,
    // Capped collection — Mongo auto-deletes oldest docs when limit hits.
    // `_id` is required, but we let Mongoose generate it.
    capped: {
      size: historySizeMB * 1024 * 1024,
      max:  historyMaxDocs,
    },
  }
);

// Indexes for history queries (e.g. last N posts for a device).
// Note: capped collections support indexes from MongoDB 3.2+.
deviceDataHistorySchema.index({ deviceId: 1, receivedAt: -1 });

export const DeviceDataHistory = mongoose.model('DeviceDataHistory', deviceDataHistorySchema);
