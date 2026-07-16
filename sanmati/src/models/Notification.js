import mongoose from 'mongoose';

/**
 * Notification — alerts for managers/supervisors.
 *
 * Examples:
 *   - Operator finished printing of PB-003. Assign next stage operator?
 *   - QC failed on PB-005, needs review
 *   - Material below reorder level
 *
 * Each notification has a kind + payload. UI renders different actions based on kind.
 *
 * Recipients can be:
 *   - Specific user IDs (`userIds`)
 *   - All users with a permission (`permission`)
 *   - Just "any admin" (default — anyone with production:update)
 */
const notificationSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: [
        'stage_complete_assign_next',
        'qc_failed',
        'low_stock',
        'machine_breakdown',
        'general',
      ],
      required: true,
      index: true,
    },

    title: { type: String, required: true },
    message: { type: String, required: true },

    // Action payload — depends on kind. For stage_complete_assign_next:
    // { jobOrderId, jobOrderNumber, completedStage, completedByName, nextStage, nextStageId }
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },

    severity: {
      type: String,
      enum: ['info', 'success', 'warning', 'urgent'],
      default: 'info',
    },

    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },

    // Read tracking — per user. When user dismisses, we add their ID here.
    dismissedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Resolved means action taken — eg. operator assigned. Stops it appearing again.
    resolved: { type: Boolean, default: false, index: true },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    createdAt: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

notificationSchema.index({ plantId: 1, resolved: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);
