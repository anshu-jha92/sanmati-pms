import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Configurable third-party API integration. Admin creates these from the UI;
 * the sync worker iterates active integrations on schedule and fetches data.
 *
 * Credential fields are encrypted at rest using AES-256-GCM with a key derived
 * from JWT_ACCESS_SECRET (cheap way to avoid introducing a new secret — in a
 * production deployment move these to a dedicated KMS).
 */

const endpointSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // 'list', 'get', 'create', etc.
    path: { type: String, required: true }, // relative to baseUrl
    method: { type: String, enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
    // Static query params merged into request (e.g. { limit: '100' })
    queryParams: { type: Map, of: String, default: () => ({}) },
  },
  { _id: false }
);

const apiIntegrationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String },

    // Which internal module this integration feeds
    module: {
      type: String,
      enum: ['inventory', 'bom', 'sales_orders', 'purchase_orders', 'custom'],
      required: true,
      index: true,
    },

    baseUrl: { type: String, required: true },

    auth: {
      type: {
        type: String,
        enum: ['none', 'bearer', 'api_key', 'basic'],
        default: 'none',
      },
      // Encrypted blobs (see encrypt/decrypt below)
      bearerTokenEnc: { type: String, select: false },
      apiKeyHeader: { type: String, default: 'X-API-Key' },
      apiKeyEnc: { type: String, select: false },
      username: { type: String },
      passwordEnc: { type: String, select: false },
    },

    // Custom static headers merged into every request
    headers: { type: Map, of: String, default: () => ({}) },

    endpoints: [endpointSchema],

    // Path in the API response to find the items array. Dot notation, e.g. 'data.items'.
    // Use '' for responses where the body IS the array.
    responseItemsPath: { type: String, default: 'items' },

    // Optional field mapping: source field name -> internal field name.
    // Example: { "product_code": "sku", "qty": "onHand" }
    fieldMapping: { type: Map, of: String, default: () => ({}) },

    syncIntervalMinutes: { type: Number, default: 15, min: 1 },
    active: { type: Boolean, default: true, index: true },

    plantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plant' },

    lastSyncedAt: { type: Date },
    lastSyncStatus: { type: String, enum: ['success', 'failed', 'running'] },
    lastSyncError: { type: String },
    lastSyncRecordCount: { type: Number },
  },
  { timestamps: true }
);

apiIntegrationSchema.index({ module: 1, active: 1 });

/* ====== Simple at-rest encryption for credential fields ====== */

const ALGO = 'aes-256-gcm';

function getKey() {
  return crypto.createHash('sha256').update(env.JWT_ACCESS_SECRET).digest();
}

export function encryptSecret(plain) {
  if (plain == null || plain === '') return undefined;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack: base64(iv | tag | ciphertext)
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(enc) {
  if (!enc) return undefined;
  try {
    const buf = Buffer.from(enc, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

/** Safe-for-client view: never leaks decrypted secrets. */
apiIntegrationSchema.methods.toClientJSON = function () {
  const o = this.toObject({ virtuals: true });
  if (o.auth) {
    o.auth = {
      type: o.auth.type,
      apiKeyHeader: o.auth.apiKeyHeader,
      username: o.auth.username,
      hasBearer: !!o.auth.bearerTokenEnc,
      hasApiKey: !!o.auth.apiKeyEnc,
      hasPassword: !!o.auth.passwordEnc,
    };
  }
  return o;
};

export const ApiIntegration = mongoose.model('ApiIntegration', apiIntegrationSchema);
