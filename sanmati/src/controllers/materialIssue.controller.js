import { Plant } from '../models/Plant.js';
import { z } from 'zod';
import mongoose from 'mongoose';
import { MaterialIssue } from '../models/MaterialIssue.js';
import { InventoryItem, InventoryMovement } from '../models/Inventory.js';
import { JobOrder } from '../models/JobOrder.js';
import { User } from '../models/User.js';
import { Team } from '../models/Team.js';
import { Machine } from '../models/Machine.js';
import { AuditLog } from '../models/AuditLog.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { parsePagination, paginatedMeta } from '../utils/pagination.js';
import { cacheService } from '../services/cache.service.js';
import { socketService } from '../services/socket.service.js';
import { logger } from '../config/logger.js';

/* ═══ LIST ═══
 * GET /api/v1/material-issues?status=issued&jobOrderId=...&issuedTo=...
 * Drives the WIP dashboard.
 */
const listQuery = z.object({
  status: z.string().optional(),
  jobOrderId: z.string().optional(),
  jobOrderNumber: z.string().optional(),
  issuedTo: z.string().optional(),
  teamId: z.string().optional(),
  stage: z.string().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});

export const listIssues = asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const { page, limit, skip, sort } = parsePagination(q);
  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.jobOrderId && mongoose.isValidObjectId(q.jobOrderId)) filter.jobOrderId = q.jobOrderId;
  if (q.jobOrderNumber) filter.jobOrderNumber = q.jobOrderNumber.toUpperCase();
  if (q.issuedTo && mongoose.isValidObjectId(q.issuedTo)) filter.issuedTo = q.issuedTo;
  if (q.teamId && mongoose.isValidObjectId(q.teamId)) filter.teamId = q.teamId;
  if (q.stage) filter.stage = q.stage;
  if (q.fromDate || q.toDate) {
    filter.issuedAt = {};
    if (q.fromDate) filter.issuedAt.$gte = q.fromDate;
    if (q.toDate) filter.issuedAt.$lte = q.toDate;
  }

  const [items, total] = await Promise.all([
    MaterialIssue.find(filter).sort(sort || { issuedAt: -1 }).skip(skip).limit(limit).lean(),
    MaterialIssue.countDocuments(filter),
  ]);
  res.json(ok(items, paginatedMeta({ page, limit, total })));
});

/* ═══ GET ONE ═══ */
export const getIssue = asyncHandler(async (req, res) => {
  const issue = await MaterialIssue.findById(req.params.id).lean();
  if (!issue) throw ApiError.notFound('Material issue not found');
  res.json(ok(issue));
});

/* ═══ CURRENT WIP (materials on the floor right now) ═══
 * GET /api/v1/material-issues/wip
 * Returns open issues grouped for the dashboard.
 */
export const currentWIP = asyncHandler(async (req, res) => {
  const wip = await MaterialIssue.find({ status: { $in: ['issued', 'partial'] } })
    .sort({ issuedAt: -1 })
    .limit(100)
    .lean();

  const byStage = wip.reduce((acc, w) => {
    acc[w.stage] = (acc[w.stage] || 0) + 1;
    return acc;
  }, {});

  const byPerson = wip.reduce((acc, w) => {
    const key = w.issuedToName || 'Unknown';
    if (!acc[key]) acc[key] = { name: key, issuedTo: w.issuedTo, count: 0, items: 0 };
    acc[key].count += 1;
    acc[key].items += w.items.length;
    return acc;
  }, {});

  res.json(ok({
    totalOpen: wip.length,
    byStage,
    byPerson: Object.values(byPerson),
    recent: wip.slice(0, 20),
  }));
});

/* ═══ ISSUE MATERIAL (deduct inventory) ═══
 * POST /api/v1/material-issues
 *
 * Body:
 *   {
 *     jobOrderId | jobOrderNumber,     // at least one
 *     stage: 'printing',
 *     issuedToUserId (or issuedToName),
 *     teamId?, machineCode?,
 *     items: [{ sku, qty, uom?, notes? }],
 *     notes?
 *   }
 */
