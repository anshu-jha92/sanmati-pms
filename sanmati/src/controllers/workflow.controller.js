import { z } from 'zod';
import mongoose from 'mongoose';
import { SalesOrder } from '../models/SalesOrder.js';
import { JobOrder, STAGES } from '../models/JobOrder.js';
import { Machine } from '../models/Machine.js';
import { Plant } from '../models/Plant.js';
import { InventoryItem, InventoryMovement } from '../models/Inventory.js';
import { Notification } from '../models/Notification.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { parsePagination, paginatedMeta } from '../utils/pagination.js';
import { buildFilter, scopeToPrincipal } from '../services/filter.service.js';
import { cacheService } from '../services/cache.service.js';
import { socketService } from '../services/socket.service.js';
import { checkAvailability, getDashboardSuggestions, getDashboardAlerts } from '../services/availability.service.js';
import { AuditLog } from '../models/AuditLog.js';

/* ════════════════════════════════════════════════════════════════════════
 * SALES ORDERS
 * ══════════════════════════════════════════════════════════════════════ */

const soListQuery = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  customer: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});

export const listSalesOrders = asyncHandler(async (req, res) => {
  const q = soListQuery.parse(req.query);
  const { page, limit, skip, sort } = parsePagination(q);

  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.priority) filter.priority = q.priority;
  if (q.customer) filter.customer = new RegExp(q.customer, 'i');
  if (q.q) filter.$text = { $search: q.q };
  scopeToPrincipal(filter, req.user, { plantField: 'plantId' });

  const [items, total] = await Promise.all([
    SalesOrder.find(filter).sort(sort || { dueDate: 1 }).skip(skip).limit(limit).lean(),
    SalesOrder.countDocuments(filter),
  ]);

  // Enrich each SO with production status derived from linked Jobs
  // - notStarted: no Jobs created yet (needs Plan & Schedule)
  // - planned: Jobs exist but none started
  // - inProgress: at least one Job is in_progress / paused / qc_hold
  // - completed: ALL job lines completed
  const allJobIds = items.flatMap((so) =>
    (so.lines || []).flatMap((l) => l.jobOrderIds || [])
  );
  let jobsById = {};
  if (allJobIds.length > 0) {
    const jobs = await JobOrder.find(
      { _id: { $in: allJobIds } },
      { status: 1, orderNumber: 1, jobNumber: 1, currentStageIndex: 1, stages: 1 }
    ).lean();
    jobsById = Object.fromEntries(jobs.map((j) => [String(j._id), j]));
  }

  const enriched = items.map((so) => {
    const linkedJobs = (so.lines || []).flatMap((l) =>
      (l.jobOrderIds || []).map((id) => jobsById[String(id)]).filter(Boolean)
    );

    let productionStatus = 'notStarted';
    if (linkedJobs.length > 0) {
      const allCompleted = linkedJobs.every((j) => j.status === 'completed');
      const anyInProgress = linkedJobs.some((j) => ['in_progress', 'paused', 'qc_hold', 'released'].includes(j.status));
      if (allCompleted) productionStatus = 'completed';
      else if (anyInProgress) productionStatus = 'inProgress';
      else productionStatus = 'planned';
    }

    return {
      ...so,
      productionStatus,
      jobsCount: linkedJobs.length,
      jobs: linkedJobs.map((j) => ({
        _id: j._id,
        orderNumber: j.orderNumber,
        jobNumber: j.jobNumber,
        status: j.status,
        currentStageIndex: j.currentStageIndex || 0,
      })),
    };
  });

  res.json(ok(enriched, paginatedMeta({ page, limit, total })));
});

export const getSalesOrder = asyncHandler(async (req, res) => {
  const so = await SalesOrder.findById(req.params.id).lean();
  if (!so) throw ApiError.notFound('Sales order not found');
  res.json(ok(so));
});

/**
 * Create a sales order manually (as opposed to ERP sync).
 * Generates an externalId of MANUAL-<timestamp> so it plays nicely with the
 * unique-index constraint (all SO records need one).
 */
const soCreateSchema = z.object({
  orderNumber: z.string().optional(),   // auto-generated if not provided
  customer: z.string().min(1),
  customerEmail: z.string().optional(),
  customerPhone: z.string().optional(),
  priority: z.enum(['high', 'medium', 'normal']).optional(),
  status: z.enum(['new', 'planning', 'in_progress', 'fulfilled', 'cancelled', 'on_hold']).optional(),
  orderedAt: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  totalValue: z.number().optional(),
  currency: z.string().optional(),
  plantId: z.string().nullish(),   // may be null (admin has no plant) → resolved server-side
  notes: z.string().optional(),
  lines: z.array(z.object({
    sku: z.string().min(1),
    productName: z.string().min(1),
    qty: z.number().positive(),
    uom: z.string().optional(),
    dueDate: z.coerce.date().optional(),
  })).min(1),
});

/**
 * Resolve a usable plantId for order/job creation:
 *   explicit payload plantId → the caller's own plant → the first plant in the DB.
 * Admin users often have no plantId, so a null value must NOT hard-fail — we fall
 * back to the single/first plant so the create flow keeps working. Also guards
 * against a bad id (e.g. a User id pasted by mistake) by verifying it exists.
 */
async function resolvePlantId(rawPlantId, user) {
  let plantId = rawPlantId || user?.plantId || null;
  if (plantId) {
    const exists = await Plant.findById(plantId).lean();
    if (!exists) plantId = user?.plantId || null;
  }
  if (!plantId) {
    const fallback = await Plant.findOne().sort({ createdAt: 1 }).lean();
    plantId = fallback?._id || null;
  }
  if (!plantId) {
    throw ApiError.badRequest(
      'No valid plant found. Seed a plant first, or pass a real plantId.',
      { code: 'E_NO_PLANT' }
    );
  }
  return plantId;
}

