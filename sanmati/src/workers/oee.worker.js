import { Worker } from 'bullmq';
import { queueConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { bullPrefix } from '../services/queue.service.js';
import { computeBucket } from '../services/oee.service.js';
import { socketService } from '../services/socket.service.js';

export function startOeeWorker() {
  const worker = new Worker(
    'oee-rollup',
    async (job) => {
      const { machineId, granularity, bucketStart } = job.data;
      const doc = await computeBucket(machineId, granularity, new Date(bucketStart));
      if (doc) {
        socketService.emitOeeTick(String(doc.plantId), String(doc.machineId), {
          granularity: doc.granularity,
          bucketStart: doc.bucketStart,
          oee: doc.oee,
          availability: doc.availability,
          performance: doc.performance,
          quality: doc.quality,
        });
      }
    },
    { connection: queueConnection, prefix: bullPrefix, concurrency: env.WORKER_CONCURRENCY_OEE }
  );
  worker.on('failed', (job, err) => logger.warn({ jobId: job?.id, err }, 'oee job failed'));
  logger.info({ concurrency: env.WORKER_CONCURRENCY_OEE }, 'oee worker started');
  return worker;
}