const emptyToUndef = (v) => (v === '' || v === null ? undefined : v);

const issueSchema = z.preprocess(
  (data) => {
    if (!data || typeof data !== 'object') return data;
    const out = { ...data };
    // Treat empty strings as "not provided"
    for (const k of ['jobOrderId', 'jobOrderNumber', 'issuedToUserId', 'issuedToName', 'teamId', 'machineCode', 'plantId', 'notes']) {
      out[k] = emptyToUndef(out[k]);
    }
    return out;
  },
  z.object({
    jobOrderId: z.string().optional(),
    jobOrderNumber: z.string().optional(),
    stage: z.enum(['printing', 'inspection', 'lamination', 'hot_room', 'slitting', 'cutting', 'packaging', 'general']),
    issuedToUserId: z.string().optional(),
    issuedToName: z.string().optional(),
    teamId: z.string().optional(),
    machineCode: z.string().optional(),
    plantId: z.string().nullish(),
    notes: z.string().optional(),
    items: z.array(z.object({
      sku: z.string().min(1),
      qty: z.number().positive(),
      uom: z.string().optional(),
      notes: z.string().optional(),
    })).min(1),
  })
  .refine(
    (d) => d.issuedToUserId || d.issuedToName,
    { message: 'Either issuedToUserId or issuedToName is required', path: ['issuedToName'] }
  )
);

async function generateIssueNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  return `MI-${ts}`;
}

async function resolveJobOrder({ jobOrderId, jobOrderNumber }) {
  if (jobOrderId && mongoose.isValidObjectId(jobOrderId)) {
    const j = await JobOrder.findById(jobOrderId).lean();
    if (j) return j;
  }
  if (jobOrderNumber) {
    // JobOrder model uses `orderNumber` (or `jobNumber`) — try both
    const j = await JobOrder.findOne({
      $or: [
        { orderNumber: jobOrderNumber.toUpperCase() },
        { jobNumber: jobOrderNumber.toUpperCase() },
      ],
    }).lean();
    if (j) return j;
  }
  return null;
}

async function resolveIssuee({ issuedToUserId, issuedToName }) {
  if (issuedToUserId && mongoose.isValidObjectId(issuedToUserId)) {
    const u = await User.findById(issuedToUserId).select('name email teams').lean();
    if (u) return { id: u._id, name: u.name, teamIds: u.teams };
  }
  if (issuedToName) {
    return { id: null, name: issuedToName, teamIds: [] };
  }
  throw ApiError.badRequest('Either issuedToUserId or issuedToName is required');
}

