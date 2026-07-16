import { MachineData } from '../models/MachineData.js';
import { telemetryQueue } from '../services/queue.service.js';
import { socketService } from '../services/socket.service.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { logger } from '../config/logger.js';

/**
 * FULLY-DYNAMIC IoT ingestion.
 *
 * Send ANY JSON shape. Minimum requirement: identify the machine (via URL, body
 * machineId, or X-Machine-Code header — iotAuth handles that).
 *
 * Accepted bodies:
 *   1. Single event (flat):
 *        { "machineId":"PRNT-1","state":"running","speed":57,"production":45 }
 *
 *   2. Array of events:
 *        [ {"machineId":"PRNT-1","state":"running",...}, {...} ]
 *
 *   3. Wrapped batch:
 *        { "machineId":"PRNT-1", "events": [ {"state":"running"}, {"state":"idle"} ] }
 *
 * KNOWN fields (indexed separately in MachineData):
 *   timestamp, event, state, unitsProduced, rejects, speed,
 *   alarmCode, operatorCode, orderId, batchId, seq
 *
 * ALIAS fields — mapped to known fields automatically:
 *   production → unitsProduced
 *   reject / rejected → rejects
 *   rpm / spm → speed (if no speed set)
 *   operator / operator_code → operatorCode
 *   alarm / alarm_code → alarmCode
 *   order_id → orderId
 *
 * Machine-identity fields (machineId, machineCode, machine_code, code) are DROPPED
 * from the payload — they were used for auth, shouldn't clutter `metrics`.
 *
 * EVERYTHING ELSE lands in `metrics` — including custom fields like temp, waterLPH,
 * efficiency, parameter-1, parameter-2, etc. No schema. No whitelist. Query them
 * all back via `GET /api/v1/machines/:id/telemetry`.
 *
 * Also accepts a `status` field as an alias for `state`, and treats these status
 * values as state changes: running, idle, maintenance, down, offline.
 */

const IDENTITY_FIELDS = new Set(['machineid', 'machinecode', 'machine_code', 'code']);
const KNOWN_FIELDS = new Set([
  'timestamp', 'event', 'state', 'unitsproduced', 'rejects', 'speed',
  'alarmcode', 'operatorcode', 'orderid', 'batchid', 'seq', 'metrics', 'status',
]);

// Aliases → canonical field name
const ALIASES = {
  production: 'unitsProduced',
  units_produced: 'unitsProduced',
  reject: 'rejects',
  rejected: 'rejects',
  reject_qty: 'rejects',
  operator: 'operatorCode',
  operator_code: 'operatorCode',
  operatorid: 'operatorCode',
  operator_id: 'operatorCode',
  alarm: 'alarmCode',
  alarm_code: 'alarmCode',
  order_id: 'orderId',
  orderno: 'orderId',
  order_no: 'orderId',
};

const STATE_VALUES = new Set(['running', 'idle', 'maintenance', 'down', 'offline']);
const MAX_EVENTS_PER_REQUEST = 500;
const FUTURE_CLAMP_MS = 5_000;

function normaliseBody(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.events)) return body.events;
  if (body && typeof body === 'object') return [body];
  return [];
}

/**
 * Takes any raw event object and shapes it into a MachineData document.
 * - Known fields → top-level indexed columns
 * - Aliases resolved (e.g. production → unitsProduced)
 * - Unknown fields → metrics subdocument
 * - status alias maps to state + auto-sets event='state_change' if status is a known state
 */