export const createSalesOrder = asyncHandler(async (req, res) => {
  const payload = soCreateSchema.parse(req.body);

  // Auto-generate orderNumber if missing: SO-<epoch base36>
  const ts = Date.now();
  const orderNumber = payload.orderNumber || `SO-${ts.toString(36).toUpperCase()}`;
  const externalId = `MANUAL-${ts}`;

  const plantId = await resolvePlantId(payload.plantId, req.user);

  const doc = await SalesOrder.create({
    externalId,
    orderNumber,
    customer: payload.customer,
    priority: payload.priority || 'normal',
    status: payload.status || 'new',
    orderedAt: payload.orderedAt || new Date(),
    dueDate: payload.dueDate,
    totalValue: payload.totalValue,
    currency: payload.currency || 'INR',
    plantId,
    notes: payload.notes,
    lines: payload.lines.map((l) => ({
      sku: String(l.sku).toUpperCase(),
      productName: l.productName,
      qty: l.qty,
      uom: l.uom || 'kg',
      dueDate: l.dueDate,
      status: 'pending',
    })),
    syncedAt: new Date(),
    seenAt: new Date(),
  });

  await AuditLog.create({
    actor: req.user.id,
    actorEmail: req.user.email,
    action: 'sales_order.create',
    module: 'sales_orders',
    targetType: 'SalesOrder',
    targetId: String(doc._id),
    after: doc.toObject(),
    ip: req.ip,
    plantId: doc.plantId,
  });

  await cacheService.invalidateTag('sales_orders');
  res.status(201).json(ok(doc));
});

/**
 * Delete a sales order (used to remove accidental duplicates). Blocks if any
 * linked job has already started; otherwise removes the SO and its not-yet-
 * started jobs so nothing is left orphaned.
 */
export const deleteSalesOrder = asyncHandler(async (req, res) => {
  const so = await SalesOrder.findById(req.params.id);
  if (!so) throw ApiError.notFound('Sales order not found');

  const jobIds = (so.lines || []).flatMap((l) => l.jobOrderIds || []);
  let removedJobs = 0;
  if (jobIds.length) {
    const active = await JobOrder.findOne({
      _id: { $in: jobIds },
      status: { $in: ['in_progress', 'paused', 'qc_hold', 'completed'] },
    }).lean();
    if (active) {
      throw ApiError.conflict(
        'This sales order has a job that is already in production. Cancel or finish that job before deleting the order.',
        { code: 'E_SO_HAS_ACTIVE_JOB' }
      );
    }
    const del = await JobOrder.deleteMany({ _id: { $in: jobIds } });
    removedJobs = del.deletedCount || 0;
  }

  await so.deleteOne();
  await AuditLog.create({
    actor: req.user.id, actorEmail: req.user.email,
    action: 'sales_order.delete', module: 'sales_orders',
    targetType: 'SalesOrder', targetId: String(so._id),
    before: so.toObject(), ip: req.ip, plantId: so.plantId,
  });
  await cacheService.invalidateTag('sales_orders');
  res.json(ok({ deleted: true, _id: so._id, removedJobs }));
});

/**
 * Availability check for a specific line of a sales order.
 * Returns materials/machines/operators state + go/no-go recommendation.
 */
export const salesOrderAvailability = asyncHandler(async (req, res) => {
  const so = await SalesOrder.findById(req.params.id).lean();
  if (!so) throw ApiError.notFound('Sales order not found');

  const results = [];
  for (const line of so.lines || []) {
    const result = await checkAvailability({
      sku: line.sku,
      qty: line.qty,
      plantId: so.plantId,
    });
    results.push({
      lineId: line._id,
      sku: line.sku,
      productName: line.productName,
      qty: line.qty,
      uom: line.uom,
      ...result,
    });
  }
  res.json(ok({ salesOrder: { id: so._id, orderNumber: so.orderNumber, customer: so.customer }, lines: results }));
});

/* ════════════════════════════════════════════════════════════════════════
 * JOB ORDERS — internal work orders created from sales-order lines
 * ══════════════════════════════════════════════════════════════════════ */

const jobCreateSchema = z.object({
  salesOrderId: z.string().optional(),
  salesOrderLineId: z.string().optional(),
  orderNumber: z.string().optional(), // PB-001; auto-generated if not given
  jobNumber: z.string().optional(),   // JOB-7845; auto-generated if not given
  customer: z.string().optional(),
  product: z.object({
    sku: z.string(),
    name: z.string(),
    specRef: z.string().optional(),
  }),
  plannedQty: z.number().positive(),
  uom: z.string().optional(),
  inputRollWeightKg: z.number().nonnegative().optional(),
  inputRollDescription: z.string().optional(),
  priority: z.enum(['high', 'medium', 'normal']).optional(),
  dueDate: z.coerce.date().optional(),
  plannedStart: z.coerce.date().optional(),
  plantId: z.string().nullish(),   // may be null → resolved server-side to the caller's / first plant
  bomSnapshot: z.object({
    externalId: z.string().optional(),
    version: z.string().optional(),
    components: z.array(z.object({
      sku: z.string(),
      name: z.string().optional(),
      qtyPerUnit: z.number(),
      uom: z.string().optional(),
      scrapPct: z.number().optional(),
    })).optional(),
  }).optional(),
});

/**
 * Create a JobOrder from a sales-order line (or ad-hoc).
 * Automatically creates one StageExecution per stage in the fixed sequence.
 */