export const issueMaterial = asyncHandler(async (req, res) => {
  const payload = issueSchema.parse(req.body);

  // Resolve plantId with fallback chain: payload → user → first plant in DB
  let plantId = null;
  if (payload.plantId && mongoose.isValidObjectId(payload.plantId)) {
    plantId = new mongoose.Types.ObjectId(payload.plantId);
  } else if (req.user?.plantId && mongoose.isValidObjectId(req.user.plantId)) {
    plantId = new mongoose.Types.ObjectId(req.user.plantId);
  } else {
    const fallback = await Plant.findOne().sort({ createdAt: 1 }).lean();
    if (fallback) plantId = fallback._id;
  }
  if (!plantId) {
    throw ApiError.badRequest(
      'No plant available. Run `node scripts/seed.js` to create one.',
      { code: 'E_NO_PLANT' }
    );
  }

  // Resolve Job Order
  const jobOrder = await resolveJobOrder({
    jobOrderId: payload.jobOrderId,
    jobOrderNumber: payload.jobOrderNumber,
  });
  if (!jobOrder && (payload.jobOrderId || payload.jobOrderNumber)) {
    throw ApiError.notFound('Job Order not found');
  }

  // Resolve person
  const issuee = await resolveIssuee(payload);

  // Resolve team
  let team = null;
  if (payload.teamId && mongoose.isValidObjectId(payload.teamId)) {
    team = await Team.findById(payload.teamId).select('name').lean();
  }

  // Resolve machine
  let machine = null;
  if (payload.machineCode) {
    machine = await Machine.findOne({ code: payload.machineCode.toUpperCase() }).select('_id code').lean();
  }

  // Pre-check ALL items have sufficient stock. Fail fast before any write.
  const skus = payload.items.map((i) => String(i.sku).toUpperCase());
  const invItems = await InventoryItem.find({ sku: { $in: skus } });
  const invBySku = Object.fromEntries(invItems.map((i) => [i.sku, i]));

  const shortages = [];
  for (const ln of payload.items) {
    const sku = String(ln.sku).toUpperCase();
    const inv = invBySku[sku];
    if (!inv) {
      shortages.push({ sku, reason: 'item not found in inventory', requested: ln.qty });
      continue;
    }
    const available = (inv.onHand || 0) - (inv.reserved || 0);
    if (available < ln.qty) {
      shortages.push({
        sku,
        name: inv.name,
        requested: ln.qty,
        available,
        shortBy: ln.qty - available,
        uom: inv.uom,
      });
    }
  }
  if (shortages.length) {
    throw new ApiError(422, 'Insufficient stock', {
      code: 'E_INSUFFICIENT_STOCK',
      details: shortages,
    });
  }

  const issueNumber = await generateIssueNumber();
  const issuedAt = new Date();

  // Sequential atomic deductions + movement log. Track rollback in case the
  // final MaterialIssue save fails.
  const issuedLines = [];
  const rollback = [];
  let totalValue = 0;

  try {
    for (const ln of payload.items) {
      const sku = String(ln.sku).toUpperCase();
      const qty = Number(ln.qty);
      const inv = invBySku[sku];
      const unitCost = inv.unitCost || 0;
      const lineValue = unitCost * qty;
      totalValue += lineValue;

      // Atomic: onHand -= qty (no transaction needed)
      const updated = await InventoryItem.findOneAndUpdate(
        { _id: inv._id, onHand: { $gte: qty } },  // guard against race
        { $inc: { onHand: -qty } },
        { new: true }
      );
      if (!updated) {
        throw new ApiError(409, `Race condition: ${sku} was taken by another issue`, {
          code: 'E_RACE',
          details: { sku },
        });
      }
      rollback.push(() => InventoryItem.updateOne({ _id: inv._id }, { $inc: { onHand: qty } }));

      // Log movement
      const mov = await InventoryMovement.create({
        sku: inv.sku,
        itemId: inv._id,
        plantId,
        type: 'OUT',
        qty,
        reference: { kind: 'material_issue', id: issueNumber },
        balanceAfter: updated.onHand,
        performedBy: req.user.id || null,
        notes: `Issued to ${issuee.name} for ${payload.stage}${jobOrder ? ` (job ${jobOrder.orderNumber || jobOrder.jobNumber})` : ''}`,
      });
      rollback.push(() => InventoryMovement.deleteOne({ _id: mov._id }));

      issuedLines.push({
        sku,
        name: inv.name,
        issuedQty: qty,
        uom: ln.uom || inv.uom || 'kg',
        unitCost,
        consumedQty: 0,
        returnedQty: 0,
        scrapQty: 0,
        inventoryItemId: inv._id,
        issuanceMovementId: mov._id,
        notes: ln.notes,
      });
    }

    // Save the MaterialIssue document
    const doc = await MaterialIssue.create({
      issueNumber,
      jobOrderId: jobOrder?._id,
      jobOrderNumber: jobOrder?.orderNumber || jobOrder?.jobNumber,
      productSku: jobOrder?.product?.sku,
      productName: jobOrder?.product?.name,
      stage: payload.stage,
      issuedTo: issuee.id,
      issuedToName: issuee.name,
      teamId: team?._id,
      teamName: team?.name,
      issuedBy: req.user.id || null,
      issuedByName: req.user.name || req.user.email,
      machineId: machine?._id,
      machineCode: machine?.code,
      items: issuedLines,
      totalValue: Number(totalValue.toFixed(2)),
      status: 'issued',
      plantId,
      issuedAt,
      notes: payload.notes,
    });

    await AuditLog.create({
      actor: req.user.id || null,
      actorEmail: req.user.email || 'system',
      action: 'material_issue.issue',
      module: 'inventory',
      targetType: 'MaterialIssue',
      targetId: String(doc._id),
      after: doc.toObject(),
      ip: req.ip,
      plantId,
    });

    await cacheService.invalidateTag('inventory');
    await cacheService.invalidateTag('material_issues');
    socketService.emit?.('/ops', 'material-issue:new', doc.toObject());

    logger.info({ issueNumber, items: issuedLines.length, totalValue },
      `Material issued: ${issueNumber} to ${issuee.name}`);

    res.status(201).json(ok({
      ...doc.toObject(),
      message: `✓ Issued ${issuedLines.length} item(s) to ${issuee.name}. Inventory updated.`,
    }));
  } catch (err) {
    logger.error({ err, issueNumber }, 'Material issue failed, rolling back inventory');
    for (const undo of rollback.reverse()) {
      try { await undo(); } catch { /* continue */ }
    }
    throw err;
  }
});

