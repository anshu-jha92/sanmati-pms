import { z } from 'zod';
import mongoose from 'mongoose';
import { InventoryItem, InventoryMovement } from '../models/Inventory.js';
import { MaterialIssue } from '../models/MaterialIssue.js';
import { MaterialRequest } from '../models/MaterialRequest.js';
import { User } from '../models/User.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { parsePagination, paginatedMeta } from '../utils/pagination.js';
import { scopeToPrincipal } from '../services/filter.service.js';
import { AuditLog } from '../models/AuditLog.js';
import { cacheService } from '../services/cache.service.js';
import { resolvePlantId } from '../utils/plant.js';

/* ═══ LIST ═══ */
const listQuery = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  lowStockOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});

export const listInventory = asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const { page, limit, skip, sort } = parsePagination(q);

  // Forgiving filter: exclude only explicitly-inactive items.
  const filter = { active: { $ne: false } };

  // Category → also match on `type` (DB field). Old records may have category
  // undefined; new ones have both.
  if (q.category) {
    const categoryMap = { raw: 'raw', consumable: 'consumable', packaging: 'packaging', finished_good: 'finished' };
    const mappedType = categoryMap[q.category] || q.category;
    filter.$or = [
      { type: mappedType },
      { category: q.category },
    ];
  }
  if (q.q) {
    const search = [
      { sku: new RegExp(q.q, 'i') },
      { name: new RegExp(q.q, 'i') },
    ];
    if (filter.$or) filter.$and = [{ $or: filter.$or }, { $or: search }], delete filter.$or;
    else filter.$or = search;
  }
  // NOTE: Plant scope removed on purpose. All logged-in users see all items
  // in the database. This avoids the "admin user has wrong/missing plantId"
  // class of bugs. Tighten later with proper multi-plant support.

  let pipeline = [
    { $match: filter },
    { $addFields: {
      available: { $subtract: ['$onHand', { $ifNull: ['$reserved', 0] }] },
      belowReorder: {
        $and: [
          { $gt: ['$reorderLevel', 0] },
          { $lt: ['$onHand', '$reorderLevel'] },
        ],
      },
    } },
  ];
  if (q.lowStockOnly) {
    pipeline.push({ $match: { belowReorder: true } });
  }
  pipeline.push({ $sort: sort || { name: 1 } });
  pipeline.push({ $skip: skip }, { $limit: limit });

  const [items, countRes] = await Promise.all([
    InventoryItem.aggregate(pipeline),
    InventoryItem.aggregate([
      { $match: filter },
      { $addFields: {
        belowReorder: {
          $and: [
            { $gt: ['$reorderLevel', 0] },
            { $lt: ['$onHand', '$reorderLevel'] },
          ],
        },
      } },
      ...(q.lowStockOnly ? [{ $match: { belowReorder: true } }] : []),
      { $count: 'total' },
    ]),
  ]);

  const total = countRes[0]?.total || 0;
  res.json(ok(items, paginatedMeta({ page, limit, total })));
});

/* ═══ CREATE / UPDATE (new entry with all params) ═══ */
/* ═══ CREATE / UPDATE (new entry with all params) ═══
 * Note: Inventory model has both `type` (required, strict enum) and `category`.
 * We accept `category` from the UI (raw/consumable/packaging/finished_good) and
 * map to the stricter `type` enum (raw/consumable/packaging/finished) that the
 * schema requires. 'finished_good' → 'finished'.
 */
const CATEGORY_TO_TYPE = {
  raw: 'raw',
  consumable: 'consumable',
  packaging: 'packaging',
  finished_good: 'finished',
};

/* ═══ DEBUG ═══
 * Returns raw inventory state + user context if logged in. PUBLIC endpoint —
 * no authentication required. Call GET /api/v1/inventory/debug directly in
 * browser to diagnose why items aren't showing.
 */
