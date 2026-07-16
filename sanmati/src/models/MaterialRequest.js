/**
 * MaterialRequest — operator's request for raw materials needed to run a stage.
 *
 * Workflow:
 *   1. Operator opens stage runner → sees "Request Materials" panel
 *   2. They select needed items (auto-pre-filled from BOM) + quantities
 *   3. Submit → request goes to inventory dashboard with status "pending"
 *   4. Inventory clerk reviews → "Issue" button → status "issued"
 *      → InventoryMovement is created (deducts from on-hand)
 *      → Stage materialsAdded gets the issued items pushed in
 *   5. Or inventory can "reject" with reason
 *
 * One MaterialRequest covers ONE stage of ONE job. Multiple line items inside.
 */

import mongoose from 'mongoose';

const requestLineSchema = new mongoose.Schema({
  sku: { type: String, required: true, uppercase: true, trim: true, index: true },
  name: { type: String, required: true },
  qtyRequested: { type: Number, required: true, min: 0 },
  qtyIssued: { type: Number, default: 0, min: 0 },
  uom: { type: String, default: 'kg' },
  // Snapshot of inventory item at request time, for the inventory clerk's reference
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },
  // Set true if this line was part of the BOM-suggested set vs operator-added
  fromBom: { type: Boolean, default: false },
  // Per-line note from operator (e.g., "low stock, use new batch only")
  note: { type: String },
});

const materialRequestSchema = new mongoose.Schema(
  {
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },
    jobOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobOrder', required: true, index: true },
    // Snapshot fields so list views don't have to populate
    jobOrderNumber: String,
    productName: String,
    customerName: String,

    stageId: { type: mongoose.Schema.Types.ObjectId, required: true },
    stageName: { type: String, required: true }, // 'printing', 'lamination', etc.

    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByName: String,                    // Snapshot for display

    lines: { type: [requestLineSchema], default: [] },

    status: {
      type: String,
      enum: ['pending', 'partial', 'issued', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },

    priority: {
      type: String,
      enum: ['normal', 'urgent'],
      default: 'normal',
    },

    operatorNote: String,            // Free-text note from operator on the request

    // Inventory action fields
    issuedAt: Date,
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    issuedByName: String,
    rejectionReason: String,
  },
  { timestamps: true }
);

// Indexes for the common queries
materialRequestSchema.index({ plantId: 1, status: 1, createdAt: -1 });
materialRequestSchema.index({ jobOrderId: 1, stageId: 1 });

export const MaterialRequest = mongoose.model('MaterialRequest', materialRequestSchema);
