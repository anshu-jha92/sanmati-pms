import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X, Package, AlertTriangle, ArrowDownCircle, ArrowUpCircle,
  Settings as SettingsIcon, RotateCcw, User as UserIcon, Clock, Factory,
  Download,
} from 'lucide-react';
import clsx from 'clsx';
import { inventoryApi } from '../../api/endpoints.js';

const TYPE_CONFIG = {
  IN:       { color: 'green',  Icon: ArrowDownCircle, label: 'In' },
  OUT:      { color: 'red',    Icon: ArrowUpCircle,   label: 'Out' },
  ADJUST:   { color: 'yellow', Icon: SettingsIcon,    label: 'Adjust' },
  TRANSFER: { color: 'blue',   Icon: RotateCcw,       label: 'Transfer' },
};

const REF_KIND_LABELS = {
  purchase_order:        { label: 'Purchase Order',  color: 'green' },
  production_order:      { label: 'Production',      color: 'blue' },
  sales_order:           { label: 'Sales Order',     color: 'blue' },
  dispatch:              { label: 'Dispatch',        color: 'gray' },
  qc:                    { label: 'QC',              color: 'red' },
  manual:                { label: 'Manual',          color: 'gray' },
  material_issue:        { label: 'Issued to Floor', color: 'yellow' },
  material_consumption:  { label: 'Consumed',        color: 'red' },
  material_return:       { label: 'Returned',        color: 'green' },
  material_cancel:       { label: 'Cancelled',       color: 'gray' },
  scrap:                 { label: 'Scrap',           color: 'red' },
};

