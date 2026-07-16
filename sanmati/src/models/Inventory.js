import mongoose from 'mongoose';

/**
 * We keep two collections:
 *  - InventoryItem: master (sku, description, UOM, reorder levels, current on-hand)
 *  - InventoryMovement: append-only ledger (IN / OUT / ADJUST / TRANSFER / ISSUE_TO_PROD / RECEIPT_FROM_PROD)
 *
 * Current on-hand is denormalized on InventoryItem for fast reads, but the ledger is
 * the source of truth — rebuildable via a reconciliation job.
 */

const inventoryItemSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['raw', 'wip', 'finished', 'consumable', 'packaging'], required: true, index: true },
    uom: { type: String, default: 'kg' },
    category: { type: String, index: true },

    onHand: { type: Number, default: 0 }, // denormalized
    reserved: { type: Number, default: 0 }, // allocated to open orders
    reorderLevel: { type: Number, default: 0 },
    reorderQty: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },     // cost per UOM (₹)
    location: { type: String, trim: true },     // bin / rack location
    supplier: { type: String, trim: true },     // default supplier
    barcode: { type: String, trim: true },
    notes: { type: String },

    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },
    externalRef: { type: String, index: true }, // ERP item id

    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

inventoryItemSchema.index({ plantId: 1, type: 1 });
inventoryItemSchema.index({ name: 'text', sku: 'text' });

export const InventoryItem = mongoose.model('InventoryItem', inventoryItemSchema);

const inventoryMovementSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, index: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },
    type: {
      type: String,
      enum: ['IN', 'OUT', 'ADJUST', 'TRANSFER', 'ISSUE_TO_PROD', 'RECEIPT_FROM_PROD', 'RESERVE', 'UNRESERVE'],
      required: true,
      index: true,
    },
    qty: { type: Number, required: true }, // signed where meaningful; non-negative here + type carries direction
    reference: {
      kind: { type: String, enum: [
        'purchase_order', 'production_order', 'sales_order', 'dispatch', 'qc', 'manual',
        'material_issue', 'material_consumption', 'material_return', 'material_cancel', 'scrap',
      ] },
      id: { type: String },
    },
    balanceAfter: { type: Number }, // snapshot for audit
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
    occurredAt: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

inventoryMovementSchema.index({ plantId: 1, occurredAt: -1 });
inventoryMovementSchema.index({ itemId: 1, occurredAt: -1 });

export const InventoryMovement = mongoose.model('InventoryMovement', inventoryMovementSchema);
