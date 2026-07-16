import { z } from 'zod';
import mongoose from 'mongoose';
import { QualityCheck } from '../models/QualityCheck.js';
import { InventoryItem, InventoryMovement } from '../models/Inventory.js';
import { Dispatch } from '../models/Dispatch.js';
import { ProductionOrder } from '../models/ProductionOrder.js';
import { AuditLog } from '../models/AuditLog.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { parsePagination, paginatedMeta } from '../utils/pagination.js';
import { buildFilter } from '../services/filter.service.js';
import { cacheService } from '../services/cache.service.js';
import { socketService } from '../services/socket.service.js';
import { resolvePlantId } from '../utils/plant.js';

/* ======================== QC ======================== */

const qcCreateSchema = z.object({
  orderId: z.string(),
  stage: z.enum(['printing', 'inspection', 'lamination', 'slitting', 'cutting', 'packaging']),
  machineId: z.string().optional(),
  teamId: z.string().optional(),
  plantId: z.string().nullish(),
  sampledQty: z.number().positive(),
  passedQty: z.number().nonnegative().default(0),
  rejectedQty: z.number().nonnegative().default(0),
  reworkQty: z.number().nonnegative().default(0),
  defects: z
    .array(
      z.object({
        code: z.string(),
        severity: z.enum(['minor', 'major', 'critical']).default('minor'),
        qty: z.number().int().positive().default(1),
        notes: z.string().optional(),
      })
    )
    .optional(),
  decision: z.enum(['pass', 'reject', 'rework', 'hold']),
  notes: z.string().optional(),
});

export const createQc = asyncHandler(async (req, res) => {
  const payload = qcCreateSchema.parse(req.body);
  payload.plantId = await resolvePlantId(payload.plantId, req.user.plantId);
  if (payload.passedQty + payload.rejectedQty + payload.reworkQty > payload.sampledQty) {
    throw ApiError.badRequest('passed+rejected+rework cannot exceed sampled');
  }

  const session = await mongoose.startSession();
  let qc;
  try {
    await session.withTransaction(async () => {
      qc = (
        await QualityCheck.create([{ ...payload, inspector: req.user.id, checkedAt: new Date() }], { session })
      )[0];

      // Update order rollups
      const ord = await ProductionOrder.findById(payload.orderId).session(session);
      if (ord) {
        ord.totalRejects = (ord.totalRejects || 0) + payload.rejectedQty;
        ord.totalRework = (ord.totalRework || 0) + payload.reworkQty;

        // If decision=rework, create linked rework order
        if (payload.decision === 'rework' && payload.reworkQty > 0) {
          const [rework] = await ProductionOrder.create(
            [
              {
                orderNumber: `${ord.orderNumber}-RW-${Date.now().toString(36).slice(-4).toUpperCase()}`,
                source: 'rework',
                customer: ord.customer,
                product: ord.product,
                plannedQty: payload.reworkQty,
                plantId: ord.plantId,
                priority: 1,
                status: 'planned',
                stageProgress: [{ stage: payload.stage, status: 'pending', plannedQty: payload.reworkQty }],
                createdBy: req.user.id,
              },
            ],
            { session }
          );
          qc.reworkOrderId = rework._id;
          await qc.save({ session });
        }

        await ord.save({ session });
      }

      await AuditLog.create(
        [
          {
            actor: req.user.id,
            actorEmail: req.user.email,
            action: `qc.${payload.decision}`,
            module: 'qc',
            targetType: 'QualityCheck',
            targetId: String(qc._id),
            after: qc.toObject(),
            ip: req.ip,
            plantId: qc.plantId,
          },
        ],
        { session }
      );
    });

    await cacheService.invalidateTag('dashboard');
    socketService.emitAlert(String(qc.plantId), {
      kind: 'qc',
      decision: qc.decision,
      stage: qc.stage,
      orderId: String(qc.orderId),
      at: qc.checkedAt,
    });

    res.status(201).json(ok(qc));
  } finally {
    session.endSession();
  }
});

const qcListQuery = z.object({
  orderId: z.string().optional(),
  stage: z.string().optional(),
  decision: z.string().optional(),
  plantId: z.string().nullish(),
  teamId: z.string().optional(),
  machineId: z.string().optional(),
  employeeId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  month: z.string().optional(),
  year: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});

export const listQc = asyncHandler(async (req, res) => {
  const q = qcListQuery.parse(req.query);
  const { page, limit, skip, sort } = parsePagination(q);
  const filter = buildFilter(q, {
    plantField: 'plantId',
    teamField: 'teamId',
    machineField: 'machineId',
    employeeField: 'inspector',
    stageField: 'stage',
    dateField: 'checkedAt',
  });
  if (q.orderId) filter.orderId = q.orderId;
  if (q.decision) filter.decision = q.decision;

  const [items, total] = await Promise.all([
    QualityCheck.find(filter)
      .populate('inspector', 'name employeeCode')
      .populate('machineId', 'code name')
      .sort(sort || { checkedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    QualityCheck.countDocuments(filter),
  ]);
  res.json(ok(items, paginatedMeta({ page, limit, total })));
});

/* ======================== Inventory ======================== */

export const listInventory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  if (req.query.plantId) filter.plantId = req.query.plantId;
  if (req.query.q) filter.$text = { $search: req.query.q };

  const [items, total] = await Promise.all([
    InventoryItem.find(filter).sort({ sku: 1 }).skip(skip).limit(limit).lean(),
    InventoryItem.countDocuments(filter),
  ]);
  res.json(ok(items, paginatedMeta({ page, limit, total })));
});

