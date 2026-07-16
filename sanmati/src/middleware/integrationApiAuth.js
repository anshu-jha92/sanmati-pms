import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { Plant } from '../models/Plant.js';

/**
 * Integration API authentication — for EXTERNAL SOFTWARE pushing data in.
 *
 * Third-party systems (customer ERPs, other applications) hit endpoints
 * mounted at /integrations/v1/* to push sales orders / purchase orders.
 * They authenticate with a single shared API key in the `X-API-Key` header.
 *
 *   POST /integrations/v1/sales-orders
 *   POST /integrations/v1/purchase-orders
 *
 * Header format:
 *   X-API-Key: <INTEGRATION_API_KEY from backend/.env>
 *
 * The middleware:
 *   • Verifies the key (constant-time comparison to avoid timing attacks).
 *   • Resolves a default plant (so items can be created without the caller
 *     needing to know plant IDs).
 *   • Attaches req.integration = { plant }.
 */

let cachedPlant = null;
let cachedAt = 0;
const PLANT_CACHE_MS = 60_000;

async function resolveDefaultPlant() {
  const now = Date.now();
  if (cachedPlant && (now - cachedAt) < PLANT_CACHE_MS) return cachedPlant;
  const plant = await Plant.findOne().sort({ createdAt: 1 }).lean();
  if (plant) {
    cachedPlant = plant;
    cachedAt = now;
  }
  return plant;
}

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export const integrationApiAuth = asyncHandler(async (req, _res, next) => {
  if (!env.INTEGRATION_API_KEY) {
    throw ApiError.unauthorized(
      'Integration API is not configured. Set INTEGRATION_API_KEY in backend/.env and restart.',
      { code: 'E_INTEGRATION_NOT_CONFIGURED' }
    );
  }

  const providedKey =
    req.header('x-api-key') ||
    (req.header('authorization') || '').replace(/^Bearer\s+/i, '');

  if (!providedKey) {
    throw ApiError.unauthorized('Missing X-API-Key header', { code: 'E_INTEGRATION_KEY_MISSING' });
  }

  if (!safeEqual(providedKey, env.INTEGRATION_API_KEY)) {
    throw ApiError.unauthorized('Invalid API key', { code: 'E_INTEGRATION_KEY_INVALID' });
  }

  // Resolve a default plant for orders that don't specify one.
  const plant = await resolveDefaultPlant();
  if (!plant) {
    throw ApiError.badRequest(
      'No plant found in the database. Seed one first or pass plantId in the request body.',
      { code: 'E_NO_PLANT' }
    );
  }

  req.integration = {
    plant,
    // Synthetic user for audit-log purposes — the integration acts as a system user
    user: {
      id: 'integration-api',
      email: 'integration@system',
      plantId: String(plant._id),
    },
  };
  next();
});