export const createJobOrder = asyncHandler(async (req, res) => {
  const payload = jobCreateSchema.parse(req.body);
  const now = Date.now();

  // Idempotency guard: if this Sales Order line already has a non-cancelled
  // Job linked to it, return that existing job instead of creating a duplicate.
  // This prevents "Plan & Schedule" double-clicks (or stale-cache re-clicks
  // after navigating away and back) from spawning multiple PB-### jobs from
  // the same SO line.
  if (payload.salesOrderId && payload.salesOrderLineId) {
    const so = await SalesOrder.findOne(
      { _id: payload.salesOrderId, 'lines._id': payload.salesOrderLineId },
      { 'lines.$': 1 }
    ).lean();
    const linkedJobIds = so?.lines?.[0]?.jobOrderIds || [];
    if (linkedJobIds.length > 0) {
      const existingActive = await JobOrder.findOne({
        _id: { $in: linkedJobIds },
        status: { $ne: 'cancelled' },
      }).lean();
      if (existingActive) {
        // Already planned — just return the existing job. Frontend will
        // navigate to /planning where the user can see/edit it.
        return res.status(200).json(ok(existingActive));
      }
    }
  }

  const orderNumber = payload.orderNumber || await nextOrderNumber();
  const jobNumber = payload.jobNumber || await nextJobNumber();

  const stages = STAGES.map((stage, idx) => ({
    stage,
    sequence: idx + 1,
    status: idx === 0 ? 'ready' : 'pending',
  }));

  const plantId = await resolvePlantId(payload.plantId, req.user);
  const doc = await JobOrder.create({
    ...payload,
    plantId,
    orderNumber,
    jobNumber,
    source: payload.salesOrderId ? 'sales_order' : 'stock',
    stages,
    status: 'planned',
    currentStageIndex: 0,
    createdBy: req.user.id,
  });

  // Link back to sales-order line if provided
  if (payload.salesOrderId && payload.salesOrderLineId) {
    await SalesOrder.updateOne(
      { _id: payload.salesOrderId, 'lines._id': payload.salesOrderLineId },
      {
        $push: { 'lines.$.jobOrderIds': doc._id },
        $set: { 'lines.$.status': 'planned', status: 'planning' },
      }
    );
  }

  await AuditLog.create({
    actor: req.user.id,
    actorEmail: req.user.email,
    action: 'job.create',
    module: 'production',
    targetType: 'JobOrder',
    targetId: String(doc._id),
    after: doc.toObject(),
    ip: req.ip,
    plantId: doc.plantId,
  });

  await cacheService.invalidateTag('job_orders');
  socketService.emitOrderUpdate(String(doc.plantId), doc.toObject());
  res.status(201).json(ok(doc));
});

async function nextOrderNumber() {
  // Simple monotonic: PB-xxx based on count. For prod use a dedicated counters collection.
  const n = await JobOrder.countDocuments();
  return `PB-${String(n + 1).padStart(3, '0')}`;
}
async function nextJobNumber() {
  const n = await JobOrder.countDocuments();
  return `JOB-${7845 + n}`;
}

const jobListQuery = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  stage: z.string().optional(),
  plantId: z.string().nullish(),
  customer: z.string().optional(),
  operatorId: z.string().optional(),
  machineId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  month: z.string().optional(),
  year: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});

export const listJobOrders = asyncHandler(async (req, res) => {
  const q = jobListQuery.parse(req.query);
  const { page, limit, skip, sort } = parsePagination(q);

  const filter = buildFilter(q, {
    plantField: 'plantId',
    dateField: 'plannedStart',
    textSearch: false,   // we do our own — see below
  });
  if (q.status) filter.status = q.status;
  if (q.priority) filter.priority = q.priority;
  if (q.customer) filter.customer = new RegExp(q.customer, 'i');
  if (q.stage) {
    filter['stages.stage'] = q.stage;
    filter['stages.status'] = { $in: ['in_progress', 'ready'] };
  }
  if (q.operatorId) filter['stages.operatorId'] = new mongoose.Types.ObjectId(q.operatorId);
  if (q.machineId) filter['stages.machineId'] = new mongoose.Types.ObjectId(q.machineId);

  // Search by order number / job number / product / customer.
  // We deliberately AVOID $text here because Mongo's text index tokenises
  // "PB-001" as "pb" + "001", which then also matches "PB-002" — a serious
  // bug for the Order Tracking page where the user types an exact order
  // number and expects exactly that order back. Use a precise OR with
  // anchored regexes instead.
  if (q.q) {
    const term = String(q.q).trim();
    if (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { orderNumber: new RegExp(`^${escaped}$`, 'i') },        // exact match preferred
        { orderNumber: new RegExp(`^${escaped}`, 'i') },         // prefix match
        { jobNumber:   new RegExp(`^${escaped}`, 'i') },
        { 'product.sku':  new RegExp(escaped, 'i') },
        { 'product.name': new RegExp(escaped, 'i') },
        { customer: new RegExp(escaped, 'i') },
      ];
    }
  }
  scopeToPrincipal(filter, req.user, { plantField: 'plantId' });

  const [items, total] = await Promise.all([
    JobOrder.find(filter)
      .sort(sort || { priority: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      // Populate so OrderTracking page can show operator + machine names
      // without an extra round-trip per job. Only populate the small fields
      // we render — name/employeeCode for operator, code/name/stage for machine.
      .populate('stages.machineId', 'code name stage')
      .populate('stages.operatorId', 'name employeeCode')
      .lean(),
    JobOrder.countDocuments(filter),
  ]);

  res.json(ok(items, paginatedMeta({ page, limit, total })));
});

/* ════════════════════════════════════════════════════════════════════════
 * DELETE / CANCEL JOB — soft delete (sets status to 'cancelled')
 *
 * Allowed only if the job is in draft/planned/released status. In-progress
 * or completed jobs cannot be deleted (data integrity — they may have
 * inventory movements, IoT data, audit history attached).
 * ══════════════════════════════════════════════════════════════════════ */

export const deleteJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const job = await JobOrder.findById(id);
  if (!job) throw ApiError.notFound('Job order not found');
  if (!['draft', 'planned', 'released', 'cancelled'].includes(job.status)) {
    throw ApiError.badRequest(
      `Cannot delete a ${job.status} job. Only draft, planned, or released jobs can be deleted.`,
      { code: 'E_JOB_RUNNING' }
    );
  }

  const before = job.toObject();

  // Soft delete — preserves history, but un-links from sales order line
  job.status = 'cancelled';
  await job.save();

  // Pull this job's id from any linked sales order lines so re-planning works
  await SalesOrder.updateMany(
    { 'lines.jobOrderIds': job._id },
    {
      $pull: { 'lines.$[].jobOrderIds': job._id },
      $set: { 'lines.$[].status': 'pending' },
    }
  );

  await AuditLog.create({
    actor: req.user.id,
    actorEmail: req.user.email,
    action: 'job.delete',
    module: 'production',
    targetType: 'JobOrder',
    targetId: String(job._id),
    before,
    after: job.toObject(),
    ip: req.ip,
    plantId: job.plantId,
  });

  await cacheService.invalidateTag('job_orders');
  socketService.emitOrderUpdate(String(job.plantId), job.toObject());
  res.json(ok({ deleted: true, _id: String(job._id) }));
});

