/**
 * Machines page — live machine status across all production stages.
 *
 * Card layout is information-rich and stage-aware, following the
 * Image 1 reference: big primary metric + secondary metrics grid +
 * progress bar + assignment block + action footer.
 *
 * Each machine card adapts its primary/secondary metrics to its
 * production stage. For example, a printing line surfaces print
 * speed and ink consumption; a laminator surfaces temperature and
 * adhesive flow; inspection surfaces pass rate. Metrics come from
 * the machine's `currentStatus.live` IoT payload — anything we
 * don't have a value for renders as `—` rather than disappearing,
 * so the layout stays stable as data fills in.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  Activity, Gauge, Thermometer, Clock, TrendingUp, Droplet,
  Settings, RefreshCw, Search, BarChart3, CheckCircle,
  Factory, AlertCircle,
} from 'lucide-react';
import { machineApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';

/* ────────────────────────────────────────────────────────────────
 * Stage metadata — primary metric, secondary tiles, accent colour.
 * Keep this configurable so adding a new stage is one entry, not a
 * rewrite of MachineCard.
 * ──────────────────────────────────────────────────────────────── */
const STAGE_CONFIG = {
  printing: {
    label: 'Printing',
    accent: '#1a6bff',
    primary: { key: 'speed', unit: 'm/min', label: 'Speed', icon: Gauge },
    secondary: [
      { key: 'inkLevel',     unit: '%',     label: 'Ink Level',   icon: Droplet,    color: '#1a6bff' },
      { key: 'tension',      unit: 'N',     label: 'Web Tension', icon: TrendingUp, color: '#7c3aed' },
    ],
  },
  inspection: {
    label: 'Inspection',
    accent: '#7c3aed',
    primary: { key: 'passRate', unit: '%', label: 'Pass Rate', icon: Activity },
    secondary: [
      { key: 'defectRate',  unit: '%',   label: 'Defect Rate', icon: AlertCircle, color: '#ef4444' },
      { key: 'inspected',   unit: 'pcs', label: 'Inspected',   icon: TrendingUp,  color: '#059669' },
    ],
  },
  lamination: {
    label: 'Lamination',
    accent: '#ea580c',
    primary: { key: 'speed', unit: 'm/min', label: 'Speed', icon: Gauge },
    secondary: [
      { key: 'temperature', unit: '°C',   label: 'Temperature',  icon: Thermometer, color: '#ef4444' },
      { key: 'adhesiveFlow', unit: 'g/m', label: 'Adhesive Flow', icon: Droplet,    color: '#1a6bff' },
    ],
  },
  hot_room: {
    label: 'Hot Room',
    accent: '#ef4444',
    primary: { key: 'temperature', unit: '°C', label: 'Temperature', icon: Thermometer },
    secondary: [
      { key: 'humidity', unit: '%',   label: 'Humidity', icon: Droplet, color: '#1a6bff' },
      { key: 'duration', unit: 'h',   label: 'Duration', icon: Clock,   color: '#7c3aed' },
    ],
  },
  slitting: {
    label: 'Slitting',
    accent: '#059669',
    primary: { key: 'speed', unit: 'm/min', label: 'Speed', icon: Gauge },
    secondary: [
      { key: 'bladeTemp',  unit: '°C', label: 'Blade Temp',   icon: Thermometer, color: '#ef4444' },
      { key: 'edgeQuality', unit: '%', label: 'Edge Quality', icon: Activity,    color: '#059669' },
    ],
  },
  cutting: {
    label: 'Cutting',
    accent: '#ec4899',
    primary: { key: 'speed', unit: 'cuts/min', label: 'Speed', icon: Gauge },
    secondary: [
      { key: 'bladeWear',  unit: '%',   label: 'Blade Wear', icon: AlertCircle, color: '#ef4444' },
      { key: 'accuracy',   unit: '%',   label: 'Accuracy',   icon: Activity,    color: '#059669' },
    ],
  },
  packaging: {
    label: 'Packaging',
    accent: '#0891b2',
    primary: { key: 'speed', unit: 'pcs/min', label: 'Speed', icon: Gauge },
    secondary: [
      { key: 'sealQuality', unit: '%', label: 'Seal Quality', icon: Activity,   color: '#059669' },
      { key: 'sealTemp',    unit: '°C', label: 'Seal Temp',   icon: Thermometer, color: '#ef4444' },
    ],
  },
};