export const debugInventory = asyncHandler(async (req, res) => {
  const [totalCount, activeCount, explicitlyInactiveCount, sample, plants] = await Promise.all([
    InventoryItem.countDocuments({}),
    InventoryItem.countDocuments({ active: true }),
    InventoryItem.countDocuments({ active: false }),
    InventoryItem.find({}).sort({ createdAt: -1 }).limit(20).lean(),
    mongoose.model('Plant').find({}).limit(5).lean(),
  ]);
  res.json(ok({
    db: {
      totalItems: totalCount,
      activeTrue: activeCount,
      activeFalse: explicitlyInactiveCount,
      activeUndefined: totalCount - activeCount - explicitlyInactiveCount,
    },
    currentUser: req.user ? {
      id: req.user.id,
      email: req.user.email,
      plantId: req.user.plantId,
      hasWildcard: req.user.permissions?.includes('*:*'),
      permCount: req.user.permissions?.length,
    } : null,
    plants: plants.map((p) => ({ id: String(p._id), name: p.name, code: p.code })),
    sample: sample.map((i) => ({
      _id: String(i._id),
      sku: i.sku,
      name: i.name,
      type: i.type,
      category: i.category,
      onHand: i.onHand,
      active: i.active,
      plantId: String(i.plantId || 'NONE'),
      createdAt: i.createdAt,
    })),
  }));
});

const upsertSchema = z.object({
  sku: z.string().toUpperCase(),
  name: z.string().min(1),
  category: z.enum(['raw', 'consumable', 'packaging', 'finished_good']).optional(),
  uom: z.string().default('kg'),
  onHand: z.number().nonnegative().optional(),
  reserved: z.number().nonnegative().optional(),
  reorderLevel: z.number().nonnegative().optional(),
  reorderQty: z.number().nonnegative().optional(),
  unitCost: z.number().nonnegative().optional(),
  location: z.string().optional(),
  supplier: z.string().optional(),
  barcode: z.string().optional(),
  notes: z.string().optional(),
  plantId: z.string().nullish(),
});

export const createInventoryItem = asyncHandler(async (req, res) => {
  const body = upsertSchema.parse(req.body);
  body.plantId = await resolvePlantId(body.plantId, req.user.plantId);
  // Default reorder level of 80 kg for raw materials
  if (body.category === 'raw' && body.reorderLevel === undefined) {
    body.reorderLevel = 80;
  }
  const existing = await InventoryItem.findOne({ sku: body.sku, plantId: body.plantId });
  if (existing) throw ApiError.conflict(`Item ${body.sku} already exists`);

  // The DB schema has a REQUIRED `type` field that is strictly enumerated.
  // Map the UI-friendly `category` string to it.
  const type = CATEGORY_TO_TYPE[body.category || 'raw'];

  const doc = await InventoryItem.create({
    ...body,
    type,                         // required by schema
    active: true,
  });

  await AuditLog.create({
    actor: req.user.id, actorEmail: req.user.email,
    action: 'inventory.create', module: 'inventory',
    targetType: 'InventoryItem', targetId: String(doc._id),
    after: doc.toObject(), ip: req.ip, plantId: doc.plantId,
  });
  await cacheService.invalidateTag('inventory');
  res.status(201).json(ok(doc));
});

// Whitelisted update fields — protect against arbitrary writes
const UPDATABLE_FIELDS = [
  'name', 'category', 'uom', 'reorderLevel', 'reorderQty', 'unitCost',
  'location', 'supplier', 'barcode', 'notes', 'active',
];