function shapeEvent(raw, machine) {
  const doc = {
    metadata: {
      machineId: machine._id,
      machineCode: machine.code,
      plantId: machine.plantId,
      stage: machine.stage,
    },
    ingestedAt: new Date(),
  };

  // Resolve aliases into a working object. We lowercase keys for matching
  // but preserve original casing in metrics.
  const working = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const lk = k.toLowerCase();
    if (IDENTITY_FIELDS.has(lk)) continue; // drop machine-identity fields
    const mapped = ALIASES[lk];
    if (mapped) {
      // If already set, skip (first-wins)
      if (working[mapped] === undefined) working[mapped] = v;
    } else {
      working[k] = v;
    }
  }

  // timestamp
  let ts;
  if (working.timestamp) {
    const parsed = new Date(working.timestamp);
    ts = isNaN(parsed.getTime()) ? new Date() : parsed;
  } else {
    ts = new Date();
  }
  const now = Date.now();
  if (ts.getTime() - now > FUTURE_CLAMP_MS) ts = new Date(now);
  doc.timestamp = ts;
  delete working.timestamp;

  // state / status
  let state = working.state;
  if (!state && typeof working.status === 'string') {
    state = working.status;
  }
  if (typeof state === 'string') {
    state = state.toLowerCase();
    if (STATE_VALUES.has(state)) doc.state = state;
  }
  delete working.state;
  delete working.status;

  // event — auto-set to 'state_change' when we have a valid state AND no event given
  if (typeof working.event === 'string') {
    doc.event = working.event;
  } else if (doc.state) {
    doc.event = 'state_change';
  } else if (typeof working.unitsProduced === 'number' && working.unitsProduced > 0) {
    doc.event = 'cycle_end';
  } else {
    doc.event = 'heartbeat';
  }
  delete working.event;

  // numeric known fields — coerce if reasonable, otherwise let them fall through to metrics
  for (const k of ['unitsProduced', 'rejects', 'speed']) {
    if (working[k] !== undefined) {
      const n = Number(working[k]);
      if (!isNaN(n) && isFinite(n)) doc[k] = n;
      delete working[k];
    }
  }

  // String known fields
  for (const k of ['alarmCode', 'operatorCode']) {
    if (typeof working[k] === 'string') {
      doc[k] = working[k];
    } else if (working[k] !== undefined) {
      doc[k] = String(working[k]);
    }
    delete working[k];
  }

  if (typeof working.orderId === 'string' && /^[0-9a-fA-F]{24}$/.test(working.orderId)) {
    doc.orderId = working.orderId;
  }
  delete working.orderId;

  // Idempotency: batchId+seq → gatewayBatchId
  if (working.batchId && typeof working.seq === 'number') {
    doc.gatewayBatchId = `${working.batchId}:${working.seq}`;
  }
  delete working.batchId;
  delete working.seq;

  // Remaining working object (+ any `metrics` the caller provided) → metrics
  const existingMetrics = (raw && typeof raw.metrics === 'object' && raw.metrics) || {};
  delete working.metrics;
  const mergedMetrics = { ...existingMetrics, ...working };

  if (Object.keys(mergedMetrics).length > 0) {
    doc.metrics = mergedMetrics;
  }

  return doc;
}

export const ingest = asyncHandler(async (req, res) => {
  const { machine } = req.iot;
  const events = normaliseBody(req.body);

  if (events.length === 0) {
    throw ApiError.badRequest('No events found in request body', { code: 'E_IOT_EMPTY' });
  }
  if (events.length > MAX_EVENTS_PER_REQUEST) {
    throw ApiError.badRequest(`Too many events (max ${MAX_EVENTS_PER_REQUEST})`, { code: 'E_IOT_TOO_MANY' });
  }

  const docs = events.map((e) => shapeEvent(e, machine));

  const liveEvents = [];
  const jobs = [];

  for (const d of docs) {
    liveEvents.push({
      machineCode: machine.code,
      machineId: String(machine._id),
      stage: machine.stage,
      timestamp: d.timestamp.toISOString(),
      state: d.state,
      unitsProduced: d.unitsProduced,
      rejects: d.rejects,
      speed: d.speed,
      event: d.event,
      alarmCode: d.alarmCode,
      metrics: d.metrics,
    });

    if (
      d.event === 'state_change' ||
      d.event === 'alarm' ||
      d.event === 'cycle_end' ||
      d.event === 'counter'
    ) {
      jobs.push({
        name: 'process-event',
        data: {
          machineId: String(machine._id),
          plantId: String(machine.plantId),
          event: d.event,
          state: d.state,
          timestamp: d.timestamp.toISOString(),
          unitsProduced: d.unitsProduced || 0,
          rejects: d.rejects || 0,
          orderId: d.orderId,
          operatorCode: d.operatorCode,
          alarmCode: d.alarmCode,
          gatewayBatchId: d.gatewayBatchId,
        },
        opts: d.gatewayBatchId ? { jobId: d.gatewayBatchId } : {},
      });
    }
  }

  try {
    await MachineData.insertMany(docs, { ordered: false, lean: true });
  } catch (err) {
    if (err.writeErrors) {
      const nonDup = err.writeErrors.filter((e) => e.code !== 11000);
      if (nonDup.length) logger.warn({ errors: nonDup.slice(0, 3) }, 'partial insertMany failures');
    } else {
      logger.error({ err }, 'insertMany fatal');
      throw ApiError.internal('Ingest write failed');
    }
  }

  if (jobs.length) {
    telemetryQueue.addBulk(jobs).catch((err) => logger.error({ err }, 'enqueue failed'));
  }
  socketService.emitMachineEvents(String(machine.plantId), String(machine._id), liveEvents);

  res.status(202).json(ok({
    accepted: docs.length,
    queued: jobs.length,
    machine: { code: machine.code, stage: machine.stage },
  }));
});

export const iotHealth = asyncHandler(async (req, res) => {
  res.json(
    ok({
      machine: {
        id: req.iot.machine._id,
        code: req.iot.machine.code,
        stage: req.iot.machine.stage,
      },
      serverTime: new Date().toISOString(),
      note: 'Credentials valid. Any JSON payload accepted; unknown fields go into metrics.',
    })
  );
});
