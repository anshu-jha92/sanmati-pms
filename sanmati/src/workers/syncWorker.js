import { Worker } from 'bullmq';
import { queueConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { bullPrefix, erpSyncQueue } from '../services/queue.service.js';
import { ApiIntegration } from '../models/ApiIntegration.js';
import { runSync } from '../services/integration.service.js';

/**
 * The sync worker processes two kinds of jobs:
 *
 *   1. `run-integration` ({ integrationId }) — enqueued by admin action or the scheduler below
 *   2. `tick` — periodic, finds integrations whose schedule is due and enqueues them
 *
 * Scheduling is simple: a single repeatable `tick` job runs every minute and
 * checks each active integration's `syncIntervalMinutes` against its `lastSyncedAt`.
 * This keeps schedules in the DB (editable from the UI) instead of in env/cron.
 */

async function processor(job) {
  if (job.name === 'run-integration') {
    const { integrationId } = job.data;
    const result = await runSync(integrationId);
    return result;
  }

  if (job.name === 'tick') {
    const now = Date.now();
    const candidates = await ApiIntegration.find({ active: true }).select('slug syncIntervalMinutes lastSyncedAt');
    let queued = 0;
    for (const ig of candidates) {
      const dueAt = ig.lastSyncedAt ? new Date(ig.lastSyncedAt).getTime() + ig.syncIntervalMinutes * 60_000 : 0;
      if (dueAt <= now) {
        await erpSyncQueue.add(
          'run-integration',
          { integrationId: String(ig._id) },
          { jobId: `sched:${ig._id}:${Math.floor(now / 60_000)}` }
        );
        queued += 1;
      }
    }
    return { queued };
  }

  throw new Error(`Unknown job name: ${job.name}`);
}

export function startSyncWorker() {
  const worker = new Worker('erp-sync', processor, {
    connection: queueConnection,
    prefix: bullPrefix,
    concurrency: env.WORKER_CONCURRENCY_SYNC,
  });
  worker.on('failed', (job, err) => logger.warn({ name: job?.name, jobId: job?.id, err: err?.message }, 'sync job failed'));
  worker.on('completed', (job, result) => logger.info({ name: job.name, ...result }, 'sync job complete'));
  logger.info('sync worker started');
  return worker;
}

/**
 * Register the periodic `tick` job. Runs once a minute; cheap — most ticks find nothing to do.
 */
export async function scheduleSyncTick() {
  await erpSyncQueue.add('tick', {}, { repeat: { every: 60_000 }, jobId: 'sched:tick' });
  logger.info('sync tick scheduled (every 60s)');
}
