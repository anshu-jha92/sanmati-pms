import mongoose from 'mongoose';

/**
 * Pre-aggregated OEE per machine per bucket. Bucket granularities:
 *   - hour (24 buckets/day per machine) — live dashboard
 *   - shift (3 per day) — shift handover reports
 *   - day (1 per day) — trend analysis
 *
 * Computed by workers/oee.worker.js. This is what dashboard/reports query, NOT raw telemetry.
 */

const oeeRollupSchema = new mongoose.Schema(
  {
    machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true, index: true },
    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant', required: true, index: true },
    granularity: { type: String, enum: ['hour', 'shift', 'day'], required: true, index: true },
    bucketStart: { type: Date, required: true, index: true },
    bucketEnd: { type: Date, required: true },
    shift: { type: String, enum: ['A', 'B', 'C', 'General'] }, // populated for shift granularity

    // Inputs
    plannedProductionSec: { type: Number, default: 0 },
    runTimeSec: { type: Number, default: 0 },
    idleTimeSec: { type: Number, default: 0 },
    downTimeSec: { type: Number, default: 0 },
    maintenanceTimeSec: { type: Number, default: 0 },

    totalProduced: { type: Number, default: 0 },
    goodProduced: { type: Number, default: 0 },
    rejects: { type: Number, default: 0 },

    idealCycleTimeSec: { type: Number, default: 1 },

    // Outputs (0..1)
    availability: { type: Number, default: 0 },
    performance: { type: Number, default: 0 },
    quality: { type: Number, default: 0 },
    oee: { type: Number, default: 0 },

    // Operator context (for operator-wise rollups where appropriate)
    operators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    computedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

// Idempotent upsert key: one rollup per machine+granularity+bucket
oeeRollupSchema.index(
  { machineId: 1, granularity: 1, bucketStart: 1 },
  { unique: true }
);
oeeRollupSchema.index({ plantId: 1, granularity: 1, bucketStart: -1 });

export const OEERollup = mongoose.model('OEERollup', oeeRollupSchema);
