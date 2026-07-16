import { Queue, QueueEvents } from 'bullmq';
import { queueConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * BullMQ namespacing is now done via the `prefix` option on Queue/Worker —
 * NOT via ioredis keyPrefix (which BullMQ v5 rejects).
 */
const BULL_PREFIX = `${env.REDIS_KEY_PREFIX}bull`;

const queueOpts = {
  connection: queueConnection,
  prefix: BULL_PREFIX,
  defaultJobOptions: {
    removeOnComplete: { age: 3600, count: 5000 },
    removeOnFail: { age: 24 * 3600 },
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
  },
};

export const telemetryQueue = new Queue('telemetry', queueOpts);
export const oeeQueue = new Queue('oee-rollup', queueOpts);
export const erpSyncQueue = new Queue('erp-sync', queueOpts);

// Observability: log failures on the telemetry queue
const events = new QueueEvents('telemetry', {
  connection: queueConnection.duplicate(),
  prefix: BULL_PREFIX,
});
events.on('failed', ({ jobId, failedReason }) =>
  logger.warn({ jobId, failedReason }, 'telemetry job failed')
);

export const bullPrefix = BULL_PREFIX;

export async function closeQueues() {
  await Promise.allSettled([
    telemetryQueue.close(),
    oeeQueue.close(),
    erpSyncQueue.close(),
    events.close(),
  ]);
}
