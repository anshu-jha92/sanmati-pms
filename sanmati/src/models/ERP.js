import mongoose from 'mongoose';

/**
 * Bill of Materials (BOM) — pushed from external ERP via the Integration API.
 *
 * A BOM defines "to make 1 unit of product X, you need these raw materials".
 * Store manager then uses this as a reference when issuing materials to
 * operators for a production job. Materials are NOT auto-deducted on order
 * creation — deduction happens only via a MaterialIssue record.
 *
 * NOTE: SalesOrder and PurchaseOrder were previously defined here too.
 * They now live in their own dedicated files.
 */

const bomComponentSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String },
    qtyPerUnit: { type: Number, required: true, min: 0 },
    uom: { type: String, default: 'kg' },
    scrapPct: { type: Number, default: 0, min: 0, max: 100 },
    // Which stage this material is used in (helps the issue UI filter).
    stage: {
      type: String,
      enum: ['printing', 'inspection', 'lamination', 'hot_room', 'slitting', 'cutting', 'packaging', 'any'],
      default: 'any',
    },
    notes: { type: String },
  },
  { _id: false }
);

// Virtual: effective qty including scrap — exposed when toJSON is called
bomComponentSchema.virtual('effectiveQtyPerUnit').get(function () {
  return Number((this.qtyPerUnit * (1 + (this.scrapPct || 0) / 100)).toFixed(6));
});
bomComponentSchema.set('toJSON', { virtuals: true });
bomComponentSchema.set('toObject', { virtuals: true });

const bomSchema = new mongoose.Schema(
  {
    externalId: { type: String, required: true, unique: true }, // ERP BOM id
    productSku: { type: String, required: true, uppercase: true, trim: true, index: true },
    productName: { type: String },
    outputQty: { type: Number, default: 1, min: 0 },    // per how many output units the components apply
    outputUom: { type: String, default: 'kg' },
    version: { type: String, required: true, default: 'v1' },
    active: { type: Boolean, default: true, index: true },
    components: { type: [bomComponentSchema], default: [] },
    notes: { type: String },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', index: true },
    syncedAt: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

bomSchema.index({ productSku: 1, active: 1, version: -1 });

// Helper: calculate material requirement for a target output qty
bomSchema.methods.requirementsFor = function (targetQty) {
  const factor = targetQty / (this.outputQty || 1);
  return this.components.map((c) => {
    const rawQty = (c.qtyPerUnit || 0) * factor;
    const withScrap = rawQty * (1 + (c.scrapPct || 0) / 100);
    return {
      sku: c.sku,
      name: c.name,
      rawQtyRequired: Number(rawQty.toFixed(4)),
      scrapPct: c.scrapPct || 0,
      qtyRequired: Number(withScrap.toFixed(4)),   // includes scrap buffer
      uom: c.uom || 'kg',
      stage: c.stage || 'any',
      notes: c.notes,
    };
  });
};

export const BOM = mongoose.model('BOM', bomSchema);
