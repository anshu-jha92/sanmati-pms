import mongoose from 'mongoose';

/**
 * Raw telemetry from 7 machines @ 24x7. We use MongoDB native time-series collections
 * for automatic bucketing, compression (~5-10x), and efficient time-range queries.
 *
 * Schema note: `metadata` is the bucketing key; must include machineId.
 * `timestamp` is the time field; indexed automatically by MongoDB.
 *
 * We do NOT validate metric shapes strictly — IoT payloads evolve; we prefer flexibility.
 * However we do enforce required core fields and run a separate JSON-schema validator
 * (in iot.controller.js via Zod) before writing.
 */

const machineDataSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true },
    metadata: {
      machineId: { type: mongoose.Schema.Types.ObjectId, required: true },
      machineCode: { type: String, required: true },
      plantId: { type: mongoose.Schema.Types.ObjectId, required: true },
      stage: { type: String },
    },
    // Event-style payload. Common fields:
    //   state: running | idle | maintenance | down
    //   spm / rpm: speed measurement
    //   unitsProduced: delta since last emit
    //   temperature, pressure, tension: process values
    //   reject: boolean + rejectReason
    //   operatorCode: optional — links to operator shift
    //   orderId: current production order
    state: { type: String, index: false }, // state snapshots — indexed via compound on metadata + timestamp
    unitsProduced: { type: Number, default: 0 },
    rejects: { type: Number, default: 0 },
    speed: { type: Number },
    metrics: { type: mongoose.Schema.Types.Mixed }, // free-form numeric sensors
    event: { type: String }, // 'state_change' | 'cycle_end' | 'heartbeat' | 'alarm' | ...
    alarmCode: { type: String },
    operatorCode: { type: String },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder' },
    // IoT gateway fields
    gatewayBatchId: { type: String }, // for idempotency / dedupe
    ingestedAt: { type: Date, default: () => new Date() },
  },
  {
    timeseries: {
      timeField: 'timestamp',
      metaField: 'metadata',
      granularity: 'seconds',
    },
    autoCreate: true,
  }
);

// For queries like "all events for machine X between t1 and t2"
// MongoDB auto-creates optimal indexes on metadata + timestamp for time-series,
// but we add one for dedupe lookups.
machineDataSchema.index({ gatewayBatchId: 1 }, { sparse: true });

export const MachineData = mongoose.model('MachineData', machineDataSchema);