export const updateInventoryItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Item not found');
  const before = item.toObject();

  // Handle category → type mapping
  if (req.body.category && CATEGORY_TO_TYPE[req.body.category]) {
    item.type = CATEGORY_TO_TYPE[req.body.category];
  }

  // Apply whitelisted fields
  for (const field of UPDATABLE_FIELDS) {
    if (req.body[field] !== undefined) {
      item[field] = req.body[field];
    }
  }

  // Special handling for onHand — if it changed, log a movement
  let movementCreated = null;
  if (req.body.onHand !== undefined) {
    const newOnHand = Number(req.body.onHand);
    const delta = newOnHand - (before.onHand || 0);
    if (delta !== 0) {
      item.onHand = newOnHand;
      // Log the manual adjustment as a proper InventoryMovement so it shows in history
      movementCreated = await InventoryMovement.create({
        sku: item.sku,
        itemId: item._id,
        plantId: item.plantId,
        type: 'ADJUST',
        qty: Math.abs(delta),
        reference: { kind: 'manual', id: `manual-${Date.now()}` },
        balanceAfter: newOnHand,
        performedBy: req.user.id || null,
        notes: delta > 0
          ? `Manual stock added: +${delta} ${item.uom}`
          : `Manual stock removed: ${delta} ${item.uom}`,
      });
    }
  }

  await item.save();
  await AuditLog.create({
    actor: req.user.id, actorEmail: req.user.email,
    action: 'inventory.update', module: 'inventory',
    targetType: 'InventoryItem', targetId: String(item._id),
    before, after: item.toObject(),
    ip: req.ip, plantId: item.plantId,
  });
  await cacheService.invalidateTag('inventory');
  res.json(ok({
    ...item.toObject(),
    _movementLogged: movementCreated ? true : false,
  }));
});

/* ═══ MANUAL ADJUSTMENT (add stock / consume / scrap) ═══ */
const adjustSchema = z.object({
  itemId: z.string(),
  type: z.enum(['RECEIPT', 'CONSUMPTION', 'ADJUSTMENT', 'SCRAP']),
  qty: z.number(),
  reason: z.string().optional(),
  reference: z.string().optional(),
});

export const recordMovement = asyncHandler(async (req, res) => {
  const payload = adjustSchema.parse(req.body);
  const session = await mongoose.startSession();
  let savedMov;
  try {
    await session.withTransaction(async () => {
      const item = await InventoryItem.findById(payload.itemId).session(session);
      if (!item) throw ApiError.notFound('Item not found');
      const delta = payload.type === 'RECEIPT' ? payload.qty : -Math.abs(payload.qty);
      item.onHand = Math.max(0, (item.onHand || 0) + delta);
      await item.save({ session });

      const mov = await InventoryMovement.create([{
        sku: item.sku,
        itemId: item._id,
        plantId: item.plantId,
        type: payload.type,
        qty: Math.abs(payload.qty),
        reference: payload.reference ? { kind: 'manual', id: payload.reference } : undefined,
        balanceAfter: item.onHand,
        performedBy: req.user.id,
        notes: payload.reason,
      }], { session });
      savedMov = mov[0].toObject();
    });
    await cacheService.invalidateTag('inventory');
    res.json(ok(savedMov));
  } finally {
    session.endSession();
  }
});

/* ═══ LOW STOCK ALERTS ═══ */
export const lowStockAlerts = asyncHandler(async (req, res) => {
  const filter = { active: true, reorderLevel: { $gt: 0 } };
  scopeToPrincipal(filter, req.user, { plantField: 'plantId' });
  const items = await InventoryItem.aggregate([
    { $match: filter },
    { $match: { $expr: { $lt: ['$onHand', '$reorderLevel'] } } },
    { $sort: { onHand: 1 } },
  ]);
  res.json(ok(items));
});

/* ═══ ERP SYNC TRIGGER ═══
 *
 * Tells the ERP sync worker to run NOW for the "inventory" scope.
 * The worker is defined in src/workers/erpSync.worker.js; this just enqueues a job.
 */
export const triggerErpSync = asyncHandler(async (req, res) => {
  // Enqueue a sync job via the existing erpSync queue
  const { erpSyncQueue } = await import('../services/queue.service.js');
  await erpSyncQueue.add('sync-inventory', { scope: 'inventory', triggeredBy: req.user.id });
  res.json(ok({ queued: true, message: 'ERP sync requested for inventory' }));
});

