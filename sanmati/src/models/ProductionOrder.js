import mongoose from 'mongoose';

/**
 * ProductionOrder represents a manufacturing job derived from a sales order or
 * standalone plan. It moves through stages (printing → inspection → lamination →
 * slitting → cutting → packaging) tracked as `stageProgress`.
 */

const stageProgressSchema = new mongoose.Schema(
  {
    stage: {
      type: String,
      enum: ['printing', 'inspection', 'lamination', 'slitting', 'cutting', 'packaging'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'on_hold', 'rework'],
      default: 'pending',
    },
    machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine' },
    operator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    startedAt: { type: Date },
    completedAt: { type: Date },
    plannedQty: { type: Number, default: 0 },
    producedQty: { type: Number, default: 0 },
    rejectQty: { type: Number, default: 0 },
    reworkQty: { type: Number, default: 0 },
    notes: { type: String },
  },
  { _id: true, timestamps: false }
);

const productionOrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    // Origin: external SO, or internal stock build
    source: { type: String, enum: ['sales_order', 'stock', 'sample', 'rework'], default: 'sales_order' },
    externalSalesOrderId: { type: String, index: true }, // ERP reference
    customer: { type: String },

    product: {
      sku: { type: String, required: true, index: true },
      name: { type: String, required: true },
      specRef: { type: String }, // reference to spec sheet / drawing
    },
    bomRef: { type: String, index: true }, // external BOM id; populated on planning
    plannedQty: { type: Number, required: true },
    uom: { type: String, default: 'pcs' },

    priority: { type: Number, default: 5, index: true }, // 1 highest
    plannedStart: { type: Date, index: true },
    plannedEnd: { type: Date },
    actualStart: { type: Date },
    actualEnd: { type: Date },

    status: {
      type: String,
      enum: ['planned', 'released', 'in_progress', 'paused', 'completed', 'cancelled'],
      default: 'planned',
      index: true,
    },

    stageProgress: [stageProgressSchema],

    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Rollups — maintained by production controller or a periodic job
    totalProduced: { type: Number, default: 0 },
    totalRejects: { type: Number, default: 0 },
    totalRework: { type: Number, default: 0 },
  },
  { timestamps: true }
);

productionOrderSchema.index({ plantId: 1, status: 1, plannedStart: -1 });
productionOrderSchema.index({ 'product.sku': 1, createdAt: -1 });
productionOrderSchema.index({ orderNumber: 'text', 'product.name': 'text', customer: 'text' });

export const ProductionOrder = mongoose.model('ProductionOrder', productionOrderSchema);
