import mongoose from 'mongoose';

/**
 * Discrete status intervals for each machine. We derive this from state-change events
 * in telemetry. This is what we actually query for OEE availability calculation —
 * summing running time between t1 and t2 is O(intervals) instead of O(events).
 */

const machineStatusSchema = new mongoose.Schema(
  {
    machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true, index: true },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },
    state: {
      type: String,
      enum: ['running', 'idle', 'maintenance', 'down', 'offline'],
      required: true,
      index: true,
    },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date }, // null = ongoing
    durationSec: { type: Number }, // denormalized on close
    reason: { type: String }, // breakdown reason, maintenance type, etc.
    operator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder' },
  },
  { timestamps: true }
);

// Efficient range query: "all status intervals for machine X that overlap [t1, t2]"
machineStatusSchema.index({ machineId: 1, startAt: -1 });
machineStatusSchema.index({ plantId: 1, state: 1, startAt: -1 });
// Find the currently open interval for a machine
machineStatusSchema.index({ machineId: 1, endAt: 1 });

export const MachineStatus = mongoose.model('MachineStatus', machineStatusSchema);
