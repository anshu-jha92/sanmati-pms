import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, RefreshCw, Trash2, TestTube2, Save, X } from 'lucide-react';
import { integrationApi } from '../api/endpoints.js';
import { Card, StatusPill, ErrorNote, Empty, Loading } from '../components/ui/Primitives.jsx';
import { Can } from '../components/auth/Gates.jsx';

const MODULES = [
  { value: 'inventory', label: 'Inventory' },
  { value: 'bom', label: 'BOM' },
  { value: 'sales_orders', label: 'Sales Orders' },
  { value: 'purchase_orders', label: 'Purchase Orders' },
  { value: 'custom', label: 'Custom' },
];
const AUTH_TYPES = ['none', 'bearer', 'api_key', 'basic'];

export function IntegrationsPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ['integrations'],
    queryFn: async () => (await integrationApi.list()).data,
  });

  const selected = list.data?.find((i) => i._id === selectedId);

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">API Integrations</h1>
          <p className="text-sm text-ink-500">
            Configure third-party APIs (Inventory, BOM, Sales / Purchase Orders). Credentials are encrypted at rest.
          </p>
        </div>
        <Can module="integrations" action="create">
          <button className="btn-primary" onClick={() => { setCreating(true); setSelectedId(null); }}>
            <Plus className="h-4 w-4" /> New integration
          </button>
        </Can>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <Card bodyClass="p-0">
          {list.isLoading ? (
            <Loading />
          ) : !list.data?.length ? (
            <Empty title="No integrations yet" sub="Click New integration to add one." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {list.data.map((i) => (
                <li key={i._id}>
                  <button
                    onClick={() => { setSelectedId(i._id); setCreating(false); }}
                    className={`w-full text-left px-4 py-3 hover:bg-ink-50 ${selectedId === i._id ? 'bg-brand-50 ring-1 ring-brand-100' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{i.name}</div>
                        <div className="text-xs text-ink-500">
                          <span className="font-mono">{i.slug}</span> · {i.module} · {i.active ? 'active' : 'paused'}
                        </div>
                      </div>
                      {i.lastSyncStatus && <StatusPill status={i.lastSyncStatus} />}
                    </div>
                    {i.lastSyncedAt && (
                      <div className="text-[11px] text-ink-400 mt-1">
                        last: {new Date(i.lastSyncedAt).toLocaleString()}
                        {i.lastSyncRecordCount !== undefined && ` · ${i.lastSyncRecordCount} records`}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card bodyClass="p-0">
          {creating ? (
            <IntegrationEditor
              key="new"
              mode="create"
              onSaved={(doc) => { qc.invalidateQueries({ queryKey: ['integrations'] }); setCreating(false); setSelectedId(doc._id); }}
              onCancel={() => setCreating(false)}
            />
          ) : selected ? (
            <IntegrationEditor
              key={selected._id}
              mode="edit"
              value={selected}
              onSaved={() => qc.invalidateQueries({ queryKey: ['integrations'] })}
            />
          ) : (
            <Empty title="Select an integration to view or edit" />
          )}
        </Card>
      </div>
    </div>
  );
}

function IntegrationEditor({ mode, value, onSaved, onCancel }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => normaliseFromServer(value));
  const [err, setErr] = useState('');
  const [testResult, setTestResult] = useState(null);

  const save = useMutation({
    mutationFn: async () => {
      const body = buildPayload(form);
      if (mode === 'create') return (await integrationApi.create(body)).data;
      return (await integrationApi.update(value._id, body)).data;
    },
    onSuccess: (doc) => {
      setErr('');
      setTestResult(null);
      onSaved?.(doc);
    },
    onError: (e) => setErr(e.message || 'Save failed'),
  });

  const remove = useMutation({
    mutationFn: async () => await integrationApi.remove(value._id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const test = useMutation({
    mutationFn: async () => (await integrationApi.test(value._id)).data,
    onSuccess: (r) => { setTestResult(r); setErr(''); },
    onError: (e) => { setTestResult(null); setErr(`Test: ${e.message}`); },
  });

  const runNow = useMutation({
    mutationFn: async () => (await integrationApi.runNow(value._id)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
    onError: (e) => setErr(`Sync: ${e.message}`),
  });

  return (
    <div>
      <div className="px-5 py-3 border-b border-ink-100 flex items-center justify-between">
        <div>
          <div className="font-medium">{mode === 'create' ? 'New integration' : value.name}</div>
          {mode === 'edit' && (
            <div className="text-xs text-ink-500">
              Last sync: {value.lastSyncedAt ? new Date(value.lastSyncedAt).toLocaleString() : 'never'}
              {value.lastSyncError && <span className="text-red-600 ml-2">— {value.lastSyncError}</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {mode === 'edit' && (
            <>
              <Can module="integrations" action="update">
                <button className="btn-secondary text-xs" onClick={() => test.mutate()} disabled={test.isPending}>
                  <TestTube2 className="h-3.5 w-3.5" /> {test.isPending ? 'Testing…' : 'Test'}
                </button>
                <button className="btn-secondary text-xs" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                  <Play className="h-3.5 w-3.5" /> {runNow.isPending ? 'Running…' : 'Sync now'}
                </button>
              </Can>
              <Can module="integrations" action="delete">
                <button
                  className="btn-secondary text-xs text-red-600"
                  onClick={() => confirm(`Delete integration "${value.name}"?`) && remove.mutate()}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </Can>
            </>
          )}
          {mode === 'create' && onCancel && (
            <button className="btn-secondary text-xs" onClick={onCancel}>
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          )}
          <Can module="integrations" action="update">
            <button className="btn-primary text-xs" onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="h-3.5 w-3.5" /> {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </Can>
        </div>
      </div>

      <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
        <ErrorNote message={err} />

        {testResult && (
          <div className="rounded-lg bg-green-50 ring-1 ring-green-200 p-3">
            <div className="text-sm text-green-800 font-medium">
              Test succeeded — {testResult.fetched} records fetched
            </div>
            {testResult.preview?.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-green-700 cursor-pointer">Preview first {testResult.preview.length} mapped records</summary>
                <pre className="mt-2 text-[11px] bg-white p-2 rounded overflow-auto max-h-48">
                  {JSON.stringify(testResult.preview, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Basic */}
        <section className="grid grid-cols-2 gap-3">
          <Labeled label="Name">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Labeled>
          <Labeled label="Slug">
            <input className="input font-mono" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} pattern="[a-z0-9_-]+" />
          </Labeled>
          <Labeled label="Module">
            <select className="input" value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })}>
              {MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Labeled>
          <Labeled label="Base URL">
            <input className="input" placeholder="https://erp.example.com/api" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          </Labeled>
          <Labeled label="Sync interval (minutes)">
            <input type="number" className="input" value={form.syncIntervalMinutes} onChange={(e) => setForm({ ...form, syncIntervalMinutes: Number(e.target.value) })} />
          </Labeled>
          <Labeled label="Response items path">
            <input className="input font-mono" placeholder="items or data.items" value={form.responseItemsPath} onChange={(e) => setForm({ ...form, responseItemsPath: e.target.value })} />
          </Labeled>
          <Labeled label="Active">
            <select className="input" value={String(form.active)} onChange={(e) => setForm({ ...form, active: e.target.value === 'true' })}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </Labeled>
          <Labeled label="Description">
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Labeled>
        </section>

        {/* Auth */}
        <section>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500 mb-2">Authentication</div>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Auth type">
              <select className="input" value={form.auth.type} onChange={(e) => setForm({ ...form, auth: { ...form.auth, type: e.target.value } })}>
                {AUTH_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Labeled>
            {form.auth.type === 'bearer' && (
              <Labeled label={mode === 'edit' && value.auth?.hasBearer ? 'New bearer token (leave blank to keep)' : 'Bearer token'}>
                <input className="input font-mono" type="password" value={form.auth.bearerToken} onChange={(e) => setForm({ ...form, auth: { ...form.auth, bearerToken: e.target.value } })} />
              </Labeled>
            )}
            {form.auth.type === 'api_key' && (
              <>
                <Labeled label="Header name">
                  <input className="input" value={form.auth.apiKeyHeader} onChange={(e) => setForm({ ...form, auth: { ...form.auth, apiKeyHeader: e.target.value } })} />
                </Labeled>
                <Labeled label={mode === 'edit' && value.auth?.hasApiKey ? 'New API key (leave blank to keep)' : 'API key'}>
                  <input className="input font-mono" type="password" value={form.auth.apiKey} onChange={(e) => setForm({ ...form, auth: { ...form.auth, apiKey: e.target.value } })} />
                </Labeled>
              </>
            )}
            {form.auth.type === 'basic' && (
              <>
                <Labeled label="Username">
                  <input className="input" value={form.auth.username} onChange={(e) => setForm({ ...form, auth: { ...form.auth, username: e.target.value } })} />
                </Labeled>
                <Labeled label={mode === 'edit' && value.auth?.hasPassword ? 'New password (leave blank to keep)' : 'Password'}>
                  <input className="input" type="password" value={form.auth.password} onChange={(e) => setForm({ ...form, auth: { ...form.auth, password: e.target.value } })} />
                </Labeled>
              </>
            )}
          </div>
        </section>

        {/* Endpoints */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Endpoints</div>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setForm({ ...form, endpoints: [...form.endpoints, { key: '', path: '', method: 'GET' }] })}
            >
              <Plus className="h-3.5 w-3.5" /> Add endpoint
            </button>
          </div>
          <div className="space-y-2">
            {form.endpoints.map((ep, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-[120px_100px_minmax(0,1fr)_auto] gap-2">
                <input
                  className="input text-sm"
                  placeholder="key (e.g. list)"
                  value={ep.key}
                  onChange={(e) => updateEndpoint(setForm, form, idx, { key: e.target.value })}
                />
                <select
                  className="input text-sm"
                  value={ep.method}
                  onChange={(e) => updateEndpoint(setForm, form, idx, { method: e.target.value })}
                >
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input
                  className="input text-sm font-mono"
                  placeholder="/path/goes/here"
                  value={ep.path}
                  onChange={(e) => updateEndpoint(setForm, form, idx, { path: e.target.value })}
                />
                <button
                  type="button"
                  className="btn-ghost text-red-600"
                  onClick={() => setForm({ ...form, endpoints: form.endpoints.filter((_, i) => i !== idx) })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="text-xs text-ink-500 mt-2">
            The endpoint with key <span className="font-mono">list</span> is used for sync runs.
          </div>
        </section>

        {/* Field mapping */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Field mapping (source → internal)</div>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setForm({ ...form, fieldMapping: [...form.fieldMapping, { from: '', to: '' }] })}
            >
              <Plus className="h-3.5 w-3.5" /> Add mapping
            </button>
          </div>
          <div className="space-y-2">
            {form.fieldMapping.map((m, idx) => (
              <div key={idx} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] gap-2 items-center">
                <input
                  className="input text-sm font-mono"
                  placeholder="source_field"
                  value={m.from}
                  onChange={(e) => updateMapping(setForm, form, idx, { from: e.target.value })}
                />
                <span className="text-ink-400">→</span>
                <input
                  className="input text-sm font-mono"
                  placeholder="internal_field"
                  value={m.to}
                  onChange={(e) => updateMapping(setForm, form, idx, { to: e.target.value })}
                />
                <button
                  type="button"
                  className="btn-ghost text-red-600"
                  onClick={() => setForm({ ...form, fieldMapping: form.fieldMapping.filter((_, i) => i !== idx) })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function updateEndpoint(setForm, form, idx, patch) {
  setForm({ ...form, endpoints: form.endpoints.map((e, i) => (i === idx ? { ...e, ...patch } : e)) });
}
function updateMapping(setForm, form, idx, patch) {
  setForm({ ...form, fieldMapping: form.fieldMapping.map((m, i) => (i === idx ? { ...m, ...patch } : m)) });
}

function Labeled({ label, children }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function normaliseFromServer(v) {
  const defaults = {
    name: '',
    slug: '',
    description: '',
    module: 'inventory',
    baseUrl: '',
    syncIntervalMinutes: 15,
    responseItemsPath: 'items',
    active: true,
    auth: { type: 'none', apiKeyHeader: 'X-API-Key', bearerToken: '', apiKey: '', username: '', password: '' },
    endpoints: [{ key: 'list', path: '/items', method: 'GET' }],
    fieldMapping: [],
  };
  if (!v) return defaults;
  return {
    ...defaults,
    ...v,
    auth: {
      ...defaults.auth,
      ...(v.auth || {}),
      // Clear plaintext secret fields — we never receive them from server
      bearerToken: '',
      apiKey: '',
      password: '',
    },
    endpoints: (v.endpoints || defaults.endpoints).map((e) => ({
      key: e.key,
      path: e.path,
      method: e.method || 'GET',
    })),
    fieldMapping: Object.entries(v.fieldMapping || {}).map(([from, to]) => ({ from, to })),
  };
}

function buildPayload(form) {
  const payload = {
    name: form.name,
    slug: form.slug,
    description: form.description || undefined,
    module: form.module,
    baseUrl: form.baseUrl,
    syncIntervalMinutes: Number(form.syncIntervalMinutes) || 15,
    responseItemsPath: form.responseItemsPath || 'items',
    active: !!form.active,
    auth: {
      type: form.auth.type,
      apiKeyHeader: form.auth.apiKeyHeader,
      username: form.auth.username || undefined,
    },
    endpoints: form.endpoints.filter((e) => e.key && e.path),
    fieldMapping: Object.fromEntries(form.fieldMapping.filter((m) => m.from && m.to).map((m) => [m.from, m.to])),
  };
  // Only send plaintext secrets if user entered them
  if (form.auth.bearerToken) payload.auth.bearerToken = form.auth.bearerToken;
  if (form.auth.apiKey) payload.auth.apiKey = form.auth.apiKey;
  if (form.auth.password) payload.auth.password = form.auth.password;
  return payload;
}
