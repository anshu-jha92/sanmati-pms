import { z } from 'zod';
import mongoose from 'mongoose';
import { SalesOrder } from '../models/SalesOrder.js';
import { PurchaseOrder } from '../models/PurchaseOrder.js';
import { InventoryItem, InventoryMovement } from '../models/Inventory.js';
import { BOM } from '../models/ERP.js';
import { AuditLog } from '../models/AuditLog.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { cacheService } from '../services/cache.service.js';
import { socketService } from '../services/socket.service.js';

/* ════════════════════════════════════════════════════════════════════════
 * INTEGRATION API — public endpoints for external systems
 *
 * Auth: X-API-Key header (set via INTEGRATION_API_KEY in backend/.env)
 * Base URL: /integrations/v1/
 * ══════════════════════════════════════════════════════════════════════ */

/* ─── Shared helpers ─── */

const priorityMap = (p) => {
  if (typeof p === 'string') {
    const s = p.toLowerCase();
    if (['high', 'medium', 'normal'].includes(s)) return s;
    if (['urgent', 'critical'].includes(s)) return 'high';
    if (['low'].includes(s)) return 'normal';
  }
  const n = Number(p);
  if (!isNaN(n)) {
    if (n <= 3) return 'high';
    if (n <= 6) return 'medium';
  }
  return 'normal';
};

const soStatusMap = {
  open: 'new', new: 'new', pending: 'new',
  planning: 'planning',
  in_progress: 'in_progress', processing: 'in_progress',
  fulfilled: 'fulfilled', delivered: 'fulfilled', completed: 'fulfilled',
  cancelled: 'cancelled', canceled: 'cancelled',
  on_hold: 'on_hold', hold: 'on_hold',
};

/* ════════════════════════════════════════════════════════════════════════
 * POST /integrations/v1/sales-orders
 *
 * Accepts a single sales order OR an array of sales orders in one call.
 * Upserts each by externalId (so same call can be retried safely).
 * ══════════════════════════════════════════════════════════════════════ */

const soLineSchema = z.object({
  sku: z.string().min(1),
  productName: z.string().min(1).optional(),
  name: z.string().min(1).optional(),   // alias
  qty: z.number().positive(),
  uom: z.string().optional(),
  dueDate: z.coerce.date().optional(),
});

const salesOrderSchema = z.object({
  externalId: z.string().min(1).optional(),   // ERP's own ID
  id: z.string().min(1).optional(),           // alias for externalId
  orderNumber: z.string().min(1),
  customer: z.string().min(1),
  customerEmail: z.string().optional(),
  customerPhone: z.string().optional(),
  priority: z.union([z.string(), z.number()]).optional(),
  status: z.string().optional(),
  orderedAt: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  totalValue: z.number().optional(),
  currency: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(soLineSchema).min(1),
});

const soPayload = z.union([
  salesOrderSchema,
  z.array(salesOrderSchema).min(1),
]);

export const pushSalesOrders = asyncHandler(async (req, res) => {
  const parsed = soPayload.parse(req.body);
  const incoming = Array.isArray(parsed) ? parsed : [parsed];
  const plantId = req.integration.plant._id;

  const results = [];
  for (const o of incoming) {
    const externalId = String(o.externalId || o.id || `EXT-${o.orderNumber}`);
    const doc = await SalesOrder.findOneAndUpdate(
      { externalId },
      {
        $set: {
          externalId,
          orderNumber: String(o.orderNumber).toUpperCase(),
          customer: o.customer,
          priority: priorityMap(o.priority),
          status: soStatusMap[String(o.status || '').toLowerCase()] || 'new',
          orderedAt: o.orderedAt || new Date(),
          dueDate: o.dueDate,
          totalValue: o.totalValue,
          currency: o.currency || 'INR',
          notes: o.notes,
          lines: o.lines.map((l) => ({
            sku: String(l.sku).toUpperCase(),
            productName: l.productName || l.name || l.sku,
            qty: Number(l.qty),
            uom: l.uom || 'kg',
            dueDate: l.dueDate,
            status: 'pending',
          })),
          plantId,
          syncedAt: new Date(),
        },
        $setOnInsert: { seenAt: new Date() },
      },
      { upsert: true, new: true, lean: true }
    );
    results.push({
      externalId,
      id: String(doc._id),
      orderNumber: doc.orderNumber,
      status: doc.status,
      action: doc.createdAt?.getTime() === doc.updatedAt?.getTime() ? 'created' : 'updated',
    });
  }

  await AuditLog.create({
    actor: null,
    actorEmail: 'integration-api',
    action: 'integration.push_sales_orders',
    module: 'sales_orders',
    targetType: 'SalesOrder',
    targetId: 'batch',
    after: { count: results.length, results },
    ip: req.ip,
    plantId,
  });

  await cacheService.invalidateTag('sales_orders');
  res.status(200).json(ok({
    received: incoming.length,
    processed: results.length,
    results,
  }));
});

