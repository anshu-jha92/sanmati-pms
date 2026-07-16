import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { integrationApiAuth } from '../middleware/integrationApiAuth.js';
import {
  pushSalesOrders,
  pushPurchaseOrders,
  pushBoms,
  integrationHealth,
} from '../controllers/integrationApi.controller.js';

/**
 * External Integration API — NOT protected by user JWTs.
 * Authenticates with X-API-Key header against env.INTEGRATION_API_KEY.
 *
 * Mounted at /integrations/v1/* in app.js (outside of /api/v1).
 */
export function buildIntegrationApiRouter() {
  const router = Router();

  // Generous rate limit — ERP might push bursts. 300 req/min per IP.
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
  router.use(limiter);

  // All endpoints require the integration API key
  router.use(integrationApiAuth);

  router.get('/health',           integrationHealth);
  router.post('/sales-orders',    pushSalesOrders);
  router.post('/purchase-orders', pushPurchaseOrders);
  router.post('/bom',             pushBoms);

  return router;
}
