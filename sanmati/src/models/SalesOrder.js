import mongoose from 'mongoose';

/**
 * SalesOrder — mirror of customer orders pulled from the external ERP via the
 * Integrations module. Each line can be converted into one or more JobOrders.
 *
 * This is the entry point for the whole production workflow:
 *   SalesOrder → Availability Check → JobOrder(s) → StageExecution(s) → Dispatch
 */

const salesOrderLineSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, uppercase: true, index: true },
    productName: { type: String, required: true },
    qty: { type: Number, required: true },
    uom: { type: String, default: 'kg' },
    dueDate: { type: Date },
    // Each line can be "opened" — meaning JobOrders are created from it
    jobOrderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'JobOrder' }],
    status: {
      type: String,
      enum: ['pending', 'planned', 'in_progress', 'fulfilled', 'cancelled'],
      default: 'pending',
    },
    fulfilledQty: { type: Number, default: 0 },
  },
  { _id: true }
);

const salesOrderSchema = new mongoose.Schema(
  {
    externalId: { type: String, required: true, unique: true, index: true },
    orderNumber: { type: String, required: true, index: true },
    customer: { type: String, required: true, index: true },

    priority: { type: String, enum: ['high', 'medium', 'normal'], default: 'normal', index: true },
    status: {
      type: String,
      enum: ['new', 'planning', 'in_progress', 'fulfilled', 'cancelled', 'on_hold'],
      default: 'new',
      index: true,
    },

    orderedAt: { type: Date },
    dueDate: { type: Date, index: true },

    lines: [salesOrderLineSchema],

    totalValue: { type: Number },
    currency: { type: String, default: 'INR' },

    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', index: true },

    // Sync metadata
    externalVersion: { type: String },
    syncedAt: { type: Date, default: () => new Date(), index: true },
    seenAt: { type: Date, default: () => new Date() }, // first time we saw this SO — drives "new" badge

    // Operator/planner notes
    notes: { type: String },
  },
  { timestamps: true }
);

salesOrderSchema.index({ plantId: 1, status: 1, dueDate: 1 });
salesOrderSchema.index({ priority: 1, status: 1 });
salesOrderSchema.index({ orderNumber: 'text', customer: 'text' });

export const SalesOrder = mongoose.model('SalesOrder', salesOrderSchema);
