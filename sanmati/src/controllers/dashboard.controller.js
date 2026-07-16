import mongoose from 'mongoose';
import { Machine } from '../models/Machine.js';
import { OEERollup } from '../models/OEERollup.js';
import { ProductionOrder } from '../models/ProductionOrder.js';
import { QualityCheck } from '../models/QualityCheck.js';
import { Dispatch } from '../models/Dispatch.js';
import { asyncHandler, ok } from '../utils/http.js';
import { cacheService } from '../services/cache.service.js';

/**
 * Main dashboard KPIs.
 *   - Machine state breakdown (running/idle/maintenance/down/offline counts)
 *   - Today's OEE (weighted avg across machines, today's day rollups)
 *   - Throughput today (sum totalProduced)
 *   - Order status counts
 *   - QC pass rate today
 *   - Pending dispatches
 *
 * 30-second cache per plant.
 */
export const overview = asyncHandler(async (req, res) => {
  const plantId = req.query.plantId || req.user.plantId;
  if (!plantId) return res.json(ok({ empty: true }));

  const key = `dash:overview:${plantId}`;
  const data = await cacheService.getOrSet(
    key,
    30,
    async () => {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const plantObj = new mongoose.Types.ObjectId(plantId);

      const [machineBreakdown, todaysRollup, orderCounts, qcToday, dispatchPending] = await Promise.all([
        Machine.aggregate([
          { $match: { plantId: plantObj, active: true } },
          { $group: { _id: '$currentStatus.state', count: { $sum: 1 } } },
        ]),
        OEERollup.aggregate([
          { $match: { plantId: plantObj, granularity: 'day', bucketStart: today } },
          {
            $group: {
              _id: null,
              avgAvailability: { $avg: '$availability' },
              avgPerformance: { $avg: '$performance' },
              avgQuality: { $avg: '$quality' },
              avgOee: { $avg: '$oee' },
              totalProduced: { $sum: '$totalProduced' },
              goodProduced: { $sum: '$goodProduced' },
              rejects: { $sum: '$rejects' },
            },
          },
        ]),
        ProductionOrder.aggregate([
          { $match: { plantId: plantObj } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        QualityCheck.aggregate([
          { $match: { plantId: plantObj, checkedAt: { $gte: today } } },
          {
            $group: {
              _id: null,
              sampled: { $sum: '$sampledQty' },
              passed: { $sum: '$passedQty' },
              rejected: { $sum: '$rejectedQty' },
              rework: { $sum: '$reworkQty' },
            },
          },
        ]),
        Dispatch.countDocuments({ plantId: plantObj, status: { $in: ['planned', 'packed', 'loaded'] } }),
      ]);

      const stateCounts = Object.fromEntries(machineBreakdown.map((d) => [d._id || 'offline', d.count]));
      const orderStatus = Object.fromEntries(orderCounts.map((d) => [d._id, d.count]));
      const oeeStats = todaysRollup[0] || {};
      const qc = qcToday[0] || {};
      const qcRate = qc.sampled ? qc.passed / qc.sampled : null;

      return {
        machines: {
          running: stateCounts.running || 0,
          idle: stateCounts.idle || 0,
          maintenance: stateCounts.maintenance || 0,
          down: stateCounts.down || 0,
          offline: stateCounts.offline || 0,
        },
        oee: {
          availability: round3(oeeStats.avgAvailability),
          performance: round3(oeeStats.avgPerformance),
          quality: round3(oeeStats.avgQuality),
          oee: round3(oeeStats.avgOee),
          totalProduced: oeeStats.totalProduced || 0,
          goodProduced: oeeStats.goodProduced || 0,
          rejects: oeeStats.rejects || 0,
        },
        orders: {
          planned: orderStatus.planned || 0,
          in_progress: orderStatus.in_progress || 0,
          paused: orderStatus.paused || 0,
          completed: orderStatus.completed || 0,
        },
        qc: {
          sampled: qc.sampled || 0,
          passRate: round3(qcRate),
          rejected: qc.rejected || 0,
          rework: qc.rework || 0,
        },
        dispatch: {
          pending: dispatchPending,
        },
        generatedAt: new Date().toISOString(),
      };
    },
    ['dashboard']
  );

  res.json(ok(data));
});

function round3(v) {
  if (v === undefined || v === null || !Number.isFinite(v)) return null;
  return Math.round(v * 1000) / 1000;
}
