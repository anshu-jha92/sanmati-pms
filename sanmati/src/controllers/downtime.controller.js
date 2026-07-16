import { z } from 'zod';
import { Machine } from '../models/Machine.js';
import { MachineStatus } from '../models/MachineStatus.js';
import { asyncHandler, ok } from '../utils/http.js';

/**
 * Cross-machine downtime overview — READ ONLY.
 *
 * Aggregates MachineStatus intervals over a time window, per machine, clipping
 * each interval to the window. "Downtime" here = idle + down (per the ops spec
 * used by the Downtime page). Nothing is written to the DB.
 *
 * GET /api/v1/downtime/summary?from=&to=&plantId=&machineId=
 *   → { from, to, totals:{running,idle,down,maintenance,offline,downtime}, machines:[...] }
 */

const STATES = ['running', 'idle', 'down', 'maintenance', 'offline'];
const emptyBuckets = () => Object.fromEntries(STATES.map((s) => [s, 0]));

const summaryQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  plantId: z.string().nullish(),
  machineId: z.string().optional(),
});

export const downtimeSummary = asyncHandler(async (req, res) => {
  const q = summaryQuery.parse(req.query);
  const now = new Date();
  const to = q.to || now;
  const from = q.from || new Date(to.getTime() - 24 * 3600 * 1000); // default: last 24h
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const nowMs = now.getTime();

  const machineFilter = { active: true };
  if (q.plantId) machineFilter.plantId = q.plantId;
  if (q.machineId) machineFilter._id = q.machineId;

  const machines = await Machine.find(machineFilter)
    .select('code name stage currentStatus plantId')
    .lean();
  const machineIds = machines.map((m) => m._id);

  // Any interval that overlaps [from, to]: it started before `to`, and either is
  // still open or ended after `from`.
  const intervals = machineIds.length
    ? await MachineStatus.find({
        machineId: { $in: machineIds },
        startAt: { $lt: to },
        $or: [{ endAt: null }, { endAt: { $gt: from } }],
      }).lean()
    : [];

  // Seconds of this interval that fall inside the window.
  const clippedSec = (iv) => {
    const s = Math.max(new Date(iv.startAt).getTime(), fromMs);
    const e = Math.min(iv.endAt ? new Date(iv.endAt).getTime() : nowMs, toMs);
    return Math.max(0, Math.floor((e - s) / 1000));
  };

  const perMachine = new Map();
  for (const iv of intervals) {
    const key = String(iv.machineId);
    if (!perMachine.has(key)) perMachine.set(key, emptyBuckets());
    const bucket = perMachine.get(key);
    if (bucket[iv.state] !== undefined) bucket[iv.state] += clippedSec(iv);
  }

  const totals = { ...emptyBuckets(), downtime: 0 };
  const rows = machines.map((m) => {
    const b = perMachine.get(String(m._id)) || emptyBuckets();
    const downtime = b.idle + b.down; // ops spec: idle + down
    for (const s of STATES) totals[s] += b[s];
    totals.downtime += downtime;
    return {
      machineId: String(m._id),
      code: m.code,
      name: m.name,
      stage: m.stage,
      currentState: m.currentStatus?.state || 'offline',
      ...b,
      downtime,
    };
  });

  // Worst offenders first.
  rows.sort((a, b) => b.downtime - a.downtime);

  res.json(ok({ from: from.toISOString(), to: to.toISOString(), totals, machines: rows }));
});

/**
 * GET /api/v1/downtime/intervals?machineId=&from=&to=
 * Raw stop/idle intervals for one machine (used for drill-downs). READ ONLY.
 */
const intervalsQuery = z.object({
  machineId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

export const downtimeIntervals = asyncHandler(async (req, res) => {
  const q = intervalsQuery.parse(req.query);
  const to = q.to || new Date();
  const from = q.from || new Date(to.getTime() - 24 * 3600 * 1000);

  const filter = { startAt: { $lt: to }, $or: [{ endAt: null }, { endAt: { $gt: from } }] };
  if (q.machineId) filter.machineId = q.machineId;

  const items = await MachineStatus.find(filter)
    .sort({ startAt: -1 })
    .limit(q.limit || 500)
    .lean();

  res.json(ok(items));
});
