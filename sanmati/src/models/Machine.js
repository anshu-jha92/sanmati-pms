import mongoose from 'mongoose';
import crypto from 'node:crypto';

/**
 * Each machine has its own API key that the IoT gateway sends as `X-API-Key`
 * along with the machine code. Keys can be rotated via POST /machines/:id/rotate-key.
 */

const machineSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    stage: {
      type: String,
      enum: ['printing', 'inspection', 'lamination', 'slitting', 'cutting', 'packaging'],
      required: true,
      index: true,
    },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },

    idealCycleTimeSec: { type: Number, default: 1 },
    targetOutputPerHour: { type: Number, default: 0 },

    serialNumber: { type: String },
    manufacturer: { type: String },
    installedAt: { type: Date },

    currentStatus: {
      state: { type: String, enum: ['running', 'idle', 'maintenance', 'down', 'offline'], default: 'offline' },
      since: { type: Date },
      currentOperator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      currentOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder' },
      lastSeenAt: { type: Date },
      // Free-text job/operator assignment set from the Machines page "Configure"
      // dialog (PATCH /machines/:id/assignment). Distinct from currentOperator/
      // currentOrder (ObjectId refs) — these mirror exactly what the operator types.
      currentJobNumber: { type: String },
      currentOrderNumber: { type: String },
      currentProduct: { type: String },
      operatorName: { type: String },
      supervisorName: { type: String },
    },

    // API key authentication for IoT ingestion. Stored as a SHA-256 hash; the cleartext
    // is only returned at creation and on rotation so operators can save it once.
    apiKeyHash: { type: String, required: true, select: false, index: true },
    apiKeyPrefix: { type: String }, // first 8 chars for display, e.g. "mk_a1b2c3"
    apiKeyRotatedAt: { type: Date, default: () => new Date() },

    // Optional per-machine rate-limit override (requests per second).
    // If null, falls back to IOT_RATE_LIMIT_RPS env default.
    rateLimitRps: { type: Number, default: null },

    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

machineSchema.index({ plantId: 1, stage: 1 });
machineSchema.index({ 'currentStatus.state': 1, plantId: 1 });

/** Generate a plaintext API key + hash pair. */
export function generateApiKey() {
  const raw = 'mk_' + crypto.randomBytes(24).toString('base64url'); // ~32 chars, URL-safe
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash, prefix: raw.slice(0, 10) };
}

export function hashApiKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export const Machine = mongoose.model('Machine', machineSchema);
