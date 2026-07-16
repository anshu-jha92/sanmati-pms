/**
 * Material Request controller
 *
 * Handles the operator → inventory hand-off when materials are needed
 * to run a production stage. See `models/MaterialRequest.js` for the
 * workflow overview.
 */

import { z } from 'zod';
import mongoose from 'mongoose';
import { MaterialRequest } from '../models/MaterialRequest.js';
import { JobOrder } from '../models/JobOrder.js';
import { InventoryItem, InventoryMovement } from '../models/Inventory.js';
import { Notification } from '../models/Notification.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { socketService } from '../services/socket.service.js';

/* ════════════════════════════════════════════════════════════════════════
 * CREATE — operator submits a material request for a specific stage
 * ══════════════════════════════════════════════════════════════════════ */

const createSchema = z.object({
  jobOrderId: z.string(),
  stageId: z.string(),
  priority: z.enum(['normal', 'urgent']).optional().default('normal'),
  operatorNote: z.string().optional(),
  lines: z.array(z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    qtyRequested: z.number().positive(),
    uom: z.string().optional(),
    itemId: z.string().optional(),
    fromBom: z.boolean().optional(),
    note: z.string().optional(),
  })).min(1, 'At least one material line is required'),
});

export const createMaterialRequest = asyncHandler(async (req, res) => {
  const payload = createSchema.parse(req.body);

  const job = await JobOrder.findById(payload.jobOrderId).lean();
  if (!job) throw ApiError.notFound('Job order not found');

  const stage = (job.stages || []).find((s) => String(s._id) === payload.stageId);
  if (!stage) throw ApiError.notFound('Stage not found');

  const doc = await MaterialRequest.create({
    plantId: job.plantId,
    jobOrderId: job._id,
    jobOrderNumber: job.orderNumber,
    productName: job.product?.name,
    customerName: job.customer,
    stageId: stage._id,
    stageName: stage.stage,
    requestedBy: req.user.id,
    requestedByName: req.user.name || req.user.email || 'Operator',
    priority: payload.priority,
    operatorNote: payload.operatorNote,
    lines: payload.lines.map((l) => ({
      sku: String(l.sku).toUpperCase(),
      name: l.name,
      qtyRequested: l.qtyRequested,
      uom: l.uom || 'kg',
      itemId: l.itemId,
      fromBom: !!l.fromBom,
      note: l.note,
    })),
    status: 'pending',
  });

  // Notify inventory team
  try {
    const notif = await Notification.create({
      kind: 'general',
      title: `Material request — ${job.orderNumber}`,
      message: `${doc.requestedByName} requested ${payload.lines.length} item(s) for ${stage.stage.replace(/_/g, ' ')}.`,
      severity: payload.priority === 'urgent' ? 'urgent' : 'info',
      plantId: job.plantId,
      payload: {
        materialRequestId: String(doc._id),
        jobOrderId: String(job._id),
        jobOrderNumber: job.orderNumber,
        stageName: stage.stage,
      },
    });
    socketService.emitNotification(String(job.plantId), 'notification:new', notif.toObject());
  } catch (err) {
    console.error('[createMaterialRequest] notification failed:', err.message);
  }

  res.status(201).json(ok(doc.toObject()));
});

/* ════════════════════════════════════════════════════════════════════════
 * LIST — pending material requests (for inventory team) or by job
 * ══════════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════
 * LIST — material requests
 *
 * Two access modes:
 *   - User has inventory:view perm  → sees ALL plant requests
 *   - User does NOT have it (operator) → sees only their OWN requests
 *     (so they can check status of their submissions on the gate screen)
 * ══════════════════════════════════════════════════════════════════════ */

