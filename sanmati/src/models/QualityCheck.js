import mongoose from 'mongoose';

/**
 * QC record: captured by inspectors at any stage. Defects are itemized so
 * dashboards can surface top rejection reasons. Rework flow: a QC with
 * decision='rework' creates a linked rework ProductionOrder (see qc.controller.js).
 */

const defectSchema = new mongoose.Schema(
  {
    code: { type: String, required: true }, // e.g. PRINT_MISALIGN, LAM_BUBBLE
    severity: { type: String, enum: ['minor', 'major', 'critical'], default: 'minor' },
    qty: { type: Number, default: 1 },
    notes: { type: String },
  },
  { _id: false }
);

const qualityCheckSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: true, index: true },
    stage: {
      type: String,
      enum: ['printing', 'inspection', 'lamination', 'slitting', 'cutting', 'packaging'],
      required: true,
      index: true,
    },
    machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', index: true },
    inspector: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', index: true },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },

    sampledQty: { type: Number, required: true },
    passedQty: { type: Number, default: 0 },
    rejectedQty: { type: Number, default: 0 },
    reworkQty: { type: Number, default: 0 },

    defects: [defectSchema],

    decision: {
      type: String,
      enum: ['pass', 'reject', 'rework', 'hold'],
      required: true,
      index: true,
    },
    reworkOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder' },

    checkedAt: { type: Date, default: () => new Date(), index: true },
    notes: { type: String },
  },
  { timestamps: true }
);

qualityCheckSchema.index({ plantId: 1, checkedAt: -1 });
qualityCheckSchema.index({ orderId: 1, stage: 1 });

export const QualityCheck = mongoose.model('QualityCheck', qualityCheckSchema);
