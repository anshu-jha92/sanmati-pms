import { z } from 'zod';
import mongoose from 'mongoose';
import { BOM } from '../models/ERP.js';
import { InventoryItem } from '../models/Inventory.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { parsePagination, paginatedMeta } from '../utils/pagination.js';

/* ═══ LIST ═══ */
const listQuery = z.object({
  q: z.string().optional(),
  sku: z.string().optional(),
  active: z.coerce.boolean().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});

export const listBoms = asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const { page, limit, skip, sort } = parsePagination(q);
  const filter = {};
  if (q.active !== undefined) filter.active = q.active;
  if (q.sku) filter.productSku = new RegExp(`^${q.sku}`, 'i');
  if (q.q) filter.$or = [
    { productSku: new RegExp(q.q, 'i') },
    { productName: new RegExp(q.q, 'i') },
    { externalId: new RegExp(q.q, 'i') },
  ];

  const [items, total] = await Promise.all([
    BOM.find(filter).sort(sort || { updatedAt: -1 }).skip(skip).limit(limit).lean(),
    BOM.countDocuments(filter),
  ]);
  res.json(ok(items, paginatedMeta({ page, limit, total })));
});

/* ═══ GET ONE (by ID or by productSku — latest active) ═══ */
export const getBom = asyncHandler(async (req, res) => {
  const { idOrSku } = req.params;
  let bom;
  if (mongoose.isValidObjectId(idOrSku)) {
    bom = await BOM.findById(idOrSku).lean();
  }
  if (!bom) {
    bom = await BOM.findOne({ productSku: idOrSku.toUpperCase(), active: true })
      .sort({ version: -1, updatedAt: -1 }).lean();
  }
  if (!bom) throw ApiError.notFound(`No BOM found for ${idOrSku}`);
  res.json(ok(bom));
});

/* ═══ CREATE / UPDATE / DELETE (in-app authoring) ═══
 * BOMs can be authored right here in the app (in addition to being pushed from
 * an external ERP via POST /integrations/v1/bom — that path is untouched).
 * In-app BOMs get a generated LOCAL-* externalId so they never clash with ERP ids. */
const STAGE_ENUM = ['printing', 'inspection', 'lamination', 'hot_room', 'slitting', 'cutting', 'packaging', 'any'];

const componentInput = z.object({
  sku: z.string().min(1),
  name: z.string().optional(),
  qtyPerUnit: z.coerce.number().min(0),
  uom: z.string().optional(),
  scrapPct: z.coerce.number().min(0).max(100).optional(),
  stage: z.enum(STAGE_ENUM).optional(),
  notes: z.string().optional(),
});

const bomWriteSchema = z.object({
  productSku: z.string().min(1),
  productName: z.string().optional(),
  outputQty: z.coerce.number().positive().optional(),
  outputUom: z.string().optional(),
  version: z.string().optional(),
  active: z.boolean().optional(),
  components: z.array(componentInput).min(1, 'Add at least one component'),
  notes: z.string().optional(),
});

export const createBom = asyncHandler(async (req, res) => {
  const p = bomWriteSchema.parse(req.body);
  const version = (p.version || 'v1').trim();
  const externalId = `LOCAL-${p.productSku.toUpperCase()}-${version}-${Date.now().toString(36).toUpperCase()}`;
  const bom = await BOM.create({ ...p, version, externalId, syncedAt: new Date() });
  res.status(201).json(ok(bom.toJSON()));
});

export const updateBom = asyncHandler(async (req, res) => {
  const p = bomWriteSchema.partial().parse(req.body);
  const bom = await BOM.findById(req.params.id);
  if (!bom) throw ApiError.notFound('BOM not found');
  Object.assign(bom, p);
  bom.syncedAt = new Date();
  await bom.save();
  res.json(ok(bom.toJSON()));
});

export const deleteBom = asyncHandler(async (req, res) => {
  const bom = await BOM.findByIdAndDelete(req.params.id);
  if (!bom) throw ApiError.notFound('BOM not found');
  res.json(ok({ success: true }));
});

/* ═══ CALCULATE REQUIREMENTS ═══
 * GET /api/v1/bom/:sku/requirements?qty=100
 *
 * Given the target output qty, returns:
 *   • list of raw material SKUs needed
 *   • qty required (including scrap buffer)
 *   • current onHand / reserved / available for each
 *   • whether the order can be fulfilled right now
 */
export const calculateRequirements = asyncHandler(async (req, res) => {
  const { sku } = req.params;
  const targetQty = Number(req.query.qty) || 1;
  if (targetQty <= 0) throw ApiError.badRequest('qty must be > 0');

  const bom = await BOM.findOne({ productSku: sku.toUpperCase(), active: true })
    .sort({ version: -1, updatedAt: -1 });
  if (!bom) throw ApiError.notFound(`No active BOM for ${sku}`);

  const requirements = bom.requirementsFor(targetQty);

  // Fetch inventory for all SKUs in one query
  const skus = requirements.map((r) => r.sku);
  const invItems = await InventoryItem.find({ sku: { $in: skus } }).lean();
  const invBySku = Object.fromEntries(invItems.map((i) => [i.sku, i]));

  const enriched = requirements.map((r) => {
    const inv = invBySku[r.sku];
    const onHand = inv?.onHand || 0;
    const reserved = inv?.reserved || 0;
    const available = onHand - reserved;
    return {
      ...r,
      inventory: inv ? {
        itemId: String(inv._id),
        onHand,
        reserved,
        available,
        uom: inv.uom,
      } : null,
      sufficient: available >= r.qtyRequired,
      shortBy: Math.max(0, r.qtyRequired - available),
    };
  });

  const canFulfill = enriched.every((r) => r.sufficient);

  res.json(ok({
    bom: {
      id: String(bom._id),
      productSku: bom.productSku,
      productName: bom.productName,
      version: bom.version,
      outputQty: bom.outputQty,
      outputUom: bom.outputUom,
    },
    targetQty,
    scalingFactor: targetQty / (bom.outputQty || 1),
    canFulfill,
    requirements: enriched,
    shortages: enriched.filter((r) => !r.sufficient).map((r) => ({
      sku: r.sku,
      name: r.name,
      required: r.qtyRequired,
      available: r.inventory?.available || 0,
      shortBy: r.shortBy,
      uom: r.uom,
    })),
  }));
});