/* ════════════════════════════════════════════════════════════════════════
 * ASSIGN STAGE — pre-assign operator and/or machine to a stage
 *
 * Used during planning/scheduling. Manager picks who will handle each stage
 * and on which machine, with an optional plannedStart for that stage. When
 * the operator opens "My Jobs" later, they'll see this job assigned to them.
 * ══════════════════════════════════════════════════════════════════════ */

const assignStageSchema = z.object({
  operatorId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
  machineId: z.string().nullable().optional(),
  plannedStart: z.coerce.date().optional(),
  notes: z.string().optional(),
});

export const assignStage = asyncHandler(async (req, res) => {
  const { id, stageId } = req.params;
  const payload = assignStageSchema.parse(req.body);

  const job = await JobOrder.findById(id);
  if (!job) throw ApiError.notFound('Job order not found');
  const stage = job.stages.id(stageId);
  if (!stage) throw ApiError.notFound('Stage not found');
  if (['completed', 'skipped'].includes(stage.status)) {
    throw ApiError.badRequest(`Cannot reassign a ${stage.status} stage`);
  }

  const before = job.toObject();

  if (payload.operatorId !== undefined) {
    stage.operatorId = payload.operatorId
      ? new mongoose.Types.ObjectId(payload.operatorId)
      : undefined;
  }
  if (payload.teamId !== undefined) {
    stage.teamId = payload.teamId
      ? new mongoose.Types.ObjectId(payload.teamId)
      : undefined;
  }
  if (payload.machineId !== undefined) {
    stage.machineId = payload.machineId
      ? new mongoose.Types.ObjectId(payload.machineId)
      : undefined;
  }
  if (payload.plannedStart) {
    stage.plannedStart = payload.plannedStart;
  }

  // Sequential workflow: a stage can only become "ready" if all previous
  // stages are completed (or skipped). Otherwise it stays "pending" until
  // the prior stage completes — at which point completeStage will promote
  // the next stage to "ready" automatically.
  //
  // This prevents inspection from starting before printing finishes.
  const stageIdx = job.stages.findIndex((s) => String(s._id) === stageId);
  const prevStagesAllDone = job.stages
    .slice(0, stageIdx)
    .every((s) => ['completed', 'skipped'].includes(s.status));

  if (stage.status === 'pending' && (stage.operatorId || stage.machineId) && prevStagesAllDone) {
    stage.status = 'ready';
  }
  // If a later stage gets assigned but its predecessors aren't done, the
  // assignment is still saved (operator pre-assigned) — but status stays
  // pending. It will auto-flip to ready when the previous stage completes.

  await job.save();

  await AuditLog.create({
    actor: req.user.id,
    actorEmail: req.user.email,
    action: 'job.assign_stage',
    module: 'production',
    targetType: 'JobOrder',
    targetId: String(job._id),
    before,
    after: job.toObject(),
    ip: req.ip,
    plantId: job.plantId,
  });

  await cacheService.invalidateTag('job_orders');
  socketService.emitOrderUpdate(String(job.plantId), job.toObject());
  res.json(ok(job.toObject()));
});

export const getJobOrder = asyncHandler(async (req, res) => {
  const doc = await JobOrder.findById(req.params.id)
    .populate('stages.machineId', 'code name stage')
    .populate('stages.operatorId', 'name employeeCode')
    .lean();
  if (!doc) throw ApiError.notFound('Job order not found');
  res.json(ok(doc));
});

/* ════════════════════════════════════════════════════════════════════════
 * SCHEDULING — set/update plannedStart, dueDate, priority
 * Used by the Scheduling page to plan when each job will start.
 * ══════════════════════════════════════════════════════════════════════ */

const scheduleSchema = z.object({
  plannedStart: z.coerce.date().optional(),
  plannedEnd: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  priority: z.enum(['high', 'medium', 'normal']).optional(),
  notes: z.string().optional(),
});