export function ItemTrackingModal({ sku, onClose }) {
  const [tab, setTab] = useState('overview');

  const summary = useQuery({
    queryKey: ['inventory-summary', sku],
    queryFn: async () => (await inventoryApi.summary(sku)).data,
  });

  const wip = useQuery({
    queryKey: ['inventory-wip', sku],
    queryFn: async () => (await inventoryApi.wip(sku)).data,
    enabled: tab === 'wip' || tab === 'overview',
  });

  const item = summary.data?.item;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-w-5xl mx-auto bg-white rounded-2xl shadow-2xl my-4">
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">Inventory Tracking</div>
            <h2 className="text-[18px] font-bold text-ink-900 font-mono">{sku}</h2>
            {item && (
              <div className="text-[12.5px] text-ink-700 mt-0.5">
                {item.name}
                {item.category && (
                  <span className="ml-2 chip-gray text-[10px]">{item.category}</span>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        {summary.isLoading ? (
          <div className="p-12 text-center text-ink-400">Loading…</div>
        ) : summary.isError ? (
          <div className="p-12 text-center text-state-down">{summary.error?.message || 'Could not load item'}</div>
        ) : (
          <>
            {item && (
              <div className="px-5 pt-4">
                <TopStrip summary={summary.data} wip={wip.data} />
              </div>
            )}

            <div className="px-5 pt-4 flex items-center gap-1 overflow-x-auto border-b border-ink-100">
              {[
                { key: 'overview', label: 'Overview', count: null },
                { key: 'wip', label: 'Currently Issued', count: wip.data?.summary?.openIssues },
                { key: 'log', label: 'Movement Log', count: summary.data?.totals?.movementCount },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={clsx(
                    'px-4 py-2 text-[12.5px] font-semibold border-b-2 -mb-px whitespace-nowrap',
                    tab === t.key ? 'text-brand-600 border-brand-500' : 'text-ink-500 border-transparent hover:text-ink-700'
                  )}
                >
                  {t.label}
                  {t.count != null && t.count > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-ink-100 text-ink-600 text-[10px] px-1.5 py-0.5 min-w-[18px]">
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="p-5">
              {tab === 'overview' && <OverviewTab summary={summary.data} wip={wip.data} />}
              {tab === 'wip' && <WIPTab wip={wip.data} loading={wip.isLoading} />}
              {tab === 'log' && <MovementLogTab sku={sku} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TopStrip({ summary, wip }) {
  const item = summary.item;
  const wipQty = wip?.summary?.totalPendingQty || 0;
  const lowStock = item.reorderLevel > 0 && item.onHand < item.reorderLevel;
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <SnapCard accent="blue" label="On Hand" value={`${item.onHand} ${item.uom}`} warning={lowStock ? 'Below reorder' : null} />
      <SnapCard accent="yellow" label="In WIP" value={`${wipQty} ${item.uom}`} />
      <SnapCard accent="green" label="Total IN" value={`${summary.totals.totalIn} ${item.uom}`} />
      <SnapCard accent="red" label="Total OUT" value={`${summary.totals.totalOut} ${item.uom}`} />
      <SnapCard accent="red" label="Scrap" value={`${summary.totals.totalScrap} ${item.uom}`} />
    </div>
  );
}

function SnapCard({ accent, label, value, warning }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="sc-label">{label}</div>
      <div className="sc-val">{value}</div>
      {warning && <div className="sc-meta text-state-down !flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{warning}</div>}
    </div>
  );
}

function OverviewTab({ summary, wip }) {
  const item = summary.item;
  const daily = summary.last30Days?.daily || [];
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-ink-100 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-[13px] text-ink-900">Last 30 days activity</div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-state-running rounded-sm"></span>IN</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-state-down rounded-sm"></span>OUT</span>
          </div>
        </div>
        {daily.length === 0 ? (
          <div className="text-center py-10 text-[12px] text-ink-400">No activity in the last 30 days</div>
        ) : <BarChart data={daily} uom={item.uom} />}
        <div className="mt-3 grid grid-cols-3 gap-3 text-center text-[11.5px]">
          <div className="rounded-md bg-ink-50 p-2">
            <div className="text-ink-500">Total IN (30d)</div>
            <div className="font-bold text-state-running tabular-nums">{summary.last30Days.totalIn} {item.uom}</div>
          </div>
          <div className="rounded-md bg-ink-50 p-2">
            <div className="text-ink-500">Total OUT (30d)</div>
            <div className="font-bold text-state-down tabular-nums">{summary.last30Days.totalOut} {item.uom}</div>
          </div>
          <div className="rounded-md bg-ink-50 p-2">
            <div className="text-ink-500">Avg daily OUT</div>
            <div className="font-bold tabular-nums">{summary.last30Days.avgDailyOut.toFixed(1)} {item.uom}</div>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-ink-100 p-4">
        <div className="font-bold text-[13px] text-ink-900 mb-2">Recent activity</div>
        {summary.recentMovements.length === 0 ? (
          <div className="text-center py-6 text-[12px] text-ink-400">No recent activity</div>
        ) : (
          <MovementsTable movements={summary.recentMovements} />
        )}
      </div>
    </div>
  );
}

function BarChart({ data, uom }) {
  const max = Math.max(...data.map((d) => Math.max(d.in, d.out)), 1);
  const w = 700, h = 160, padL = 32, padR = 8, padT = 8, padB = 28;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const groupWidth = innerW / data.length;
  const barWidth = Math.max(2, groupWidth * 0.4);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ minWidth: 600 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <g key={i}>
            <line x1={padL} y1={padT + (1 - p) * innerH} x2={w - padR} y2={padT + (1 - p) * innerH} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padL - 4} y={padT + (1 - p) * innerH + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{(max * p).toFixed(0)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + i * groupWidth + groupWidth / 2;
          const inH = (d.in / max) * innerH;
          const outH = (d.out / max) * innerH;
          return (
            <g key={i}>
              <rect x={cx - barWidth - 1} y={padT + innerH - inH} width={barWidth} height={inH} fill="#059669" rx="1">
                <title>{d.date}: IN {d.in} {uom}</title>
              </rect>
              <rect x={cx + 1} y={padT + innerH - outH} width={barWidth} height={outH} fill="#dc2626" rx="1">
                <title>{d.date}: OUT {d.out} {uom}</title>
              </rect>
              {(i % Math.max(1, Math.floor(data.length / 8)) === 0 || i === data.length - 1) && (
                <text x={cx} y={h - 8} textAnchor="middle" fontSize="9" fill="#64748b">{d.date.slice(5)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function WIPTab({ wip, loading }) {
  if (loading) return <div className="text-center py-10 text-ink-400">Loading…</div>;
  if (!wip || wip.summary.openIssues === 0) {
    return (
      <div className="text-center py-12">
        <Factory className="h-10 w-10 mx-auto text-ink-300 mb-2" />
        <div className="font-bold text-[13px] text-ink-900">Nothing in WIP for this item</div>
        <div className="text-[11.5px] text-ink-500 mt-1">All issued material has been consumed or returned.</div>
      </div>
    );
  }
  const { summary, wipLines } = wip;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg border-2 border-state-idle/20 bg-state-idle/5 p-3">
          <div className="text-[11px] text-state-idle font-bold uppercase tracking-wider">On Floor</div>
          <div className="text-[20px] font-bold tabular-nums text-state-idle">{summary.totalPendingQty} {wip.uom}</div>
          <div className="text-[10.5px] text-ink-500 mt-1">across {summary.openIssues} issue{summary.openIssues !== 1 ? 's' : ''}</div>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-3">
          <div className="text-[11px] text-ink-500 font-bold uppercase tracking-wider">By stage</div>
          <div className="mt-1 space-y-0.5 text-[11.5px]">
            {summary.byStage.map((s) => (
              <div key={s.stage} className="flex justify-between">
                <span className="capitalize">{s.stage.replace(/_/g, ' ')}</span>
                <span className="font-bold tabular-nums">{s.qty} {wip.uom}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white p-3">
          <div className="text-[11px] text-ink-500 font-bold uppercase tracking-wider">By person</div>
          <div className="mt-1 space-y-0.5 text-[11.5px]">
            {summary.byPerson.map((p) => (
              <div key={p.name} className="flex justify-between">
                <span>{p.name}</span>
                <span className="font-bold tabular-nums">{p.qty} {wip.uom}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-ink-100">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Issue #</th>
              <th className="th">Job / Product</th>
              <th className="th">Stage</th>
              <th className="th">Operator</th>
              <th className="th text-right">Issued</th>
              <th className="th text-right">Consumed</th>
              <th className="th text-right">Returned</th>
              <th className="th text-right">Scrap</th>
              <th className="th text-right">Pending</th>
              <th className="th">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {wipLines.map((l) => (
              <tr key={l.issueId} className="hover:bg-ink-50">
                <td className="td font-mono text-[11px] font-bold text-brand-600">{l.issueNumber}</td>
                <td className="td text-[11.5px]">
                  {l.jobOrderNumber && <div className="font-mono font-bold">{l.jobOrderNumber}</div>}
                  {l.productSku && <div className="text-[10.5px] text-ink-500">{l.productSku}</div>}
                </td>
                <td className="td"><span className="chip-blue text-[10px] capitalize">{l.stage.replace(/_/g, ' ')}</span></td>
                <td className="td text-[11.5px]">
                  <div className="flex items-center gap-1"><UserIcon className="h-3 w-3 text-ink-400" />{l.issuedToName}</div>
                </td>
                <td className="td text-right tabular-nums">{l.issuedQty}</td>
                <td className="td text-right tabular-nums text-state-down">{l.consumedQty || '—'}</td>
                <td className="td text-right tabular-nums text-state-running">{l.returnedQty || '—'}</td>
                <td className="td text-right tabular-nums text-state-down">{l.scrapQty || '—'}</td>
                <td className="td text-right tabular-nums font-bold text-state-idle">{l.pendingQty}</td>
                <td className="td text-[10.5px] text-ink-500">
                  <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(l.issuedAt)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MovementLogTab({ sku }) {
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['inventory-movements', sku, filters, page],
    queryFn: async () => (await inventoryApi.movements(sku, { ...filters, page, limit: 50 })).data,
  });
  const movements = query.data || [];

  function exportCsv() {
    const header = 'Date,Type,Qty,Balance After,Description,Performed By,Reference,Notes\n';
    const rows = movements.map((m) => [
      new Date(m.occurredAt).toLocaleString('en-IN'),
      m.type,
      m.qty,
      m.balanceAfter ?? '',
      `"${(m.description || '').replace(/"/g, '""')}"`,
      m.performedByName || '',
      `${m.reference?.kind || ''} ${m.reference?.id || ''}`,
      `"${(m.notes || '').replace(/"/g, '""')}"`,
    ].join(','));
    const blob = new Blob([header + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sku}-movements-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select className="input w-auto py-1.5 text-[12px]"
          value={filters.type || ''}
          onChange={(e) => setFilters({ ...filters, type: e.target.value || undefined })}>
          <option value="">All types</option>
          <option value="IN">IN (Receipt / Return)</option>
          <option value="OUT">OUT (Issue / Consume)</option>
          <option value="ADJUST">Adjust / Scrap</option>
          <option value="TRANSFER">Transfer</option>
        </select>
        <select className="input w-auto py-1.5 text-[12px]"
          value={filters.refKind || ''}
          onChange={(e) => setFilters({ ...filters, refKind: e.target.value || undefined })}>
          <option value="">All sources</option>
          {Object.entries(REF_KIND_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input type="date" className="input w-auto py-1.5 text-[12px]"
          value={filters.fromDate || ''}
          onChange={(e) => setFilters({ ...filters, fromDate: e.target.value || undefined })} />
        <input type="date" className="input w-auto py-1.5 text-[12px]"
          value={filters.toDate || ''}
          onChange={(e) => setFilters({ ...filters, toDate: e.target.value || undefined })} />
        {(filters.type || filters.refKind || filters.fromDate || filters.toDate) && (
          <button className="btn-ghost btn-sm text-state-down" onClick={() => setFilters({})}>
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        <div className="ml-auto flex gap-2 items-center">
          <span className="text-[11px] text-ink-400">{movements.length} records</span>
          <button className="btn-secondary btn-sm" onClick={exportCsv} disabled={!movements.length}>
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>
      {query.isLoading ? <div className="text-center py-10 text-ink-400">Loading…</div>
        : movements.length === 0 ? <div className="text-center py-10 text-ink-400">No movements found</div>
        : <MovementsTable movements={movements} />}
    </div>
  );
}

function MovementsTable({ movements }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-ink-100">
      <table className="table">
        <thead>
          <tr>
            <th className="th">Date / Time</th>
            <th className="th">Type</th>
            <th className="th text-right">Qty</th>
            <th className="th text-right">Balance</th>
            <th className="th">Description</th>
            <th className="th">Source</th>
            <th className="th">By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {movements.map((m) => {
            const cfg = TYPE_CONFIG[m.type] || TYPE_CONFIG.ADJUST;
            const refCfg = REF_KIND_LABELS[m.reference?.kind];
            const Icon = cfg.Icon;
            // Determine sign
            let signedQty;
            if (m.type === 'IN') {
              signedQty = Math.abs(m.qty);
            } else if (m.type === 'OUT') {
              signedQty = -Math.abs(m.qty);
            } else if (m.type === 'ADJUST') {
              if (m.reference?.kind === 'scrap') signedQty = -Math.abs(m.qty);
              else if (m.reference?.kind === 'material_consumption') signedQty = -Math.abs(m.qty);
              else if (m.reference?.kind === 'manual') {
                // For manual adjustments, qty is already signed (we logged delta)
                signedQty = Number(m.qty);
                // If qty stored as positive but notes says "removed", flip sign
                if (m.notes && /removed/i.test(m.notes) && signedQty > 0) signedQty = -signedQty;
              } else {
                signedQty = Number(m.qty);
              }
            } else {
              signedQty = Number(m.qty);
            }
            const positive = signedQty >= 0;
            return (
              <tr key={m._id} className="hover:bg-ink-50">
                <td className="td text-[11px]">
                  <div className="font-semibold">{new Date(m.occurredAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
                  <div className="text-ink-400">{new Date(m.occurredAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                </td>
                <td className="td">
                  <div className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold',
                    cfg.color === 'green' && 'bg-state-running/10 text-state-running',
                    cfg.color === 'red' && 'bg-state-down/10 text-state-down',
                    cfg.color === 'yellow' && 'bg-state-idle/10 text-state-idle',
                    cfg.color === 'blue' && 'bg-brand-500/10 text-brand-600')}>
                    <Icon className="h-3 w-3" /> {cfg.label}
                  </div>
                </td>
                <td className={clsx('td text-right tabular-nums font-bold', positive ? 'text-state-running' : 'text-state-down')}>
                  {positive ? '+' : ''}{signedQty}
                </td>
                <td className="td text-right tabular-nums text-[11.5px]">{m.balanceAfter != null ? m.balanceAfter : '—'}</td>
                <td className="td text-[11.5px]">{m.description}</td>
                <td className="td">
                  {refCfg && (
                    <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-semibold',
                      refCfg.color === 'green' && 'bg-state-running/10 text-state-running',
                      refCfg.color === 'red' && 'bg-state-down/10 text-state-down',
                      refCfg.color === 'yellow' && 'bg-state-idle/10 text-state-idle',
                      refCfg.color === 'blue' && 'bg-brand-500/10 text-brand-600',
                      refCfg.color === 'gray' && 'bg-ink-100 text-ink-600')}>
                      {refCfg.label}
                    </span>
                  )}
                  {m.reference?.id && <div className="text-[10px] font-mono text-ink-500 mt-0.5">{m.reference.id}</div>}
                </td>
                <td className="td text-[11px]">
                  <div className="flex items-center gap-1"><UserIcon className="h-3 w-3 text-ink-400" />{m.performedByName || 'system'}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function timeAgo(date) {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
