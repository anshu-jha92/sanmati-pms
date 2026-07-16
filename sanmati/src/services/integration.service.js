import { ApiIntegration, decryptSecret } from '../models/ApiIntegration.js';
import { BOM } from '../models/ERP.js';
import { SalesOrder } from '../models/SalesOrder.js';
import { PurchaseOrder } from '../models/PurchaseOrder.js';
import { InventoryItem } from '../models/Inventory.js';
import { cacheService } from './cache.service.js';
import { logger } from '../config/logger.js';

/**
 * Config-driven third-party API integration.
 *
 * Each ApiIntegration document describes:
 *   - Base URL + auth type + credentials (encrypted at rest)
 *   - Endpoints (key -> path/method/query)
 *   - How to find items in responses (`responseItemsPath`)
 *   - Optional field mapping (source -> internal)
 *
 * The service:
 *   1. Builds an authenticated fetch caller for the integration
 *   2. Calls the endpoint matching the operation
 *   3. Extracts items from the response
 *   4. Applies field mapping
 *   5. Upserts into the appropriate internal collection based on `module`
 */

function getPath(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
}

/**
 * Apply field mapping. Source fields on the LHS are copied to internal fields on
 * the RHS. Unmapped fields are passed through as-is, so partial maps work.
 */
function mapFields(src, mapping) {
  if (!mapping || mapping.size === 0) return src;
  const out = { ...src };
  for (const [from, to] of mapping.entries()) {
    if (src[from] !== undefined) {
      out[to] = src[from];
      if (from !== to) delete out[from];
    }
  }
  return out;
}

/**
 * Build a pre-configured HTTP caller for the integration.
 * Returns { call(endpointKey, { params } = {}) }.
 */
