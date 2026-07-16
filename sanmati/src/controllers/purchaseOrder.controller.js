import { z } from 'zod';
import mongoose from 'mongoose';
import { PurchaseOrder } from '../models/PurchaseOrder.js';
import { InventoryItem, InventoryMovement } from '../models/Inventory.js';
import { Plant } from '../models/Plant.js';
import { AuditLog } from '../models/AuditLog.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { parsePagination, paginatedMeta } from '../utils/pagination.js';
import { scopeToPrincipal } from '../services/filter.service.js';
import { cacheService } from '../services/cache.service.js';
import { socketService } from '../services/socket.service.js';
import { logger } from '../config/logger.js';

/* ═════════════ LIST ═════════════ */
const listQuery = z.object({
  status: z.string().optional(),
  supplier: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});

export const listPurchaseOrders = asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const { page, limit, skip, sort } = parsePagination(q);
  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.supplier) filter.supplier = new RegExp(q.supplier, 'i');
  if (q.q) filter.$or = [
    { poNumber: new RegExp(q.q, 'i') },
    { supplier: new RegExp(q.q, 'i') },
  ];
  scopeToPrincipal(filter, req.user, { plantField: 'plantId' });

  const [items, total] = await Promise.all([
    PurchaseOrder.find(filter).sort(sort || { createdAt: -1 }).skip(skip).limit(limit).lean(),
    PurchaseOrder.countDocuments(filter),
  ]);
  res.json(ok(items, paginatedMeta({ page, limit, total })));
});

export const getPurchaseOrder = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id).lean();
  if (!po) throw ApiError.notFound('Purchase order not found');
  res.json(ok(po));
});

/**
 * Delete a goods-receipt / purchase order (used to remove accidental duplicates).
 * REVERSES the stock it added: for each line, decrement the item's onHand by the
 * received qty and write an OUT movement for the audit trail. Then deletes the PO.
 */
export const deletePurchaseOrder = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) throw ApiError.notFound('Purchase order not found');

  const reversed = [];
  for (const ln of po.lines || []) {
    const qty = Number(ln.receivedQty ?? ln.qty ?? 0);
    if (qty <= 0) continue;
    const item = await InventoryItem.findOne({ sku: ln.sku, plantId: po.plantId });
    if (!item) continue;
    const newOnHand = Math.max(0, (item.onHand || 0) - qty);
    item.onHand = newOnHand;
    await item.save();
    await InventoryMovement.create({
      sku: item.sku, itemId: item._id, plantId: po.plantId,
      type: 'OUT', qty,
      reference: { kind: 'manual', id: po.poNumber },
      balanceAfter: newOnHand,
      performedBy: req.user.id || null,
      notes: `Reversal of deleted goods-receipt ${po.poNumber}`,
    });
    reversed.push({ sku: item.sku, qtyReversed: qty, newOnHand });
  }

  await po.deleteOne();
  await AuditLog.create({
    actor: req.user.id || null, actorEmail: req.user.email,
    action: 'po.delete', module: 'purchase_orders',
    targetType: 'PurchaseOrder', targetId: String(po._id),
    before: po.toObject(), ip: req.ip, plantId: po.plantId,
  });
  await cacheService.invalidateTag('purchase_orders');
  await cacheService.invalidateTag('inventory');
  res.json(ok({ deleted: true, _id: po._id, reversed }));
});

/* ═════════════ RESOLVE PLANT ID ═════════════
 *
 * Users can be created without a plantId. Fall back to the first Plant in the DB
 * so inventory always has a valid target.
 */
async function resolvePlantId(payloadPlantId, userPlantId) {
  if (payloadPlantId) return new mongoose.Types.ObjectId(payloadPlantId);
  if (userPlantId) return new mongoose.Types.ObjectId(userPlantId);
  const defaultPlant = await Plant.findOne().sort({ createdAt: 1 }).lean();
  if (!defaultPlant) {
    throw ApiError.badRequest(
      'No plant exists in the database. Run `node scripts/seed.js` to create one first.',
      { code: 'E_NO_PLANT' }
    );
  }
  return defaultPlant._id;
}

/* ═════════════ CREATE = RECEIVE = INVENTORY UPDATE ═════════════
 *
 * IMPORTANT: no MongoDB transaction is used here. Transactions require a
 * replica set and fail silently on standalone Mongo or some Atlas free-tier
 * configs. We do the inventory writes sequentially instead — if the PO save
 * fails at the end we rollback inventory manually (rare — validation catches
 * most cases before any write).
 *
 * Response includes `inventoryUpdates` so the caller sees exactly which
 * items had their onHand changed.
 */
const createSchema = z.object({
  poNumber: z.string().optional(),
  supplier: z.string().min(1),
  supplierEmail: z.string().optional(),
  supplierPhone: z.string().optional(),
  supplierAddress: z.string().optional(),
  invoiceNumber: z.string().optional(),
  vehicleNumber: z.string().optional(),
  receivedAt: z.coerce.date().optional(),
  plantId: z.string().nullish(),   // null (admin has no plant) → resolved to first plant
  notes: z.string().optional(),
  lines: z.array(z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    qty: z.number().positive(),
    uom: z.string().optional(),
    unitCost: z.number().nonnegative().optional(),
    itemType: z.enum(['raw', 'wip', 'finished', 'consumable', 'packaging']).optional(),
  })).min(1),
});

