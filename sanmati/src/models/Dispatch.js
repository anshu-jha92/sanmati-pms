import mongoose from 'mongoose';

const dispatchLineSchema = new mongoose.Schema(
  {
    productionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder' },
    sku: { type: String, required: true },
    qty: { type: Number, required: true },
    uom: { type: String },
    lotNumber: { type: String },
  },
  { _id: true }
);

const dispatchSchema = new mongoose.Schema(
  {
    dispatchNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    salesOrderExternalId: { type: String, index: true },
    customer: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['planned', 'packed', 'loaded', 'dispatched', 'delivered', 'cancelled'],
      default: 'planned',
      index: true,
    },
    lines: [dispatchLineSchema],
    vehicle: {
      number: String,
      driverName: String,
      driverPhone: String,
      carrier: String,
    },
    plannedDispatchAt: { type: Date, index: true },
    actualDispatchAt: { type: Date },
    deliveredAt: { type: Date },
    eWayBill: { type: String },
    invoice: { type: String },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    dispatchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
  },
  { timestamps: true }
);

dispatchSchema.index({ plantId: 1, status: 1, plannedDispatchAt: 1 });
dispatchSchema.index({ dispatchNumber: 'text', customer: 'text' });

export const Dispatch = mongoose.model('Dispatch', dispatchSchema);
