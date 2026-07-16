import { z } from 'zod';
import { ApiIntegration, encryptSecret } from '../models/ApiIntegration.js';
import { ApiError, asyncHandler, ok } from '../utils/http.js';
import { runSync, testIntegration } from '../services/integration.service.js';
import { erpSyncQueue } from '../services/queue.service.js';

const endpointSchema = z.object({
  key: z.string().min(1),
  path: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  queryParams: z.record(z.string()).optional(),
});

const baseAuth = z.object({
  type: z.enum(['none', 'bearer', 'api_key', 'basic']).default('none'),
  // Plaintext on input — we encrypt before save. Never returned in responses.
  bearerToken: z.string().optional(),
  apiKeyHeader: z.string().optional(),
  apiKey: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});

const integrationSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9_-]+$/),
  description: z.string().optional(),
  module: z.enum(['inventory', 'bom', 'sales_orders', 'purchase_orders', 'custom']),
  baseUrl: z.string().url(),
  auth: baseAuth.optional(),
  headers: z.record(z.string()).optional(),
  endpoints: z.array(endpointSchema).min(1),
  responseItemsPath: z.string().optional(),
  fieldMapping: z.record(z.string()).optional(),
  syncIntervalMinutes: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  plantId: z.string().nullish(),
});

function shapeForSave(payload) {
  const out = { ...payload };

  if (payload.auth) {
    out.auth = {
      type: payload.auth.type || 'none',
      apiKeyHeader: payload.auth.apiKeyHeader || 'X-API-Key',
      username: payload.auth.username,
    };
    if (payload.auth.bearerToken) out.auth.bearerTokenEnc = encryptSecret(payload.auth.bearerToken);
    if (payload.auth.apiKey) out.auth.apiKeyEnc = encryptSecret(payload.auth.apiKey);
    if (payload.auth.password) out.auth.passwordEnc = encryptSecret(payload.auth.password);
  }

  // Mongoose Maps take plain objects
  if (payload.headers) out.headers = payload.headers;
  if (payload.fieldMapping) out.fieldMapping = payload.fieldMapping;
  if (payload.endpoints) {
    out.endpoints = payload.endpoints.map((e) => ({
      key: e.key,
      path: e.path,
      method: e.method,
      queryParams: e.queryParams || {},
    }));
  }
  return out;
}

export const list = asyncHandler(async (_req, res) => {
  const items = await ApiIntegration.find().sort({ module: 1, name: 1 });
  res.json(ok(items.map((i) => i.toClientJSON())));
});

export const getOne = asyncHandler(async (req, res) => {
  const doc = await ApiIntegration.findById(req.params.id);
  if (!doc) throw ApiError.notFound('Integration not found');
  res.json(ok(doc.toClientJSON()));
});

export const create = asyncHandler(async (req, res) => {
  const payload = integrationSchema.parse(req.body);
  const doc = await ApiIntegration.create(shapeForSave(payload));
  res.status(201).json(ok(doc.toClientJSON()));
});

export const update = asyncHandler(async (req, res) => {
  const payload = integrationSchema.partial().parse(req.body);
  const doc = await ApiIntegration.findById(req.params.id).select('+auth.bearerTokenEnc +auth.apiKeyEnc +auth.passwordEnc');
  if (!doc) throw ApiError.notFound('Integration not found');

  // Handle each top-level field, with special care for nested auth
  if (payload.auth) {
    const a = payload.auth;
    if (a.type !== undefined) doc.auth.type = a.type;
    if (a.apiKeyHeader !== undefined) doc.auth.apiKeyHeader = a.apiKeyHeader;
    if (a.username !== undefined) doc.auth.username = a.username;
    // Only overwrite encrypted fields when caller explicitly sends new plaintext
    if (a.bearerToken) doc.auth.bearerTokenEnc = encryptSecret(a.bearerToken);
    if (a.apiKey) doc.auth.apiKeyEnc = encryptSecret(a.apiKey);
    if (a.password) doc.auth.passwordEnc = encryptSecret(a.password);
  }
  for (const k of ['name', 'description', 'module', 'baseUrl', 'responseItemsPath', 'syncIntervalMinutes', 'active', 'plantId', 'slug']) {
    if (payload[k] !== undefined) doc[k] = payload[k];
  }
  if (payload.headers !== undefined) doc.headers = new Map(Object.entries(payload.headers));
  if (payload.fieldMapping !== undefined) doc.fieldMapping = new Map(Object.entries(payload.fieldMapping));
  if (payload.endpoints !== undefined) {
    doc.endpoints = payload.endpoints.map((e) => ({
      key: e.key,
      path: e.path,
      method: e.method,
      queryParams: e.queryParams ? new Map(Object.entries(e.queryParams)) : new Map(),
    }));
  }
  await doc.save();
  res.json(ok(doc.toClientJSON()));
});

export const remove = asyncHandler(async (req, res) => {
  const doc = await ApiIntegration.findByIdAndDelete(req.params.id);
  if (!doc) throw ApiError.notFound('Integration not found');
  res.json(ok({ success: true }));
});

/** Synchronously test the config without persisting any data. */
export const test = asyncHandler(async (req, res) => {
  try {
    const result = await testIntegration(req.params.id);
    res.json(ok(result));
  } catch (err) {
    throw ApiError.badRequest(`Test failed: ${err.message}`, {
      code: 'E_INTEGRATION_TEST',
      details: { upstreamBody: err.body, status: err.status },
    });
  }
});

/** Enqueue a sync job so it runs via the worker (non-blocking). */
export const triggerSync = asyncHandler(async (req, res) => {
  const doc = await ApiIntegration.findById(req.params.id);
  if (!doc) throw ApiError.notFound('Integration not found');
  await erpSyncQueue.add('run-integration', { integrationId: String(doc._id) }, {
    jobId: `sync:${doc._id}:${Date.now()}`,
  });
  res.status(202).json(ok({ queued: true }));
});

/** Run sync synchronously (useful for "Sync now" button where the admin wants immediate feedback). */
export const runNow = asyncHandler(async (req, res) => {
  try {
    const result = await runSync(req.params.id);
    res.json(ok(result));
  } catch (err) {
    throw ApiError.badRequest(`Sync failed: ${err.message}`, { code: 'E_INTEGRATION_SYNC' });
  }
});

/** Rotate the API key for a machine — not an integration, but thematically similar (security). */
export { rotateMachineApiKey } from './machine.controller.js';
