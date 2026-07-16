/**
 * Open IoT controller — no authentication, no schema enforcement.
 *
 * Endpoints:
 *
 *   POST /iot/data
 *     Body: { deviceId, machineName, ...anything }
 *     Behaviour:
 *       1. Upserts the device's current state in DeviceData (one row
 *          per deviceId). Same POST repeated overwrites the row.
 *       2. Appends to DeviceDataHistory (capped) for audit/charts.
 *       3. AUTO-REGISTERS a Machine record if no Machine exists with
 *          code === machineName. New machines appear on the dashboard
 *          immediately without anyone touching the admin panel.
 *       4. AUTO-TRACKS state intervals in MachineStatus — when the
 *          device reports a different state than the previous POST,
 *          we close the open interval (set endAt, durationSec) and
 *          open a new one. This is what powers the "Down for 5m 23s"
 *          timer on the dashboard.
 *
 *   GET /iot/data
 *     Returns: array of all current device states.
 *
 *   GET /iot/data/:deviceId
 *     Returns: current state for one device.
 *
 *   GET /iot/data/:deviceId/history?limit=100
 *     Returns: most recent N (default 100, max 1000) history rows.
 *
 *   DELETE /iot/data/:deviceId
 *     Removes a device's current row. History is retained.
 */

import mongoose from 'mongoose';
import { DeviceData, DeviceDataHistory } from '../models/DeviceData.js';
import { Machine, generateApiKey } from '../models/Machine.js';
import { Plant } from '../models/Plant.js';
import { MachineStatus } from '../models/MachineStatus.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { cacheService } from '../services/cache.service.js';
import { logger } from '../config/logger.js';

/* ════════════════════════════════════════════════════════════════════════
 * Helpers
 * ══════════════════════════════════════════════════════════════════════ */

function inferStage(machineName, hint) {
  const validStages = ['printing', 'inspection', 'lamination', 'slitting', 'cutting', 'packaging'];
  if (hint && validStages.includes(String(hint).toLowerCase())) {
    return String(hint).toLowerCase();
  }
  const upper = String(machineName || '').toUpperCase();
  if (upper.startsWith('PR') || upper.includes('PRINT'))     return 'printing';
  if (upper.startsWith('IN') || upper.includes('INSP'))      return 'inspection';
  if (upper.startsWith('LM') || upper.startsWith('LAM')
      || upper.includes('LAMIN'))                            return 'lamination';
  if (upper.startsWith('SL') || upper.includes('SLIT'))      return 'slitting';
  if (upper.startsWith('CT') || upper.startsWith('CUT')
      || upper.includes('CUTTING'))                          return 'cutting';
  if (upper.startsWith('PK') || upper.startsWith('PACK')
      || upper.includes('PACKAG'))                           return 'packaging';
  return 'printing';
}

async function resolveDefaultPlantId(bodyPlantId) {
  if (bodyPlantId && mongoose.Types.ObjectId.isValid(bodyPlantId)) {
    const exists = await Plant.exists({ _id: bodyPlantId, active: true });
    if (exists) return bodyPlantId;
  }
  const cached = await cacheService.get('iot:default-plant-id');
  if (cached) return cached;

  const plant = await Plant.findOne({ active: true }).select('_id').lean();
  if (!plant) return null;
  await cacheService.set('iot:default-plant-id', plant._id.toString(), 300, ['machines']);
  return plant._id.toString();
}

function normalizeStateValue(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).toLowerCase().trim();
  if (!s) return null;
  if (['running', 'run', 'active', 'on', 'started', 'producing'].includes(s)) return 'running';
  if (['idle', 'pause', 'paused', 'ready', 'standby', 'waiting'].includes(s)) return 'idle';
  if (['stopped', 'stop', 'down', 'off', 'fault', 'error', 'failed', 'halt', 'halted'].includes(s)) return 'down';
  if (['maintenance', 'maint', 'service', 'servicing', 'repair'].includes(s)) return 'maintenance';
  if (['offline', 'disconnected', 'unknown'].includes(s)) return 'offline';
  return null;
}

/**
 * Ensure a Machine document exists. Returns the machine (existing or new),
 * plus a flag indicating whether we just created it.
 */
async function ensureMachine(machineName, body) {
  const code = machineName.toUpperCase().trim();
  const existing = await Machine.findOne({ code }).lean();
  if (existing) return { machine: existing, created: false };

  const plantId = await resolveDefaultPlantId(body.plantId);
  if (!plantId) {
    logger.warn({ machineName }, '[iot] cannot auto-register — no active Plant in DB');
    return { machine: null, created: false };
  }

  const { hash, prefix } = generateApiKey();
  try {
    const created = await Machine.create({
      code,
      name: body.displayName || body.name || machineName,
      stage: inferStage(machineName, body.stage),
      plantId,
      idealCycleTimeSec: Number(body.idealCycleTimeSec) || 1,
      targetOutputPerHour: Number(body.targetOutputPerHour) || 0,
      apiKeyHash: hash,
      apiKeyPrefix: prefix,
      apiKeyRotatedAt: new Date(),
      active: true,
      currentStatus: { state: 'running', lastSeenAt: new Date() },
    });
    await cacheService.invalidateTag('machines');
    logger.info({ machineName: code }, '[iot] auto-registered new machine');
    return { machine: created.toObject(), created: true };
  } catch (err) {
    if (err.code === 11000) {
      const racedDoc = await Machine.findOne({ code }).lean();
      return { machine: racedDoc, created: false };
    }
    logger.error({ err, machineName }, '[iot] auto-register failed');
    return { machine: null, created: false };
  }
}

