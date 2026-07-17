import mongoose from 'mongoose';

/**
 * JobOrder — a single production job derived from a SalesOrder line.
 *
 * A JobOrder of, say, "100 KG Printed Polybag" will spawn a sequence of
 * StageExecution records as it passes through: 
 *   Printing → Inspection → Lamination → Hot Room → Slitting → Cutting → Packaging
 *
 * Each StageExecution records:
 *   - Input weight (what arrived from previous stage)
 *   - Materials added at this stage (paper, ink, tape, adhesive, etc. — each with qty + uom + type)
 *   - Output weight
 *   - Reject count + reject weight
 *   - Operator + machine + start/end time
 *   - QC result for this stage
 *   - Reference to the IoT data window captured during this stage
 */

// Stages are fixed for Sanmati's workflow — change here if the flow changes.
export const STAGES = ['printing', 'inspection', 'lamination', 'hot_room', 'slitting', 'cutting', 'packaging'];

const materialAddedSchema = new mongoose.Schema(
  {
    sku: { type: String, uppercase: true, trim: true },
    name: { type: String, required: true },
    // What KIND of thing — drives inventory impact and reporting
    type: { type: String, enum: ['raw', 'consumable', 'packaging'], default: 'consumable' },
    qty: { type: Number, required: true },
    uom: { type: String, default: 'kg' },
    // Optional link to InventoryItem for ledger write-down
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },
    addedAt: { type: Date, default: () => new Date() },
  },
  { _id: true }
);

const stageExecutionSchema = new mongoose.Schema(
  {
    stage: { type: String, enum: STAGES, required: true },
    status: {
      type: String,
      enum: ['pending', 'ready', 'in_progress', 'paused', 'qc_hold', 'rework', 'completed', 'skipped'],
      default: 'pending',
      index: true,
    },

    // Assignment
    machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine' },
    operatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },

    // Timestamps
    plannedStart: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    durationSec: { type: Number },

    // Weights (kg, by convention — UOM carried separately if needed)
    weightInKg: { type: Number, default: 0 },
    weightOutKg: { type: Number, default: 0 },
    rejectCountPcs: { type: Number, default: 0 },
    rejectWeightKg: { type: Number, default: 0 },

    // Materials added at this stage
    materialsAdded: [materialAddedSchema],

    // Materials receipt confirmation. Once the operator has requested
    // materials and inventory has issued them, the operator must explicitly
    // confirm receipt before they can start production. This prevents
    // accidental "starts" without verifying the materials are physically
    // on the machine.
    materialsConfirmedAt: { type: Date },
    materialsConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // IoT-driven live metrics captured for this stage (populated by the worker when stage starts)
    liveMetrics: {
      // Latest snapshot summary — computed from MachineData in [startedAt, completedAt]
      avgSpeed: { type: Number },
      totalUnitsProduced: { type: Number },
      metersUsed: { type: Number },
      maxTemperature: { type: Number },
      // Free-form — arbitrary IoT counters relevant to this stage (tape used, etc.)
      custom: { type: mongoose.Schema.Types.Mixed },
    },

    // QC
    qcResult: {
      decision: { type: String, enum: ['pending', 'pass', 'fail', 'rework', 'hold'], default: 'pending' },
      qualityCheckId: { type: mongoose.Schema.Types.ObjectId, ref: 'QualityCheck' },
      sampleSize: Number,
      defectCount: Number,
      inspectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      remarks: String,
      // Per-parameter checklist used by the inspection stage UI.
      // Each entry: { parameter, result: pass|fail|na, remarks? }
      // Lets ops record granular pass/fail per quality parameter
      // (e.g. print registration, color match, edge quality, etc.)
      checklist: [{
        _id: false,
        parameter: { type: String, required: true },
        result: { type: String, enum: ['pass', 'fail', 'na'], required: true },
        remarks: { type: String },
      }],
    },

    // Output from operator / QC / supervisor
    operatorRemarks: { type: String },
    weightNote: { type: String }, // free-text weight observation

    // Order of stages — printing=1, inspection=2, etc.
    sequence: { type: Number, required: true },
  },
  { _id: true }
);

const jobOrderSchema = new mongoose.Schema(
  {
    // Human-friendly IDs
    orderNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    jobNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },

    // Origin
    source: { type: String, enum: ['sales_order', 'stock', 'sample', 'rework'], default: 'sales_order' },
    salesOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', index: true },
    salesOrderLineId: { type: mongoose.Schema.Types.ObjectId },
    customer: { type: String, index: true },

    product: {
      sku: { type: String, required: true, uppercase: true, index: true },
      name: { type: String, required: true },
      specRef: String,
    },

    // BOM snapshot — captured at plan time so later BOM edits don't rewrite history
    bomSnapshot: {
      externalId: String,
      version: String,
      components: [{
        sku: String,
        name: String,
        qtyPerUnit: Number,
        uom: String,
        scrapPct: Number,
      }],
    },

    // Quantity
    plannedQty: { type: Number, required: true }, // e.g. 100
    uom: { type: String, default: 'kg' },
    inputRollDescription: { type: String }, // "1 Roll · 90 KG BOPP Film"
    inputRollWeightKg: { type: Number, default: 0 }, // 90

    // Priority
    priority: { type: String, enum: ['high', 'medium', 'normal'], default: 'normal', index: true },

    // Lifecycle
    status: {
      type: String,
      enum: ['draft', 'planned', 'released', 'in_progress', 'paused', 'completed', 'cancelled', 'qc_hold'],
      default: 'draft',
      index: true,
    },

    // Timing
    plannedStart: { type: Date, index: true },
    plannedEnd: { type: Date },
    actualStart: { type: Date },
    actualEnd: { type: Date },
    dueDate: { type: Date, index: true },

    // Stage executions — one per stage, in order
    stages: [stageExecutionSchema],

    // Running rollups (maintained by controller on stage updates)
    currentStageIndex: { type: Number, default: 0 },
    totalProducedKg: { type: Number, default: 0 },
    totalRejectsKg: { type: Number, default: 0 },
    currentWeightKg: { type: Number, default: 0 },

    // Tenancy + audit
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

jobOrderSchema.index({ plantId: 1, status: 1, priority: 1 });
jobOrderSchema.index({ 'product.sku': 1, createdAt: -1 });
jobOrderSchema.index({ orderNumber: 'text', jobNumber: 'text', 'product.name': 'text', customer: 'text' });

/**
 * Get current (active) stage execution — the first non-completed one.
 */
jobOrderSchema.methods.currentStage = function () {
  return this.stages.find((s) => s.status !== 'completed' && s.status !== 'skipped') || null;
};

export const JobOrder = mongoose.model('JobOrder', jobOrderSchema);