export const scheduleJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payload = scheduleSchema.parse(req.body);

  const job = await JobOrder.findById(id);
  if (!job) throw ApiError.notFound('Job order not found');
  if (['completed', 'cancelled'].includes(job.status)) {
    throw ApiError.badRequest(`Cannot schedule a ${job.status} job`);
  }

  const before = job.toObject();
  if (payload.plannedStart) job.plannedStart = payload.plannedStart;
  if (payload.plannedEnd) job.plannedEnd = payload.plannedEnd;
  if (payload.dueDate) job.dueDate = payload.dueDate;
  if (payload.priority) job.priority = payload.priority;

  // If a start date was set on a draft, auto-promote to 'planned'
  if (job.status === 'draft' && job.plannedStart) {
    job.status = 'planned';
  }

  await job.save();

  await AuditLog.create({
    actor: req.user.id,
    actorEmail: req.user.email,
    action: 'job.schedule',
    module: 'production',
    targetType: 'JobOrder',
    targetId: String(job._id),
    before,
    after: job.toObject(),
    ip: req.ip,
    plantId: job.plantId,
  });

  await cacheService.invalidateTag('job_orders');
  socketService.emitOrderUpdate(String(job.plantId), job.toObject());
  res.json(ok(job.toObject()));
});

/* ════════════════════════════════════════════════════════════════════════
 * RELEASE — move from 'planned' to 'released' (queued for production)
 * Once released, operators can pick it up from their My Jobs list.
 * ══════════════════════════════════════════════════════════════════════ */

export const releaseJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const job = await JobOrder.findById(id);
  if (!job) throw ApiError.notFound('Job order not found');
  if (!['draft', 'planned'].includes(job.status)) {
    throw ApiError.badRequest(`Cannot release a ${job.status} job`);
  }

  const before = job.toObject();
  job.status = 'released';
  if (!job.plannedStart) job.plannedStart = new Date();

  // Promote ONLY the first stage to "ready" — operators can start it.
  // Subsequent stages stay "pending" and only flip to "ready" when their
  // predecessor completes. This enforces strict sequential execution.
  if (job.stages.length > 0) {
    const firstStage = job.stages[0];
    if (firstStage.status === 'pending') {
      firstStage.status = 'ready';
    }
  }

  await job.save();

  await AuditLog.create({
    actor: req.user.id,
    actorEmail: req.user.email,
    action: 'job.release',
    module: 'production',
    targetType: 'JobOrder',
    targetId: String(job._id),
    before,
    after: job.toObject(),
    ip: req.ip,
    plantId: job.plantId,
  });

  await cacheService.invalidateTag('job_orders');
  socketService.emitOrderUpdate(String(job.plantId), job.toObject());
  res.json(ok(job.toObject()));
});

/* ════════════════════════════════════════════════════════════════════════
 * STAGE EXECUTION — operator actions
 * ══════════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════
 * CONFIRM MATERIALS RECEIVED
 *
 * Operator confirms they have physically received the materials on the
 * machine and are ready to start. This unlocks the START PRODUCTION
 * action. Without this confirmation, startStage will return
 * E_MATERIALS_NOT_CONFIRMED.
 *
 * Validates that at least one material has been issued to this stage —
 * otherwise the operator wouldn't have anything to confirm.
 * ══════════════════════════════════════════════════════════════════════ */

export const confirmMaterialsReceived = asyncHandler(async (req, res) => {
  const { id, stageId } = req.params;
  const job = await JobOrder.findById(id);
  if (!job) throw ApiError.notFound('Job order not found');
  const stage = job.stages.id(stageId);
  if (!stage) throw ApiError.notFound('Stage not found');

  if (stage.materialsConfirmedAt) {
    // Idempotent — already confirmed, just return current state
    return res.json(ok(job.toObject()));
  }

  if (stage.status === 'completed' || stage.status === 'in_progress') {
    throw ApiError.conflict('Stage is already past confirmation');
  }

  // Sanity check: must have at least one material added before confirming.
  // (Inspection stage doesn't go through this flow at all.)
  const hasMaterials = (stage.materialsAdded || []).length > 0;
  if (!hasMaterials) {
    throw ApiError.badRequest(
      'No materials issued yet. Request materials and wait for inventory to issue before confirming.',
      { code: 'E_NO_MATERIALS' }
    );
  }

  stage.materialsConfirmedAt = new Date();
  stage.materialsConfirmedBy = req.user.id;
  await job.save();

  socketService.emitOrderUpdate(String(job.plantId), job.toObject());
  res.json(ok(job.toObject()));
});

const stageStartSchema = z.object({
  machineId: z.string().optional(),  // optional for manual stages (inspection)
  operatorId: z.string().optional(), // defaults to current user
  weightInKg: z.number().nonnegative().optional(),
});

/**
 * Operator starts a stage: sets machine + operator, transitions status → in_progress,
 * stamps startedAt. Weight-in defaults to previous stage's weight-out (or inputRollWeight).
 *
 * Some stages (inspection) don't need a machine — they're manual QC. We allow
 * machineId to be omitted, in which case the stage just gets an operator and
 * a start time. No machine status update happens.
 */
