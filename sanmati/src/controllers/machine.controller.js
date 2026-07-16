import { z } from 'zod';
import mongoose from 'mongoose';
import { Machine, generateApiKey } from '../models/Machine.js';
import { MachineData } from '../models/MachineData.js';
import { MachineStatus } from '../models/MachineStatus.js';
import { OEERollup } from '../models/OEERollup.js';
import { DeviceData, DeviceDataHistory } from '../models/DeviceData.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { parsePagination, paginatedMeta } from '../utils/pagination.js';
import { cacheService } from '../services/cache.service.js';
import { resolvePlantId } from '../utils/plant.js';

const listQuery = z.object({
  plantId: z.string().nullish(),
  stage: z.string().optional(),
  state: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});

export const list = asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const { page, limit, skip } = parsePagination(q);
  const filter = {};
  if (q.plantId) filter.plantId = q.plantId;
  if (q.stage) filter.stage = q.stage;
  if (q.state) filter['currentStatus.state'] = q.state;
  if (q.q) filter.$or = [{ code: new RegExp(q.q, 'i') }, { name: new RegExp(q.q, 'i') }];

  const [items, total] = await Promise.all([
    Machine.find(filter).sort({ code: 1 }).skip(skip).limit(limit).lean(),
    Machine.countDocuments(filter),
  ]);
  res.json(ok(items, paginatedMeta({ page, limit, total })));
});

/**
 * GET /machines/:id — single machine, with live IoT data merged in.
 *
 * The detail page reads `currentStatus.live` to render dynamic parameter
 * cards, so we merge the latest DeviceData row here too (same logic as
 * /machines/live, just for one machine).
 */
export const getOne = asyncHandler(async (req, res) => {
  const doc = await Machine.findById(req.params.id).lean();
  if (!doc) throw ApiError.notFound('Machine not found');

  // Pull the latest DeviceData row for this machine. There may be
  // multiple devices reporting under the same machineName (e.g. two
  // sensors on one machine) — pick the most recently seen.
  const device = await DeviceData.findOne({ machineName: doc.code })
    .sort({ lastSeenAt: -1 })
    .lean();

  // Also find the currently open state interval so the UI can display
  // a "Running for 5m 23s" timer without having to query separately.
  const openInterval = await MachineStatus.findOne({
    machineId: doc._id,
    endAt: null,
  }).sort({ startAt: -1 }).lean();

  const merged = {
    ...doc,
    currentStatus: {
      ...(doc.currentStatus || {}),   // stored DB state is the source of truth
      live: device?.data || {},
      lastSeenAt: device?.lastSeenAt || doc.currentStatus?.lastSeenAt || null,
      deviceId: device?.deviceId || null,
      updateCount: device?.updateCount || 0,
      // currentStateSince: when the current state started — used by the
      // detail-page live timer to compute "Running for 5m 23s".
      currentStateSince: openInterval?.startAt || doc.currentStatus?.since || null,
    },
  };

  res.json(ok(merged));
});

const createSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  stage: z.enum(['printing', 'inspection', 'lamination', 'slitting', 'cutting', 'packaging']),
  plantId: z.string().nullish(),
  idealCycleTimeSec: z.number().positive().default(1),
  targetOutputPerHour: z.number().nonnegative().default(0),
  serialNumber: z.string().optional(),
  manufacturer: z.string().optional(),
  rateLimitRps: z.number().int().positive().optional(),
});

export const create = asyncHandler(async (req, res) => {
  const payload = createSchema.parse(req.body);
  payload.plantId = await resolvePlantId(payload.plantId, req.user.plantId);
  const { raw, hash, prefix } = generateApiKey();
  const machine = await Machine.create({
    ...payload,
    apiKeyHash: hash,
    apiKeyPrefix: prefix,
    apiKeyRotatedAt: new Date(),
    currentStatus: { state: 'offline' },
  });
  await cacheService.invalidateTag('machines');
  res.status(201).json(
    ok({
      machine: machine.toObject(),
      apiKey: raw,
      warning: 'Save this API key now — it will never be shown again.',
    })
  );
});