/* ═══ REPORT CONSUMPTION ═══
 * POST /api/v1/material-issues/:id/consume
 *
 * Operator finishes the stage. Reports:
 *   items: [{ lineId, consumedQty, returnedQty?, scrapQty? }]
 *
 * Rules:
 *   - consumedQty + returnedQty + scrapQty MUST equal issuedQty
 *   - returnedQty is added BACK to inventory
 *   - scrapQty is logged but not returned
 */
const consumeSchema = z.object({
  items: z.array(z.object({
    lineId: z.string(),
    consumedQty: z.number().nonnegative(),
    returnedQty: z.number().nonnegative().optional(),
    scrapQty: z.number().nonnegative().optional(),
  })).min(1),
  notes: z.string().optional(),
});

export const reportConsumption = asyncHandler(async (req, res) => {
  const payload = consumeSchema.parse(req.body);
  const issue = await MaterialIssue.findById(req.params.id);
  if (!issue) throw ApiError.notFound('Material issue not found');
  if (!['issued', 'partial'].includes(issue.status)) {
    throw ApiError.badRequest(`Cannot report consumption on a ${issue.status} issue`);
  }

  const rollback = [];
  const now = new Date();

  try {
    let anyReturned = false;
    let anyPending = false;

    for (const update of payload.items) {
      const line = issue.items.id(update.lineId);
      if (!line) throw ApiError.notFound(`Line ${update.lineId} not found`);

      const consumed = Number(update.consumedQty || 0);
      const returned = Number(update.returnedQty || 0);
      const scrap = Number(update.scrapQty || 0);
      const total = consumed + returned + scrap;
      const epsilon = 0.0001;

      if (Math.abs(total - line.issuedQty) > epsilon) {
        throw ApiError.badRequest(
          `${line.sku}: consumed(${consumed}) + returned(${returned}) + scrap(${scrap}) = ${total} must equal issued ${line.issuedQty}`
        );
      }

      line.consumedQty = consumed;
      line.returnedQty = returned;
      line.scrapQty = scrap;

      // Log consumption as ADJUST type (bookkeeping/audit only — inventory
      // was already decremented at issue time, this is just recording WHAT
      // happened to the issued material on the floor).
      if (consumed > 0) {
        const consMov = await InventoryMovement.create({
          sku: line.sku,
          itemId: line.inventoryItemId,
          plantId: issue.plantId,
          type: 'ADJUST',
          qty: consumed,
          reference: { kind: 'material_consumption', id: issue.issueNumber },
          balanceAfter: null,
          performedBy: req.user.id || null,
          notes: `Consumed in ${issue.stage}${issue.jobOrderNumber ? ` (${issue.jobOrderNumber})` : ''}`,
        });
        rollback.push(() => InventoryMovement.deleteOne({ _id: consMov._id }));
        line.consumptionMovementId = consMov._id;
      }

      // Return unused material back to inventory
      if (returned > 0) {
        anyReturned = true;
        const returnedBack = await InventoryItem.findOneAndUpdate(
          { _id: line.inventoryItemId },
          { $inc: { onHand: returned } },
          { new: true }
        );
        rollback.push(() => InventoryItem.updateOne({ _id: line.inventoryItemId }, { $inc: { onHand: -returned } }));

        const retMov = await InventoryMovement.create({
          sku: line.sku,
          itemId: line.inventoryItemId,
          plantId: issue.plantId,
          type: 'IN',
          qty: returned,
          reference: { kind: 'material_return', id: issue.issueNumber },
          balanceAfter: returnedBack.onHand,
          performedBy: req.user.id || null,
          notes: `Returned from ${issue.stage}${issue.jobOrderNumber ? ` (${issue.jobOrderNumber})` : ''}`,
        });
        rollback.push(() => InventoryMovement.deleteOne({ _id: retMov._id }));
        line.returnMovementId = retMov._id;
      }

      // Log scrap as a separate movement type (ADJUST with negative context)
      if (scrap > 0) {
        await InventoryMovement.create({
          sku: line.sku,
          itemId: line.inventoryItemId,
          plantId: issue.plantId,
          type: 'ADJUST',
          qty: -scrap,   // negative = waste
          reference: { kind: 'scrap', id: issue.issueNumber },
          balanceAfter: null,
          performedBy: req.user.id || null,
          notes: `Scrap in ${issue.stage}${issue.jobOrderNumber ? ` (${issue.jobOrderNumber})` : ''}`,
        });
      }
    }

    // Check if any line was not reported (still has issuedQty but no consumption data)
    for (const l of issue.items) {
      if (l.consumedQty + l.returnedQty + l.scrapQty === 0) anyPending = true;
    }

    issue.status = anyPending ? 'partial' : (anyReturned ? 'partial' : 'consumed');
    issue.consumedAt = now;
    if (payload.notes) issue.notes = (issue.notes ? issue.notes + '\n' : '') + payload.notes;
    await issue.save();

    await AuditLog.create({
      actor: req.user.id || null,
      actorEmail: req.user.email || 'system',
      action: 'material_issue.consume',
      module: 'inventory',
      targetType: 'MaterialIssue',
      targetId: String(issue._id),
      after: issue.toObject(),
      ip: req.ip,
      plantId: issue.plantId,
    });

    await cacheService.invalidateTag('inventory');
    await cacheService.invalidateTag('material_issues');
    socketService.emit?.('/ops', 'material-issue:update', issue.toObject());

    res.json(ok(issue.toObject()));
  } catch (err) {
    for (const undo of rollback.reverse()) {
      try { await undo(); } catch { /* continue */ }
    }
    throw err;
  }
});