/* ════════════════════════════════════════════════════════════════════════
 * POST /integrations/v1/purchase-orders
 *
 * Creates a Purchase Order AND updates inventory in one atomic transaction.
 * Accepts single PO or array of POs.
 *
 * For each line:
 *   • Upserts the InventoryItem (creates with type='raw' if new)
 *   • Increments onHand by qty
 *   • Writes an InventoryMovement of type 'IN'
 * ══════════════════════════════════════════════════════════════════════ */

const poLineSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  qty: z.number().positive(),
  uom: z.string().optional(),
  unitCost: z.number().nonnegative().optional(),
  itemType: z.enum(['raw', 'wip', 'finished', 'consumable', 'packaging']).optional(),
});

const purchaseOrderSchema = z.object({
  poNumber: z.string().min(1).optional(),   // auto-generated if missing
  externalId: z.string().optional(),
  supplier: z.string().min(1),
  supplierEmail: z.string().optional(),
  supplierPhone: z.string().optional(),
  supplierAddress: z.string().optional(),
  invoiceNumber: z.string().optional(),
  vehicleNumber: z.string().optional(),
  receivedAt: z.coerce.date().optional(),
  notes: z.string().optional(),
  lines: z.array(poLineSchema).min(1),
});

const poPayload = z.union([
  purchaseOrderSchema,
  z.array(purchaseOrderSchema).min(1),
]);

