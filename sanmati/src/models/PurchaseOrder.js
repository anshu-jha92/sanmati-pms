import mongoose from 'mongoose';

/**
 * PurchaseOrder — what we buy FROM suppliers (opposite of SalesOrder).
 *
 * Flow:
 *   Draft → Submitted → Approved → In Transit → Partially Received → Received → Closed
 *
 * When goods arrive, the user creates GRN lines (Goods Receipt Note). Each GRN
 * line auto-writes the received qty into the matching InventoryItem and records
 * an InventoryMovement of type 'RECEIPT_FROM_PO'.
 */

const poLineSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, uppercase: true, index: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true },
    uom: { type: String, default: 'kg' },
    unitCost: { type: Number, default: 0 },
    lineTotal: { type: Number, default: 0 },
    receivedQty: { type: Number, default: 0 },
    pendingQty: { type: Number }, // computed: qty - receivedQty
    grns: [
      {
        receivedAt: { type: Date, default: () => new Date() },
        qty: { type: Number, required: true },
        vehicleNumber: String,
        invoiceNumber: String,
        receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        remarks: String,
        inventoryMovementId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryMovement' },
      },
    ],
    status: {
      type: String,
      enum: ['pending', 'partial', 'received', 'cancelled'],
      default: 'pending',
    },
  },
  { _id: true }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    externalId: { type: String, index: true, sparse: true },
    poNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },

    supplier: { type: String, required: true, index: true },
    supplierEmail: String,
    supplierPhone: String,
    supplierAddress: String,

    status: {
      type: String,
      enum: ['draft', 'submitted', 'approved', 'in_transit', 'partial', 'received', 'cancelled'],
      default: 'draft',
      index: true,
    },

    priority: { type: String, enum: ['high', 'medium', 'normal'], default: 'normal' },

    orderedAt: { type: Date, default: () => new Date() },
    expectedDate: { type: Date, index: true },
    receivedAt: { type: Date },

    lines: [poLineSchema],

    totalValue: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    taxAmount: { type: Number, default: 0 },
    shippingCost: { type: Number, default: 0 },

    // If auto-generated in response to low stock
    source: {
      type: String,
      enum: ['manual', 'auto_reorder', 'erp_sync'],
      default: 'manual',
    },
    triggeredByItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },

    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Sync metadata (for ERP integrations)
    externalVersion: String,
    syncedAt: Date,

    notes: String,
  },
  { timestamps: true }
);

purchaseOrderSchema.index({ plantId: 1, status: 1, expectedDate: 1 });
purchaseOrderSchema.index({ supplier: 'text', poNumber: 'text' });

// Maintain pendingQty on each line before save
purchaseOrderSchema.pre('save', function updatePendingQty(next) {
  let allReceived = true;
  let anyReceived = false;
  for (const line of this.lines) {
    const received = line.receivedQty || 0;
    line.pendingQty = Math.max(0, line.qty - received);
    if (received >= line.qty) {
      line.status = 'received';
    } else if (received > 0) {
      line.status = 'partial';
      allReceived = false;
      anyReceived = true;
    } else {
      line.status = 'pending';
      allReceived = false;
    }
    if (received > 0) anyReceived = true;
  }

  if (this.status !== 'cancelled' && this.status !== 'draft') {
    if (allReceived && this.lines.length > 0) {
      this.status = 'received';
      this.receivedAt = this.receivedAt || new Date();
    } else if (anyReceived) {
      this.status = 'partial';
    }
  }
  next();
});

export const PurchaseOrder = mongoose.model('PurchaseOrder', purchaseOrderSchema);
