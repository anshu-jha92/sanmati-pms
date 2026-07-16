import { z } from 'zod';
import { QualityCheck } from '../models/QualityCheck.js';
import { InventoryItem } from '../models/Inventory.js';
import { JobOrder } from '../models/JobOrder.js';
import { Dispatch } from '../models/Dispatch.js';
import { Machine } from '../models/Machine.js';
import { MachineStatus } from '../models/MachineStatus.js';
import { asyncHandler, ok } from '../utils/http.js';

/**
 * Reports & Analytics — READ ONLY.
 * One aggregation endpoint that rolls up Quality, Machine utilisation, Inventory,
 * Production and Dispatch over a date window. Nothing is written to the DB.
 *
 * GET /api/v1/reports/summary?from=&to=&plantId=
 */

const query = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  plantId: z.string().nullish(),
});

export const reportsSummary = asyncHandler(async (req, res) => {
  const p = query.parse(req.query);
  const now = new Date();
  const to = p.to || now;
  const from = p.from || new Date(to.getTime() - 30 * 24 * 3600 * 1000); // default: last 30 days
  const plantFilter = p.plantId ? { plantId: p.plantId } : {};

  /* ── QUALITY ── */
  const checks = await QualityCheck.find({ ...plantFilter, checkedAt: { $gte: from, $lte: to } }).lean();
  const decisionCount = { pass: 0, reject: 0, rework: 0, hold: 0 };
  let sampled = 0, rejected = 0, rework = 0, passed = 0;
  const stageMap = {};
  const defectMap = {};
  for (const c of checks) {
    if (decisionCount[c.decision] !== undefined) decisionCount[c.decision] += 1;
    sampled += c.sampledQty || 0;
    rejected += c.rejectedQty || 0;
    rework += c.reworkQty || 0;
    passed += c.passedQty || 0;
    const st = c.stage || 'other';
    if (!stageMap[st]) stageMap[st] = { stage: st, checks: 0, sampled: 0, rejected: 0 };
    stageMap[st].checks += 1; stageMap[st].sampled += c.sampledQty || 0; stageMap[st].rejected += c.rejectedQty || 0;
    for (const d of c.defects || []) defectMap[d.code] = (defectMap[d.code] || 0) + (d.qty || 1);
  }
  const quality = {
    checks: checks.length,
    ...decisionCount,
    decisions: { ...decisionCount }, // unambiguous per-check decision breakdown (pass/reject/rework/hold)
    sampled, rejected, rework, passed,
    rejectionRatePct: sampled > 0 ? +((rejected / sampled) * 100).toFixed(1) : 0,
    byStage: Object.values(stageMap).sort((a, b) => b.rejected - a.rejected || b.checks - a.checks),
    topDefects: Object.entries(defectMap).map(([code, qty]) => ({ code, qty })).sort((a, b) => b.qty - a.qty).slice(0, 6),
  };

  /* ── MACHINES (utilisation over window) ── */
  const machines = await Machine.find({ active: true, ...plantFilter }).select('code name stage currentStatus').lean();
  const machineIds = machines.map((m) => m._id);
  const intervals = machineIds.length
    ? await MachineStatus.find({ machineId: { $in: machineIds }, startAt: { $lt: to }, $or: [{ endAt: null }, { endAt: { $gt: from } }] }).lean()
    : [];
  const clip = (iv) => {
    const s = Math.max(new Date(iv.startAt).getTime(), from.getTime());
    const e = Math.min(iv.endAt ? new Date(iv.endAt).getTime() : now.getTime(), to.getTime());
    return Math.max(0, Math.floor((e - s) / 1000));
  };
  const perMachine = new Map();
  const STATES = ['running', 'idle', 'down', 'maintenance', 'offline'];
  for (const iv of intervals) {
    const k = String(iv.machineId);
    if (!perMachine.has(k)) perMachine.set(k, Object.fromEntries(STATES.map((s) => [s, 0])));
    const b = perMachine.get(k);
    if (b[iv.state] !== undefined) b[iv.state] += clip(iv);
  }
  const mTotals = Object.fromEntries(STATES.map((s) => [s, 0]));
  const byMachine = machines.map((m) => {
    const b = perMachine.get(String(m._id)) || Object.fromEntries(STATES.map((s) => [s, 0]));
    for (const s of STATES) mTotals[s] += b[s];
    const tracked = STATES.reduce((n, s) => n + b[s], 0);
    return { code: m.code, name: m.name, stage: m.stage, ...b, tracked, availabilityPct: tracked > 0 ? Math.round((b.running / tracked) * 100) : 0, state: m.currentStatus?.state || 'offline' };
  }).sort((a, b) => b.running - a.running);
  const mTracked = STATES.reduce((n, s) => n + mTotals[s], 0);
  const machinesReport = { count: machines.length, ...mTotals, availabilityPct: mTracked > 0 ? Math.round((mTotals.running / mTracked) * 100) : 0, byMachine };

  /* ── INVENTORY (current snapshot) ── */
  const items = await InventoryItem.find({ active: true, ...plantFilter }).lean();
  let totalValue = 0, lowStock = 0;
  const typeMap = {};
  const lowList = [];
  for (const it of items) {
    const val = (it.onHand || 0) * (it.unitCost || 0);
    totalValue += val;
    const t = it.type || 'other';
    if (!typeMap[t]) typeMap[t] = { type: t, items: 0, value: 0, onHand: 0 };
    typeMap[t].items += 1; typeMap[t].value += val; typeMap[t].onHand += it.onHand || 0;
    if ((it.reorderLevel || 0) > 0 && (it.onHand || 0) < it.reorderLevel) {
      lowStock += 1;
      lowList.push({ sku: it.sku, name: it.name, onHand: it.onHand || 0, reorderLevel: it.reorderLevel, uom: it.uom });
    }
  }
  const inventory = {
    items: items.length,
    totalValue: Math.round(totalValue),
    lowStock,
    byType: Object.values(typeMap).map((t) => ({ ...t, value: Math.round(t.value) })).sort((a, b) => b.value - a.value),
    lowList: lowList.sort((a, b) => (a.onHand - a.reorderLevel) - (b.onHand - b.reorderLevel)).slice(0, 8),
  };

  /* ── PRODUCTION (jobs created in range) ── */
  const jobs = await JobOrder.find({ ...plantFilter, createdAt: { $gte: from, $lte: to } }).select('status stages plannedQty uom').lean();
  const jobStatus = {};
  let producedKg = 0, plannedKg = 0;
  for (const j of jobs) {
    jobStatus[j.status] = (jobStatus[j.status] || 0) + 1;
    plannedKg += j.plannedQty || 0;
    const pack = (j.stages || []).find((s) => s.stage === 'packaging' && s.status === 'completed');
    if (pack?.weightOutKg) producedKg += pack.weightOutKg;
  }
  const production = {
    jobs: jobs.length,
    byStatus: jobStatus,
    completed: jobStatus.completed || 0,
    inProgress: jobStatus.in_progress || 0,
    producedKg: Math.round(producedKg),
    plannedKg: Math.round(plannedKg),
  };

  /* ── DISPATCH (created in range) ── */
  const dispatches = await Dispatch.find({ ...plantFilter, createdAt: { $gte: from, $lte: to } }).select('status lines').lean();
  const dispatchStatus = {};
  let dispatchedUnits = 0;
  for (const d of dispatches) {
    dispatchStatus[d.status] = (dispatchStatus[d.status] || 0) + 1;
    dispatchedUnits += (d.lines || []).reduce((n, l) => n + (l.qty || 0), 0);
  }
  const dispatch = {
    total: dispatches.length,
    byStatus: dispatchStatus,
    delivered: dispatchStatus.delivered || 0,
    inTransit: dispatchStatus.dispatched || 0,
    units: dispatchedUnits,
  };

  res.json(ok({
    range: { from: from.toISOString(), to: to.toISOString() },
    quality, machines: machinesReport, inventory, production, dispatch,
  }));
});
