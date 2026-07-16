import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { limiterClient } from '../config/redis.js';
import { env } from '../config/env.js';
import { iotAuth } from '../middleware/iotAuth.js';
import { ingest, iotHealth } from '../controllers/iot.controller.js';

/**
 * Three interchangeable entry points for IoT ingestion:
 *
 *   A) URL-scoped       POST /iot/v1/machines/:code/data
 *                       POST /iot/v1/machines/:code/events   (alias)
 *
 *   B) Header-scoped    POST /iot/v1/ingest
 *                       header: X-Machine-Code: PR-01
 *
 *   C) Body-scoped      POST /iot/v1/ingest
 *                       body: { "machineId": "PR-01", ... }
 *
 * All three require `X-API-Key: <key>`.
 */
export function buildIotRouter() {
  const router = Router();
  router.use(express.json({ limit: env.IOT_MAX_PAYLOAD_BYTES }));

  const iotLimiter = rateLimit({
    windowMs: 1_000,
    max: (req) => {
      const m = req.iot?.machine;
      return m?.rateLimitRps || env.IOT_RATE_LIMIT_RPS;
    },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Best effort — after auth the machine is known; before, use header/URL/IP.
      const code =
        req.iot?.machine?.code ||
        req.params?.code ||
        req.header('x-machine-code') ||
        req.body?.machineId ||
        req.ip;
      return `iot:${String(code).toUpperCase()}`;
    },
    message: { ok: false, error: { code: 'E_IOT_RATE_LIMIT', message: 'IoT rate limit exceeded' } },
    store: new RedisStore({ prefix: 'rl:iot:', sendCommand: (...a) => limiterClient.call(...a) }),
  });

  // URL-scoped (A)
  router.post('/machines/:code/data', iotAuth, iotLimiter, ingest);
  router.post('/machines/:code/events', iotAuth, iotLimiter, ingest);
  router.get('/machines/:code/health', iotAuth, iotHealth);

  // Flat endpoint that accepts code from body or header (B, C)
  router.post('/ingest', iotAuth, iotLimiter, ingest);
  router.get('/health', iotAuth, iotHealth);

  return router;
}
