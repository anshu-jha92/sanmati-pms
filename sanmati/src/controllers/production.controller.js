import { z } from 'zod';
import mongoose from 'mongoose';
import { ProductionOrder } from '../models/ProductionOrder.js';
import { AuditLog } from '../models/AuditLog.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { parsePagination, paginatedMeta } from '../utils/pagination.js';
import { buildFilter, scopeToPrincipal } from '../services/filter.service.js';
import { cacheService } from '../services/cache.service.js';
import { socketService } from '../services/socket.service.js';
import { resolvePlantId } from '../utils/plant.js';

const STAGES = ['printing', 'inspection', 'lamination', 'slitting', 'cutting', 'packaging'];

const listQuery = z.object({
  status: z.string().optional(),
  stage: z.enum(STAGES).optional(),
  plantId: z.string().nullish(),
  teamId: z.string().optional(),
  machineId: z.string().optional(),
  operatorId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  month: z.string().optional(),
  year: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  sort: z.string().optional(),
});

const createSchema = z.object({
  orderNumber: z.string().min(1),
  source: z.enum(['sales_order', 'stock', 'sample', 'rework']).default('sales_order'),
  externalSalesOrderId: z.string().optional(),
  customer: z.string().optional(),
  product: z.object({ sku: z.string(), name: z.string(), specRef: z.string().optional() }),
  bomRef: z.string().optional(),
  plannedQty: z.number().positive(),
  uom: z.string().default('pcs'),
  priority: z.number().int().min(1).max(10).default(5),
  plannedStart: z.coerce.date().optional(),
  plannedEnd: z.coerce.date().optional(),
  plantId: z.string().nullish(),
  stageProgress: z
    .array(
      z.object({
        stage: z.enum(STAGES),
        machineId: z.string().optional(),
        plannedQty: z.number().optional(),
      })
    )
    .optional(),
});

export const list = asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const { page, limit, skip, sort } = parsePagination(q);

  const mapping = {
    plantField: 'plantId',
    dateField: 'plannedStart',
    textSearch: true,
  };
  const filter = buildFilter(q, mapping);
  if (q.status) filter.status = q.status;
  scopeToPrincipal(filter, req.user, mapping);

  const cacheKey = `po:list:${req.user.id}:${JSON.stringify({ ...q, page, limit, sort })}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) return res.json(ok(cached.data, cached.meta));

  const [items, total] = await Promise.all([
    ProductionOrder.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select('orderNumber status customer product plannedQty totalProduced priority plannedStart plannedEnd stageProgress')
      .lean(),
    ProductionOrder.countDocuments(filter),
  ]);

  const result = { data: items, meta: paginatedMeta({ page, limit, total }) };
  await cacheService.set(cacheKey, result, 30, ['production_orders']);
  res.json(ok(result.data, result.meta));
});

export const getOne = asyncHandler(async (req, res) => {
  const doc = await ProductionOrder.findById(req.params.id).lean();
  if (!doc) throw ApiError.notFound('Order not found');
  res.json(ok(doc));
});

export const create = asyncHandler(async (req, res) => {
  const payload = createSchema.parse(req.body);
  payload.plantId = await resolvePlantId(payload.plantId, req.user.plantId);

  const stageProgress =
    payload.stageProgress?.map((s) => ({ ...s, status: 'pending' })) ||
    STAGES.map((stage) => ({ stage, status: 'pending', plannedQty: payload.plannedQty }));

  const doc = await ProductionOrder.create({
    ...payload,
    stageProgress,
    status: 'planned',
    createdBy: req.user.id,
  });

  await AuditLog.create({
    actor: req.user.id,
    actorEmail: req.user.email,
    action: 'production.order.create',
    module: 'production',
    targetType: 'ProductionOrder',
    targetId: String(doc._id),
    after: doc.toObject(),
    ip: req.ip,
    plantId: doc.plantId,
  });

  await cacheService.invalidateTag('production_orders');
  socketService.emitOrderUpdate(String(doc.plantId), doc.toObject());

  res.status(201).json(ok(doc));
});

/**
 * Transition a single stage of an order. Enforces valid transitions:
 *  pending → in_progress → (on_hold|rework|completed)
 */
const transitionSchema = z.object({
  status: z.enum(['in_progress', 'on_hold', 'rework', 'completed']),
  operator: z.string().optional(),
  teamId: z.string().optional(),
  machineId: z.string().optional(),
  producedQty: z.number().nonnegative().optional(),
  rejectQty: z.number().nonnegative().optional(),
  reworkQty: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export const transitionStage = asyncHandler(async (req, res) => {
  const { id, stage } = req.params;
  if (!STAGES.includes(stage)) throw ApiError.badRequest('Unknown stage');

  const payload = transitionSchema.parse(req.body);
  const session = await mongoose.startSession();
  try {
    let updated;
    await session.withTransaction(async () => {
      const order = await ProductionOrder.findById(id).session(session);
      if (!order) throw ApiError.notFound('Order not found');
      const sp = order.stageProgress.find((s) => s.stage === stage);
      if (!sp) throw ApiError.badRequest('Stage not found on order');

      const allowed = transitionsAllowed(sp.status);
      if (!allowed.includes(payload.status)) {
        throw ApiError.conflict(`Invalid transition ${sp.status} → ${payload.status}`);
      }

      const before = sp.toObject();
      sp.status = payload.status;
      if (payload.operator) sp.operator = payload.operator;
      if (payload.teamId) sp.teamId = payload.teamId;
      if (payload.machineId) sp.machineId = payload.machineId;
      if (payload.producedQty !== undefined) sp.producedQty = payload.producedQty;
      if (payload.rejectQty !== undefined) sp.rejectQty = payload.rejectQty;
      if (payload.reworkQty !== undefined) sp.reworkQty = payload.reworkQty;
      if (payload.notes) sp.notes = payload.notes;
      if (payload.status === 'in_progress' && !sp.startedAt) sp.startedAt = new Date();
      if (payload.status === 'completed') sp.completedAt = new Date();

      // Rollups
      order.totalProduced = order.stageProgress.reduce((a, s) => a + (s.producedQty || 0), 0);
      order.totalRejects = order.stageProgress.reduce((a, s) => a + (s.rejectQty || 0), 0);
      order.totalRework = order.stageProgress.reduce((a, s) => a + (s.reworkQty || 0), 0);

      // Overall status
      if (order.status === 'planned' && payload.status === 'in_progress') {
        order.status = 'in_progress';
        order.actualStart = order.actualStart || new Date();
      }
      if (order.stageProgress.every((s) => s.status === 'completed')) {
        order.status = 'completed';
        order.actualEnd = new Date();
      }

      await order.save({ session });

      await AuditLog.create(
        [
          {
            actor: req.user.id,
            actorEmail: req.user.email,
            action: `production.stage.${payload.status}`,
            module: 'production',
            targetType: 'ProductionOrder',
            targetId: String(order._id),
            before: { stage, ...before },
            after: { stage, ...sp.toObject() },
            ip: req.ip,
            plantId: order.plantId,
          },
        ],
        { session }
      );

      updated = order.toObject();
    });

    await cacheService.invalidateTag('production_orders');
    socketService.emitOrderUpdate(String(updated.plantId), updated);
    res.json(ok(updated));
  } finally {
    session.endSession();
  }
});

function transitionsAllowed(current) {
  const g = {
    pending: ['in_progress', 'on_hold'],
    in_progress: ['on_hold', 'rework', 'completed'],
    on_hold: ['in_progress'],
    rework: ['in_progress'],
    completed: [],
  };
  return g[current] || [];
}
