import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, ScaleIcon, ShieldCheck, QrCode, Download, MapPin, Search, X, FileText } from 'lucide-react';
import clsx from 'clsx';
import { jobApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { useSocket } from '../hooks/useSocket.js';

/**
 * Production Floor — live production log.
 *
 * Shows one row per ACTIVE stage across all jobs (in_progress, ready, completed recently,
 * on hold, or with failed QC). Mirrors the screenshot table exactly.
 */

const STAGE_LABEL = {
  printing: 'Printing',
  inspection: 'Inspection',
  lamination: 'Lamination',
  hot_room: 'Hot Room',
  slitting: 'Slitting',
  cutting: 'Cutting',
  packaging: 'Packaging',
};

const STATUS_PILL = {
  in_progress: { text: 'RUNNING', cls: 'bg-state-running/10 text-state-running' },
  ready:       { text: 'READY',   cls: 'bg-brand-50 text-brand-600' },
  completed:   { text: 'DONE',    cls: 'bg-state-running/10 text-state-running' },
  paused:      { text: 'PAUSED',  cls: 'bg-state-idle/10 text-state-idle' },
  qc_hold:     { text: 'ON HOLD', cls: 'bg-state-down/10 text-state-down' },
  rework:      { text: 'REWORK',  cls: 'bg-state-maintenance/10 text-state-maintenance' },
  pending:     { text: 'PENDING', cls: 'bg-ink-100 text-ink-600' },
};

function summarizeMaterials(materials) {
  if (!materials?.length) return '—';
  return materials
    .slice(0, 3)
    .map((m) => `${m.name.split(' ')[0]} ${m.qty}${m.uom || 'kg'}`)
    .join(' + ');
}

export function ProductionFloorPage() {
  const user = authStore((s) => s.user);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [filters, setFilters] = useState({ status: '', stage: '' });
  const [searchQ, setSearchQ] = useState('');

  const query = useQuery({
    queryKey: ['jobs', 'floor', user?.plantId, filters],
    queryFn: async () => (await jobApi.list({
      plantId: user?.plantId,
      limit: 100,
      sort: '-updatedAt',
    })).data,
    refetchInterval: 20_000,
  });

  useSocket(
    '/orders',
    { 'order:update': () => qc.invalidateQueries({ queryKey: ['jobs', 'floor'] }) },
    [user?.plantId],
    (s) => user?.plantId && s.emit('subscribe:plant', user.plantId)
  );

  // Flatten jobs → production log rows (one per relevant stage)
  const rows = useMemo(() => {
    const out = [];
    for (const job of query.data || []) {
      for (const stage of job.stages || []) {
        // Show stages that are currently meaningful on the floor
        if (!['in_progress', 'ready', 'qc_hold', 'paused', 'rework'].includes(stage.status)) {
          // Also show recently completed (last 24h)
          if (stage.status === 'completed' && stage.completedAt) {
            const age = Date.now() - new Date(stage.completedAt).getTime();
            if (age > 24 * 3600 * 1000) continue;
          } else {
            continue;
          }
        }
        out.push({
          key: `${job._id}_${stage._id}`,
          jobId: job._id,
          orderNumber: job.orderNumber,
          jobNumber: job.jobNumber,
          productName: job.product?.name,
          stage: stage.stage,
          stageId: stage._id,
          machineCode: stage.machineId?.code || stage.machineCode || '—',
          weightIn: stage.weightInKg,
          weightOut: stage.weightOutKg,
          materials: stage.materialsAdded,
          operator: stage.operatorId?.name || '—',
          qc: stage.qcResult?.decision,
          status: stage.status,
          updatedAt: stage.completedAt || stage.startedAt || job.updatedAt,
        });
      }
    }
    // Apply filters
    let filtered = out;
    if (filters.status) filtered = filtered.filter((r) => r.status === filters.status);
    if (filters.stage) filtered = filtered.filter((r) => r.stage === filters.stage);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      filtered = filtered.filter((r) =>
        r.orderNumber?.toLowerCase().includes(q) ||
        r.jobNumber?.toLowerCase().includes(q) ||
        r.productName?.toLowerCase().includes(q) ||
        r.operator?.toLowerCase().includes(q)
      );
    }
    return filtered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [query.data, filters, searchQ]);

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-primary">
          <Plus className="h-4 w-4" /> Stage Entry
        </button>
        <button className="btn-secondary">
          ⚖️ Weight Entry
        </button>
        <button className="btn-secondary" onClick={() => nav('/qc')}>
          <ShieldCheck className="h-4 w-4" /> QC Check
        </button>
        <button className="btn-secondary">
          <QrCode className="h-4 w-4" /> Scan QR
        </button>
      </div>

      {/* Filter bar */}
      <div className="panel !p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
            <input
              className="input pl-8 py-1.5 text-[12.5px]"
              placeholder="Search order, job, product, operator…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
          </div>
          <select
            className="input w-auto py-1.5 text-[12.5px]"
            value={filters.stage}
            onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
          >
            <option value="">All stages</option>
            {Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select
            className="input w-auto py-1.5 text-[12.5px]"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">All statuses</option>
            <option value="in_progress">Running</option>
            <option value="ready">Ready</option>
            <option value="qc_hold">On Hold</option>
            <option value="paused">Paused</option>
            <option value="completed">Done</option>
          </select>
          {(filters.stage || filters.status || searchQ) && (
            <button
              className="btn-ghost btn-sm text-state-down"
              onClick={() => { setFilters({ status: '', stage: '' }); setSearchQ(''); }}
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          <div className="ml-auto text-[11px] text-ink-400 bg-ink-50 border border-ink-200 px-2.5 py-1 rounded-md">
            {rows.length} entries
          </div>
        </div>
      </div>

      {/* Production log table */}
      <div className="panel !p-0 overflow-hidden">
        <div className="panel-header !px-4 !py-3 !mb-0 !border-b border-ink-100">
          <div className="panel-title">
            <FileText className="h-4 w-4 text-brand-500" />
            Production Log
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary btn-sm">
              <Download className="h-3.5 w-3.5" /> Export
            </button>
            <button className="btn-primary btn-sm">
              <Plus className="h-3.5 w-3.5" /> Entry
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="th">Order #</th>
                <th className="th">Job #</th>
                <th className="th">Product</th>
                <th className="th">Stage</th>
                <th className="th">Machine</th>
                <th className="th text-right">Input Wt</th>
                <th className="th">Added Mat</th>
                <th className="th text-right">Output Wt</th>
                <th className="th">Operator</th>
                <th className="th">QC</th>
                <th className="th">Status</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {query.isLoading ? (
                <tr><td colSpan={12} className="td text-center py-10 text-[12.5px] text-ink-400">Loading production log…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={12} className="td text-center py-10 text-[12.5px] text-ink-500">
                  No active production. Start a job from Planning & Orders.
                </td></tr>
              ) : rows.map((r) => {
                const status = STATUS_PILL[r.status] || STATUS_PILL.pending;
                return (
                  <tr key={r.key} className="tr-hover">
                    <td className="td">
                      <span className="font-mono text-[11.5px] font-bold text-brand-600">{r.orderNumber}</span>
                    </td>
                    <td className="td">
                      <span className="font-mono text-[11px] text-state-maintenance">{r.jobNumber}</span>
                    </td>
                    <td className="td text-[12px] font-semibold">{r.productName}</td>
                    <td className="td text-[12px]">{STAGE_LABEL[r.stage]}</td>
                    <td className="td font-mono text-[11.5px]">{r.machineCode}</td>
                    <td className="td text-right tabular-nums">
                      <span className="text-[12px] font-bold text-state-running">{r.weightIn || 0} kg</span>
                    </td>
                    <td className="td text-[11px] text-state-idle">
                      {summarizeMaterials(r.materials)}
                    </td>
                    <td className="td text-right tabular-nums">
                      {r.weightOut ? (
                        <span className="text-[12px] font-bold text-brand-600">{r.weightOut} kg</span>
                      ) : r.status === 'in_progress' || r.status === 'ready' ? (
                        <span className="text-ink-400">—</span>
                      ) : <span className="text-ink-400">—</span>}
                    </td>
                    <td className="td text-[11.5px]">{r.operator}</td>
                    <td className="td">
                      {r.qc === 'pass' && <span className="chip-green text-[10px]">✓ Pass</span>}
                      {r.qc === 'fail' && <span className="chip-red text-[10px]">✗ Fail</span>}
                      {(!r.qc || r.qc === 'pending') && <span className="text-ink-400 text-[11px]">—</span>}
                    </td>
                    <td className="td">
                      <span className={clsx('text-[9.5px] font-bold px-2 py-0.5 rounded-full', status.cls)}>
                        {status.text}
                      </span>
                    </td>
                    <td className="td">
                      <div className="flex gap-1">
                        <button
                          onClick={() => nav(`/tracking?orderNumber=${r.orderNumber}`)}
                          className="rounded-md border border-state-down/20 bg-state-down/5 text-state-down text-[10px] font-semibold px-2 py-1 flex items-center gap-1 hover:brightness-95"
                        >
                          <MapPin className="h-3 w-3" /> Track
                        </button>
                        <button className="rounded-md border border-ink-200 bg-ink-50 text-ink-600 text-[10px] font-semibold px-2 py-1 flex items-center gap-1 hover:bg-ink-100">
                          <QrCode className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
