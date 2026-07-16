/**
 * Open IoT routes.
 *
 * Mounted at /iot/* in app.js, OUTSIDE of /api/v1, OUTSIDE of /integrations.
 * No authentication middleware is applied.
 *
 *   POST    /iot/data                          Upsert device data
 *   GET     /iot/data                          List all current device states
 *   GET     /iot/data/:deviceId                Get one device's current state
 *   GET     /iot/data/:deviceId/history        Get recent N history rows
 *   DELETE  /iot/data/:deviceId                Clear current state
 *
 * A separate rate limiter is applied here to protect the database from
 * misconfigured devices in an infinite loop. The limit is generous —
 * 5000 requests per minute per IP — enough for normal IoT traffic.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  ingestDeviceData,
  listDeviceData,
  getDeviceData,
  getDeviceHistory,
  deleteDeviceData,
} from '../controllers/iotOpen.controller.js';

export function buildOpenIotRouter() {
  const router = Router();

  // Safety net: 5000 req/min per IP. A factory of 7 machines @ 1Hz
  // would only do ~420 req/min, so 5000 leaves plenty of headroom for
  // bursts or extra dev devices.
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5000,
    standardHeaders: true,
    legacyHeaders: false,
  });
  router.use(limiter);

  router.post('/data', ingestDeviceData);
  router.get('/data', listDeviceData);
  router.get('/data/:deviceId', getDeviceData);
  router.get('/data/:deviceId/history', getDeviceHistory);
  router.delete('/data/:deviceId', deleteDeviceData);

  return router;
}
