import mongoose from 'mongoose';

/**
 * MaterialIssue — tracks every batch of materials that moves from the
 * inventory store to the production floor for a specific Job Order.
 *
 * Lifecycle:
 *   1. Store manager creates MaterialIssue → status = 'issued'
 *      • InventoryItem.onHand decreases by the issued qty
 *      • InventoryMovement logged with type='OUT' and reference.kind='material_issue'
 *
 *   2. Operator finishes the stage → reportConsumption called:
 *      • status → 'consumed' (or 'partial' if some is returned)
 *      • actualConsumedQty recorded per line
 *      • Any excess returned to inventory (returnedQty)
 *      • Scrap recorded separately for variance reports
 *
 * No transactions required — we use atomic findOneAndUpdate with $inc on
 * inventory counters, and manually roll back the inventory write if the
 * MaterialIssue document fails to save.
 */

const materialLineSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    issuedQty: { type: Number, required: true, min: 0 },
    uom: { type: String, default: 'kg' },
    unitCost: { type: Number, default: 0 },

    // Filled on consumption report
    consumedQty: { type: Number, default: 0 },
    returnedQty: { type: Number, default: 0 },
    scrapQty: { type: Number, default: 0 },

    // Back-references for rollback / audit
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },
    issuanceMovementId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryMovement' },
    consumptionMovementId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryMovement' },
    returnMovementId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryMovement' },

    notes: { type: String },
  },
  { _id: true }
);

const materialIssueSchema = new mongoose.Schema(
  {
    issueNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },

    // What / for whom
    jobOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobOrder', index: true },
    jobOrderNumber: { type: String, index: true },
    productSku: { type: String, uppercase: true, trim: true },
    productName: { type: String },

    stage: {
      type: String,
      enum: ['printing', 'inspection', 'lamination', 'hot_room', 'slitting', 'cutting', 'packaging', 'general'],
      required: true,
      index: true,
    },

    // Person & team the material is issued TO
    issuedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    issuedToName: { type: String, required: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    teamName: { type: String },

    // Person who issued it (store manager)
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    issuedByName: { type: String },

    // Machine (optional — some stages are machine-tied)
    machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine' },
    machineCode: { type: String },

    // Contents
    items: { type: [materialLineSchema], required: true },
    totalValue: { type: Number, default: 0 },

    /**
     * Status lifecycle:
     *   issued     → materials are out on floor, WIP
     *   consumed   → operator reported all consumed
     *   partial    → some returned / some scrap / some consumed
     *   returned   → entire issue returned unused
     *   cancelled  → issue was rolled back before consumption
     */
    status: {
      type: String,
      enum: ['issued', 'consumed', 'partial', 'returned', 'cancelled'],
      default: 'issued',
      index: true,
    },

    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },

    issuedAt: { type: Date, default: () => new Date(), index: true },
    consumedAt: { type: Date },
    returnedAt: { type: Date },

    notes: { type: String },
  },
  { timestamps: true }
);

materialIssueSchema.index({ plantId: 1, status: 1, issuedAt: -1 });
materialIssueSchema.index({ jobOrderId: 1, stage: 1 });

export const MaterialIssue = mongoose.model('MaterialIssue', materialIssueSchema);
