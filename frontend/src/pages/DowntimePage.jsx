/**
 * DowntimePage — cross-machine downtime overview.
 *
 * Lives at /downtime. Shows:
 *
 *   1. Big summary tiles — total running / idle / down / downtime time
 *      across all machines in the selected window. Downtime = idle + down,
 *      per Pankaj's spec.
 *
 *   2. Filter bar — date range (default: today), per-machine drill-down.
 *
 *   3. Per-machine table — one row per machine, sorted by downtime
 *      descending (worst offenders at the top). Columns: Code · Stage ·
 *      Current State · Running · Idle · Down · Total Downtime ·
 *      Downtime %. Click a row to open that machine's detail page.
 *
 * Backend: GET /api/v1/downtime/summary?from=&to=&plantId=&machineId=
 * Returns: { machines: [...], totals: {...}, from, to }
 *
 * Data refresh: every 30 seconds. Most state intervals close on minute
 * boundaries (machines POST every few seconds), so 30s is enough to feel
 * live without hammering the DB.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  Clock, AlertTriangle, Activity, Zap, Power, RefreshCw,
  Calendar, ChevronRight, TrendingDown,
} from 'lucide-react';
import { downtimeApi } from '../api/endpoints.js';

const STATE_META = {
  running:     { label: 'Running',      color: '#059669', bg: '#ecfdf5' },
  idle:        { label: 'Idle',         color: '#d97706', bg: '#fffbeb' },
  down:        { label: 'Down',         color: '#dc2626', bg: '#fef2f2' },
  maintenance: { label: 'Maintenance',  color: '#7c3aed', bg: '#f5f3ff' },
  offline:     { label: 'Offline',      color: '#64748b', bg: '#f1f5f9' },
};

/** Seconds → compact human duration */
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const sec = Math.max(0, Math.floor(seconds));
  if (sec === 0) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Build ISO datetime strings for the default date-range picker (today). */
function todayWindow() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  return {
    from: toLocalDatetime(start),
    to:   toLocalDatetime(end),
  };
}

/** Format a Date as YYYY-MM-DDTHH:MM for <input type="datetime-local">. */
function toLocalDatetime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

const PRESET_RANGES = [
  { key: 'today',      label: 'Today' },
  { key: 'yesterday',  label: 'Yesterday' },
  { key: '7days',      label: 'Last 7 days' },
  { key: '30days',     label: 'Last 30 days' },
  { key: 'thismonth',  label: 'This month' },
];

function presetWindow(key) {
  const now = new Date();
  switch (key) {
    case 'today': {
      const s = new Date(); s.setHours(0,0,0,0);
      return { from: s, to: now };
    }
    case 'yesterday': {
      const s = new Date(); s.setDate(s.getDate() - 1); s.setHours(0,0,0,0);
      const e = new Date(s); e.setHours(23,59,59,999);
      return { from: s, to: e };
    }
    case '7days': {
      const s = new Date(); s.setDate(s.getDate() - 7);
      return { from: s, to: now };
    }
    case '30days': {
      const s = new Date(); s.setDate(s.getDate() - 30);
      return { from: s, to: now };
    }
    case 'thismonth': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: s, to: now };
    }
    default:
      return { from: null, to: null };
  }
}

