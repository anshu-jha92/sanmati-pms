import http from 'node:http';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { disconnectRedis, ensureRedisAvailable } from './config/redis.js';
import { socketService } from './services/socket.service.js';
import { closeQueues } from './services/queue.service.js';
import { createSuperAdminIfNeeded } from './services/adminBootstrap.service.js';
import { startWorkers, stopWorkers } from './workers/index.js';

async function main() {
  // Fail fast with ONE clear message if Redis is not reachable.
  await ensureRedisAvailable();

  // Fail fast with a clear message if MongoDB URI is bad / DB not reachable.
  await connectDatabase();

  // Auto-create a super-admin user if environment requests it
  const adminResult = await createSuperAdminIfNeeded();
  if (adminResult) {
    if (adminResult.created) {
      logger.info({ email: adminResult.email }, 'Super-admin created at bootstrap');
      logger.info('Admin credentials:');
      logger.info(`  email: ${adminResult.email}`);
      logger.info(`  password: ${adminResult.password}`);
    } else {
      logger.info('Super-admin already existed; no user created');
    }
  }

  const app = buildApp();
  const httpServer = http.createServer(app);
  socketService.init(httpServer);

  // Run background workers in-process by default (single-service deploy). This
  // is what actually consumes the telemetry/oee/erp-sync queues AND lets their
  // Socket.IO emits reach dashboards. Set WORKERS_INLINE=false only if you run a
  // dedicated `npm run worker` process instead.
  let workers = [];
  if (env.WORKERS_INLINE !== 'false') {
    workers = startWorkers();
  }

  // Handle listen errors cleanly. Without this, a busy port surfaces as an
  // unhandled 'error' event -> uncaughtException -> a FATAL stack-trace storm.
  // The most common case in dev is another API instance already on this port.
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `Port ${env.PORT} is already in use — another instance of the API is ` +
          `probably still running. Stop it first, or set a different PORT in .env, ` +
          `then start again.`
      );
    } else {
      logger.error({ err: err.message }, 'HTTP server failed to start');
    }
    process.exit(1);
  });

  httpServer.listen(env.PORT, () => {
    logger.info(`API listening on :${env.PORT}`);
  });

  shutdownOn(['SIGINT', 'SIGTERM'], async () => {
    logger.info('Shutting down API...');
    // Bound the shutdown so a hung connection can't block exit forever.
    const watchdog = setTimeout(() => {
      logger.error('Shutdown watchdog fired — forcing exit');
      process.exit(1);
    }, 10_000);
    watchdog.unref();

    // Stop accepting new connections and wait for in-flight requests to finish
    // BEFORE tearing down the DB/Redis they depend on.
    await new Promise((resolve) => httpServer.close(resolve));
    await stopWorkers(workers);
    await socketService.close();
    await closeQueues();
    await disconnectDatabase();
    await disconnectRedis();
    clearTimeout(watchdog);
    logger.info('Shutdown complete');
    process.exit(0);
  });

  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });
}

function shutdownOn(signals, handler) {
  let running = false;
  for (const sig of signals) {
    process.on(sig, async () => {
      if (running) return;
      running = true;
      try {
        await handler();
      } catch (err) {
        logger.error({ err }, 'shutdown error');
        process.exit(1);
      }
    });
  }
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'Failed to start');
  process.exit(1);
});