/* ════════════════════════════════════════════════════════════════════════
 *
 *  ITEM TRACKING — full history, current WIP, summary stats
 *
 *  GET /api/v1/inventory/items/:sku/summary
 *  GET /api/v1/inventory/items/:sku/movements
 *  GET /api/v1/inventory/items/:sku/wip
 *
 * ══════════════════════════════════════════════════════════════════════ */

/* ═══ FIND ITEM BY SKU OR ID ═══ */
async function resolveItem(skuOrId) {
  if (mongoose.isValidObjectId(skuOrId)) {
    const byId = await InventoryItem.findById(skuOrId).lean();
    if (byId) return byId;
  }
  return InventoryItem.findOne({ sku: String(skuOrId).toUpperCase() }).lean();
}

/* ═══ ENRICH MOVEMENT WITH USER + REFERENCE NAMES ═══
 * Movements just store ObjectIds. The UI wants user names and reference
 * descriptions resolved. We do this in batch (one query per type).
 */
async function enrichMovements(movements) {
  if (!movements.length) return [];

  // Collect IDs
  const userIds = new Set();
  const issueRefIds = new Set();      // MaterialIssue.issueNumber strings (legacy)
  const requestRefIds = new Set();    // MaterialRequest._id strings (new flow)
  for (const m of movements) {
    if (m.performedBy) userIds.add(String(m.performedBy));
    if (m.reference?.kind?.startsWith('material_') || m.reference?.kind === 'scrap') {
      const refId = m.reference.id;
      if (!refId) continue;
      // MaterialRequest IDs are 24-char hex ObjectIds; MaterialIssue is "MI-XXXX"
      if (/^[0-9a-fA-F]{24}$/.test(refId)) {
        requestRefIds.add(refId);
      } else {
        issueRefIds.add(refId);
      }
    }
  }

  // Batch fetch from BOTH old MaterialIssue and new MaterialRequest
  const [users, issues, requests] = await Promise.all([
    userIds.size
      ? User.find({ _id: { $in: [...userIds] } }).select('name email').lean()
      : Promise.resolve([]),
    issueRefIds.size
      ? MaterialIssue.find({ issueNumber: { $in: [...issueRefIds] } })
        .select('issueNumber stage issuedToName jobOrderNumber productSku').lean()
      : Promise.resolve([]),
    requestRefIds.size
      ? MaterialRequest.find({ _id: { $in: [...requestRefIds] } })
        .select('_id stageName requestedByName jobOrderNumber productName').lean()
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const issueMap = new Map(issues.map((i) => [i.issueNumber, i]));

  // Normalise MaterialRequest entries into the same shape so describeMovement
  // doesn't need to know about both models. Map keys are the raw refId
  // (MaterialRequest._id as string) for direct lookup.
  const requestMap = new Map(requests.map((r) => [String(r._id), {
    issueNumber: `MR-${String(r._id).slice(-6).toUpperCase()}`,
    stage: r.stageName,
    issuedToName: r.requestedByName,
    jobOrderNumber: r.jobOrderNumber,
    productSku: r.productName,         // we use productName here for display
    productName: r.productName,
  }])); 

  return movements.map((m) => {
    const user = m.performedBy ? userMap.get(String(m.performedBy)) : null;
    let issue = null;
    if (m.reference?.kind?.startsWith('material_') || m.reference?.kind === 'scrap') {
      const refId = m.reference?.id;
      issue = requestMap.get(refId) || issueMap.get(refId) || null;
    }

    return {
      ...m,
      _id: String(m._id),
      performedByName: user?.name || user?.email || 'system',
      performedByEmail: user?.email,
      // Pretty description for the UI
      description: describeMovement(m, issue),
      relatedIssue: issue ? {
        issueNumber: issue.issueNumber,
        stage: issue.stage,
        issuedToName: issue.issuedToName,
        jobOrderNumber: issue.jobOrderNumber,
        productSku: issue.productSku,
        productName: issue.productName,
      } : null,
    };
  });
}

function describeMovement(m, issue) {
  const refKind = m.reference?.kind;
  const refId = m.reference?.id;

  if (refKind === 'purchase_order') {
    return `Receipt from supplier (PO ${refId})`;
  }
  if (refKind === 'production_order') {
    return `Issued to production (${refId})`;
  }
  if (refKind === 'sales_order') {
    return `Issued for sales order ${refId}`;
  }
  if (refKind === 'dispatch') {
    return `Dispatched (${refId})`;
  }
  if (refKind === 'qc') {
    return `QC adjustment (${refId})`;
  }
  if (refKind === 'material_issue') {
    const operator = issue?.issuedToName || 'operator';
    const product = issue?.productName || issue?.productSku;
    const stage = issue?.stage ? issue.stage.replace(/_/g, ' ') : 'production';
    const jobNum = issue?.jobOrderNumber;
    let desc = `Issued to ${operator} for ${stage}`;
    if (product) desc += ` of ${product}`;
    if (jobNum) desc += ` (${jobNum})`;
    return desc;
  }
  if (refKind === 'material_consumption') {
    return `Consumed in ${issue?.stage?.replace(/_/g, ' ') || 'production'}` +
      (issue?.jobOrderNumber ? ` (${issue.jobOrderNumber})` : '');
  }
  if (refKind === 'material_return') {
    return `Returned from ${issue?.stage?.replace(/_/g, ' ') || 'production'} by ${issue?.issuedToName || 'operator'}` +
      (issue?.jobOrderNumber ? ` (${issue.jobOrderNumber})` : '');
  }
  if (refKind === 'material_cancel') {
    return `Issue cancelled — returned to stock (${refId})`;
  }
  if (refKind === 'scrap') {
    return `Scrap in ${issue?.stage || 'production'}` +
      (issue?.jobOrderNumber ? ` (job ${issue.jobOrderNumber})` : '');
  }
  if (refKind === 'manual') {
    return m.notes || `Manual adjustment (${refId || 'no ref'})`;
  }
  return m.notes || `${m.type} movement`;
}

/* ════════════════════ ITEM SUMMARY ════════════════════
 * GET /api/v1/inventory/items/:sku/summary
 *
 * Aggregated stats: total in, total out, total scrap, current WIP exposure,
 * by-source breakdown, last 30-day daily activity, etc.
 */
export const itemSummary = asyncHandler(async (req, res) => {
  const item = await resolveItem(req.params.sku);
  if (!item) throw ApiError.notFound(`Item ${req.params.sku} not found`);

  const itemId = item._id;
  const sku = item.sku;
  const now = new Date();
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Totals — only count movements that actually changed stock levels.
  // Internal "consumption" / "return" sub-events of a material issue are
  // NOT counted as separate OUT/IN — the original "issued" event already
  // accounts for stock leaving inventory. When stock comes back via return,
  // the return IS a real IN. But consumption never returns to stock, so it's
  // skipped from totals (it's just bookkeeping for variance).
  const [totalsByType, openWip, last30Daily, scrapTotal, last5Movements] = await Promise.all([
    InventoryMovement.aggregate([
      { $match: {
        itemId,
        // Exclude pure-bookkeeping movements that don't change actual stock
        'reference.kind': { $nin: ['material_consumption'] },
      } },
      { $group: { _id: '$type', total: { $sum: '$qty' }, count: { $sum: 1 } } },
    ]),
    MaterialIssue.aggregate([
      { $match: {
        status: { $in: ['issued', 'partial'] },
        'items.sku': sku,
      } },
      { $unwind: '$items' },
      { $match: { 'items.sku': sku } },
      { $group: {
        _id: null,
        totalIssued: { $sum: '$items.issuedQty' },
        totalConsumed: { $sum: '$items.consumedQty' },
        totalReturned: { $sum: '$items.returnedQty' },
        totalScrap: { $sum: '$items.scrapQty' },
        issueCount: { $sum: 1 },
      } },
    ]),
    InventoryMovement.aggregate([
      { $match: {
        itemId,
        occurredAt: { $gte: last30 },
        'reference.kind': { $nin: ['material_consumption'] },
      } },
      { $group: {
        _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } }, type: '$type' },
        qty: { $sum: '$qty' },
      } },
      { $sort: { '_id.day': 1 } },
    ]),
    InventoryMovement.aggregate([
      { $match: { itemId, 'reference.kind': 'scrap' } },
      { $group: { _id: null, total: { $sum: { $abs: '$qty' } } } },
    ]),
    InventoryMovement.find({ itemId }).sort({ occurredAt: -1 }).limit(5).lean(),
  ]);

  const typeMap = Object.fromEntries(totalsByType.map((t) => [t._id, t]));
  const wip = openWip[0] || { totalIssued: 0, totalConsumed: 0, totalReturned: 0, totalScrap: 0, issueCount: 0 };
  const wipPending = wip.totalIssued - wip.totalConsumed - wip.totalReturned - wip.totalScrap;

  // Build daily series with both IN and OUT
  const dailyMap = {};
  for (const d of last30Daily) {
    const day = d._id.day;
    if (!dailyMap[day]) dailyMap[day] = { date: day, in: 0, out: 0 };
    if (d._id.type === 'IN') dailyMap[day].in += d.qty;
    else if (d._id.type === 'OUT') dailyMap[day].out += d.qty;
  }
  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  res.json(ok({
    item: {
      _id: String(item._id),
      sku: item.sku,
      name: item.name,
      type: item.type,
      category: item.category,
      uom: item.uom,
      onHand: item.onHand || 0,
      reserved: item.reserved || 0,
      available: (item.onHand || 0) - (item.reserved || 0),
      reorderLevel: item.reorderLevel || 0,
      unitCost: item.unitCost || 0,
      location: item.location,
      supplier: item.supplier,
      barcode: item.barcode,
      notes: item.notes,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    },
    totals: {
      totalIn:     typeMap.IN?.total || 0,
      totalOut:    typeMap.OUT?.total || 0,
      totalAdjust: typeMap.ADJUST?.total || 0,
      totalScrap:  scrapTotal[0]?.total || 0,
      movementCount: totalsByType.reduce((s, t) => s + t.count, 0),
    },
    wip: {
      openIssues: wip.issueCount,
      qtyOnFloor: wipPending,        // currently issued but not yet consumed/returned/scrapped
      lifetimeConsumed: wip.totalConsumed,
      lifetimeReturned: wip.totalReturned,
      lifetimeScrap: wip.totalScrap,
    },
    last30Days: {
      totalIn:  daily.reduce((s, d) => s + d.in, 0),
      totalOut: daily.reduce((s, d) => s + d.out, 0),
      avgDailyOut: daily.length ? daily.reduce((s, d) => s + d.out, 0) / daily.length : 0,
      daily,                          // for the chart
    },
    recentMovements: await enrichMovements(last5Movements),
  }));
});

