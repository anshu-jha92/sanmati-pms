/**
 * Machine detail page — tabbed.
 *
 * A persistent header (identity + live state + duration) sits above a tab bar:
 *   • Overview   — live parameters, today's running/idle/down totals, batches
 *   • Downtime   — real stop/idle analysis derived from MachineStatus intervals
 *   • History    — full IoT audit log, paginated 10 rows per page
 *   • Configure  — assign job / operator / supervisor to the machine
 *
 * The active tab is driven by the `?tab=` query param so the Machines-page card
 * can deep-link straight into any section. All daily totals are computed from
 * the last-24h status intervals (the backend does not send dailyStats).
 *
 * Hook-order note: every hook is declared before any early return.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
} from '@tanstack/react-table';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeft, Activity, Clock, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown,
  Zap, Power, Wrench, WifiOff, RefreshCw, BarChart3,
  LayoutGrid, TrendingDown, History as HistoryIcon, Settings, AlertTriangle, Save, Eraser,
} from 'lucide-react';
import { machineApi } from '../api/endpoints.js';

/* ────────────────────────────────────────────────────────────────────────
 * Visual metadata for each state value
 * ────────────────────────────────────────────────────────────────────── */
const STATE_META = {
  running:     { label: 'Running',      color: '#059669', bg: '#ecfdf5', icon: Zap,     pulse: true  },
  idle:        { label: 'Idle',         color: '#d97706', bg: '#fffbeb', icon: Clock,   pulse: false },
  down:        { label: 'Down',         color: '#dc2626', bg: '#fef2f2', icon: Power,   pulse: true  },
  maintenance: { label: 'Maintenance',  color: '#7c3aed', bg: '#f5f3ff', icon: Wrench,  pulse: false },
  offline:     { label: 'Disconnected', color: '#64748b', bg: '#f1f5f9', icon: WifiOff, pulse: false },
};

const TABS = [
  { key: 'overview',  label: 'Overview',  icon: LayoutGrid },
  { key: 'downtime',  label: 'Downtime',  icon: TrendingDown },
  { key: 'history',   label: 'History',   icon: HistoryIcon },
  { key: 'configure', label: 'Configure', icon: Settings },
];

/* ────────────────────────────────────────────────────────────────────────
 * Format helpers
 * ────────────────────────────────────────────────────────────────────── */
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const sec = Math.max(0, Math.floor(seconds));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatNumber(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-IN');
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
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

/** Flat ({speed}) or nested ({data:{speed}}) payloads both render correctly. */
function unwrapPayload(obj) {
  if (!obj || typeof obj !== 'object') return {};
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    return { ...obj.data, ...Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'data')) };
  }
  return obj;
}