export function DowntimePage() {
  // Filter state — start with "today"
  const [activePreset, setActivePreset] = useState('today');
  const [customFrom, setCustomFrom] = useState(todayWindow().from);
  const [customTo,   setCustomTo]   = useState(todayWindow().to);

  // Compute effective window: preset wins unless user typed in custom
  const { fromISO, toISO } = useMemo(() => {
    if (activePreset && activePreset !== 'custom') {
      const w = presetWindow(activePreset);
      return { fromISO: w.from?.toISOString(), toISO: w.to?.toISOString() };
    }
    return {
      fromISO: customFrom ? new Date(customFrom).toISOString() : undefined,
      toISO:   customTo   ? new Date(customTo).toISOString()   : undefined,
    };
  }, [activePreset, customFrom, customTo]);

  const summary = useQuery({
    queryKey: ['downtime', 'summary', fromISO, toISO],
    queryFn: async () => {
      const params = {};
      if (fromISO) params.from = fromISO;
      if (toISO)   params.to   = toISO;
      return (await downtimeApi.summary(params)).data;
    },
    refetchInterval: 30_000,
  });

  const data = summary.data || { machines: [], totals: { running: 0, idle: 0, down: 0, downtime: 0 } };
  const totals = data.totals || {};
  const machines = data.machines || [];

  // Sort by total downtime descending — worst at top
  const sortedMachines = useMemo(() => {
    return [...machines].sort((a, b) => (b.downtime || 0) - (a.downtime || 0));
  }, [machines]);

  // Overall downtime % (idle+down / total tracked time)
  const totalTracked = (totals.running || 0) + (totals.idle || 0) + (totals.down || 0)
                     + (totals.maintenance || 0) + (totals.offline || 0);
  const downtimePct = totalTracked > 0
    ? Math.round((totals.downtime / totalTracked) * 1000) / 10
    : 0;

  return (
    <div className="space-y-5">
      {/* Page title */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-[22px] font-bold text-ink-900 flex items-center gap-2">
            <TrendingDown className="h-6 w-6 text-state-down" />
            Downtime Overview
          </h1>
          <div className="text-[12px] text-ink-500 mt-0.5">
            Cross-machine running, idle, and stopped time aggregation
          </div>
        </div>
        <button
          onClick={() => summary.refetch()}
          disabled={summary.isFetching}
          className="btn-secondary text-[12px] py-1.5 px-3 inline-flex items-center gap-1.5"
        >
          <RefreshCw className={clsx('h-3.5 w-3.5', summary.isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Date filter bar */}
      <div className="card p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink-500 mr-1">
            Period:
          </span>
          {PRESET_RANGES.map((p) => (
            <button
              key={p.key}
              onClick={() => setActivePreset(p.key)}
              className={clsx(
                'px-3 py-1 rounded-md text-[11.5px] font-semibold border transition',
                activePreset === p.key
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-ink-700 border-ink-200 hover:border-brand-300'
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setActivePreset('custom')}
            className={clsx(
              'px-3 py-1 rounded-md text-[11.5px] font-semibold border transition inline-flex items-center gap-1',
              activePreset === 'custom'
                ? 'bg-brand-500 text-white border-brand-500'
                : 'bg-white text-ink-700 border-ink-200 hover:border-brand-300'
            )}
          >
            <Calendar className="h-3.5 w-3.5" />
            Custom
          </button>
        </div>

        {activePreset === 'custom' && (
          <div className="flex items-end gap-2 flex-wrap pt-2 border-t border-ink-100">
            <div>
              <label className="block text-[10px] font-bold uppercase text-ink-500 tracking-wider mb-1">From</label>
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="input py-1.5 text-[12px]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase text-ink-500 tracking-wider mb-1">To</label>
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="input py-1.5 text-[12px]"
              />
            </div>
          </div>
        )}

        {data.from && data.to && (
          <div className="text-[11px] text-ink-400 mt-3">
            Showing data from <strong>{new Date(data.from).toLocaleString()}</strong>{' '}
            to <strong>{new Date(data.to).toLocaleString()}</strong>
          </div>
        )}
      </div>

      {/* Big summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile
          icon={Zap}
          label="Running"
          seconds={totals.running || 0}
          color="#059669"
          bg="#ecfdf5"
        />
        <SummaryTile
          icon={Clock}
          label="Idle"
          seconds={totals.idle || 0}
          color="#d97706"
          bg="#fffbeb"
        />
        <SummaryTile
          icon={Power}
          label="Down"
          seconds={totals.down || 0}
          color="#dc2626"
          bg="#fef2f2"
        />
        <SummaryTile
          icon={AlertTriangle}
          label={`Total Downtime (${downtimePct}%)`}
          seconds={totals.downtime || 0}
          color="#7c2d12"
          bg="#fff7ed"
          highlight
        />
      </div>

      {/* Per-machine table */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-bold text-[15px] text-ink-900 flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand-500" />
            Per-Machine Breakdown
            <span className="text-[10px] font-semibold text-ink-400 bg-ink-50 border border-ink-200 px-2 py-0.5 rounded">
              {sortedMachines.length} machine{sortedMachines.length === 1 ? '' : 's'}
            </span>
          </h2>
          <div className="text-[11px] text-ink-400">
            Sorted by total downtime (highest first)
          </div>
        </div>

        {summary.isLoading ? (
          <div className="text-center py-10 text-[13px] text-ink-400">Loading…</div>
        ) : sortedMachines.length === 0 ? (
          <div className="text-center py-10 text-[13px] text-ink-400 bg-ink-50/50 rounded-lg border border-dashed border-ink-200">
            No machines found for the selected window.
          </div>
        ) : (
          <div className="overflow-x-auto border border-ink-100 rounded-lg">
            <table className="w-full">
              <thead className="bg-ink-50">
                <tr>
                  <th className="text-left p-3 text-[10px] font-bold uppercase text-ink-500 tracking-wider">Machine</th>
                  <th className="text-left p-3 text-[10px] font-bold uppercase text-ink-500 tracking-wider">Stage</th>
                  <th className="text-left p-3 text-[10px] font-bold uppercase text-ink-500 tracking-wider">Current State</th>
                  <th className="text-right p-3 text-[10px] font-bold uppercase text-ink-500 tracking-wider">Running</th>
                  <th className="text-right p-3 text-[10px] font-bold uppercase text-ink-500 tracking-wider">Idle</th>
                  <th className="text-right p-3 text-[10px] font-bold uppercase text-ink-500 tracking-wider">Down</th>
                  <th className="text-right p-3 text-[10px] font-bold uppercase text-state-down tracking-wider">Downtime</th>
                  <th className="text-center p-3 text-[10px] font-bold uppercase text-ink-500 tracking-wider">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {sortedMachines.map((m) => {
                  const stateMeta = STATE_META[m.currentState] || STATE_META.offline;
                  const machineTracked = (m.running || 0) + (m.idle || 0) + (m.down || 0)
                                       + (m.maintenance || 0) + (m.offline || 0);
                  const machineDowntimePct = machineTracked > 0
                    ? Math.round((m.downtime / machineTracked) * 100)
                    : 0;
                  return (
                    <tr
                      key={m.machineId}
                      className="hover:bg-ink-50/40 transition cursor-pointer"
                      onClick={() => { window.location.href = `/machines/${m.machineId}`; }}
                    >
                      <td className="p-3">
                        <div className="font-mono text-[10.5px] font-bold text-ink-400 uppercase">
                          {m.code}
                        </div>
                        <div className="text-[12.5px] font-semibold text-ink-900">{m.name}</div>
                      </td>
                      <td className="p-3 text-[11.5px] text-ink-600 capitalize">{m.stage}</td>
                      <td className="p-3">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-bold"
                          style={{ background: stateMeta.bg, color: stateMeta.color }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: stateMeta.color }} />
                          {stateMeta.label}
                        </span>
                      </td>
                      <td className="p-3 text-right text-[12px] tabular-nums font-semibold" style={{ color: '#059669' }}>
                        {formatDuration(m.running)}
                      </td>
                      <td className="p-3 text-right text-[12px] tabular-nums font-semibold" style={{ color: '#d97706' }}>
                        {formatDuration(m.idle)}
                      </td>
                      <td className="p-3 text-right text-[12px] tabular-nums font-semibold" style={{ color: '#dc2626' }}>
                        {formatDuration(m.down)}
                      </td>
                      <td className="p-3 text-right">
                        <div className="text-[13px] tabular-nums font-bold text-state-down">
                          {formatDuration(m.downtime)}
                        </div>
                        <div className="text-[10px] text-ink-400 tabular-nums">
                          {machineDowntimePct}% of period
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <Link
                          to={`/machines/${m.machineId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center text-brand-600 hover:text-brand-700"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ icon: Icon, label, seconds, color, bg, highlight }) {
  return (
    <div
      className={clsx(
        'rounded-lg border p-4',
        highlight && 'ring-2 ring-offset-2 ring-amber-200'
      )}
      style={{ background: bg, borderColor: color + '30' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4" style={{ color }} />
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
          {label}
        </div>
      </div>
      <div className="text-[26px] font-bold tabular-nums" style={{ color }}>
        {formatDuration(seconds)}
      </div>
    </div>
  );
}