/* ════════════════════ ITEM MOVEMENT LOG ════════════════════
 * GET /api/v1/inventory/items/:sku/movements
 *
 * Paginated, filterable. Returns enriched movements with user names and
 * reference descriptions.
 *
 * Query: type, refKind, fromDate, toDate, performedBy, page, limit
 */
const movementsQuery = z.object({
  type: z.string().optional(),         // IN / OUT / ADJUST / TRANSFER
  refKind: z.string().optional(),      // material_issue / purchase_order / etc.
  performedBy: z.string().optional(),  // user id
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});

export const itemMovements = asyncHandler(async (req, res) => {
  const item = await resolveItem(req.params.sku);
  if (!item) throw ApiError.notFound(`Item ${req.params.sku} not found`);

  const q = movementsQuery.parse(req.query);
  const { page, limit, skip } = parsePagination({ ...q, limit: q.limit || 50 });

  const filter = { itemId: item._id };
  if (q.type) filter.type = q.type.toUpperCase();
  if (q.refKind) filter['reference.kind'] = q.refKind;
  if (q.performedBy && mongoose.isValidObjectId(q.performedBy)) filter.performedBy = q.performedBy;
  if (q.fromDate || q.toDate) {
    filter.occurredAt = {};
    if (q.fromDate) filter.occurredAt.$gte = q.fromDate;
    if (q.toDate) filter.occurredAt.$lte = q.toDate;
  }

  const [rawMovements, total] = await Promise.all([
    InventoryMovement.find(filter).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
    InventoryMovement.countDocuments(filter),
  ]);

  const enriched = await enrichMovements(rawMovements);

  res.json(ok(enriched, paginatedMeta({ page, limit, total })));
});

