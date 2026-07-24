import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import pinoHttp from 'pino-http';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { cacheClient } from './config/redis.js';

// Resolve the frontend build (frontend/dist) relative to this file (sanmati/src/app.js).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '../../frontend/dist');
const CLIENT_INDEX = path.join(CLIENT_DIR, 'index.html');
import { logger } from './config/logger.js';
import { buildRouter } from './routes/index.js';
import { buildIotRouter } from './routes/iot.js';
import { buildOpenIotRouter } from './routes/iot-open.js';
import { buildIntegrationApiRouter } from './routes/integrations-api.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      // Skip liveness/readiness pings and the high-frequency IoT ingest paths —
      // logging every telemetry packet floods logs and slows the hot path.
      autoLogging: {
        ignore: (req) =>
          req.url === '/health' || req.url === '/ready' || req.url.startsWith('/iot'),
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    })
  );

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
      maxAge: 600,
    })
  );
  app.use(compression());

  // Liveness: is the process up? (cheap, no dependencies)
  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Readiness: can we actually serve traffic? Verifies Mongo + Redis so a load
  // balancer / Apache health probe stops routing to a broken instance.
  app.get('/ready', async (_req, res) => {
    const mongoOk = mongoose.connection.readyState === 1;
    let redisOk = false;
    try {
      redisOk = (await cacheClient.ping()) === 'PONG';
    } catch {
      redisOk = false;
    }
    const ok = mongoOk && redisOk;
    res.status(ok ? 200 : 503).json({ ok, mongo: mongoOk, redis: redisOk, ts: Date.now() });
  });

  // IoT routes — have their own JSON parser with larger limit (see routes/iot.js)
  app.use('/iot/v1', buildIotRouter());

  // Open, no-auth IoT — devices POST any payload to /iot/data, server upserts latest
  // NOTE: must be mounted AFTER /iot/v1 so the more specific prefix matches first
  app.use('/iot', express.json({ limit: '512kb' }), buildOpenIotRouter());

  // External Integration API — 3rd party systems pushing sales/purchase orders
  app.use('/integrations/v1', express.json({ limit: '2mb' }), buildIntegrationApiRouter());

  // Standard API routes
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use('/api/v1', buildRouter());

  // ── Serve the built frontend (single-service / Render deploy) ──
  // When frontend/dist exists (after `vite build`), serve the SPA from the SAME
  // origin as the API — no CORS, one URL. API/IoT/integration prefixes are handled
  // above; every other GET falls through to index.html for client-side routing.
  if (fs.existsSync(CLIENT_INDEX)) {
    app.use(express.static(CLIENT_DIR, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (
        req.path.startsWith('/api') ||
        req.path.startsWith('/iot') ||
        req.path.startsWith('/integrations') ||
        req.path === '/health'
      ) return next();
      res.sendFile(CLIENT_INDEX);
    });
    logger.info('Serving frontend build from frontend/dist');
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