const DEFAULT_STAGE = {
  label: '—',
  accent: '#64748b',
  primary: { key: 'output', unit: '/h', label: 'Output', icon: Gauge },
  secondary: [
    { key: 'efficiency', unit: '%',  label: 'Efficiency', icon: TrendingUp, color: '#059669' },
    { key: 'downtime',   unit: 'min', label: 'Downtime',  icon: Clock,      color: '#ef4444' },
  ],
};

/* ────────────────────────────────────────────────────────────────
 * State badge — running / idle / down / offline / maintenance
 * ──────────────────────────────────────────────────────────────── */
const STATE_META = {
  running:     { label: 'Running',          dot: 'bg-state-running',   cls: 'bg-state-running/10 text-state-running   border-state-running/30',   pulse: true },
  idle:        { label: 'Idle',             dot: 'bg-state-idle',      cls: 'bg-state-idle/10    text-state-idle      border-state-idle/30' },
  down:        { label: 'Machine Down',     dot: 'bg-state-down',      cls: 'bg-state-down/10    text-state-down      border-state-down/30',      pulse: true },
  maintenance: { label: 'Maintenance',      dot: 'bg-brand-500',       cls: 'bg-brand-500/10     text-brand-700       border-brand-500/30' },
  offline:     { label: 'Machine Disconnected', dot: 'bg-ink-400',     cls: 'bg-ink-100          text-ink-600         border-ink-200' },
};