function normalizeRowState(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (['running', 'run', 'active', 'on', 'started', 'producing'].includes(s)) return 'running';
  if (['idle', 'pause', 'paused', 'ready', 'standby', 'waiting'].includes(s)) return 'idle';
  if (['stopped', 'stop', 'down', 'off', 'fault', 'error', 'failed', 'halt', 'halted'].includes(s)) return 'down';
  if (['maintenance', 'maint', 'service', 'servicing', 'repair'].includes(s)) return 'maintenance';
  if (['offline', 'disconnected', 'unknown'].includes(s)) return 'offline';
  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Small presentational pieces
 * ────────────────────────────────────────────────────────────────────── */
function StatTile({ label, value, sub, color }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-4">
      <div className="flex items-center gap-1.5 mb-1">
        {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-500">{label}</span>
      </div>
      <div className="text-[22px] font-bold tabular-nums leading-tight" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-ink-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function NestedObjectChips({ obj }) {
  if (!obj || typeof obj !== 'object') return <span className="text-ink-300 text-[12px]">—</span>;
  const entries = Object.entries(obj);
  if (entries.length === 0) return <span className="text-ink-300 text-[12px] italic">empty</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        typeof v === 'boolean' ? (
          <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono border"
            style={v ? { background: '#ecfdf5', borderColor: '#a7f3d0', color: '#059669' }
                     : { background: '#f4f6fb', borderColor: '#d8dde8', color: '#64748b' }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: v ? '#059669' : '#94a3b8' }} />
            <strong>{k}</strong>
          </span>
        ) : (
          <span key={k} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono bg-white border border-ink-200">
            <strong className="text-ink-700">{k}:</strong>
            <span className="text-ink-900">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
          </span>
        )
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * Component
 * ══════════════════════════════════════════════════════════════════════ */
export function MachineDetailPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const setTab = (key) => setSearchParams((prev) => { const p = new URLSearchParams(prev); p.set('tab', key); return p; }, { replace: true });

  const queryClient = useQueryClient();

  // Tick every second for the live "current state duration" counter.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // History filters + paging. Page size is user-selectable (default 10).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [fromDate, setFromDate] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [toDate, setToDate] = useState('');
  const [toTime, setToTime] = useState('');
  const [activeFilters, setActiveFilters] = useState({});

  // Configure form
  const [form, setForm] = useState({
    currentJobNumber: '', currentOrderNumber: '', currentProduct: '', operatorName: '', supervisorName: '',
  });
  const [configMsg, setConfigMsg] = useState('');

  const machine = useQuery({
    queryKey: ['machine', id],
    queryFn: async () => (await machineApi.get(id)).data,
    refetchInterval: 5_000,
    enabled: !!id,
  });

  const statusHistory = useQuery({
    queryKey: ['machine', id, 'status-history'],
    queryFn: async () => (await machineApi.statusHistory(id)).data,
    refetchInterval: 10_000,
    enabled: !!id,
  });

  const iotHistory = useQuery({
    queryKey: ['machine', id, 'iot-history', page, pageSize, activeFilters],
    queryFn: async () => {
      const params = { page, limit: pageSize };
      if (activeFilters.from) params.from = activeFilters.from;
      if (activeFilters.to) params.to = activeFilters.to;
      return await machineApi.iotHistory(id, params);
    },
    refetchInterval: activeTab === 'history' ? 15_000 : false,
    enabled: !!id,
    placeholderData: keepPreviousData,
  });

  // Seed the Configure form once, from the first machine payload we receive.
  useEffect(() => {
    const cs = machine.data?.currentStatus;
    if (!cs) return;
    setForm({
      currentJobNumber: cs.currentJobNumber || '',
      currentOrderNumber: cs.currentOrderNumber || '',
      currentProduct: cs.currentProduct || '',
      operatorName: cs.operatorName || '',
      supervisorName: cs.supervisorName || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.data?._id]);

  const saveAssignment = useMutation({
    mutationFn: (payload) => machineApi.updateAssignment(id, payload),
    onSuccess: () => {
      setConfigMsg('Saved ✓');
      queryClient.invalidateQueries({ queryKey: ['machine', id] });
      queryClient.invalidateQueries({ queryKey: ['machines', 'live'] });
      setTimeout(() => setConfigMsg(''), 2500);
    },
    onError: (err) => setConfigMsg(err?.message || 'Save failed'),
  });

  /* ───── EARLY RETURNS AFTER ALL HOOKS ───── */
  if (machine.isLoading) {
    return <div className="text-center py-10 text-ink-400 text-[13px]">Loading…</div>;
  }
  if (!machine.data) {
    return (
      <div className="text-center py-10">
        <div className="text-state-down text-[14px] font-semibold mb-2">Machine not found.</div>
        <Link to="/machines" className="text-brand-500 text-[12.5px] hover:underline">← Back to all machines</Link>
      </div>
    );
  }

  /* ───── DERIVE DISPLAY DATA ───── */
  const m = machine.data;
  const status = m.currentStatus || {};
  const live = unwrapPayload(status.live);
  const state = status.state || 'offline';
  const stateMeta = STATE_META[state] || STATE_META.offline;
  const StateIcon = stateMeta.icon;

  const stateSinceMs = status.currentStateSince ? new Date(status.currentStateSince).getTime() : null;
  const stateDurationSec = stateSinceMs ? Math.floor((nowTick - stateSinceMs) / 1000) : null;
  const durationLabel =
    state === 'down' ? 'Downtime' : state === 'idle' ? 'Idle Time' :
    state === 'maintenance' ? 'In Maintenance' : state === 'offline' ? 'Disconnected For' : 'Running For';

  // Live parameter buckets
  const SKIP = new Set(['state', 'status']);
  const NETWORK_META = new Set(['plcIp', 'plcip', 'plc_ip', 'connected', 'deviceId', 'machineName']);
  const scalarKeys = [], objectKeys = [], metaKeys = [];
  for (const k of Object.keys(live)) {
    if (SKIP.has(k)) continue;
    const v = live[k];
    if (v === null || v === undefined) continue;
    if (NETWORK_META.has(k)) { metaKeys.push(k); continue; }
    if (typeof v === 'object' && !Array.isArray(v)) { objectKeys.push(k); continue; }
    scalarKeys.push(k);
  }

  const counterVal = live.counter ?? live.outputCount ?? live.production ?? null;
  const batchSize = live.bagsPerBatch ?? live.unitsPerBatch ?? null;
  const batchesCompleted = (typeof counterVal === 'number' && typeof batchSize === 'number' && batchSize > 0)
    ? Math.floor(counterVal / batchSize) : null;

  // State intervals → real duration totals + downtime analysis (last 24h).
  const intervals = statusHistory.data || [];
  const durOf = (iv) => (iv.endAt ? (iv.durationSec || 0) : Math.max(0, Math.floor((nowTick - new Date(iv.startAt).getTime()) / 1000)));
  const totals = { running: 0, idle: 0, down: 0, maintenance: 0, offline: 0 };
  for (const iv of intervals) totals[iv.state] = (totals[iv.state] || 0) + durOf(iv);

  // "…Today" tiles: only count the part of each interval that falls in TODAY
  // (local midnight → now), so a job running since yesterday shows today's time.
  const startOfTodayMs = new Date(nowTick).setHours(0, 0, 0, 0);
  const durTodayOf = (iv) => {
    const s = Math.max(new Date(iv.startAt).getTime(), startOfTodayMs);
    const e = Math.min(iv.endAt ? new Date(iv.endAt).getTime() : nowTick, nowTick);
    return Math.max(0, Math.floor((e - s) / 1000));
  };
  const todayTotals = { running: 0, idle: 0, down: 0, maintenance: 0, offline: 0 };
  for (const iv of intervals) todayTotals[iv.state] = (todayTotals[iv.state] || 0) + durTodayOf(iv);

  const downStates = new Set(['down', 'idle', 'maintenance', 'offline']);
  const downtimeIntervals = intervals.filter((iv) => downStates.has(iv.state));
  const totalDowntimeSec = totals.down + totals.maintenance;
  const stopCount = intervals.filter((iv) => iv.state === 'down').length;
  const longestStopSec = downtimeIntervals.reduce((mx, iv) => Math.max(mx, durOf(iv)), 0);
  const productiveSec = totals.running;
  const trackedSec = Object.values(totals).reduce((a, b) => a + b, 0);
  const availabilityPct = trackedSec > 0 ? Math.round((productiveSec / trackedSec) * 100) : 0;

  // IoT history
  const historyResponse = iotHistory.data || {};
  const historyItems = Array.isArray(historyResponse.data) ? historyResponse.data : [];
  const historyMeta = historyResponse.meta || { page: 1, pages: 1, total: 0 };
  const historyKeySet = new Set();
  for (const row of historyItems) {
    const payload = unwrapPayload(row.data);
    for (const k of Object.keys(payload)) {
      if (k === 'state' || k === 'status') continue;
      const v = payload[k];
      if (v === null || v === undefined || typeof v === 'object') continue;
      historyKeySet.add(k);
    }
  }
  const historyKeys = Array.from(historyKeySet).slice(0, 8);

  /* ───── HANDLERS ───── */
  const applyFilters = () => {
    const f = {};
    // Combine the chosen date with the chosen time (blank time → whole-day bounds).
    if (fromDate) f.from = new Date(`${fromDate}T${fromTime || '00:00'}:00`).toISOString();
    if (toDate) f.to = new Date(`${toDate}T${toTime || '23:59'}:59`).toISOString();
    setActiveFilters(f);
    setPage(1);
  };
  const clearFilters = () => {
    setFromDate(''); setFromTime(''); setToDate(''); setToTime('');
    setActiveFilters({}); setPage(1);
  };
  const submitConfig = (e) => {
    e?.preventDefault?.();
    setConfigMsg('');
    saveAssignment.mutate(form);
  };
  const clearConfig = () => {
    const blank = { currentJobNumber: '', currentOrderNumber: '', currentProduct: '', operatorName: '', supervisorName: '' };
    setForm(blank);
    saveAssignment.mutate(blank);
  };

  /* ───── RENDER ───── */
  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[11.5px] text-ink-400">
        <Link to="/machines" className="hover:text-ink-700 flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> All machines
        </Link>
      </div>

      {/* ════════════════ Persistent header ════════════════ */}
      <div className="card p-5 flex items-start justify-between gap-4 flex-wrap" style={{ borderTop: `4px solid ${stateMeta.color}` }}>
        <div className="flex-1 min-w-[200px]">
          <div className="font-mono text-[11px] text-ink-400 uppercase tracking-wider">{m.code}</div>
          <h1 className="text-[22px] font-bold text-ink-900 leading-tight">{m.name}</h1>
          <div className="text-[12px] text-ink-500 mt-1 flex items-center gap-2 flex-wrap">
            <span className="capitalize font-semibold">{m.stage}</span>
            <span className="text-ink-300">·</span>
            <span>target {(m.targetOutputPerHour || 0).toLocaleString()}/h</span>
            {status.deviceId && (<><span className="text-ink-300">·</span>
              <span>device <code className="font-mono text-[11px] bg-ink-50 px-1.5 py-0.5 rounded">{status.deviceId}</code></span></>)}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[10px] text-ink-400 uppercase tracking-wider font-bold">Current State</div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border font-bold text-[13px] mt-1"
              style={{ background: stateMeta.bg, borderColor: stateMeta.color + '40', color: stateMeta.color }}>
              <StateIcon className={clsx('h-4 w-4', stateMeta.pulse && 'animate-pulse')} />
              {stateMeta.label}
            </div>
          </div>
          {stateDurationSec !== null && (
            <div className="text-right border-l border-ink-200 pl-4">
              <div className="text-[10px] text-ink-400 uppercase tracking-wider font-bold">{durationLabel}</div>
              <div className="text-[20px] font-bold text-ink-900 tabular-nums mt-0.5">{formatDuration(stateDurationSec)}</div>
            </div>
          )}
        </div>
      </div>

      {/* ════════════════ Tab bar ════════════════ */}
      <div className="flex items-center gap-1 border-b border-ink-200">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={clsx(
                'inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors',
                on ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-500 hover:text-ink-800 hover:border-ink-300'
              )}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ════════════════ OVERVIEW ════════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Running Today" value={formatDuration(todayTotals.running)} sub="since 12:00 AM" color="#059669" />
            <StatTile label="Idle Today" value={formatDuration(todayTotals.idle)} color="#d97706" />
            <StatTile label="Down Today" value={formatDuration(todayTotals.down)} color="#dc2626" />
            <StatTile label="Availability" value={`${availabilityPct}%`} sub="running ÷ tracked (24h)" color="#1a6bff" />
          </div>

          {batchesCompleted !== null && (
            <div className="card p-4 flex items-center justify-between">
              <div>
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-500">Batches Completed</div>
                <div className="text-[26px] font-bold text-brand-600 tabular-nums leading-tight">
                  {batchesCompleted.toLocaleString('en-IN')}
                  <span className="text-[14px] font-semibold text-ink-400 ml-2">× {batchSize} per batch</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-500">Total Count</div>
                <div className="text-[18px] font-bold text-ink-900 tabular-nums">{(counterVal || 0).toLocaleString('en-IN')}</div>
              </div>
            </div>
          )}

          <div className="card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-bold text-[15px] text-ink-900 flex items-center gap-2">
                <Activity className="h-4 w-4 text-brand-500" /> Live Parameters
                <span className="text-[10px] font-semibold text-ink-400 bg-ink-50 border border-ink-200 px-2 py-0.5 rounded">
                  {scalarKeys.length + objectKeys.length + metaKeys.length} field{(scalarKeys.length + objectKeys.length + metaKeys.length) === 1 ? '' : 's'}
                </span>
              </h2>
              <div className="text-[11px] text-ink-400">
                {status.lastSeenAt ? `Last update ${new Date(status.lastSeenAt).toLocaleString()}` : 'No data received yet'}
              </div>
            </div>

            {(scalarKeys.length + objectKeys.length + metaKeys.length) === 0 ? (
              <div className="text-center py-8 text-[12.5px] text-ink-400 bg-ink-50/50 rounded-lg border border-dashed border-ink-200">
                No live parameters yet. As the device POSTs telemetry, values appear here.
              </div>
            ) : (
              <>
                {scalarKeys.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
                    {scalarKeys.map((k) => (
                      <div key={k} className="rounded-lg bg-ink-50/50 border border-ink-100 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500 mb-1">{formatKey(k)}</div>
                        <div className="text-[18px] font-bold text-ink-900 tabular-nums">{formatNumber(live[k])}</div>
                      </div>
                    ))}
                  </div>
                )}
                {objectKeys.map((k) => (
                  <div key={k} className="mb-4 rounded-lg bg-ink-50/50 border border-ink-100 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500 mb-2">{formatKey(k)}</div>
                    <NestedObjectChips obj={live[k]} />
                  </div>
                ))}
                {metaKeys.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {metaKeys.map((k) => (
                      <div key={k} className="rounded-lg bg-ink-50/30 border border-ink-100 p-2.5">
                        <div className="text-[9.5px] font-bold uppercase tracking-wider text-ink-400 mb-0.5">{formatKey(k)}</div>
                        <div className="text-[12px] font-mono text-ink-700">
                          {typeof live[k] === 'boolean' ? (live[k] ? 'Yes' : 'No') : String(live[k])}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ════════════════ DOWNTIME ════════════════ */}
      {activeTab === 'downtime' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Total Downtime" value={formatDuration(totalDowntimeSec)} sub="down + maintenance (24h)" color="#dc2626" />
            <StatTile label="Idle Time" value={formatDuration(totals.idle)} sub="24h" color="#d97706" />
            <StatTile label="Stops" value={stopCount} sub="down events (24h)" color="#7c3aed" />
            <StatTile label="Longest Stop" value={formatDuration(longestStopSec)} sub="24h" color="#0f172a" />
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-bold text-[15px] text-ink-900 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-state-down" /> Downtime & Idle Log
                <span className="text-[11px] font-normal text-ink-400">(last 24h)</span>
              </h2>
              <span className="text-[10.5px] text-ink-400 bg-ink-50 border border-ink-200 px-2 py-0.5 rounded">
                {downtimeIntervals.length} event{downtimeIntervals.length === 1 ? '' : 's'}
              </span>
            </div>

            {statusHistory.isLoading ? (
              <div className="text-center py-6 text-[12.5px] text-ink-400">Loading…</div>
            ) : downtimeIntervals.length === 0 ? (
              <div className="text-center py-8 text-[12.5px] text-emerald-600 bg-emerald-50/50 rounded-lg border border-dashed border-emerald-200">
                ✓ No downtime or idle time in the last 24 hours. Machine has been productive.
              </div>
            ) : (
              <div className="overflow-x-auto border border-ink-100 rounded-lg">
                <table className="w-full">
                  <thead className="bg-ink-50">
                    <tr>
                      <th className="text-left p-2.5 text-[10px] font-bold uppercase text-ink-500 tracking-wider">Reason</th>
                      <th className="text-left p-2.5 text-[10px] font-bold uppercase text-ink-500 tracking-wider">From</th>
                      <th className="text-left p-2.5 text-[10px] font-bold uppercase text-ink-500 tracking-wider">To</th>
                      <th className="text-right p-2.5 text-[10px] font-bold uppercase text-ink-500 tracking-wider">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {downtimeIntervals.map((iv) => {
                      const ivMeta = STATE_META[iv.state] || STATE_META.offline;
                      const isOpen = !iv.endAt;
                      return (
                        <tr key={iv._id} className="hover:bg-ink-50/40">
                          <td className="p-2.5">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold"
                              style={{ background: ivMeta.bg, color: ivMeta.color }}>
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ivMeta.color }} />
                              {ivMeta.label}
                            </span>
                          </td>
                          <td className="p-2.5 text-[11.5px] font-mono text-ink-700 whitespace-nowrap">{new Date(iv.startAt).toLocaleString()}</td>
                          <td className="p-2.5 text-[11.5px] font-mono text-ink-700 whitespace-nowrap">
                            {isOpen ? <span className="text-state-down font-bold">● Ongoing</span> : new Date(iv.endAt).toLocaleString()}
                          </td>
                          <td className="p-2.5 text-[12px] tabular-nums text-right font-semibold text-ink-900 whitespace-nowrap">{formatDuration(durOf(iv))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════ HISTORY ════════════════ */}
      {activeTab === 'history' && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-bold text-[15px] text-ink-900 flex items-center gap-2">
              <Activity className="h-4 w-4 text-brand-500" /> IoT Data History
            </h2>
            <div className="text-[11px] text-ink-400">
              Total: <strong className="text-ink-700">{(historyMeta.total || 0).toLocaleString()}</strong> records · {pageSize} per page
            </div>
          </div>

          <div className="bg-ink-50/50 border border-ink-100 rounded-lg p-3 mb-3 flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-[10px] font-bold uppercase text-ink-500 tracking-wider mb-1">From</label>
              <div className="flex items-center gap-1.5">
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="input py-1.5 text-[12px]" />
                <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} disabled={!fromDate}
                  title={fromDate ? 'Time choose karo' : 'Pehle date select karo'}
                  className="input py-1.5 text-[12px] disabled:opacity-50 disabled:cursor-not-allowed" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-ink-500 tracking-wider mb-1">To</label>
              <div className="flex items-center gap-1.5">
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="input py-1.5 text-[12px]" />
                <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} disabled={!toDate}
                  title={toDate ? 'Time choose karo' : 'Pehle date select karo'}
                  className="input py-1.5 text-[12px] disabled:opacity-50 disabled:cursor-not-allowed" />
              </div>
            </div>
            <button onClick={applyFilters} className="btn-primary text-[12px] py-1.5 px-3">Apply Filter</button>
            {(activeFilters.from || activeFilters.to) && (
              <button onClick={clearFilters} className="btn-secondary text-[12px] py-1.5 px-3">Clear</button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-500">
                Show
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="rounded-lg border border-ink-200 bg-white py-1.5 pl-2 pr-6 text-[12px] text-ink-900 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                >
                  {[10, 20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="text-ink-400">rows</span>
              </label>
              <button onClick={() => iotHistory.refetch()} disabled={iotHistory.isFetching}
                className="btn-secondary text-[12px] py-1.5 px-3 inline-flex items-center gap-1.5">
                <RefreshCw className={clsx('h-3.5 w-3.5', iotHistory.isFetching && 'animate-spin')} /> Refresh
              </button>
            </div>
          </div>

          {iotHistory.isLoading ? (
            <div className="text-center py-8 text-[12.5px] text-ink-400">Loading history…</div>
          ) : historyItems.length === 0 ? (
            <div className="text-center py-8 text-[12.5px] text-ink-400 bg-ink-50/50 rounded-lg border border-dashed border-ink-200">
              {activeFilters.from || activeFilters.to ? 'No records in the selected date range.' : 'No history yet. Device POSTs will appear here.'}
            </div>
          ) : (
            <>
              <IoTHistoryTable rows={historyItems} dynamicKeys={historyKeys} />
              <div className="mt-2 text-[10.5px] text-ink-400">Tip: click any column header to sort the current page.</div>

              <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                <div className="text-[11.5px] text-ink-500">
                  Page <strong>{historyMeta.page}</strong> of <strong>{historyMeta.pages || 1}</strong>
                  {' · '}Showing {historyItems.length} of {(historyMeta.total || 0).toLocaleString()}
                </div>
                <div className="flex items-center gap-1.5">
                  <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="btn-secondary text-[11.5px] py-1 px-2 inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </button>
                  <button disabled={page >= (historyMeta.pages || 1)} onClick={() => setPage((p) => p + 1)}
                    className="btn-secondary text-[11.5px] py-1 px-2 inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed">
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ════════════════ CONFIGURE ════════════════ */}
      {activeTab === 'configure' && (
        <div className="card p-5 max-w-2xl">
          <h2 className="font-bold text-[15px] text-ink-900 flex items-center gap-2 mb-1">
            <Settings className="h-4 w-4 text-brand-500" /> Configure assignment
          </h2>
          <p className="text-[12px] text-ink-500 mb-4">Assign a job and operator to <strong>{m.name}</strong>. Shown on the machine card.</p>

          <form onSubmit={submitConfig} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Job Number">
                <input value={form.currentJobNumber} onChange={(e) => setForm({ ...form, currentJobNumber: e.target.value })} placeholder="e.g. PB-007" className="input w-full text-[13px]" />
              </Field>
              <Field label="Order Number">
                <input value={form.currentOrderNumber} onChange={(e) => setForm({ ...form, currentOrderNumber: e.target.value })} placeholder="e.g. SO-2026-001" className="input w-full text-[13px]" />
              </Field>
            </div>
            <Field label="Product">
              <input value={form.currentProduct} onChange={(e) => setForm({ ...form, currentProduct: e.target.value })} placeholder="e.g. Printed Pouch 200x300mm" className="input w-full text-[13px]" />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Operator Name">
                <input value={form.operatorName} onChange={(e) => setForm({ ...form, operatorName: e.target.value })} placeholder="e.g. Ramesh Kumar" className="input w-full text-[13px]" />
              </Field>
              <Field label="Supervisor Name">
                <input value={form.supervisorName} onChange={(e) => setForm({ ...form, supervisorName: e.target.value })} placeholder="Optional" className="input w-full text-[13px]" />
              </Field>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button type="submit" disabled={saveAssignment.isPending}
                className="btn-primary text-[13px] py-2 px-4 inline-flex items-center gap-1.5">
                <Save className="h-4 w-4" /> {saveAssignment.isPending ? 'Saving…' : 'Save Assignment'}
              </button>
              <button type="button" onClick={clearConfig} disabled={saveAssignment.isPending}
                className="btn-secondary text-[13px] py-2 px-4 inline-flex items-center gap-1.5">
                <Eraser className="h-4 w-4" /> Clear
              </button>
              {configMsg && (
                <span className={clsx('text-[12.5px] font-semibold', /fail/i.test(configMsg) ? 'text-state-down' : 'text-emerald-600')}>{configMsg}</span>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-bold uppercase tracking-wider text-ink-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * IoT Data History — TanStack (react-table) powered grid.
 * Sortable columns, sticky header, zebra rows. Renders the current server page
 * (pagination + page-size are controlled by the parent). READ-ONLY: no writes.
 * ──────────────────────────────────────────────────────────────────────── */
function SortIcon({ dir }) {
  if (dir === 'asc') return <ChevronUp className="h-3 w-3 text-brand-600 shrink-0" />;
  if (dir === 'desc') return <ChevronDown className="h-3 w-3 text-brand-600 shrink-0" />;
  return <ChevronsUpDown className="h-3 w-3 text-ink-300 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />;
}

function IoTHistoryTable({ rows, dynamicKeys }) {
  const [sorting, setSorting] = useState([]);

  const columns = useMemo(() => [
    {
      id: 'receivedAt',
      header: 'Time',
      accessorFn: (row) => new Date(row.receivedAt).getTime(),
      cell: (info) => (
        <span className="font-mono text-[11px] text-ink-700 whitespace-nowrap">
          {new Date(info.row.original.receivedAt).toLocaleString()}
        </span>
      ),
    },
    {
      accessorKey: 'deviceId',
      header: 'Device',
      cell: (info) => <span className="font-mono text-[11px] text-ink-500 whitespace-nowrap">{info.getValue() || '—'}</span>,
    },
    {
      id: 'state',
      header: 'State',
      accessorFn: (row) => {
        const p = unwrapPayload(row.data);
        return normalizeRowState(p.state || p.status) || '';
      },
      cell: (info) => {
        const key = info.getValue();
        const meta = key ? STATE_META[key] : null;
        return meta
          ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-bold" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
          : <span className="text-ink-300">—</span>;
      },
    },
    ...dynamicKeys.map((k) => ({
      id: k,
      header: formatKey(k),
      accessorFn: (row) => {
        const v = unwrapPayload(row.data)[k];
        return v === null ? undefined : v; // null|missing → undefined so sortUndefined:'last' applies
      },
      cell: (info) => {
        const v = info.getValue();
        return (v === null || v === undefined)
          ? <span className="text-ink-300">—</span>
          : <span className="font-mono tabular-nums text-[11px] text-ink-700">{formatNumber(v)}</span>;
      },
      meta: { align: 'right' },
      sortUndefined: 'last',
    })),
  ], [dynamicKeys]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row._id,
  });

  return (
    <div className="overflow-auto max-h-[70vh] border border-ink-100 rounded-lg">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-ink-50 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const align = header.column.columnDef.meta?.align === 'right';
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    title="Click to sort"
                    className={clsx(
                      'group p-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap select-none cursor-pointer transition-colors',
                      sorted ? 'text-brand-600 bg-brand-50/70' : 'text-ink-500 hover:text-ink-800 hover:bg-ink-100/70',
                    )}
                  >
                    <span className={clsx('inline-flex items-center gap-1', align && 'flex-row-reverse')}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <SortIcon dir={sorted} />
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, i) => (
            <tr key={row.id} className={clsx('border-t border-ink-100 hover:bg-brand-50/40 transition-colors', i % 2 === 1 && 'bg-ink-50/40')}>
              {row.getVisibleCells().map((cell) => {
                const align = cell.column.columnDef.meta?.align === 'right';
                const sortedCol = cell.column.getIsSorted();
                return (
                  <td key={cell.id} className={clsx('p-2 whitespace-nowrap', align ? 'text-right' : 'text-left', sortedCol && 'bg-brand-50/25')}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