export const listMaterialRequests = asyncHandler(async (req, res) => {
  const { status, jobOrderId, plantId, mine } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (jobOrderId) filter.jobOrderId = new mongoose.Types.ObjectId(jobOrderId);
  if (plantId) filter.plantId = new mongoose.Types.ObjectId(plantId);
  else if (req.user.plantId) filter.plantId = new mongoose.Types.ObjectId(req.user.plantId);

  // Permission gate: only inventory clerks see all requests; everyone else
  // is restricted to their own submissions. The 'mine=true' query flag also
  // forces self-scope explicitly (used by operator gate screen).
  const userPerms = req.user.permissions || [];
  const canSeeAll = userPerms.includes('inventory:view') || userPerms.includes('*:*');
  if (mine === 'true' || !canSeeAll) {
    filter.requestedBy = new mongoose.Types.ObjectId(req.user.id);
  }

  const docs = await MaterialRequest.find(filter)
    .sort({ priority: 1, createdAt: -1 })
    .limit(200)
    .lean();

  // Enrich each line with current stock-on-hand for the inventory clerk
  const allSkus = [...new Set(docs.flatMap((d) => d.lines.map((l) => l.sku)))];
  const items = await InventoryItem.find({ sku: { $in: allSkus } })
    .select('sku name onHand reserved unitCost uom')
    .lean();
  const stockBySku = Object.fromEntries(items.map((i) => [i.sku, i]));

  const enriched = docs.map((d) => ({
    ...d,
    lines: d.lines.map((l) => {
      const stock = stockBySku[l.sku];
      const available = stock ? Math.max(0, (stock.onHand || 0) - (stock.reserved || 0)) : 0;
      return {
        ...l,
        currentOnHand: stock?.onHand || 0,
        currentAvailable: available,
        sufficient: available >= l.qtyRequested,
        unitCost: stock?.unitCost || 0,
      };
    }),
  }));

  res.json(ok(enriched));
});

export const getMaterialRequest = asyncHandler(async (req, res) => {
  const doc = await MaterialRequest.findById(req.params.id).lean();
  if (!doc) throw ApiError.notFound('Material request not found');
  res.json(ok(doc));
});

/* ════════════════════════════════════════════════════════════════════════
 * ISSUE — inventory clerk fulfils a material request
 *
 * Body shape (optional): { lines: [{ lineId, qtyIssued }] }
 * If no body, issues each line at qtyRequested.
 *
 * Steps:
 *   - Validate stock availability for each line
 *   - Deduct on-hand via InventoryMovement (kind: 'material_issue')
 *   - Push materials into the JobOrder.stage.materialsAdded[]
 *   - Mark request as 'issued' or 'partial' depending on fulfilment
 * ══════════════════════════════════════════════════════════════════════ */

const issueSchema = z.object({
  lines: z.array(z.object({
    sku: z.string(),
    qtyIssued: z.number().nonnegative(),
  })).optional(),
}).optional();