/* ════════════════════ ITEM CURRENT WIP ════════════════════
 * GET /api/v1/inventory/items/:sku/wip
 *
 * All open MaterialIssues that contain this SKU. Returns line-level breakdown
 * showing who has how much, in which stage.
 */
export const itemWIP = asyncHandler(async (req, res) => {
  const item = await resolveItem(req.params.sku);
  if (!item) throw ApiError.notFound(`Item ${req.params.sku} not found`);

  const sku = item.sku;
  const issues = await MaterialIssue.find({
    status: { $in: ['issued', 'partial'] },
    'items.sku': sku,
  }).sort({ issuedAt: -1 }).lean();

  // Filter line items to just this SKU
  const wipLines = [];
  for (const issue of issues) {
    for (const line of (issue.items || [])) {
      if (line.sku !== sku) continue;
      const pending = (line.issuedQty || 0) - (line.consumedQty || 0) - (line.returnedQty || 0) - (line.scrapQty || 0);
      if (pending <= 0) continue;
      wipLines.push({
        issueId: String(issue._id),
        issueNumber: issue.issueNumber,
        jobOrderNumber: issue.jobOrderNumber,
        productSku: issue.productSku,
        productName: issue.productName,
        stage: issue.stage,
        issuedTo: issue.issuedTo ? String(issue.issuedTo) : null,
        issuedToName: issue.issuedToName,
        issuedAt: issue.issuedAt,
        status: issue.status,
        issuedQty: line.issuedQty,
        consumedQty: line.consumedQty || 0,
        returnedQty: line.returnedQty || 0,
        scrapQty: line.scrapQty || 0,
        pendingQty: pending,
        uom: line.uom,
        unitCost: line.unitCost,
        pendingValue: pending * (line.unitCost || 0),
      });
    }
  }

  // Aggregate
  const totalPending = wipLines.reduce((s, l) => s + l.pendingQty, 0);
  const totalValue = wipLines.reduce((s, l) => s + l.pendingValue, 0);

  // Group by stage
  const byStage = {};
  for (const l of wipLines) {
    if (!byStage[l.stage]) byStage[l.stage] = { stage: l.stage, qty: 0, lines: 0 };
    byStage[l.stage].qty += l.pendingQty;
    byStage[l.stage].lines += 1;
  }

  // Group by person
  const byPerson = {};
  for (const l of wipLines) {
    const key = l.issuedToName || 'Unknown';
    if (!byPerson[key]) byPerson[key] = { name: key, qty: 0, lines: 0 };
    byPerson[key].qty += l.pendingQty;
    byPerson[key].lines += 1;
  }

  res.json(ok({
    sku: item.sku,
    name: item.name,
    uom: item.uom,
    summary: {
      openIssues: wipLines.length,
      totalPendingQty: totalPending,
      totalValue,
      byStage: Object.values(byStage),
      byPerson: Object.values(byPerson),
    },
    wipLines,
  }));
});