export const createPurchaseOrder = asyncHandler(async (req, res) => {
  const payload = createSchema.parse(req.body);
  const plantId = await resolvePlantId(payload.plantId, req.user.plantId);

  const ts = Date.now();
  const poNumber = (payload.poNumber || `GRN-${ts.toString(36).toUpperCase()}`).toUpperCase();
  const receivedAt = payload.receivedAt || new Date();

  // Pre-check: PO number must be unique
  const existingPo = await PurchaseOrder.findOne({ poNumber }).lean();
  if (existingPo) {
    throw new ApiError(409, 'Duplicate value', {
      code: 'E_DUPLICATE',
      details: { poNumber },
    });
  }

  const lines = [];
  const inventoryUpdates = [];
  const rollbackActions = [];   // tasks to undo if PO save fails at the end

  try {
    for (const ln of payload.lines) {
      const sku = String(ln.sku).toUpperCase();
      const qty = Number(ln.qty);
      const unitCost = Number(ln.unitCost || 0);
      const lineTotal = qty * unitCost;
      const itemType = ln.itemType || 'raw';

      // Upsert inventory item (atomic findOneAndUpdate — works without transactions)
      let item = await InventoryItem.findOneAndUpdate(
        { sku },
        {
          $setOnInsert: {
            sku,
            name: ln.name,
            type: itemType,
            category: itemType,
            uom: ln.uom || 'kg',
            reserved: 0,
            reorderLevel: 0,
            plantId,
            active: true,
          },
          $inc: { onHand: qty },
        },
        { upsert: true, new: true }
      );

      // Remember rollback: subtract qty back if PO fails
      rollbackActions.push(() =>
        InventoryItem.updateOne({ _id: item._id }, { $inc: { onHand: -qty } })
      );

      // Write movement
      const mov = await InventoryMovement.create({
        sku: item.sku,
        itemId: item._id,
        plantId,
        type: 'IN',
        qty,
        reference: { kind: 'purchase_order', id: poNumber },
        balanceAfter: item.onHand,
        performedBy: req.user.id || null,
        notes: `${poNumber} · ${payload.supplier}${payload.invoiceNumber ? ` · inv ${payload.invoiceNumber}` : ''}`,
      });
      rollbackActions.push(() => InventoryMovement.deleteOne({ _id: mov._id }));

      inventoryUpdates.push({
        sku: item.sku,
        name: item.name,
        qtyAdded: qty,
        newOnHand: item.onHand,
        uom: item.uom,
        itemId: String(item._id),
        wasNewItem: item.createdAt?.getTime() === item.updatedAt?.getTime(),
      });

      lines.push({
        sku,
        name: ln.name,
        qty,
        uom: ln.uom || 'kg',
        unitCost,
        lineTotal,
        receivedQty: qty,
        pendingQty: 0,
        status: 'received',
        grns: [{
          receivedAt,
          qty,
          vehicleNumber: payload.vehicleNumber,
          invoiceNumber: payload.invoiceNumber,
          receivedBy: req.user.id || null,
          remarks: payload.notes,
          inventoryMovementId: mov._id,
        }],
      });
    }

    const totalValue = lines.reduce((s, l) => s + (l.lineTotal || 0), 0);

    const savedPo = await PurchaseOrder.create({
      poNumber,
      supplier: payload.supplier,
      supplierEmail: payload.supplierEmail,
      supplierPhone: payload.supplierPhone,
      supplierAddress: payload.supplierAddress,
      status: 'received',
      orderedAt: receivedAt,
      receivedAt,
      lines,
      totalValue,
      currency: 'INR',
      plantId,
      source: 'manual',
      createdBy: req.user.id || null,
      notes: payload.notes,
    });

    await AuditLog.create({
      actor: req.user.id || null,
      actorEmail: req.user.email || 'system',
      action: 'po.create_and_receive',
      module: 'purchase_orders',
      targetType: 'PurchaseOrder',
      targetId: String(savedPo._id),
      after: savedPo.toObject(),
      ip: req.ip,
      plantId,
    });

    await cacheService.invalidateTag('purchase_orders');
    await cacheService.invalidateTag('inventory');
    socketService.emit?.('/ops', 'po:update', savedPo.toObject());

    logger.info(
      { poNumber, lines: inventoryUpdates.length, totalValue },
      `PO received & inventory updated: ${poNumber}`
    );

    res.status(201).json(ok({
      ...savedPo.toObject(),
      inventoryUpdates,
      message: `✓ Created PO ${poNumber}. Updated ${inventoryUpdates.length} inventory item(s).`,
    }));
  } catch (err) {
    // PO save failed — roll back inventory writes we made above
    logger.error({ err, poNumber }, 'PO save failed, rolling back inventory');
    for (const undo of rollbackActions.reverse()) {
      try { await undo(); } catch (e) { logger.error({ e }, 'rollback step failed'); }
    }
    throw err;
  }
});

/* ═════════════ AUTO-REORDER SUGGESTIONS ═════════════ */
export const autoReorderSuggestions = asyncHandler(async (req, res) => {
  const plantId = req.query.plantId || req.user.plantId;
  const filter = { active: true, reorderLevel: { $gt: 0 } };
  if (plantId) filter.plantId = new mongoose.Types.ObjectId(plantId);

  const items = await InventoryItem.aggregate([
    { $match: filter },
    { $match: { $expr: { $lt: ['$onHand', '$reorderLevel'] } } },
    { $sort: { onHand: 1 } },
    { $limit: 20 },
    { $project: {
      sku: 1, name: 1, onHand: 1, reorderLevel: 1, uom: 1,
      suggestedOrderQty: { $multiply: ['$reorderLevel', 2] },
      shortfall: { $subtract: ['$reorderLevel', '$onHand'] },
    } },
  ]);
  res.json(ok(items));
});