export const startStage = asyncHandler(async (req, res) => {
  const { id, stageId } = req.params;
  const payload = stageStartSchema.parse(req.body);

  const job = await JobOrder.findById(id);
  if (!job) throw ApiError.notFound('Job order not found');
  const stage = job.stages.id(stageId);
  if (!stage) throw ApiError.notFound('Stage not found');
  if (stage.status === 'in_progress') throw ApiError.conflict('Stage already in progress');
  if (stage.status === 'completed') throw ApiError.conflict('Stage already completed');

  // Sequential gate: cannot start a stage until all previous stages are
  // completed (or skipped). This prevents Inspection from running while
  // Printing is still in progress.
  const stageIdx = job.stages.findIndex((s) => String(s._id) === stageId);
  const blockingStages = job.stages
    .slice(0, stageIdx)
    .filter((s) => !['completed', 'skipped'].includes(s.status));

  if (blockingStages.length > 0) {
    const blockerNames = blockingStages.map((s) => s.stage.replace(/_/g, ' ')).join(', ');
    throw ApiError.badRequest(
      `Cannot start ${stage.stage.replace(/_/g, ' ')} yet — waiting for: ${blockerNames}`,
      { code: 'E_STAGE_BLOCKED' }
    );
  }

  // Inspection is a manual QC stage and does not consume raw materials.
  // For all other stages, the operator MUST confirm materials received
  // before starting. This forces the request → issue → confirm flow:
  //   1. Operator requests materials
  //   2. Inventory issues them
  //   3. Operator confirms receipt
  //   4. THEN operator can start production
  if (stage.stage !== 'inspection' && !stage.materialsConfirmedAt) {
    throw ApiError.badRequest(
      'Materials not confirmed yet. Request materials from store, wait for inventory to issue them, then confirm receipt before starting.',
      { code: 'E_MATERIALS_NOT_CONFIRMED' }
    );
  }

  // Determine weight-in
  let weightIn = payload.weightInKg;
  if (weightIn === undefined) {
    const idx = job.stages.findIndex((s) => String(s._id) === stageId);
    if (idx > 0) {
      const prev = job.stages[idx - 1];
      weightIn = prev.weightOutKg || 0;
    } else {
      weightIn = job.inputRollWeightKg || 0;
    }
  }

  if (payload.machineId) stage.machineId = payload.machineId;
  stage.operatorId = payload.operatorId || req.user.id;
  stage.weightInKg = weightIn;
  stage.status = 'in_progress';
  stage.startedAt = new Date();

  if (job.status === 'planned' || job.status === 'released') {
    job.status = 'in_progress';
    job.actualStart = job.actualStart || new Date();
  }

  await job.save();

  // Only update machine status if a machine was actually assigned.
  // Inspection stage typically runs without a machine.
  if (payload.machineId) {
    await Machine.updateOne(
      { _id: payload.machineId },
      {
        $set: {
          'currentStatus.state': 'running',
          'currentStatus.since': new Date(),
          'currentStatus.currentOrder': job._id,
          'currentStatus.currentOperator': stage.operatorId,
        },
      }
    );
  }

  socketService.emitOrderUpdate(String(job.plantId), job.toObject());
  res.json(ok(job));
});

const stageCompleteSchema = z.object({
  weightOutKg: z.number().nonnegative(),
  rejectCountPcs: z.number().int().nonnegative().optional(),
  rejectWeightKg: z.number().nonnegative().optional(),
  materialsAdded: z.array(z.object({
    sku: z.string().optional(),
    name: z.string(),
    type: z.enum(['raw', 'consumable', 'packaging']).optional(),
    qty: z.number().positive(),
    uom: z.string().optional(),
    itemId: z.string().optional(),
  })).optional(),
  operatorRemarks: z.string().optional(),
  weightNote: z.string().optional(),
  assignNextOperatorId: z.string().optional(), // if caller wants to pre-assign next stage

  // ─── QC fields — used primarily by inspection stage ───
  // Per-parameter checklist filled during inspection
  qcChecklist: z.array(z.object({
    parameter: z.string().min(1),
    result: z.enum(['pass', 'fail', 'na']),
    remarks: z.string().optional(),
  })).optional(),
  // Final verdict from inspector: pass | fail | rework | hold
  qcDecision: z.enum(['pass', 'fail', 'rework', 'hold']).optional(),
  qcSampleSize: z.number().int().nonnegative().optional(),
  qcDefectCount: z.number().int().nonnegative().optional(),
  qcRemarks: z.string().optional(),
});

/**
 * Operator completes a stage: records weight-out, materials added, and hands off
 * to the next stage. If next stage operator wasn't pre-assigned, creates a
 * notification for managers asking them to assign one.
 *
 * No transactions — this works on Atlas free tier. We use atomic operations
 * and a manual rollback array for rare failures.
 */