export const update = asyncHandler(async (req, res) => {
  const payload = createSchema.partial().omit({ code: true }).parse(req.body);
  const doc = await Machine.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true });
  if (!doc) throw ApiError.notFound('Machine not found');
  await cacheService.invalidateTag('machines');
  res.json(ok(doc));
});

/**
 * PATCH /machines/:id/assignment — save the free-text job/operator assignment
 * entered in the Machines page "Configure" dialog. Empty strings clear a field
 * (the dialog's "Clear assignment" sends all-blank). Writes only to
 * currentStatus.* fields; never touches telemetry or the machine's identity.
 */
const assignmentSchema = z.object({
  currentJobNumber: z.string().trim().optional(),
  currentOrderNumber: z.string().trim().optional(),
  currentProduct: z.string().trim().optional(),
  operatorName: z.string().trim().optional(),
  supervisorName: z.string().trim().optional(),
});

export const updateAssignment = asyncHandler(async (req, res) => {
  const payload = assignmentSchema.parse(req.body || {});
  const $set = {};
  for (const key of ['currentJobNumber', 'currentOrderNumber', 'currentProduct', 'operatorName', 'supervisorName']) {
    // Only overwrite keys the caller actually sent; '' is a valid "clear".
    if (payload[key] !== undefined) $set[`currentStatus.${key}`] = payload[key];
  }
  const doc = await Machine.findByIdAndUpdate(req.params.id, { $set }, { new: true });
  if (!doc) throw ApiError.notFound('Machine not found');
  await cacheService.invalidateTag('machines');
  res.json(ok(doc));
});

export const rotateMachineApiKey = asyncHandler(async (req, res) => {
  const { raw, hash, prefix } = generateApiKey();
  const doc = await Machine.findByIdAndUpdate(
    req.params.id,
    { $set: { apiKeyHash: hash, apiKeyPrefix: prefix, apiKeyRotatedAt: new Date() } },
    { new: true }
  );
  if (!doc) throw ApiError.notFound('Machine not found');
  res.json(
    ok({
      apiKey: raw,
      apiKeyPrefix: prefix,
      rotatedAt: doc.apiKeyRotatedAt,
      warning: 'Save this API key now — it will never be shown again.',
    })
  );
});

/* ====== Telemetry / OEE / status queries ====== */

const telemetryQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