export const issueMaterialRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payload = issueSchema?.parse(req.body) || {};

  const reqDoc = await MaterialRequest.findById(id);
  if (!reqDoc) throw ApiError.notFound('Material request not found');
  if (!['pending', 'partial'].includes(reqDoc.status)) {
    throw ApiError.conflict(`Cannot issue a ${reqDoc.status} request`);
  }

  const issueMap = Object.fromEntries((payload.lines || []).map((l) => [String(l.sku).toUpperCase(), l.qtyIssued]));

  // Validate stock for each requested line
  const issuesPlanned = [];
  for (const line of reqDoc.lines) {
    // Default: issue full requested qty if not specified, MINUS already issued
    const wantQty = (issueMap[line.sku] !== undefined ? issueMap[line.sku] : line.qtyRequested) - (line.qtyIssued || 0);
    if (wantQty <= 0) continue;

    const item = await InventoryItem.findOne({ sku: line.sku, plantId: reqDoc.plantId })
      .lean()
      || await InventoryItem.findOne({ sku: line.sku }).lean();

    if (!item) {
      throw ApiError.badRequest(`Inventory item not found: ${line.sku}`, { code: 'E_NO_ITEM' });
    }
    const available = (item.onHand || 0) - (item.reserved || 0);
    if (available < wantQty) {
      throw ApiError.badRequest(
        `Insufficient stock for ${line.sku}: have ${available} ${line.uom}, need ${wantQty} ${line.uom}`,
        { code: 'E_LOW_STOCK' }
      );
    }
    issuesPlanned.push({ line, item, qty: wantQty });
  }

  // Apply: create InventoryMovement + decrement onHand + add to JobOrder stage materials
  const job = await JobOrder.findById(reqDoc.jobOrderId);
  if (!job) throw ApiError.notFound('Job order not found');
  const stage = job.stages.id(reqDoc.stageId);
  if (!stage) throw ApiError.notFound('Stage not found');

  for (const plan of issuesPlanned) {
    // 1. Create movement (audit trail)
    //    Schema requires: type (enum), qty, sku, itemId, plantId
    //    'reference.kind' is the structured kind tag (material_issue)
    await InventoryMovement.create({
      plantId: reqDoc.plantId,
      itemId: plan.item._id,
      sku: plan.item.sku,
      type: 'ISSUE_TO_PROD',          // outflow type
      qty: plan.qty,                   // schema uses non-negative + type carries direction
      reference: {
        kind: 'material_issue',
        id: String(reqDoc._id),
      },
      performedBy: req.user.id,
      notes: `Issued for ${job.orderNumber} · ${stage.stage} · MR-${String(reqDoc._id).slice(-6).toUpperCase()}`,
    });

    // 2. Deduct on-hand
    await InventoryItem.updateOne(
      { _id: plan.item._id },
      { $inc: { onHand: -plan.qty } }
    );

    // 3. Add to stage materialsAdded
    stage.materialsAdded.push({
      sku: plan.item.sku,
      name: plan.item.name,
      qty: plan.qty,
      uom: plan.line.uom,
      type: plan.item.category === 'Raw Material' ? 'raw' : 'consumable',
      itemId: plan.item._id,
      issuedAt: new Date(),
    });

    // 4. Update the request line's qtyIssued
    const reqLine = reqDoc.lines.find((l) => l.sku === plan.line.sku);
    if (reqLine) reqLine.qtyIssued = (reqLine.qtyIssued || 0) + plan.qty;
  }

  await job.save();

  // Determine fulfilment status
  const allFulfilled = reqDoc.lines.every((l) => (l.qtyIssued || 0) >= l.qtyRequested);
  reqDoc.status = allFulfilled ? 'issued' : 'partial';
  if (allFulfilled) {
    reqDoc.issuedAt = new Date();
    reqDoc.issuedBy = req.user.id;
    reqDoc.issuedByName = req.user.name || req.user.email || 'Inventory';
  }

  await reqDoc.save();

  // Notify operator
  try {
    const notif = await Notification.create({
      kind: 'general',
      title: `Materials ${allFulfilled ? 'issued' : 'partially issued'} — ${reqDoc.jobOrderNumber}`,
      message: `${req.user.name || 'Inventory'} ${allFulfilled ? 'issued' : 'partially issued'} ${issuesPlanned.length} item(s) for ${reqDoc.stageName.replace(/_/g, ' ')}.`,
      severity: 'info',
      plantId: reqDoc.plantId,
      payload: {
        materialRequestId: String(reqDoc._id),
        jobOrderId: String(reqDoc.jobOrderId),
        recipientUserId: String(reqDoc.requestedBy),
      },
    });
    socketService.emitNotification(String(reqDoc.plantId), 'notification:new', notif.toObject());
  } catch (err) {
    console.error('[issueMaterialRequest] notification failed:', err.message);
  }

  res.json(ok(reqDoc.toObject()));
});

/* ════════════════════════════════════════════════════════════════════════
 * REJECT / CANCEL
 * ══════════════════════════════════════════════════════════════════════ */

const rejectSchema = z.object({
  reason: z.string().min(1, 'Reason is required'),
});

export const rejectMaterialRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payload = rejectSchema.parse(req.body);

  const reqDoc = await MaterialRequest.findById(id);
  if (!reqDoc) throw ApiError.notFound('Material request not found');
  if (!['pending', 'partial'].includes(reqDoc.status)) {
    throw ApiError.conflict(`Cannot reject a ${reqDoc.status} request`);
  }

  reqDoc.status = 'rejected';
  reqDoc.rejectionReason = payload.reason;
  await reqDoc.save();

  res.json(ok(reqDoc.toObject()));
});

export const cancelMaterialRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const reqDoc = await MaterialRequest.findById(id);
  if (!reqDoc) throw ApiError.notFound('Material request not found');
  if (!['pending'].includes(reqDoc.status)) {
    throw ApiError.conflict(`Cannot cancel a ${reqDoc.status} request`);
  }

  // Only the requester (or admin) can cancel
  if (String(reqDoc.requestedBy) !== String(req.user.id) && !req.user.isAdmin) {
    throw ApiError.forbidden('Only the requester can cancel this request');
  }

  reqDoc.status = 'cancelled';
  await reqDoc.save();
  res.json(ok(reqDoc.toObject()));
});

/* ════════════════════════════════════════════════════════════════════════
 * SUGGEST — fetch BOM-derived material list for a job's stage
 *
 * Helper that the operator UI calls to pre-fill the request form.
 * Computes "what's needed for this stage" from the job's bomSnapshot,
 * minus anything already issued (so re-requests don't duplicate).
 * ══════════════════════════════════════════════════════════════════════ */