export const completeStage = asyncHandler(async (req, res) => {
  const { id, stageId } = req.params;
  const payload = stageCompleteSchema.parse(req.body);

  const job = await JobOrder.findById(id);
  if (!job) throw ApiError.notFound('Job order not found');
  const stage = job.stages.id(stageId);
  if (!stage) throw ApiError.notFound('Stage not found');
  if (stage.status !== 'in_progress') {
    throw ApiError.conflict(`Stage is ${stage.status}, cannot complete`);
  }

  const rollback = [];

  try {
    // Update stage
    stage.weightOutKg = payload.weightOutKg;
    stage.rejectCountPcs = payload.rejectCountPcs || 0;
    stage.rejectWeightKg = payload.rejectWeightKg || 0;
    if (payload.materialsAdded) stage.materialsAdded.push(...payload.materialsAdded);
    if (payload.operatorRemarks) stage.operatorRemarks = payload.operatorRemarks;
    if (payload.weightNote) stage.weightNote = payload.weightNote;

    // Save QC results (used by inspection stage). This is also relevant to
    // any stage where the operator wants to flag quality concerns.
    if (payload.qcChecklist || payload.qcDecision) {
      stage.qcResult = stage.qcResult || {};
      if (payload.qcChecklist) stage.qcResult.checklist = payload.qcChecklist;
      if (payload.qcDecision) stage.qcResult.decision = payload.qcDecision;
      if (payload.qcSampleSize !== undefined) stage.qcResult.sampleSize = payload.qcSampleSize;
      if (payload.qcDefectCount !== undefined) stage.qcResult.defectCount = payload.qcDefectCount;
      if (payload.qcRemarks) stage.qcResult.remarks = payload.qcRemarks;
      stage.qcResult.inspectorId = req.user.id;
    }

    stage.status = 'completed';
    stage.completedAt = new Date();
    stage.durationSec = stage.startedAt
      ? Math.max(0, (stage.completedAt - stage.startedAt) / 1000)
      : 0;

    // Inventory write-down for each material added
    for (const mat of payload.materialsAdded || []) {
      if (!mat.itemId) continue;
      const item = await InventoryItem.findOneAndUpdate(
        { _id: mat.itemId, onHand: { $gte: mat.qty } },
        { $inc: { onHand: -mat.qty } },
        { new: true }
      );
      if (!item) continue;
      rollback.push(() => InventoryItem.updateOne({ _id: mat.itemId }, { $inc: { onHand: mat.qty } }));
      const mov = await InventoryMovement.create({
        sku: item.sku,
        itemId: item._id,
        plantId: item.plantId,
        type: 'OUT',
        qty: mat.qty,
        reference: { kind: 'production_order', id: String(job._id) },
        balanceAfter: item.onHand,
        performedBy: req.user.id,
        notes: `${job.orderNumber} — ${stage.stage}`,
      });
      rollback.push(() => InventoryMovement.deleteOne({ _id: mov._id }));
    }

    // Next stage handling
    const idx = job.stages.findIndex((s) => String(s._id) === stageId);
    const next = job.stages[idx + 1];

    // We always fire a notification when a stage completes. The TYPE of
    // notification depends on what comes next:
    //   - Job done            → "general" (informational, success)
    //   - Next stage unassigned → "stage_complete_assign_next" (warning, needs action)
    //   - Next stage assigned   → "general" (informational — supervisors may still want to know)
    let notificationKind = 'general';
    let notificationSeverity = 'info';
    let notificationTitle = '';
    let notificationMessage = '';

    // ─── Handle QC failures ───
    // If inspector marked fail/rework/hold, the job stops here. Don't progress
    // to next stage. Create urgent notification for supervisors.
    const qcBlocking = ['fail', 'rework', 'hold'].includes(payload.qcDecision);

    if (qcBlocking) {
      // Don't auto-advance. Job goes on qc_hold for manager review.
      job.status = 'qc_hold';

      const completedStageReadable = stage.stage.replace(/_/g, ' ');
      const decision = payload.qcDecision.toUpperCase();
      notificationKind = 'qc_failed';
      notificationSeverity = 'urgent';
      notificationTitle = `QC ${decision} on ${job.orderNumber}`;
      notificationMessage = `${req.user.name || 'Inspector'} marked ${completedStageReadable} as ${decision}. ` +
        `${payload.qcRemarks ? 'Remarks: ' + payload.qcRemarks : 'Job is on hold pending manager review.'}`;
    } else if (next) {
      next.status = 'ready';
      next.weightInKg = stage.weightOutKg;

      if (payload.assignNextOperatorId) {
        // Operator chose to pre-assign next operator
        next.operatorId = new mongoose.Types.ObjectId(payload.assignNextOperatorId);
      }

      const nextStageReadable = next.stage.replace(/_/g, ' ');
      const completedStageReadable = stage.stage.replace(/_/g, ' ');

      if (!next.operatorId) {
        notificationKind = 'stage_complete_assign_next';
        notificationSeverity = 'warning';
        notificationTitle = `Assign operator for ${nextStageReadable}`;
        notificationMessage = `${req.user.name || 'Operator'} finished ${completedStageReadable} on ${job.orderNumber}. Next stage (${nextStageReadable}) needs an operator.`;
      } else {
        notificationKind = 'general';
        notificationSeverity = 'info';
        notificationTitle = `${completedStageReadable} complete on ${job.orderNumber}`;
        notificationMessage = `${req.user.name || 'Operator'} finished ${completedStageReadable}. Next stage (${nextStageReadable}) is ready and assigned.`;
      }
    } else {
      // No next stage = entire job is done
      notificationKind = 'general';
      notificationSeverity = 'success';
      notificationTitle = `Job ${job.orderNumber} completed`;
      notificationMessage = `${req.user.name || 'Operator'} finished the final stage (${stage.stage.replace(/_/g, ' ')}) on ${job.orderNumber}. Order ready for dispatch.`;
    }

    // Rollups
    job.currentStageIndex = idx + 1;
    job.currentWeightKg = stage.weightOutKg;
    job.totalProducedKg = (job.totalProducedKg || 0) + stage.weightOutKg;
    job.totalRejectsKg = (job.totalRejectsKg || 0) + (stage.rejectWeightKg || 0);

    // If all stages completed, mark job done
    if (job.stages.every((s) => s.status === 'completed' || s.status === 'skipped')) {
      job.status = 'completed';
      job.actualEnd = new Date();
    }

    // Release machine
    if (stage.machineId) {
      await Machine.updateOne(
        { _id: stage.machineId },
        {
          $set: {
            'currentStatus.state': 'idle',
            'currentStatus.since': new Date(),
            'currentStatus.currentOrder': next ? job._id : null,
          },
        }
      );
    }

    await job.save();

    // Always fire a notification — admins/supervisors should know when stages
    // complete, especially if the next stage needs an operator assigned.
    try {
      const completedByName = req.user.name || req.user.email || 'Operator';
      const notif = await Notification.create({
        kind: notificationKind,
        title: notificationTitle,
        message: notificationMessage,
        severity: notificationSeverity,
        plantId: job.plantId,
        payload: {
          jobOrderId: String(job._id),
          jobOrderNumber: job.orderNumber,
          productName: job.product?.name,
          completedStage: stage.stage,
          completedByName,
          completedAt: stage.completedAt,
          weightOutKg: stage.weightOutKg,
          ...(next ? {
            nextStage: next.stage,
            nextStageId: String(next._id),
            nextNeedsAssignment: !next.operatorId,
          } : {
            jobCompleted: true,
          }),
        },
      });
      socketService.emitNotification(String(job.plantId), 'notification:new', notif.toObject());
    } catch (notifErr) {
      // Non-fatal — log and continue. Stage is still completed.
      console.error('[completeStage] Failed to create notification:', notifErr.message);
    }

    await AuditLog.create({
      actor: req.user.id,
      actorEmail: req.user.email,
      action: `job.stage.${stage.stage}.complete`,
      module: 'production',
      targetType: 'JobOrder',
      targetId: String(job._id),
      after: stage.toObject(),
      ip: req.ip,
      plantId: job.plantId,
    });

    await cacheService.invalidateTag('job_orders');
    socketService.emitOrderUpdate(String(job.plantId), job.toObject());

    res.json(ok({
      ...job.toObject(),
      _needsAssignment: notificationKind === 'stage_complete_assign_next',
      _nextStageId: next?._id ? String(next._id) : null,
      _nextStageName: next?.stage,
    }));
  } catch (err) {
    for (const undo of rollback.reverse()) {
      try { await undo(); } catch { /* continue */ }
    }
    throw err;
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * OPERATOR VIEW — "my jobs right now"
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Returns jobs where the current user is the assigned operator on a ready/in-progress stage,
 * OR where they're on the same team as the stage and the stage is unassigned.
 * This is what the operator's simple screen shows — a clean list of what to do next.
 */
export const myJobs = asyncHandler(async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const teamIds = (req.user.teamIds || []).map((t) => new mongoose.Types.ObjectId(t));
  const plantId = req.user.plantId ? new mongoose.Types.ObjectId(req.user.plantId) : null;

  // Operator sees a job if they have ANY stage assigned to them — including
  // completed ones. We rely on the per-job `myStage` computation below to
  // pick the "right" stage to display (ready/in_progress preferred,
  // last-completed as fallback so they see "I just finished printing").
  const orFilters = [
    { 'stages.operatorId': userId },
  ];
  if (teamIds.length) {
    orFilters.push({
      'stages.teamId': { $in: teamIds },
      'stages.status': 'ready',
      'stages.operatorId': { $exists: false },
    });
  }

  const filter = { $or: orFilters, ...(plantId ? { plantId } : {}), status: { $ne: 'cancelled' } };

  const jobs = await JobOrder.find(filter)
    .populate('stages.machineId', 'code name stage')
    .sort({ priority: 1, plannedStart: 1 })
    .limit(20)
    .lean();

  // For each job, pick the stage most relevant to this operator:
  //   1. A ready/in_progress stage they own  → show with action buttons
  //   2. A team stage that's ready and unassigned (claimable)
  //   3. A pending stage they own (waiting for previous stage to finish)
  //      → operator sees "WAITING — prev stage in progress"
  //   4. Their most recent completed stage  → show as "Done" status pill
  const enriched = jobs.map((j) => {
    const ownStages = j.stages.filter((s) => String(s.operatorId) === String(userId));
    const teamStages = j.stages.filter(
      (s) => teamIds.some((t) => String(s.teamId) === String(t)) && !s.operatorId
    );

    let myStage =
      ownStages.find((s) => s.status === 'in_progress') ||
      ownStages.find((s) => s.status === 'ready') ||
      teamStages.find((s) => s.status === 'ready') ||
      ownStages.find((s) => s.status === 'pending') ||
      // Fallback: last completed stage they worked on
      [...ownStages].reverse().find((s) => s.status === 'completed');

    // Compute blocking info for pending stages — what's holding them up
    let blockedBy = null;
    if (myStage && myStage.status === 'pending') {
      const myStageIdx = j.stages.findIndex((s) => String(s._id) === String(myStage._id));
      const prevIncomplete = j.stages
        .slice(0, myStageIdx)
        .filter((s) => !['completed', 'skipped'].includes(s.status));
      if (prevIncomplete.length > 0) {
        const blocker = prevIncomplete[prevIncomplete.length - 1];
        blockedBy = {
          stage: blocker.stage,
          status: blocker.status,
        };
      }
    }

    return {
      _id: j._id,
      orderNumber: j.orderNumber,
      jobNumber: j.jobNumber,
      customer: j.customer,
      product: j.product,
      priority: j.priority,
      status: j.status,                    // job-level status (planned/in_progress/completed)
      plannedQty: j.plannedQty,
      inputRollWeightKg: j.inputRollWeightKg,
      myStage,
      blockedBy,
      jobCompleted: j.status === 'completed',
    };
  });

  res.json(ok(enriched));
});

/* ════════════════════════════════════════════════════════════════════════
 * DASHBOARD SUGGESTIONS & ALERTS
 * ══════════════════════════════════════════════════════════════════════ */

export const dashboardSuggestions = asyncHandler(async (req, res) => {
  const plantId = req.query.plantId || req.user.plantId;
  const suggestions = await getDashboardSuggestions({ plantId });
  res.json(ok(suggestions));
});

export const dashboardAlerts = asyncHandler(async (req, res) => {
  const plantId = req.query.plantId || req.user.plantId;
  const alerts = await getDashboardAlerts({ plantId });
  res.json(ok(alerts));
});

/* ════════════════════════════════════════════════════════════════════════
 * AD-HOC AVAILABILITY CHECK (without SO)
 * ══════════════════════════════════════════════════════════════════════ */

const adHocSchema = z.object({
  sku: z.string(),
  qty: z.number().positive(),
  plantId: z.string().nullish(),
});

export const adHocAvailability = asyncHandler(async (req, res) => {
  const { sku, qty, plantId } = adHocSchema.parse(req.body);
  const result = await checkAvailability({ sku, qty, plantId: plantId || req.user.plantId });
  res.json(ok(result));
});