/* ═══ CANCEL (rollback entire issue) ═══
 * POST /api/v1/material-issues/:id/cancel
 *
 * Use only BEFORE consumption is reported. Returns all issued items to inventory.
 */
export const cancelIssue = asyncHandler(async (req, res) => {
  const issue = await MaterialIssue.findById(req.params.id);
  if (!issue) throw ApiError.notFound('Material issue not found');
  if (issue.status !== 'issued') {
    throw ApiError.badRequest(`Only 'issued' status can be cancelled. Current: ${issue.status}`);
  }

  // Return everything to inventory
  for (const line of issue.items) {
    await InventoryItem.findOneAndUpdate(
      { _id: line.inventoryItemId },
      { $inc: { onHand: line.issuedQty } }
    );
    await InventoryMovement.create({
      sku: line.sku,
      itemId: line.inventoryItemId,
      plantId: issue.plantId,
      type: 'IN',
      qty: line.issuedQty,
      reference: { kind: 'material_cancel', id: issue.issueNumber },
      performedBy: req.user.id || null,
      notes: `Issue ${issue.issueNumber} cancelled — returned to stock`,
    });
    line.returnedQty = line.issuedQty;
  }

  issue.status = 'cancelled';
  issue.returnedAt = new Date();
  await issue.save();

  await cacheService.invalidateTag('inventory');
  await cacheService.invalidateTag('material_issues');
  socketService.emit?.('/ops', 'material-issue:update', issue.toObject());

  res.json(ok(issue.toObject()));
});