export const suggestMaterials = asyncHandler(async (req, res) => {
  const { jobOrderId, stageId } = req.query;
  if (!jobOrderId || !stageId) {
    throw ApiError.badRequest('jobOrderId and stageId required');
  }

  const job = await JobOrder.findById(jobOrderId).lean();
  if (!job) throw ApiError.notFound('Job order not found');

  const stage = (job.stages || []).find((s) => String(s._id) === String(stageId));
  if (!stage) throw ApiError.notFound('Stage not found');

  // Prefer bomSnapshot baked into the job (immutable history). If the job
  // was created before BOM linking was fixed, fall back to a live lookup
  // by product SKU — better to suggest something than show an empty form.
  let components = job.bomSnapshot?.components || [];
  if (components.length === 0 && job.product?.sku) {
    const { BOM } = await import('../models/ERP.js');
    const liveBom = await BOM.findOne({
      productSku: String(job.product.sku).toUpperCase(),
      active: true,
    }).lean();
    if (liveBom) {
      components = (liveBom.components || []).map((c) => ({
        sku: c.sku,
        name: c.name,
        qtyPerUnit: c.qtyPerUnit,
        uom: c.uom,
        scrapPct: c.scrapPct,
        stages: c.stages,
      }));

      // Persist the resolved bomSnapshot back to the job for next time.
      // This way old jobs get healed automatically the first time someone
      // requests materials.
      try {
        await JobOrder.updateOne(
          { _id: job._id, 'bomSnapshot.components': { $exists: false } },
          {
            $set: {
              bomSnapshot: {
                externalId: liveBom.externalId,
                version: liveBom.version,
                components,
              },
            },
          }
        );
      } catch { /* non-fatal — caller still gets components */ }
    }
  }

  if (components.length === 0) {
    return res.json(ok([]));
  }

  // Sum what's already been issued/added at this stage
  const alreadyAdded = {};
  for (const m of (stage.materialsAdded || [])) {
    const sku = String(m.sku || '').toUpperCase();
    if (!sku) continue;
    alreadyAdded[sku] = (alreadyAdded[sku] || 0) + (m.qty || 0);
  }

  // Sum what's pending in already-open requests for this stage
  const openRequests = await MaterialRequest.find({
    jobOrderId: job._id,
    stageId: stage._id,
    status: { $in: ['pending', 'partial'] },
  }).lean();
  const alreadyRequested = {};
  for (const r of openRequests) {
    for (const l of r.lines) {
      const remaining = (l.qtyRequested || 0) - (l.qtyIssued || 0);
      if (remaining > 0) {
        alreadyRequested[l.sku] = (alreadyRequested[l.sku] || 0) + remaining;
      }
    }
  }

  // Filter components by stage. If component has stages[] array, use it;
  // otherwise (legacy BOMs) include in all stages.
  const stageComponents = components.filter((c) => {
    if (!c.stages || c.stages.length === 0) return true;
    return c.stages.includes(stage.stage);
  });

  const qty = job.plannedQty || 1;

  const suggestions = await Promise.all(stageComponents.map(async (c) => {
    const skuUpper = String(c.sku).toUpperCase();
    const scrap = c.scrapPct || 0;
    const totalNeeded = (c.qtyPerUnit || 0) * qty * (1 + scrap / 100);
    const remaining = totalNeeded - (alreadyAdded[skuUpper] || 0) - (alreadyRequested[skuUpper] || 0);

    const item = await InventoryItem.findOne({ sku: skuUpper, plantId: job.plantId }).lean()
      || await InventoryItem.findOne({ sku: skuUpper }).lean();

    return {
      sku: skuUpper,
      name: c.name || item?.name || skuUpper,
      qtySuggested: Math.max(0, Number(remaining.toFixed(3))),
      qtyAlreadyAdded: alreadyAdded[skuUpper] || 0,
      qtyAlreadyRequested: alreadyRequested[skuUpper] || 0,
      uom: c.uom || item?.uom || 'kg',
      itemId: item?._id,
      currentAvailable: item ? Math.max(0, (item.onHand || 0) - (item.reserved || 0)) : 0,
      fromBom: true,
    };
  }));

  res.json(ok(suggestions.filter((s) => s.qtySuggested > 0)));
});
