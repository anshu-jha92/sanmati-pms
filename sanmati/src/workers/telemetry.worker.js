import { Worker } from 'bullmq';
import { queueConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { bullPrefix } from '../services/queue.service.js';
import { Machine } from '../models/Machine.js';
import { MachineStatus } from '../models/MachineStatus.js';
import { ProductionOrder } from '../models/ProductionOrder.js';
import { User } from '../models/User.js';
import { socketService } from '../services/socket.service.js';
import { oeeQueue } from '../services/queue.service.js';
import { bucketBoundaries } from '../services/oee.service.js';

const VALID_STATES = new Set(['running', 'idle', 'maintenance', 'down', 'offline']);

async function processEvent(job) {
  const data = job.data;
  const machineId = data.machineId;
  const ts = new Date(data.timestamp);

  // State change handling — accept any string but only act on recognized states
  if (data.event === 'state_change' && data.state && VALID_STATES.has(data.state)) {
    await transitionMachineState(machineId, data.plantId, data.state, ts, {
      reason: data.alarmCode,
      operatorCode: data.operatorCode,
      orderId: data.orderId,
    });
    const { start } = bucketBoundaries('hour', ts);
    await oeeQueue.add(
      'rollup',
      { machineId, granularity: 'hour', bucketStart: start.toISOString() },
      { jobId: `oee:${machineId}:hour:${start.getTime()}` }
    );
  }

  // Cycle / counter events — update order rollups
  if ((data.event === 'cycle_end' || data.event === 'counter') && data.unitsProduced) {
    if (data.orderId) {
      await ProductionOrder.updateOne(
        { _id: data.orderId, 'stageProgress.machineId': machineId, 'stageProgress.status': 'in_progress' },
        {
          $inc: {
            'stageProgress.$.producedQty': data.unitsProduced,
            'stageProgress.$.rejectQty': data.rejects || 0,
            totalProduced: data.unitsProduced,
            totalRejects: data.rejects || 0,
          },
        }
      );
    }
  }

  // Alarms → broadcast as alert
  if (data.event === 'alarm' && data.alarmCode) {
    socketService.emitAlert(data.plantId, {
      kind: 'machine_alarm',
      machineId,
      alarmCode: data.alarmCode,
      at: ts.toISOString(),
    });
  }
}

async function transitionMachineState(machineId, plantId, state, at, ctx) {
  const open = await MachineStatus.findOne({ machineId, endAt: null }).sort({ startAt: -1 });
  if (open?.state === state) {
    await Machine.updateOne({ _id: machineId }, { $set: { 'currentStatus.lastSeenAt': at } });
    return;
  }

  if (open) {
    open.endAt = at;
    open.durationSec = Math.max(0, (at - open.startAt) / 1000);
    await open.save();
  }

  const operator = ctx.operatorCode
    ? await User.findOne({ employeeCode: ctx.operatorCode.toUpperCase() }).select('_id').lean()
    : null;

  await MachineStatus.create({
    machineId,
    plantId,
    state,
    startAt: at,
    reason: ctx.reason,
    operator: operator?._id,
    orderId: ctx.orderId,
  });

  await Machine.updateOne(
    { _id: machineId },
    {
      $set: {
        'currentStatus.state': state,
        'currentStatus.since': at,
        'currentStatus.lastSeenAt': at,
        'currentStatus.currentOperator': operator?._id,
        'currentStatus.currentOrder': ctx.orderId,
      },
    }
  );

  socketService.emitMachineStatus(plantId, machineId, {
    state,
    since: at.toISOString(),
    reason: ctx.reason,
    operator: operator?._id,
    orderId: ctx.orderId,
  });
}

export function startTelemetryWorker() {
  const worker = new Worker('telemetry', processEvent, {
    connection: queueConnection,
    prefix: bullPrefix,
    concurrency: env.WORKER_CONCURRENCY_TELEMETRY,
  });
  worker.on('failed', (job, err) =>
    logger.warn({ jobId: job?.id, err }, 'telemetry job failed')
  );
  worker.on('error', (err) => logger.error({ err }, 'telemetry worker error'));
  logger.info({ concurrency: env.WORKER_CONCURRENCY_TELEMETRY }, 'telemetry worker started');
  return worker;
}
