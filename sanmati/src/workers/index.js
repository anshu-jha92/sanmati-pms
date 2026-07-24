import { pathToFileURL } from 'node:url';
import { logger } from '../config/logger.js';
import { ensureRedisAvailable, disconnectRedis } from '../config/redis.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { closeQueues } from '../services/queue.service.js';
import { startTelemetryWorker } from './telemetry.worker.js';
import { startOeeWorker } from './oee.worker.js';
import { startSyncWorker, scheduleSyncTick } from './syncWorker.js';

/**
 * Background workers: telemetry → machine-state/OEE, and ERP/inventory sync.
 *
 * These MUST run somewhere or their queues (filled by iot.controller,
 * inventory.controller, integration.controller) grow forever and nothing is
 * processed. In the default single-service deploy they run INSIDE the API
 * process (see server.js), which also means their Socket.IO emits reach
 * connected dashboards. Running this file standalone (`npm run worker`) is
 * supported for horizontal scaling, but a standalone worker has no initialised
 * Socket.IO server, so its realtime emits only propagate if the API process is
 * also up and sharing the Redis adapter — keep workers inline unless you know
 * you need to separate them.
 */
export function startWorkers() {
  const workers = [startTelemetryWorker(), startOeeWorker(), startSyncWorker()];
  scheduleSyncTick().catch((err) => logger.error({ err }, 'failed to schedule sync tick'));
  logger.info('Background workers started (telemetry, oee-rollup, erp-sync)');
  return workers;
}

export async function stopWorkers(workers = []) {
  await Promise.allSettled(workers.map((w) => w?.close?.()));
}

// ── Standalone bootstrap: only runs when this file is executed directly ──
async function bootstrap() {
  await ensureRedisAvailable();
  await connectDatabase();
  const workers = startWorkers();

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    logger.info('Shutting down workers...');
    await stopWorkers(workers);
    await closeQueues();
    await disconnectDatabase();
    await disconnectRedis();
    logger.info('Worker shutdown complete');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  bootstrap().catch((err) => {
    logger.fatal({ err: err?.message }, 'Failed to start workers');
    process.exit(1);
  });
}