export const telemetry = asyncHandler(async (req, res) => {
  const { from, to, limit } = telemetryQuery.parse(req.query);
  if (to < from) throw ApiError.badRequest('to < from');
  if (to - from > 7 * 24 * 3600 * 1000) throw ApiError.badRequest('Window too large; use /oee for longer ranges');

  const items = await MachineData.find({
    'metadata.machineId': new mongoose.Types.ObjectId(req.params.id),
    timestamp: { $gte: from, $lte: to },
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
  res.json(ok(items));
});

/* ════════════════════════════════════════════════════════════════════════
 * GET /machines/:id/iot-history
 *
 * Returns DeviceDataHistory rows for this machine — the FULL audit log
 * of every IoT POST. Supports:
 *   ?from=<ISO date>      filter lower bound on receivedAt
 *   ?to=<ISO date>        filter upper bound on receivedAt
 *   ?deviceId=<string>    narrow to one gateway (if multiple per machine)
 *   ?page=<n>             1-based page index
 *   ?limit=<n>            page size, max 500
 *
 * Pagination is server-side so the page is fast even if a machine has
 * hundreds of thousands of records. Response includes `meta.pages` and
 * `meta.total` so the frontend can build a pager.
 * ══════════════════════════════════════════════════════════════════════ */

const iotHistoryQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  deviceId: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const iotHistory = asyncHandler(async (req, res) => {
  const q = iotHistoryQuery.parse(req.query);
  const { page, limit, skip } = parsePagination(q, { defaultLimit: 50, maxLimit: 500 });

  // Look up the machine to get its code, which is the join key on
  // DeviceDataHistory.machineName.
  const machine = await Machine.findById(req.params.id).select('code').lean();
  if (!machine) throw ApiError.notFound('Machine not found');

  const filter = { machineName: machine.code };
  if (q.from || q.to) {
    filter.receivedAt = {};
    if (q.from) filter.receivedAt.$gte = q.from;
    if (q.to)   filter.receivedAt.$lte = q.to;
  }
  if (q.deviceId) filter.deviceId = q.deviceId;

  // countDocuments on a capped collection is fast (uses metadata).
  const [items, total] = await Promise.all([
    DeviceDataHistory.find(filter).sort({ receivedAt: -1 }).skip(skip).limit(limit).lean(),
    DeviceDataHistory.countDocuments(filter),
  ]);

  res.json(ok(items, paginatedMeta({ page, limit, total })));
});

/* ════════════════════════════════════════════════════════════════════════
 * Live status summary — dashboard polls this every 5 seconds.
 *
 * Merges Machine + DeviceData. Stale data (no POST in IOT_STALE_MS) is
 * marked offline so dashboards don't keep showing a "running" badge
 * for a dead gateway.
 * ══════════════════════════════════════════════════════════════════════ */

const IOT_STALE_MS = Number(process.env.IOT_STALE_MS || 60_000);

function normalizeState(raw) {
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

export const liveStatusSummary = asyncHandler(async (req, res) => {
  const plantId = req.query.plantId;

  const machines = await cacheService.getOrSet(
    `machines:list:${plantId || 'all'}`,
    60,
    async () => {
      const filter = plantId ? { plantId, active: true } : { active: true };
      return Machine.find(filter)
        .select('code name stage currentStatus targetOutputPerHour apiKeyPrefix')
        .lean();
    },
    ['machines']
  );

  const machineCodes = machines.map((m) => m.code);
  const deviceRows = machineCodes.length > 0
    ? await DeviceData.find({ machineName: { $in: machineCodes } }).lean()
    : [];

  const deviceByMachine = new Map();
  for (const d of deviceRows) {
    const existing = deviceByMachine.get(d.machineName);
    if (!existing || new Date(d.lastSeenAt) > new Date(existing.lastSeenAt)) {
      deviceByMachine.set(d.machineName, d);
    }
  }

  const now = Date.now();

  const merged = machines.map((m) => {
    const device = deviceByMachine.get(m.code);
    if (!device) return m;

    const lastSeenAt = device.lastSeenAt ? new Date(device.lastSeenAt) : null;

    // Show the stored DB state as the source of truth (no stale→offline
    // override): if the DB says "running", the card shows Running everywhere.
    return {
      ...m,
      currentStatus: {
        ...(m.currentStatus || {}),   // keeps m.currentStatus.state from the DB
        lastSeenAt,
        live: device.data || {},
        deviceId: device.deviceId,
        updateCount: device.updateCount,
      },
    };
  });

  res.json(ok(merged));
});

const oeeQuery = z.object({
  granularity: z.enum(['hour', 'day']).default('hour'),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const oeeHistory = asyncHandler(async (req, res) => {
  const { granularity, from, to } = oeeQuery.parse(req.query);
  const rollups = await OEERollup.find({
    machineId: req.params.id,
    granularity,
    bucketStart: { $gte: from, $lte: to },
  })
    .sort({ bucketStart: 1 })
    .lean();
  res.json(ok(rollups));
});

/**
 * GET /machines/:id/status-history
 *
 * Returns MachineStatus intervals — populated automatically by every
 * /iot/data POST. Each row shows {state, startAt, endAt, durationSec},
 * which is what the detail page renders as a state timeline + the live
 * "Down for X" / "Idle for Y" counters.
 *
 * If no from/to is provided, defaults to the last 24 hours so the page
 * loads fast.
 */
export const statusHistory = asyncHandler(async (req, res) => {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 24 * 3600 * 1000);

  const items = await MachineStatus.find({
    machineId: req.params.id,
    startAt: { $lt: to },
    $or: [{ endAt: { $gt: from } }, { endAt: null }],
  })
    .sort({ startAt: -1 })
    .lean();
  res.json(ok(items));
});