/**
 * Track a state transition. If the new state differs from the currently
 * open MachineStatus interval, close the old one and open a new one.
 * Returns true if a new interval was opened.
 */
async function recordStateTransition(machineId, plantId, newState) {
  if (!machineId || !plantId || !newState) return false;

  const now = new Date();
  const openInterval = await MachineStatus.findOne({ machineId, endAt: null }).sort({ startAt: -1 });

  if (openInterval && openInterval.state === newState) return false; // no change

  if (openInterval) {
    openInterval.endAt = now;
    openInterval.durationSec = Math.max(0, Math.round((now - openInterval.startAt) / 1000));
    await openInterval.save();
  }

  await MachineStatus.create({
    machineId,
    plantId,
    state: newState,
    startAt: now,
    endAt: null,
  });

  await Machine.updateOne(
    { _id: machineId },
    { $set: { 'currentStatus.state': newState, 'currentStatus.since': now, 'currentStatus.lastSeenAt': now } }
  );

  await cacheService.invalidateTag('machines');
  return true;
}

/* ════════════════════════════════════════════════════════════════════════
 * POST /iot/data
 * ══════════════════════════════════════════════════════════════════════ */

export const ingestDeviceData = asyncHandler(async (req, res) => {
  const body = req.body || {};

  const deviceId    = (body.deviceId    || body.device_id    || '').toString().trim();
  const machineNameRaw = (body.machineName || body.machine_name || body.machineCode || '').toString().trim();

  if (!deviceId) throw ApiError.badRequest('deviceId is required in body');
  if (!machineNameRaw) throw ApiError.badRequest('machineName is required in body');

  const machineName = machineNameRaw.toUpperCase();

  // Strip identifier + hint fields from the payload before storing.
  const {
    deviceId: _d, device_id: _d2,
    machineName: _m, machine_name: _m2, machineCode: _m3,
    name: _n, displayName: _dn,
    stage: _s, plantId: _p,
    idealCycleTimeSec: _i, targetOutputPerHour: _t,
    ...rest
  } = body;

  const now = new Date();
  const clientIp = req.ip || req.headers['x-forwarded-for'] || null;

  // 1) Upsert current device snapshot.
  const updated = await DeviceData.findOneAndUpdate(
    { deviceId },
    {
      $set: {
        deviceId,
        machineName,
        data: rest,
        lastSeenAt: now,
        lastClientIp: clientIp,
      },
      $inc: { updateCount: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, lean: true }
  );

  // 2) Append history (best-effort).
  DeviceDataHistory.create({
    deviceId,
    machineName,
    data: rest,
    receivedAt: now,
    clientIp,
  }).catch((err) => {
    logger.warn({ err: err.message, deviceId }, '[iot] history append failed');
  });

  // 3) Ensure Machine exists (auto-register if first time).
  const { machine, created } = await ensureMachine(machineName, body);

  // 4) Track state interval. Default to 'running' if device didn't send
  // a state field — the device is alive and POSTing.
  let stateChanged = false;
  if (machine) {
    const rawState = rest.state ?? rest.status ?? null;
    const normalizedState = normalizeStateValue(rawState) || 'running';
    stateChanged = await recordStateTransition(machine._id, machine.plantId, normalizedState);
  }

  res.json(ok({
    deviceId,
    machineName,
    machineId: machine?._id || null,
    machineCreated: created,
    stateChanged,
    updatedAt: updated.lastSeenAt,
    updateCount: updated.updateCount,
    fieldsReceived: Object.keys(rest),
  }));
});

/* ════════════════════════════════════════════════════════════════════════
 * GET /iot/data
 * ══════════════════════════════════════════════════════════════════════ */

export const listDeviceData = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.machineName) {
    filter.machineName = String(req.query.machineName).toUpperCase();
  }
  if (req.query.staleMinutes) {
    const cutoff = new Date(Date.now() - Number(req.query.staleMinutes) * 60_000);
    filter.lastSeenAt = { $lt: cutoff };
  }
  const docs = await DeviceData.find(filter).sort({ lastSeenAt: -1 }).limit(500).lean();
  res.json(ok(docs));
});

export const getDeviceData = asyncHandler(async (req, res) => {
  const doc = await DeviceData.findOne({ deviceId: req.params.deviceId }).lean();
  if (!doc) throw ApiError.notFound(`No data found for deviceId='${req.params.deviceId}'`);
  res.json(ok(doc));
});

export const getDeviceHistory = asyncHandler(async (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
  const rows = await DeviceDataHistory.find({ deviceId: req.params.deviceId })
    .sort({ receivedAt: -1 })
    .limit(limit)
    .lean();
  res.json(ok(rows));
});

export const deleteDeviceData = asyncHandler(async (req, res) => {
  const result = await DeviceData.deleteOne({ deviceId: req.params.deviceId });
  res.json(ok({ deleted: result.deletedCount > 0 }));
});
