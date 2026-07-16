import { authStore } from '../context/authStore.js';

// API origin resolution:
//  1. explicit VITE_API_BASE_URL (if set at build time), else
//  2. dev  → the local backend on :4000, else
//  3. prod → the same origin that served this app (single-service deploy).
const ENV_BASE = import.meta.env.VITE_API_BASE_URL;
const BASE_URL = (ENV_BASE && ENV_BASE.trim())
  ? ENV_BASE
  : (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);

let refreshInFlight = null;

async function doRefresh() {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = authStore.getState().refreshToken;
  if (!refreshToken) {
    authStore.getState().clear();
    throw new ApiClientError(401, 'E_NO_REFRESH', 'No refresh token');
  }
  refreshInFlight = (async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      authStore.getState().clear();
      throw new ApiClientError(401, 'E_REFRESH_FAILED', 'Session expired');
    }
    const body = await res.json();
    authStore.getState().setTokens({
      accessToken: body.data.accessToken,
      refreshToken: body.data.refreshToken,
    });
    return body.data.accessToken;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export class ApiClientError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, query, headers = {}, retry = true, signal } = {}) {
  const url = new URL(path.replace(/^\/+/, ''), BASE_URL.replace(/\/?$/, '/'));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((vv) => url.searchParams.append(k, String(vv)));
      else url.searchParams.set(k, String(v));
    }
  }

  const token = authStore.getState().accessToken;
  const init = {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  };

  const res = await fetch(url, init);
  if (res.status === 401 && retry && token) {
    try {
      await doRefresh();
    } catch {
      authStore.getState().clear();
      throw new ApiClientError(401, 'E_AUTH', 'Session expired');
    }
    return request(path, { method, body, query, headers, retry: false, signal });
  }

  if (res.status === 204) return null;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = json?.error || {};
    throw new ApiClientError(res.status, e.code || `E_${res.status}`, e.message || res.statusText, e.details);
  }
  if (json && typeof json === 'object' && 'ok' in json) {
    return { data: json.data, meta: json.meta };
  }
  return { data: json };
}

export const api = {
  get: (path, query, opts) => request(path, { method: 'GET', query, ...opts }),
  post: (path, body, opts) => request(path, { method: 'POST', body, ...opts }),
  patch: (path, body, opts) => request(path, { method: 'PATCH', body, ...opts }),
  put: (path, body, opts) => request(path, { method: 'PUT', body, ...opts }),
  del: (path, opts) => request(path, { method: 'DELETE', ...opts }),
};

export { BASE_URL };
