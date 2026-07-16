import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Distinct Redis clients by role. BullMQ forbids keyPrefix on its connection,
 * so `queueConnection` has no prefix (BullMQ uses its own `prefix` option).
 *
 * Retry strategy:
 *   - Dev: give up after ~5 tries (~4s) and exit with a single clear message
 *   - Prod: reconnect forever with capped backoff
 */

let warned = false;
function onError(err, clientName) {
  if (err?.code === 'ECONNREFUSED' && !warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.error(
      `\n❌ Cannot connect to Redis at ${env.REDIS_URL}\n` +
        '   Redis is required (cache, queues, rate limiting, Socket.IO adapter).\n' +
        '   Start Redis, then restart the API.\n' +
        '   Windows options:\n' +
        '     • Memurai (free)  — https://www.memurai.com/get-memurai\n' +
        '     • Docker Desktop  — docker run -d --name redis -p 6379:6379 redis:7-alpine\n' +
        '     • WSL2 + Ubuntu   — sudo apt install redis-server && sudo service redis-server start\n'
    );
  } else if (err?.code !== 'ECONNREFUSED') {
    logger.error({ client: clientName, err: err.message }, 'Redis error');
  }
}

function retryStrategy(times) {
  // In dev, give up after a handful of attempts so the operator sees the error.
  if (env.NODE_ENV === 'development' && times > 4) return null; // null = stop retrying
  // Otherwise exponential backoff, capped at 10s.
  return Math.min(times * 200, 10_000);
}

function makeClient(name, { usePrefix = true, ...opts } = {}) {
  const client = new Redis(env.REDIS_URL, {
    ...(usePrefix ? { keyPrefix: env.REDIS_KEY_PREFIX } : {}),
    lazyConnect: false,
    enableReadyCheck: true,
    retryStrategy,
    reconnectOnError: () => false, // don't retry on command errors; just bubble up
    ...opts,
  });
  client.on('error', (err) => onError(err, name));
  client.on('connect', () => logger.debug({ client: name }, 'Redis connected'));
  return client;
}

/**
 * Preflight: attempt a single PING before the app starts creating dependent clients
 * (BullMQ, Socket.IO adapter). If Redis isn't reachable, exit immediately with a
 * clean message instead of a 200-line error storm.
 */
export async function ensureRedisAvailable() {
  const probe = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 3_000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await probe.connect();
    await probe.ping();
  } catch (err) {
    onError(err, 'preflight');
    try { probe.disconnect(); } catch { /* noop */ }
    process.exit(1);
  } finally {
    try { probe.disconnect(); } catch { /* noop */ }
  }
}

// General-purpose clients (keyPrefix applied)
export const cacheClient = makeClient('cache');
export const limiterClient = makeClient('limiter');

// BullMQ connection — NO keyPrefix; maxRetriesPerRequest:null required by BullMQ
export const queueConnection = makeClient('queue', {
  usePrefix: false,
  maxRetriesPerRequest: null,
});

// Socket.IO adapter pub/sub pair — NO keyPrefix
export const pubClient = makeClient('socket-pub', { usePrefix: false });
export const subClient = pubClient.duplicate();

export async function disconnectRedis() {
  await Promise.allSettled([
    cacheClient.quit(),
    limiterClient.quit(),
    queueConnection.quit(),
    pubClient.quit(),
    subClient.quit(),
  ]);
}
