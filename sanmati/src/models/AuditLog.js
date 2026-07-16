import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorEmail: { type: String }, // denormalized for historical readability when users are deleted
    action: { type: String, required: true, index: true }, // e.g. 'production.order.create'
    module: { type: String, required: true, index: true },
    targetType: { type: String }, // collection name
    targetId: { type: String, index: true },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', index: true },
    at: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: false } // `at` is our time field
);

auditLogSchema.index({ plantId: 1, at: -1 });
auditLogSchema.index({ module: 1, action: 1, at: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