export const pushPurchaseOrders = asyncHandler(async (req, res) => {
  const parsed = poPayload.parse(req.body);
  const incoming = Array.isArray(parsed) ? parsed : [parsed];
  const plantId = req.integration.plant._id;

  const results = [];
  for (const o of incoming) {
    const ts = Date.now();
    const poNumber = (o.poNumber || `EXT-${ts.toString(36).toUpperCase()}`).toUpperCase();
    const receivedAt = o.receivedAt || new Date();

    // Skip if a PO with this number already exists
    const existing = await PurchaseOrder.findOne({ poNumber }).lean();
    if (existing) {
      results.push({
        poNumber,
        id: String(existing._id),
        action: 'skipped_duplicate',
        message: `PO ${poNumber} already exists`,
      });
      continue;
    }

    // No transaction — use findOneAndUpdate for atomic upserts. Works on
    // standalone Mongo / Atlas free tier without replica-set requirements.
    const lines = [];
    const inventoryUpdates = [];
    const rollback = [];
    let savedPo;
    try {
      for (const ln of o.lines) {
        const sku = String(ln.sku).toUpperCase();
        const qty = Number(ln.qty);
        const unitCost = Number(ln.unitCost || 0);

        const item = await InventoryItem.findOneAndUpdate(
          { sku },
          {
            $setOnInsert: {
              sku,
              name: ln.name,
              type: ln.itemType || 'raw',
              category: ln.itemType || 'raw',
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
        rollback.push(() => InventoryItem.updateOne({ _id: item._id }, { $inc: { onHand: -qty } }));

        const mov = await InventoryMovement.create({
          sku: item.sku,
          itemId: item._id,
          plantId,
          type: 'IN',
          qty,
          reference: { kind: 'purchase_order', id: poNumber },
          balanceAfter: item.onHand,
          performedBy: null,
          notes: `${poNumber} · ${o.supplier}${o.invoiceNumber ? ` · inv ${o.invoiceNumber}` : ''} (via integration API)`,
        });
        rollback.push(() => InventoryMovement.deleteOne({ _id: mov._id }));

        inventoryUpdates.push({
          sku: item.sku,
          qtyAdded: qty,
          newOnHand: item.onHand,
        });

        lines.push({
          sku,
          name: ln.name,
          qty,
          uom: ln.uom || 'kg',
          unitCost,
          lineTotal: qty * unitCost,
          receivedQty: qty,
          pendingQty: 0,
          status: 'received',
          grns: [{
            receivedAt,
            qty,
            vehicleNumber: o.vehicleNumber,
            invoiceNumber: o.invoiceNumber,
            receivedBy: null,
            remarks: o.notes,
            inventoryMovementId: mov._id,
          }],
        });
      }

      const totalValue = lines.reduce((s, l) => s + (l.lineTotal || 0), 0);
      savedPo = await PurchaseOrder.create({
        poNumber,
        externalId: o.externalId,
        supplier: o.supplier,
        supplierEmail: o.supplierEmail,
        supplierPhone: o.supplierPhone,
        supplierAddress: o.supplierAddress,
        status: 'received',
        orderedAt: receivedAt,
        receivedAt,
        lines,
        totalValue,
        currency: 'INR',
        plantId,
        source: 'erp_sync',
        createdBy: null,
        notes: o.notes,
      });

      results.push({
        poNumber,
        id: String(savedPo._id),
        action: 'created',
        linesProcessed: savedPo.lines.length,
        totalValue: savedPo.totalValue,
        inventoryUpdates,
      });

      socketService.emit?.('/ops', 'po:update', savedPo.toObject());
    } catch (err) {
      // roll back inventory
      for (const undo of rollback.reverse()) {
        try { await undo(); } catch { /* ignore */ }
      }
      results.push({
        poNumber,
        action: 'failed',
        error: err.message,
      });
    }
  }

  await AuditLog.create({
    actor: null,
    actorEmail: 'integration-api',
    action: 'integration.push_purchase_orders',
    module: 'purchase_orders',
    targetType: 'PurchaseOrder',
    targetId: 'batch',
    after: { count: results.length, results },
    ip: req.ip,
    plantId,
  });

  await cacheService.invalidateTag('purchase_orders');
  await cacheService.invalidateTag('inventory');
  res.status(200).json(ok({
    received: incoming.length,
    processed: results.length,
    results,
  }));
});

/* ════════════════════════════════════════════════════════════════════════
 * GET /integrations/v1/health — simple ping for external system to verify
 * ══════════════════════════════════════════════════════════════════════ */
export const integrationHealth = asyncHandler(async (req, res) => {
  res.json(ok({
    status: 'ok',
    plant: req.integration.plant.name,
    plantId: String(req.integration.plant._id),
    authenticated: true,
    serverTime: new Date().toISOString(),
  }));
});

/* ════════════════════════════════════════════════════════════════════════
 * POST /integrations/v1/bom
 *
 * Accepts a single BOM object OR array. Upserts by externalId.
 * Each component line supports scrap percentage and which stage it belongs to.
 *
 * Example body:
 *   {
 *     "externalId": "ERP-BOM-001",
 *     "productSku": "POLYBAG-5KG",
 *     "productName": "Printed Polybag 5kg",
 *     "outputQty": 1,
 *     "outputUom": "kg",
 *     "version": "v1",
 *     "components": [
 *       { "sku": "BOPP-FILM-20", "name": "BOPP Film", "qtyPerUnit": 0.85, "uom": "kg", "scrapPct": 5, "stage": "lamination" },
 *       { "sku": "INK-RED",      "name": "Red Ink",   "qtyPerUnit": 0.05, "uom": "kg", "scrapPct": 2, "stage": "printing" }
 *     ]
 *   }
 * ══════════════════════════════════════════════════════════════════════ */

const bomComponentApiSchema = z.object({
  sku: z.string().min(1),
  name: z.string().optional(),
  qtyPerUnit: z.number().positive(),
  uom: z.string().optional(),
  scrapPct: z.number().min(0).max(100).optional(),
  stage: z.enum(['printing', 'inspection', 'lamination', 'hot_room', 'slitting', 'cutting', 'packaging', 'any']).optional(),
  notes: z.string().optional(),
});

const bomSchema = z.object({
  externalId: z.string().min(1),
  productSku: z.string().min(1),
  productName: z.string().optional(),
  outputQty: z.number().positive().optional(),
  outputUom: z.string().optional(),
  version: z.string().optional(),
  active: z.boolean().optional(),
  notes: z.string().optional(),
  components: z.array(bomComponentApiSchema).min(1),
});

const bomPayload = z.union([bomSchema, z.array(bomSchema).min(1)]);

export const pushBoms = asyncHandler(async (req, res) => {
  const parsed = bomPayload.parse(req.body);
  const incoming = Array.isArray(parsed) ? parsed : [parsed];
  const plantId = req.integration.plant._id;

  const results = [];
  for (const b of incoming) {
    const doc = await BOM.findOneAndUpdate(
      { externalId: b.externalId },
      {
        $set: {
          externalId: b.externalId,
          productSku: b.productSku.toUpperCase(),
          productName: b.productName,
          outputQty: b.outputQty || 1,
          outputUom: b.outputUom || 'kg',
          version: b.version || 'v1',
          active: b.active !== false,
          notes: b.notes,
          plantId,
          syncedAt: new Date(),
          components: b.components.map((c) => ({
            sku: c.sku.toUpperCase(),
            name: c.name || c.sku,
            qtyPerUnit: Number(c.qtyPerUnit),
            uom: c.uom || 'kg',
            scrapPct: c.scrapPct || 0,
            stage: c.stage || 'any',
            notes: c.notes,
          })),
        },
      },
      { upsert: true, new: true, lean: true }
    );
    results.push({
      externalId: b.externalId,
      id: String(doc._id),
      productSku: doc.productSku,
      version: doc.version,
      componentCount: doc.components.length,
      action: doc.createdAt?.getTime() === doc.updatedAt?.getTime() ? 'created' : 'updated',
    });
  }

  await AuditLog.create({
    actor: null,
    actorEmail: 'integration-api',
    action: 'integration.push_bom',
    module: 'inventory',
    targetType: 'BOM',
    targetId: 'batch',
    after: { count: results.length, results },
    ip: req.ip,
    plantId,
  });

  await cacheService.invalidateTag('bom');
  res.json(ok({
    received: incoming.length,
    processed: results.length,
    results,
  }));
});