export function MachinesPage() {
  const user = authStore((s) => s.user);
  const [filters, setFilters] = useState({ q: '', stage: '', status: '' });

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['machines', 'live', user?.plantId],
    queryFn: async () => (await machineApi.live(user?.plantId)).data,
    refetchInterval: 5_000,           // 5s polling — image showed "Live 3s"
  });

  // Note: We rely on React Query's 5-second refetchInterval for live
  // updates instead of a Socket.IO subscription. Polling is simpler and
  // works without Redis on the backend; the latency cost (worst case
  // 5 seconds) is acceptable for this dashboard. If you want sub-second
  // updates later, wire up `useSocket('/ops', ...)` to patch the cache
  // via qc.setQueryData() on 'machine:status' events.

  const machines = data || [];

  const filtered = machines.filter((m) => {
    if (filters.stage && m.stage !== filters.stage) return false;
    if (filters.status && m.currentStatus?.state !== filters.status) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!`${m.code} ${m.name}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Counts by state for the filter pills
  const counts = machines.reduce((acc, m) => {
    const s = m.currentStatus?.state || 'offline';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[20px] font-bold text-ink-900">Machines</h1>
          <div className="text-[11.5px] text-ink-500 mt-0.5 flex items-center gap-2">
            Showing <strong className="text-ink-700">{filtered.length}</strong> machine{filtered.length !== 1 ? 's' : ''}
            <span className="inline-flex items-center gap-1 text-state-running font-semibold">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-state-running animate-pulse" />
              Live 5s
            </span>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-secondary"
          title="Force refresh"
        >
          <RefreshCw className={clsx('h-4 w-4', isFetching && 'animate-spin')} /> Refresh
        </button>
      </div>

      {/* Filter bar */}
      <div className="card p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <input
            placeholder="Search by code or name…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            className="input pl-9 py-1.5 text-[13px]"
          />
        </div>

        <select
          value={filters.stage}
          onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
          className="input py-1.5 text-[13px] w-auto"
        >
          <option value="">All stages</option>
          {Object.entries(STAGE_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {/* Status filter as pills */}
        <div className="flex items-center gap-1 flex-wrap">
          {['running', 'idle', 'down', 'maintenance', 'offline'].map((s) => {
            const c = counts[s] || 0;
            const meta = STATE_META[s];
            const active = filters.status === s;
            return (
              <button
                key={s}
                onClick={() => setFilters({ ...filters, status: active ? '' : s })}
                className={clsx(
                  'px-2.5 py-1 rounded-md text-[10.5px] font-bold border transition',
                  active ? meta.cls + ' ring-2 ring-offset-1 ring-current/30' :
                  c > 0 ? meta.cls + ' opacity-80 hover:opacity-100' :
                  'bg-ink-50 text-ink-400 border-ink-200'
                )}
              >
                <span className={clsx('inline-block h-1.5 w-1.5 rounded-full mr-1', meta.dot)} />
                {meta.label} {c > 0 && `· ${c}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid of cards */}
      {isLoading ? (
        <div className="card p-10 text-center text-[13px] text-ink-400">Loading machines…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <Factory className="h-10 w-10 mx-auto text-ink-300 mb-2" />
          <div className="font-bold text-[14px] text-ink-900">No machines match your filters</div>
          <div className="text-[11.5px] text-ink-500 mt-1">Try clearing search or status filters.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((m) => (
            <MachineCard key={m._id} machine={m} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
 * MachineCard
 *
 * Layout (top to bottom):
 *   1. Header: code + name + state badge
 *   2. Primary metric (BIG number with unit) + speed/output
 *   3. 2-up secondary metric tiles
 *   4. Production progress bar (current / target with %)
 *   5. Assignment block: job, operator
 *   6. Footer: Details / History links
 * ══════════════════════════════════════════════════════════════ */
function MachineCard({ machine }) {
  const navigate = useNavigate();
  const cfg = STAGE_CONFIG[machine.stage] || DEFAULT_STAGE;
  const status = machine.currentStatus || {};
  const stateMeta = STATE_META[status.state] || STATE_META.offline;

  // Unwrap the live payload. Newer POSTs put params at top level of
  // `live`; older records have them nested under `live.data`. Handle both
  // so historic data renders gracefully without a re-POST.
  const live = unwrapLive(status.live);

  // Pick up to 6 scalar parameters to render as tiles. The choice is
  // fully data-driven — no hardcoded slots tied to machine stage — so a
  // pouching machine reporting drawMm/sealTime/counter and a printer
  // reporting speed/inkLevel/tension both render correctly without any
  // per-machine configuration.
  const displayKeys = pickDisplayKeys(live, 6);

  // Best-effort production counter detection for the footer progress bar.
  const targetPerHour = machine.targetOutputPerHour || 0;
  const productionKey = findProductionKey(live);
  const currentOutput = productionKey ? Number(live[productionKey]) || 0 : 0;
  const progressPct = targetPerHour > 0
    ? Math.min(100, Math.round((currentOutput / targetPerHour) * 100))
    : 0;
  const progressColor = progressPct >= 80 ? '#059669' : progressPct >= 50 ? '#1a6bff' : '#ea580c';

  // Today's running/idle/down totals — come from backend dailyStats merge.
  const daily = machine.dailyStats || { running: 0, idle: 0, down: 0 };
  const downtimeTodaySec = (daily.idle || 0) + (daily.down || 0);

  // Batch count — derived from counter ÷ bagsPerBatch when both present.
  // Same heuristic for any unit terminology (counter, output, production)
  // and any "batch size" terminology (bagsPerBatch, unitsPerBatch, etc.)
  const counterVal = live.counter ?? live.outputCount ?? live.production ?? null;
  const batchSize = live.bagsPerBatch ?? live.unitsPerBatch ?? null;
  const batchesCompleted = (typeof counterVal === 'number' && typeof batchSize === 'number' && batchSize > 0)
    ? Math.floor(counterVal / batchSize)
    : null;

  const lastSeen = status.lastSeenAt ? timeAgo(new Date(status.lastSeenAt)) : null;

  return (
    <div
      onClick={() => navigate(`/machines/${machine._id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/machines/${machine._id}`); } }}
      className={clsx(
        'card overflow-hidden transition hover:-translate-y-px hover:shadow-cardHov cursor-pointer',
        status.state === 'down' && 'ring-2 ring-state-down/40',
      )}
      style={{ borderTop: `3px solid ${cfg.accent}` }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10.5px] text-ink-400 font-bold tracking-wider">{machine.code}</div>
          <div className="font-bold text-[15px] text-ink-900 leading-tight truncate">{machine.name}</div>
          <div className="text-[11px] text-ink-500 mt-0.5 capitalize">{cfg.label}{status.currentStage ? ` · ${status.currentStage}` : ''}</div>
        </div>
        <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10.5px] font-bold whitespace-nowrap', stateMeta.cls)}>
          <span className={clsx('h-1.5 w-1.5 rounded-full', stateMeta.dot, stateMeta.pulse && 'animate-pulse')} />
          {stateMeta.label}
        </span>
      </div>

      {/* Dynamic metric tiles — first 2 are "big" (primary), next 4 are smaller */}
      {displayKeys.length === 0 ? (
        <div className="px-4 pb-3 text-center text-[11.5px] text-ink-400 italic py-6">
          No parameters received yet
        </div>
      ) : (
        <>
          {/* Top row: first 2 keys as big tiles */}
          <div className="px-4 grid grid-cols-2 gap-2 pb-3">
            {displayKeys.slice(0, 2).map((k, i) => (
              <MetricBlock
                key={k}
                icon={i === 0 ? (cfg.primary.icon || Gauge) : Gauge}
                label={formatKey(k)}
                value={live[k]}
                unit={guessUnit(k)}
                color={i === 0 ? cfg.accent : '#7c3aed'}
                big
              />
            ))}
            {/* Fill empty slot if only 1 key present */}
            {displayKeys.length === 1 && (
              <div className="rounded-lg bg-ink-50/40 border border-dashed border-ink-200" />
            )}
          </div>

          {/* Bottom 2x2: keys 3-6 as small tiles */}
          {displayKeys.length > 2 && (
            <div className="px-4 grid grid-cols-2 gap-2 pb-3">
              {displayKeys.slice(2, 6).map((k) => (
                <MetricBlock
                  key={k}
                  icon={iconForKey(k)}
                  label={formatKey(k)}
                  value={live[k]}
                  unit={guessUnit(k)}
                  color={colorForKey(k)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Production progress bar — only shown if device reports a counter AND admin set a target */}
      {productionKey && targetPerHour > 0 && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10.5px] text-ink-500 font-semibold">
              Production: <span className="text-ink-900 font-bold tabular-nums">{formatNumber(currentOutput)}</span>
            </div>
            <div className="text-[10.5px] text-ink-500 font-semibold">
              Target: <span className="text-ink-700 font-bold tabular-nums">{formatNumber(targetPerHour)}/h</span>
          </div>
        </div>
        <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
          <div
            className="h-full transition-all"
            style={{ width: `${progressPct}%`, background: progressColor }}
          />
        </div>
        <div className="text-right text-[10px] font-bold mt-0.5" style={{ color: progressColor }}>
          {progressPct}%
        </div>
      </div>
      )}

      {/* Today's state totals — Running / Idle / Down — always visible,
          even when device hasn't POSTed metrics. Powered by MachineStatus
          intervals on the backend. */}
      <div className="px-4 pb-3 grid grid-cols-3 gap-2">
        <DailyTile label="Running" seconds={daily.running || 0} color="#059669" />
        <DailyTile label="Idle" seconds={daily.idle || 0} color="#d97706" />
        <DailyTile label="Down" seconds={daily.down || 0} color="#dc2626" />
      </div>

      {/* Batch count — only shown if device reports both a counter and
          batchSize so we can derive completed batches. */}
      {batchesCompleted !== null && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-between">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-brand-700">
            Batches Completed
          </div>
          <div className="text-[14px] font-bold text-brand-700 tabular-nums">
            {formatNumber(batchesCompleted)}
            <span className="text-[10.5px] font-normal text-brand-500 ml-1">
              × {batchSize}
            </span>
          </div>
        </div>
      )}

      {/* Assignment block */}
      <div className="px-4 pb-3 border-t border-ink-100 pt-3 space-y-1 text-[11.5px]">
        {status.currentJobNumber ? (
          <>
            <div className="text-ink-600">
              <span className="text-ink-400">Job:</span>{' '}
              <span className="font-mono font-bold text-brand-600">{status.currentJobNumber}</span>
              {status.currentOrderNumber && (
                <>
                  {' · '}
                  <span className="text-ink-400">Order:</span>{' '}
                  <span className="font-mono font-bold text-ink-900">{status.currentOrderNumber}</span>
                </>
              )}
            </div>
            {status.currentProduct && (
              <div className="text-ink-600">
                <span className="text-ink-400">Product:</span>{' '}
                <span className="font-semibold text-ink-900">{status.currentProduct}</span>
              </div>
            )}
          </>
        ) : (
          <div className="text-ink-400 italic text-[11px]">No active job assigned</div>
        )}
        {status.operatorName && (
          <div className="text-ink-600">
            <span className="text-ink-400">Operator:</span>{' '}
            <span className="font-semibold text-ink-900">{status.operatorName}</span>
          </div>
        )}
        {status.supervisorName && (
          <div className="text-ink-600">
            <span className="text-ink-400">Supervisor:</span>{' '}
            <span className="font-semibold text-ink-900">{status.supervisorName}</span>
          </div>
        )}
        {lastSeen && (
          <div className="text-[10px] text-ink-400">
            Last seen {lastSeen}
          </div>
        )}
      </div>

      {/* Footer actions — deep-link into a detail-page tab. stopPropagation so the
          button's own tab target wins over the card's default "overview" click. */}
      <div className="border-t border-ink-100 grid grid-cols-3 divide-x divide-ink-100">
        <Link
          to={`/machines/${machine._id}?tab=overview`}
          onClick={(e) => e.stopPropagation()}
          className="px-3 py-2.5 text-center text-[12px] font-bold text-brand-600 hover:bg-brand-50 transition"
        >
          Details
        </Link>
        <Link
          to={`/machines/${machine._id}?tab=history`}
          onClick={(e) => e.stopPropagation()}
          className="px-3 py-2.5 text-center text-[12px] font-bold text-brand-600 hover:bg-brand-50 transition"
        >
          History
        </Link>
        <Link
          to={`/machines/${machine._id}?tab=configure`}
          onClick={(e) => e.stopPropagation()}
          className="px-3 py-2.5 text-center text-[12px] font-bold text-brand-600 hover:bg-brand-50 transition inline-flex items-center justify-center gap-1"
        >
          <Settings className="h-3 w-3" /> Configure
        </Link>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * Sub-components
 * ──────────────────────────────────────────────────────────────── */
function MetricBlock({ icon: Icon, label, value, unit, color, big = false }) {
  const display = value === null || value === undefined || value === '' || Number.isNaN(Number(value))
    ? '—'
    : formatNumber(value);

  return (
    <div className="rounded-md bg-ink-50/50 border border-ink-100 px-2.5 py-2">
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className="h-3 w-3" style={{ color }} />
        <span className="text-[9px] font-bold uppercase tracking-wider text-ink-500">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={clsx('font-bold tabular-nums', big ? 'text-[20px]' : 'text-[14px]')} style={{ color: display === '—' ? '#94a3b8' : '#0f172a' }}>
          {display}
        </span>
        {display !== '—' && unit && (
          <span className="text-[9.5px] text-ink-500 font-semibold">{unit}</span>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────── */

/** Look up a metric by key in `live` object, with a few common fallbacks. */
function pickMetric(live, key) {
  if (!live) return null;
  if (live[key] !== undefined && live[key] !== null) return live[key];
  // Common aliases — IoT payloads vary by vendor
  const aliases = {
    speed: ['linespeed', 'machineSpeed', 'rpm', 'setSpeed'],
    temperature: ['temp', 'machineTemp'],
    output: ['outputCount', 'production', 'count', 'counter'],
    efficiency: ['oee'],
  };
  for (const alt of (aliases[key] || [])) {
    if (live[alt] !== undefined && live[alt] !== null) return live[alt];
  }
  // Last-resort: check inside metrics sub-object if the controller returns one
  if (live.metrics && live.metrics[key] !== undefined) return live.metrics[key];
  return null;
}

/**
 * Unwrap the live payload. Newer IoT POSTs put params at the top level of
 * `live`; older records have them nested under `live.data`. We accept both
 * so historic rows render without anyone needing to re-POST or migrate.
 * If both shapes coexist on the same row, top-level keys win over nested.
 */
function unwrapLive(live) {
  if (!live || typeof live !== 'object') return {};
  if (live.data && typeof live.data === 'object' && !Array.isArray(live.data)) {
    return { ...live.data, ...Object.fromEntries(Object.entries(live).filter(([k]) => k !== 'data')) };
  }
  return live;
}

/**
 * Pick the keys to render as tiles on the card. Fully data-driven — no
 * hardcoded slot names — so any machine type (pouching, printing, slitting,
 * etc.) shows whatever its device actually reports.
 *
 * Strategy:
 *   1. Skip identity / network meta and nested objects.
 *   2. PROMOTE high-priority operational keys to the front, regardless of
 *      the order the IoT engineer used in the POST body. So if the device
 *      reports `bagsRemaining: 98`, it ALWAYS appears on the card — the
 *      operator shouldn't have to open the detail page just to see how
 *      many bags are left in the running batch.
 *   3. After priority keys, fill with remaining scalar keys in payload
 *      order — non-zero values first (more interesting), zeros last.
 *      Example: `attachmentTime: 0` gets pushed to the bottom while
 *      `drawMm: 118` shows up.
 *   4. Cap at maxKeys (6 by default — 2 big + 4 small tiles).
 *
 * Skipped:
 *   - state, status (rendered separately as the status pill)
 *   - plcIp, deviceId, connected (network meta)
 *   - Nested objects (coils, inputs) — they don't render well in a tile
 *   - null / undefined
 */
const SKIP_KEYS = new Set([
  'state', 'status', 'connected', 'plcIp', 'plcip', 'plc_ip',
  'deviceId', 'device_id', 'machineName', 'machine_name', 'machineCode',
  'timestamp', 'lastSeen', 'last_seen', 'updatedAt', 'receivedAt',
]);

/**
 * Keys that should ALWAYS appear on the card if the device reports them,
 * in this order. The first 2 keys to actually be present become the
 * big "primary" tiles; the rest become small tiles. Order reflects
 * what an operator standing at the machine wants to know at a glance:
 *   - How many bags / units are left in the current batch
 *   - Total production count
 *   - Speed / RPM (is it actually running fast?)
 *   - Temperature (critical for thermal processes)
 *   - Efficiency
 *   - Batch size (context for the remaining count)
 */
const HIGH_PRIORITY_KEYS = [
  'bagsRemaining', 'bags_remaining', 'remainingQty', 'remainingQuantity', 'remaining',
  'counter', 'outputCount', 'output_count', 'production', 'productionCount',
  'setSpeed', 'set_speed', 'speed', 'lineSpeed', 'machineSpeed', 'rpm',
  'temperature', 'temp',
  'efficiency', 'oee',
  'bagsPerBatch', 'bags_per_batch', 'unitsPerBatch',
];

function pickDisplayKeys(live, maxKeys = 6) {
  if (!live || typeof live !== 'object') return [];

  const eligible = (k) => {
    if (SKIP_KEYS.has(k)) return false;
    const v = live[k];
    if (v === null || v === undefined) return false;
    if (typeof v === 'object') return false; // skip nested objects + arrays
    return true;
  };

  // Pass 1 — priority keys, in priority order
  const picked = new Set();
  const result = [];
  for (const k of HIGH_PRIORITY_KEYS) {
    if (picked.has(k)) continue;
    if (k in live && eligible(k)) {
      result.push(k);
      picked.add(k);
      if (result.length >= maxKeys) return result;
    }
  }

  // Pass 2 — fill remaining slots with non-priority keys in payload order.
  // Non-zero values are more interesting than zeros, so push 0-valued
  // numeric keys to the very end (this is what makes attachmentTime: 0
  // give way to a more useful field).
  const remaining = Object.keys(live).filter((k) => !picked.has(k) && eligible(k));
  const nonZero = remaining.filter((k) => !(typeof live[k] === 'number' && live[k] === 0));
  const zero = remaining.filter((k) => typeof live[k] === 'number' && live[k] === 0);

  result.push(...nonZero, ...zero);
  return result.slice(0, maxKeys);
}

/**
 * Best-effort detection of a "production counter" key for the progress
 * bar at the bottom of the card. First match wins.
 */
const PRODUCTION_KEY_PRIORITIES = [
  'outputCount', 'output_count', 'production', 'productionCount',
  'counter', 'count', 'totalCount', 'cycleCount',
  'bagsProduced', 'unitsProduced',
];

function findProductionKey(live) {
  if (!live) return null;
  for (const k of PRODUCTION_KEY_PRIORITIES) {
    if (live[k] !== undefined && live[k] !== null && typeof live[k] !== 'object') {
      return k;
    }
  }
  return null;
}

/** camelCase / snake_case → Title Case With Spaces */
function formatKey(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

/** Seconds → compact human duration: "2h 14m" / "32m" / "45s" / "—" */
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const sec = Math.max(0, Math.floor(seconds));
  if (sec === 0) return '0';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Small tile for the per-machine card showing today's accumulated time
 * in a given state. Used 3-up under the metric grid: Running / Idle / Down.
 */
function DailyTile({ label, seconds, color }) {
  return (
    <div className="rounded-md border border-ink-100 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[9.5px] font-bold uppercase tracking-wider text-ink-500">
          {label}
        </span>
      </div>
      <div className="text-[12.5px] font-bold tabular-nums mt-0.5" style={{ color }}>
        {formatDuration(seconds)}
      </div>
    </div>
  );
}

/** Heuristic unit guesser based on key name — empty string if uncertain. */
function guessUnit(key) {
  const k = String(key).toLowerCase();
  if (k === 'inklevel' || k.endsWith('inklevel') || k === 'humidity') return '%';
  if (k.includes('percent') || k.endsWith('pct')) return '%';
  if (k.includes('efficiency') || k === 'oee') return '%';
  if (k.endsWith('temp') || k.includes('temperature')) return '°C';
  if (k.endsWith('time') && !k.includes('lifetime')) return 's';
  if (k.endsWith('mm') || k.includes('draw')) return 'mm';
  if (k.includes('speed') && !k.includes('level')) return 'm/min';
  if (k.includes('pressure')) return 'bar';
  if (k === 'voltage' || k.endsWith('voltage')) return 'V';
  if (k === 'current' || k.endsWith('current')) return 'A';
  if (k === 'rpm' || k.endsWith('rpm')) return 'rpm';
  if (k.includes('weight') || k.endsWith('kg')) return 'kg';
  if (k.includes('downtime') || k.endsWith('minutes')) return 'min';
  return '';
}

/** Pick an icon based on key name semantics. Falls back to Activity. */
function iconForKey(key) {
  const k = String(key).toLowerCase();
  if (k.includes('speed') || k === 'rpm') return Gauge;
  if (k.includes('temp')) return Thermometer;
  if (k.includes('time') || k.includes('duration')) return Clock;
  if (k.includes('count') || k.includes('production')) return BarChart3;
  if (k.includes('efficiency') || k === 'oee') return TrendingUp;
  if (k.includes('pressure') || k.includes('tension')) return Activity;
  if (k.includes('ink') || k.includes('level')) return Droplet;
  if (k.includes('quality')) return CheckCircle;
  return Activity;
}

/** Subtle accent colour per key category — cycle through a small palette. */
const KEY_COLORS = ['#1a6bff', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];
function colorForKey(key) {
  const k = String(key);
  let hash = 0;
  for (let i = 0; i < k.length; i++) hash = (hash * 31 + k.charCodeAt(i)) | 0;
  return KEY_COLORS[Math.abs(hash) % KEY_COLORS.length];
}

function formatNumber(n) {
  const num = Number(n);
  if (Number.isNaN(num)) return n;
  if (Math.abs(num) >= 1000) return num.toLocaleString('en-IN');
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(1);
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ════════════════════════════════════════════════════════════════════════
 * ApiKeyReveal
 *
 * Re-exported here for compatibility with MachineDetailPage.jsx, which
 * imports it from this module. Shows a machine's IoT ingestKeyId behind
 * a "Show key" reveal — used in the configure/settings tab of the detail
 * page so an admin can copy the key and hand it to the IoT engineer.
 *
 * The key is sensitive (write access to telemetry), so we keep it hidden
 * by default and require an explicit click. The browser's clipboard API
 * is used for one-click copy.
 * ══════════════════════════════════════════════════════════════════════ */
export function ApiKeyReveal({ value, label = 'IoT API Key' }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked in non-secure contexts — fall back to
      // selecting the text for manual copy.
    }
  };

  if (!value) {
    return (
      <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2 text-[12px] text-ink-500">
        No API key configured for this machine.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-ink-100 bg-white px-3 py-2.5 space-y-1.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-[12px] text-ink-900 truncate">
          {shown ? value : '•'.repeat(Math.min(24, value.length))}
        </code>
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          className="text-[10.5px] font-bold text-brand-600 hover:underline px-2"
        >
          {shown ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          onClick={copy}
          className="text-[10.5px] font-bold text-brand-600 hover:underline px-2"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="text-[10px] text-ink-400">
        Send this in the <code className="font-mono">X-Api-Key</code> header for IoT requests.
      </div>
    </div>
  );
}
