import mongoose from 'mongoose';
import { MachineData } from '../models/MachineData.js';
import { MachineStatus } from '../models/MachineStatus.js';
import { OEERollup } from '../models/OEERollup.js';
import { Machine } from '../models/Machine.js';

/**
 * OEE engine.
 *
 * OEE = Availability × Performance × Quality
 *
 *   Availability = runTime / plannedProductionTime
 *   Performance  = (idealCycleTime × totalProduced) / runTime
 *   Quality      = goodProduced / totalProduced
 *
 * Inputs (per bucket [t1,t2] per machine):
 *   - plannedProductionSec: seconds the machine was scheduled to run (t2 - t1 minus planned stoppages)
 *     For simplicity we treat plannedProductionSec = bucket length minus planned 'maintenance' state intervals.
 *   - runTimeSec: summed 'running' state intervals within [t1,t2]
 *   - totalProduced / rejects: summed unitsProduced / rejects from telemetry within [t1,t2]
 *   - idealCycleTimeSec: from Machine config
 *
 * This module is called by workers/oee.worker.js. It is idempotent: running it again
 * for the same bucket upserts the same rollup (unique index on machine+granularity+bucketStart).
 */

const BUCKETS = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

export function bucketBoundaries(granularity, at = new Date()) {
  const ms = BUCKETS[granularity];
  if (!ms) throw new Error(`Unsupported granularity ${granularity}`);
  const start = new Date(Math.floor(at.getTime() / ms) * ms);
  const end = new Date(start.getTime() + ms);
  return { start, end };
}

/**
 * Sum time spent in each state for a machine over [start,end], treating open intervals correctly.
 * Returns { running, idle, maintenance, down, offline } in seconds.
 */
export async function stateDurations(machineId, start, end) {
  const intervals = await MachineStatus.find({
    machineId,
    startAt: { $lt: end },
    $or: [{ endAt: { $gt: start } }, { endAt: null }],
  })
    .select('state startAt endAt')
    .lean();

  const totals = { running: 0, idle: 0, maintenance: 0, down: 0, offline: 0 };
  for (const iv of intervals) {
    const s = iv.startAt < start ? start : iv.startAt;
    const e = !iv.endAt || iv.endAt > end ? end : iv.endAt;
    const sec = Math.max(0, (e - s) / 1000);
    totals[iv.state] = (totals[iv.state] || 0) + sec;
  }
  return totals;
}

/**
 * Sum telemetry counters for a machine over [start,end].
 */
export async function productionTotals(machineId, start, end) {
  const res = await MachineData.aggregate([
    {
      $match: {
        'metadata.machineId': new mongoose.Types.ObjectId(machineId),
        timestamp: { $gte: start, $lt: end },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ['$unitsProduced', 0] } },
        rejects: { $sum: { $ifNull: ['$rejects', 0] } },
        operators: { $addToSet: '$operatorCode' },
      },
    },
  ]);
  const r = res[0] || { total: 0, rejects: 0, operators: [] };
  return { total: r.total, rejects: r.rejects, operators: r.operators.filter(Boolean) };
}

/**
 * Compute a rollup for one bucket and upsert into OEERollup.
 */
export async function computeBucket(machineId, granularity, bucketStart) {
  const ms = BUCKETS[granularity];
  const bucketEnd = new Date(bucketStart.getTime() + ms);

  const machine = await Machine.findById(machineId).select('plantId idealCycleTimeSec targetOutputPerHour').lean();
  if (!machine) return null;

  const [durations, totals] = await Promise.all([
    stateDurations(machineId, bucketStart, bucketEnd),
    productionTotals(machineId, bucketStart, bucketEnd),
  ]);

  const runTimeSec = durations.running;
  // Planned = bucket length minus planned maintenance. Idle + down are losses counted against availability.
  const plannedProductionSec = Math.max(1, ms / 1000 - durations.maintenance);
  const idealCycleTimeSec = machine.idealCycleTimeSec || 1;

  const availability = clamp01(runTimeSec / plannedProductionSec);
  const performance = runTimeSec > 0 ? clamp01((idealCycleTimeSec * totals.total) / runTimeSec) : 0;
  const good = Math.max(0, totals.total - totals.rejects);
  const quality = totals.total > 0 ? clamp01(good / totals.total) : 1;
  const oee = round3(availability * performance * quality);

  const payload = {
    machineId,
    plantId: machine.plantId,
    granularity,
    bucketStart,
    bucketEnd,
    plannedProductionSec: round3(plannedProductionSec),
    runTimeSec: round3(runTimeSec),
    idleTimeSec: round3(durations.idle),
    downTimeSec: round3(durations.down),
    maintenanceTimeSec: round3(durations.maintenance),
    totalProduced: totals.total,
    goodProduced: good,
    rejects: totals.rejects,
    idealCycleTimeSec,
    availability: round3(availability),
    performance: round3(performance),
    quality: round3(quality),
    oee,
    computedAt: new Date(),
  };

  const doc = await OEERollup.findOneAndUpdate(
    { machineId, granularity, bucketStart },
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return doc;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function round3(v) {
  return Math.round(v * 1000) / 1000;
}