const movementSchema = z.object({
  sku: z.string(),
  type: z.enum([
    'IN',
    'OUT',
    'ADJUST',
    'TRANSFER',
    'ISSUE_TO_PROD',
    'RECEIPT_FROM_PROD',
    'RESERVE',
    'UNRESERVE',
  ]),
  qty: z.number().positive(),
  reference: z
    .object({
      kind: z.enum([
        'purchase_order',
        'production_order',
        'sales_order',
        'dispatch',
        'qc',
        'manual',
      ]),
      id: z.string().optional(),
    })
    .optional(),
  notes: z.string().optional(),
});

export const recordMovement = asyncHandler(async (req, res) => {
  const payload = movementSchema.parse(req.body);
  const session = await mongoose.startSession();
  let movement;
  try {
    await session.withTransaction(async () => {
      const item = await InventoryItem.findOne({ sku: payload.sku }).session(session);
      if (!item) throw ApiError.notFound('Item not found');

      const delta = ['IN', 'RECEIPT_FROM_PROD', 'UNRESERVE'].includes(payload.type)
        ? payload.qty
        : ['ADJUST'].includes(payload.type)
          ? payload.qty // caller supplies signed adjustment by sending negative qty through a separate endpoint; keep simple here
          : -payload.qty;

      // Apply to onHand (and reserved for RESERVE/UNRESERVE)
      if (payload.type === 'RESERVE') {
        if ((item.onHand - item.reserved) < payload.qty) throw ApiError.conflict('Insufficient available');
        item.reserved += payload.qty;
      } else if (payload.type === 'UNRESERVE') {
        item.reserved = Math.max(0, item.reserved - payload.qty);
      } else {
        if (item.onHand + delta < 0) throw ApiError.conflict('Negative onHand not allowed');
        item.onHand += delta;
      }
      await item.save({ session });

      movement = (
        await InventoryMovement.create(
          [
            {
              sku: item.sku,
              itemId: item._id,
              plantId: item.plantId,
              type: payload.type,
              qty: payload.qty,
              reference: payload.reference,
              balanceAfter: item.onHand,
              performedBy: req.user.id,
              notes: payload.notes,
            },
          ],
          { session }
        )
      )[0];
    });

    await cacheService.invalidateTag('inventory');
    res.status(201).json(ok(movement));
  } finally {
    session.endSession();
  }
});

/* ======================== Dispatch ======================== */

const dispatchCreateSchema = z.object({
  dispatchNumber: z.string().min(1),
  salesOrderExternalId: z.string().optional(),
  customer: z.string(),
  lines: z.array(
    z.object({
      productionOrderId: z.string().optional(),
      sku: z.string(),
      qty: z.number().positive(),
      uom: z.string().optional(),
      lotNumber: z.string().optional(),
    })
  ).min(1),
  vehicle: z
    .object({
      number: z.string().optional(),
      driverName: z.string().optional(),
      driverPhone: z.string().optional(),
      carrier: z.string().optional(),
    })
    .optional(),
  plannedDispatchAt: z.coerce.date().optional(),
  plantId: z.string().nullish(),
  teamId: z.string().optional(),
  notes: z.string().optional(),
});

export const listDispatches = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.plantId) filter.plantId = req.query.plantId;

  const [items, total] = await Promise.all([
    Dispatch.find(filter).sort({ plannedDispatchAt: 1 }).skip(skip).limit(limit).lean(),
    Dispatch.countDocuments(filter),
  ]);
  res.json(ok(items, paginatedMeta({ page, limit, total })));
});

export const createDispatch = asyncHandler(async (req, res) => {
  const payload = dispatchCreateSchema.parse(req.body);
  payload.plantId = await resolvePlantId(payload.plantId, req.user.plantId);
  const doc = await Dispatch.create({ ...payload, dispatchedBy: req.user.id });
  await cacheService.invalidateTag('dashboard');
  res.status(201).json(ok(doc));
});

const dispatchTransitionSchema = z.object({
  status: z.enum(['packed', 'loaded', 'dispatched', 'delivered', 'cancelled']),
  eWayBill: z.string().optional(),
  invoice: z.string().optional(),
});

export const transitionDispatch = asyncHandler(async (req, res) => {
  const payload = dispatchTransitionSchema.parse(req.body);
  const doc = await Dispatch.findById(req.params.id);
  if (!doc) throw ApiError.notFound('Dispatch not found');

  doc.status = payload.status;
  if (payload.eWayBill) doc.eWayBill = payload.eWayBill;
  if (payload.invoice) doc.invoice = payload.invoice;
  if (payload.status === 'dispatched') doc.actualDispatchAt = new Date();
  if (payload.status === 'delivered') doc.deliveredAt = new Date();
  await doc.save();

  socketService.emitAlert(String(doc.plantId), {
    kind: 'dispatch',
    status: doc.status,
    dispatchNumber: doc.dispatchNumber,
    customer: doc.customer,
  });
  res.json(ok(doc));
});