async function buildClient(integration) {
  // Reload with credentials (they're select:false)
  const full = await ApiIntegration.findById(integration._id)
    .select('+auth.bearerTokenEnc +auth.apiKeyEnc +auth.passwordEnc')
    .lean();

  const base = full.baseUrl.replace(/\/?$/, '/');
  const authHeaders = {};

  switch (full.auth?.type) {
    case 'bearer': {
      const tok = decryptSecret(full.auth.bearerTokenEnc);
      if (tok) authHeaders.authorization = `Bearer ${tok}`;
      break;
    }
    case 'api_key': {
      const key = decryptSecret(full.auth.apiKeyEnc);
      if (key) authHeaders[(full.auth.apiKeyHeader || 'X-API-Key').toLowerCase()] = key;
      break;
    }
    case 'basic': {
      const pwd = decryptSecret(full.auth.passwordEnc) || '';
      const b64 = Buffer.from(`${full.auth.username || ''}:${pwd}`).toString('base64');
      authHeaders.authorization = `Basic ${b64}`;
      break;
    }
    default:
      break;
  }

  // Static custom headers from the config
  const staticHeaders = {};
  if (full.headers) {
    for (const [k, v] of Object.entries(Object.fromEntries(full.headers))) {
      staticHeaders[k.toLowerCase()] = v;
    }
  }

  const endpointMap = new Map((full.endpoints || []).map((e) => [e.key, e]));

  async function call(key, { params = {}, body, query = {} } = {}) {
    const ep = endpointMap.get(key);
    if (!ep) throw new Error(`Endpoint "${key}" not defined on integration "${full.slug}"`);

    // Interpolate :param placeholders in path
    let pathStr = ep.path;
    for (const [k, v] of Object.entries(params)) {
      pathStr = pathStr.replace(`:${k}`, encodeURIComponent(v));
    }

    const url = new URL(pathStr.replace(/^\/+/, ''), base);

    const mergedQuery = {
      ...(ep.queryParams ? Object.fromEntries(Object.entries(Object.fromEntries(ep.queryParams))) : {}),
      ...query,
    };
    for (const [k, v] of Object.entries(mergedQuery)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method: ep.method || 'GET',
        headers: {
          accept: 'application/json',
          ...staticHeaders,
          ...authHeaders,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await res.text();
      const json = text ? safeJson(text) : null;
      if (!res.ok) {
        const err = new Error(`Upstream ${res.status}`);
        err.status = res.status;
        err.body = json ?? text.slice(0, 300);
        throw err;
      }
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { integration: full, call };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return s; }
}

/* ====== Module-specific upserters ====== */

const upserters = {
  inventory: async (items) => {
    let count = 0;
    for (const it of items) {
      if (!it.sku) continue;
      await InventoryItem.updateOne(
        { sku: String(it.sku).toUpperCase() },
        {
          $set: {
            sku: String(it.sku).toUpperCase(),
            name: it.name || it.description || it.sku,
            type: mapItemType(it.type),
            uom: it.uom || 'pcs',
            onHand: Number(it.onHand ?? it.qty ?? 0),
            reorderLevel: Number(it.reorderLevel ?? 0),
            plantId: it.plantId,
            externalRef: String(it.id ?? it.externalRef ?? it.sku),
          },
        },
        { upsert: true }
      );
      count++;
    }
    await cacheService.invalidateTag('inventory');
    return count;
  },

  bom: async (items) => {
    let count = 0;
    for (const b of items) {
      if (!b.id && !b.externalId) continue;
      await BOM.updateOne(
        { externalId: String(b.externalId ?? b.id) },
        {
          $set: {
            externalId: String(b.externalId ?? b.id),
            productSku: String(b.productSku || b.sku || '').toUpperCase(),
            version: String(b.version || '1'),
            active: b.active ?? true,
            components: (b.components || []).map((c) => ({
              sku: String(c.sku).toUpperCase(),
              name: c.name,
              qtyPerUnit: Number(c.qtyPerUnit ?? c.qty ?? 0),
              uom: c.uom,
              scrapPct: Number(c.scrapPct ?? 0),
            })),
            externalVersion: String(b.version || ''),
            syncedAt: new Date(),
          },
        },
        { upsert: true }
      );
      count++;
    }
    await cacheService.invalidateTag('boms');
    return count;
  },

  sales_orders: async (items) => {
    let count = 0;
    // Map incoming status values to the new SO schema.
    const statusMap = {
      open: 'new', pending: 'new', new: 'new',
      in_progress: 'in_progress', processing: 'in_progress',
      fulfilled: 'fulfilled', delivered: 'fulfilled', completed: 'fulfilled',
      cancelled: 'cancelled', canceled: 'cancelled',
      on_hold: 'on_hold', hold: 'on_hold',
    };
    // Priority mapping: legacy number 1-3 = high, 4-6 = medium, 7+ = normal.
    const priorityMap = (p) => {
      if (typeof p === 'string') {
        const s = p.toLowerCase();
        if (['high', 'medium', 'normal'].includes(s)) return s;
      }
      const n = Number(p);
      if (isNaN(n)) return 'normal';
      if (n <= 3) return 'high';
      if (n <= 6) return 'medium';
      return 'normal';
    };
    for (const o of items) {
      if (!o.id && !o.externalId) continue;
      await SalesOrder.updateOne(
        { externalId: String(o.externalId ?? o.id) },
        {
          $set: {
            externalId: String(o.externalId ?? o.id),
            orderNumber: o.orderNumber,
            customer: o.customer || 'Unknown',
            status: statusMap[String(o.status || '').toLowerCase()] || 'new',
            priority: priorityMap(o.priority),
            orderedAt: o.orderedAt ? new Date(o.orderedAt) : undefined,
            dueDate: o.dueDate ? new Date(o.dueDate) : undefined,
            lines: (o.lines || []).map((l) => ({
              sku: String(l.sku || '').toUpperCase(),
              productName: l.productName || l.name || l.sku,
              qty: Number(l.qty ?? 0),
              uom: l.uom || 'kg',
              dueDate: l.dueDate ? new Date(l.dueDate) : undefined,
              status: 'pending',
            })),
            totalValue: o.totalValue,
            currency: o.currency || 'INR',
            plantId: o.plantId,
            externalVersion: String(o.version || ''),
            syncedAt: new Date(),
          },
        },
        { upsert: true }
      );
      count++;
    }
    await cacheService.invalidateTag('sales_orders');
    return count;
  },

  purchase_orders: async (items) => {
    let count = 0;
    const statusMap = {
      open: 'submitted', pending: 'submitted', submitted: 'submitted',
      approved: 'approved',
      in_transit: 'in_transit', shipped: 'in_transit',
      partial: 'partial',
      received: 'received', closed: 'received',
      cancelled: 'cancelled', canceled: 'cancelled',
    };
    for (const o of items) {
      if (!o.id && !o.externalId) continue;
      const lines = (o.lines || []).map((l) => {
        const qty = Number(l.qty ?? l.orderedQty ?? 0);
        const unitCost = Number(l.unitCost ?? l.price ?? 0);
        return {
          sku: String(l.sku || '').toUpperCase(),
          name: l.name || l.sku,
          qty,
          uom: l.uom || 'kg',
          unitCost,
          lineTotal: qty * unitCost,
          receivedQty: Number(l.receivedQty ?? 0),
        };
      });
      const totalValue = lines.reduce((s, l) => s + (l.lineTotal || 0), 0);
      await PurchaseOrder.updateOne(
        { externalId: String(o.externalId ?? o.id) },
        {
          $set: {
            externalId: String(o.externalId ?? o.id),
            poNumber: o.poNumber || o.orderNumber || `PO-${o.id}`,
            supplier: o.supplier || 'Unknown',
            status: statusMap[String(o.status || '').toLowerCase()] || 'submitted',
            orderedAt: o.orderedAt ? new Date(o.orderedAt) : undefined,
            expectedDate: o.expectedDate ? new Date(o.expectedDate) : undefined,
            lines,
            totalValue,
            plantId: o.plantId,
            source: 'erp_sync',
            externalVersion: String(o.version || ''),
            syncedAt: new Date(),
          },
        },
        { upsert: true }
      );
      count++;
    }
    await cacheService.invalidateTag('purchase_orders');
    return count;
  },

  custom: async () => 0,
};

function mapItemType(t) {
  const map = { RAW: 'raw', WIP: 'wip', FG: 'finished', CONSUMABLE: 'consumable', PACK: 'packaging' };
  const key = String(t || '').toUpperCase();
  return map[key] || 'raw';
}

/**
 * Execute a sync for the given integration. Fetches via the 'list' endpoint,
 * extracts items, maps fields, upserts into the internal collection.
 * Returns count of records processed.
 */
export async function runSync(integrationId) {
  const integration = await ApiIntegration.findById(integrationId);
  if (!integration) throw new Error('Integration not found');
  if (!integration.active) throw new Error('Integration is inactive');

  integration.lastSyncStatus = 'running';
  integration.lastSyncError = undefined;
  await integration.save();

  try {
    const { call } = await buildClient(integration);
    const since = integration.lastSyncedAt ? integration.lastSyncedAt.toISOString() : undefined;
    const response = await call('list', { query: since ? { updatedSince: since } : {} });
    const raw = getPath(response, integration.responseItemsPath);
    const items = Array.isArray(raw) ? raw : Array.isArray(response) ? response : [];

    const mapping = integration.fieldMapping || new Map();
    const mapped = items.map((i) => mapFields(i, mapping));

    const upsert = upserters[integration.module];
    if (!upsert) throw new Error(`No upserter for module "${integration.module}"`);
    const count = await upsert(mapped);

    integration.lastSyncedAt = new Date();
    integration.lastSyncStatus = 'success';
    integration.lastSyncRecordCount = count;
    integration.lastSyncError = undefined;
    await integration.save();
    logger.info({ slug: integration.slug, count }, 'integration sync complete');
    return { count };
  } catch (err) {
    integration.lastSyncStatus = 'failed';
    integration.lastSyncError = err.message?.slice(0, 500);
    await integration.save();
    logger.error({ slug: integration.slug, err: err.message }, 'integration sync failed');
    throw err;
  }
}

/**
 * Test an integration without persisting anything. Returns the first 5 items
 * as received (post-mapping) so the admin can verify shape.
 */
export async function testIntegration(integrationId) {
  const integration = await ApiIntegration.findById(integrationId);
  if (!integration) throw new Error('Integration not found');
  const { call } = await buildClient(integration);
  const response = await call('list');
  const raw = getPath(response, integration.responseItemsPath);
  const items = Array.isArray(raw) ? raw : Array.isArray(response) ? response : [];
  const mapping = integration.fieldMapping || new Map();
  return {
    fetched: items.length,
    preview: items.slice(0, 5).map((i) => mapFields(i, mapping)),
    rawSample: items.slice(0, 1),
  };
}
