import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { limiterClient } from '../config/redis.js';

function make({ windowMs, max, keyGenerator, prefix, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    message: { ok: false, error: { code: 'E_RATE_LIMIT', message: message || 'Too many requests' } },
    store: new RedisStore({
      prefix,
      sendCommand: (...args) => limiterClient.call(...args),
    }),
  });
}

// General API per-IP limiter — loose default
export const apiLimiter = make({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => req.ip,
  prefix: 'rl:api:',
});

// Auth limiter — stricter to foil credential stuffing
export const authLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `${req.ip}:${req.body?.email || 'anon'}`,
  prefix: 'rl:auth:',
  message: 'Too many login attempts',
});

/**
 * IoT-specific limiter. Key = machine ingestKeyId (not IP, since all machines route
 * through one gateway). Window: 1s sliding. Default 50 RPS per machine (configurable).
 */
export function iotLimiter(rps) {
  return make({
    windowMs: 1_000,
    max: rps,
    keyGenerator: (req) => req.iot?.keyId || req.ip,
    prefix: 'rl:iot:',
    message: 'IoT rate limit exceeded',
  });
}
