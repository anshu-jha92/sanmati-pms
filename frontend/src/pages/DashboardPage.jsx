import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend, BarElement, CategoryScale,
  LinearScale, RadialLinearScale,
} from 'chart.js';
import { Doughnut, Bar, PolarArea } from 'react-chartjs-2';
import {
  ArrowRight, Sparkles, Zap, Siren, Cpu, Gauge, ShieldCheck, Boxes, Truck,
  ShoppingCart, Calendar, X, Activity, TrendingUp, CircleDot,
} from 'lucide-react';
import clsx from 'clsx';
import { dashboardApi, jobApi, machineApi, salesOrderApi, reportsApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { useSocket } from '../hooks/useSocket.js';

ChartJS.register(ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale, RadialLinearScale);
ChartJS.defaults.font.family = 'ui-sans-serif, system-ui, "Segoe UI", sans-serif';
ChartJS.defaults.color = '#8896b4';

const C = {
  running: '#059669', idle: '#d97706', down: '#dc2626', maintenance: '#7c3aed', offline: '#94a3b8',
  brand: '#1a6bff', cyan: '#0891b2', pass: '#059669', reject: '#dc2626', rework: '#7c3aed', hold: '#d97706',
  raw: '#0891b2', packaging: '#1a6bff', finished: '#059669', consumable: '#d97706', wip: '#7c3aed',
};
const STATE_LABEL = { running: 'Running', idle: 'Idle', down: 'Down', maintenance: 'Maintenance', offline: 'Offline' };
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 1000) / 10}%`);
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const cap = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const dur = (sec) => { const s = Math.max(0, Math.floor(sec || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`; };

const STAGE_META = [
  { key: 'printing', label: 'Print', icon: '🖨️' }, { key: 'inspection', label: 'Inspect', icon: '🔍' },
  { key: 'lamination', label: 'Laminate', icon: '🧲' }, { key: 'hot_room', label: 'Hot Room', icon: '🔥' },
  { key: 'slitting', label: 'Slit', icon: '✂️' }, { key: 'cutting', label: 'Cut', icon: '🗂️' },
  { key: 'packaging', label: 'Pack', icon: '📦' },
];

export function DashboardPage() {
  const user = authStore((s) => s.user);
  const plantId = user?.plantId;
  const qc = useQueryClient();
  const [modal, setModal] = useState(null); // { type, ...ctx }

  const overview = useQuery({ queryKey: ['dashboard', 'overview', plantId], queryFn: async () => (await dashboardApi.overview(plantId)).data, refetchInterval: 30_000 });
  const suggestions = useQuery({ queryKey: ['dashboard', 'suggestions', plantId], queryFn: async () => (await dashboardApi.suggestions(plantId)).data, refetchInterval: 60_000 });
  const alerts = useQuery({ queryKey: ['dashboard', 'alerts', plantId], queryFn: async () => (await dashboardApi.alerts(plantId)).data, refetchInterval: 30_000 });
  const machines = useQuery({ queryKey: ['machines', 'live', plantId], queryFn: async () => (await machineApi.live(plantId)).data, refetchInterval: 15_000 });
  const report = useQuery({ queryKey: ['reports', 'dashboard', plantId], queryFn: async () => (await reportsApi.summary({ plantId })).data, refetchInterval: 60_000 });
  const activeJob = useQuery({ queryKey: ['jobs', 'focus', plantId], queryFn: async () => { const r = await jobApi.list({ status: 'in_progress', limit: 1 }); return r.data?.[0] || null; }, refetchInterval: 30_000 });
  const newOrders = useQuery({ queryKey: ['dashboard', 'new-orders', plantId], queryFn: async () => (await salesOrderApi.list({ plantId, limit: 50 })).data, refetchInterval: 30_000 });

  useSocket('/ops', {
    'machine:status': () => qc.invalidateQueries({ queryKey: ['machines', 'live'] }),
    'order:update': () => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  }, [plantId], (s) => { if (plantId) s.emit('subscribe:plant', plantId); });

  const data = overview.data;
  const oee = data?.oee || {};
  const rep = report.data;
  // Clean per-check decision breakdown; falls back to top-level counts (rework there is a qty sum, so use 0) if backend not yet updated.
  const qd = rep?.quality?.decisions || { pass: rep?.quality?.pass || 0, reject: rep?.quality?.reject || 0, rework: 0, hold: rep?.quality?.hold || 0 };

  const mList = machines.data || [];
  const mStats = useMemo(() => {
    const by = { running: 0, idle: 0, down: 0, maintenance: 0, offline: 0 };
    for (const x of mList) by[x.currentStatus?.state || 'offline'] = (by[x.currentStatus?.state || 'offline'] || 0) + 1;
    return { total: mList.length, ...by };
  }, [mList]);

  return (
    <div className="space-y-4">
      {/* KPI strip — clickable */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi accent={C.finished} icon={TrendingUp} label="Production Today" value={num(oee.totalProduced ?? 0)} unit="kg" sub={<><b style={{ color: C.pass }}>{pct(oee.quality)}</b> good quality</>} onClick={() => setModal({ type: 'production' })} />
        <Kpi accent={C.brand} icon={ShoppingCart} label="Active Orders" value={num(data?.orders?.in_progress ?? 0)} sub={`${data?.orders?.planned ?? 0} planned`} onClick={() => setModal({ type: 'orders' })} />
        <Kpi accent={C.idle} icon={Cpu} label="Machines Running" value={mStats.running} unit={`/ ${mStats.total}`} sub={`${mStats.idle} idle · ${mStats.down} down`} onClick={() => setModal({ type: 'machines' })} />
        <Kpi accent={C.rework} icon={Gauge} label="OEE Average" value={pct(oee.oee)} sub="availability × perf × qty" onClick={() => setModal({ type: 'oee' })} />
        <Kpi accent={C.reject} icon={ShieldCheck} label="QC Pass Rate" value={rep?.quality?.checks ? `${Math.round((rep.quality.pass / rep.quality.checks) * 100)}%` : '—'} sub={`${rep?.quality?.checks ?? 0} checks · ${rep?.quality?.rejectionRatePct ?? 0}% rej`} onClick={() => setModal({ type: 'quality' })} />
        <Kpi accent={C.cyan} icon={Truck} label="Dispatch Pending" value={num(data?.dispatch?.pending ?? 0)} sub="awaiting ship" onClick={() => setModal({ type: 'dispatch' })} />
      </section>

      {/* Chart row 1 — Machine status + Quality + OEE */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Machine Status" icon={Cpu} onClick={() => setModal({ type: 'machines' })} count={`${mStats.total} machines`}>
          {mStats.total ? (
            <div className="flex items-center gap-4">
              <div className="relative w-[150px] h-[150px] shrink-0">
                <Doughnut data={doughnut([
                  { l: 'Running', v: mStats.running, c: C.running }, { l: 'Idle', v: mStats.idle, c: C.idle },
                  { l: 'Down', v: mStats.down, c: C.down }, { l: 'Maint.', v: mStats.maintenance, c: C.maintenance },
                  { l: 'Offline', v: mStats.offline, c: C.offline },
                ])} options={doughnutOpts} />
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                  <div className="text-center"><div className="text-[26px] font-bold text-ink-900 leading-none">{mStats.total}</div><div className="text-[9px] uppercase tracking-wider text-ink-400">machines</div></div>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                {[['running', mStats.running], ['idle', mStats.idle], ['down', mStats.down], ['maintenance', mStats.maintenance], ['offline', mStats.offline]].filter(([, v]) => v > 0 || true).map(([k, v]) => (
                  <LegendRow key={k} color={C[k]} label={STATE_LABEL[k]} value={v} total={mStats.total} />
                ))}
              </div>
            </div>
          ) : <Empty text="No machines found." />}
        </ChartCard>

        <ChartCard title="Quality Split" icon={ShieldCheck} onClick={() => setModal({ type: 'quality' })} count={`${rep?.quality?.checks ?? 0} checks`}>
          {rep?.quality?.checks ? (
            <div className="flex items-center gap-4">
              <div className="relative w-[150px] h-[150px] shrink-0">
                <Doughnut data={doughnut([
                  { l: 'Pass', v: qd.pass, c: C.pass }, { l: 'Reject', v: qd.reject, c: C.reject },
                  { l: 'Rework', v: qd.rework, c: C.rework }, { l: 'Hold', v: qd.hold, c: C.hold },
                ])} options={doughnutOpts} />
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                  <div className="text-center"><div className="text-[24px] font-bold text-ink-900 leading-none">{rep.quality.checks ? Math.round((rep.quality.pass / rep.quality.checks) * 100) : 0}%</div><div className="text-[9px] uppercase tracking-wider text-ink-400">pass</div></div>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                <LegendRow color={C.pass} label="Passed" value={qd.pass} total={rep.quality.checks} />
                <LegendRow color={C.reject} label="Rejected" value={qd.reject} total={rep.quality.checks} />
                <LegendRow color={C.rework} label="Rework" value={qd.rework} total={rep.quality.checks} />
                <LegendRow color={C.hold} label="Hold" value={qd.hold} total={rep.quality.checks} />
                <div className="pt-1 text-[11px] text-ink-500">Rejection rate <b className="text-state-down">{rep.quality.rejectionRatePct}%</b></div>
              </div>
            </div>
          ) : <Empty text="No QC checks yet." />}
        </ChartCard>

        <ChartCard title="OEE Breakdown" icon={Gauge} onClick={() => setModal({ type: 'oee' })} count="this shift">
          <div className="grid grid-cols-2 gap-2 py-1">
            <MiniRing label="Availability" value={oee.availability ?? 0} color={C.brand} />
            <MiniRing label="Performance" value={oee.performance ?? 0} color={C.finished} />
            <MiniRing label="Quality" value={oee.quality ?? 0} color={C.idle} />
            <MiniRing label="OEE Total" value={oee.oee ?? 0} color={C.rework} />
          </div>
        </ChartCard>
      </section>

      {/* Chart row 2 — Inventory polar + Machine utilisation bar */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Inventory Value by Type" icon={Boxes} onClick={() => setModal({ type: 'inventory' })} count={inr(rep?.inventory?.totalValue)}>
          {rep?.inventory?.byType?.length ? (
            <div className="flex items-center gap-4">
              <div className="w-[190px] h-[190px] shrink-0">
                <PolarArea data={polar(rep.inventory.byType.map((t) => ({ l: cap(t.type), v: t.value, c: C[t.type] || C.offline })))} options={polarOpts} />
              </div>
              <div className="flex-1 space-y-1.5">
                {rep.inventory.byType.map((t) => (
                  <LegendRow key={t.type} color={C[t.type] || C.offline} label={cap(t.type)} value={inr(t.value)} raw />
                ))}
                {rep.inventory.lowStock > 0 && <div className="pt-1 text-[11px] text-state-down font-semibold flex items-center gap-1"><CircleDot className="h-3 w-3" /> {rep.inventory.lowStock} item(s) low on stock</div>}
              </div>
            </div>
          ) : <Empty text="No inventory items." />}
        </ChartCard>

        <ChartCard title="Machine Utilisation (running time)" icon={Activity} onClick={() => setModal({ type: 'machines' })} count={`${rep?.machines?.availabilityPct ?? 0}% avg`}>
          {rep?.machines?.byMachine?.length ? (
            <div className="h-[210px]">
              <Bar data={{
                labels: rep.machines.byMachine.map((m) => m.code),
                datasets: [
                  { label: 'Running', data: rep.machines.byMachine.map((m) => Math.round(m.running / 3600 * 10) / 10), backgroundColor: C.running, borderRadius: 4, stack: 's' },
                  { label: 'Idle', data: rep.machines.byMachine.map((m) => Math.round(m.idle / 3600 * 10) / 10), backgroundColor: C.idle, borderRadius: 4, stack: 's' },
                  { label: 'Down', data: rep.machines.byMachine.map((m) => Math.round(m.down / 3600 * 10) / 10), backgroundColor: C.down, borderRadius: 4, stack: 's' },
                ],
              }} options={barOpts} />
            </div>
          ) : <Empty text="No machine data available." />}
        </ChartCard>
      </section>

      {/* Smart Suggestions */}
      <section className="panel">
        <div className="panel-header">
          <div className="panel-title"><Sparkles className="h-4 w-4 text-brand-500" /> Smart Suggestions
            <span className="ml-1 text-[9.5px] font-bold bg-brand-50 text-brand-600 border border-brand-500/20 rounded-full px-2 py-0.5">AUTO</span></div>
        </div>
        <div className="space-y-2">
          {(suggestions.data || []).length === 0
            ? <div className="text-center py-6 text-[12.5px] text-ink-400">No suggestions right now. Everything is running smoothly.</div>
            : (suggestions.data || []).map((s, i) => <SuggestionCard key={i} s={s} />)}
        </div>
      </section>

      {/* Process flow + Orders + Alerts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="px-5 py-3.5 border-b border-ink-100 flex items-center justify-between">
            <div className="panel-title"><Zap className="h-4 w-4 text-brand-500" /> Live Process Flow</div>
            {activeJob.data && <span className="chip-blue text-[10.5px] font-bold">{activeJob.data.orderNumber}</span>}
          </div>
          <div className="p-5"><ProcessFlow job={activeJob.data} /></div>
        </div>

        <OrdersAwaitingPlanningPanel orders={newOrders.data || []} onOpen={() => setModal({ type: 'orders' })} />
      </section>

      <section className="card">
        <div className="px-5 py-3.5 border-b border-ink-100 flex items-center justify-between cursor-pointer hover:bg-ink-50/50" onClick={() => setModal({ type: 'alerts' })}>
          <div className="panel-title"><Siren className="h-4 w-4 text-state-down" /> Active Alerts</div>
          <span className="text-[10px] font-bold text-ink-400">{(alerts.data || []).length} alert{(alerts.data || []).length !== 1 ? 's' : ''} · view all →</span>
        </div>
        <div className="p-4">
          {(alerts.data || []).length === 0
            ? <div className="text-center py-6 text-[12.5px] text-ink-400">No active alerts. All systems nominal. ✓</div>
            : (alerts.data || []).slice(0, 5).map((a, i) => (
              <div key={i} className={clsx('alert-item', a.severity === 'crit' ? 'ai-crit' : a.severity === 'warn' ? 'ai-warn' : 'ai-info')}>
                <span className="text-[14px]">{a.icon || '⚠'}</span>
                <div className="flex-1"><div className="font-bold text-ink-900">{a.title}</div><div className="text-[11.5px] text-ink-600 mt-0.5">{a.desc}</div></div>
              </div>
            ))}
        </div>
      </section>

      {modal && <DetailModal ctx={modal} data={{ overview: data, machines: mList, mStats, report: rep, orders: newOrders.data || [], alerts: alerts.data || [] }} onClose={() => setModal(null)} />}
    </div>
  );
}

/* ── Chart helpers ───────────────────────────────────────────────────────── */
const doughnut = (items) => ({ labels: items.map((x) => x.l), datasets: [{ data: items.map((x) => x.v), backgroundColor: items.map((x) => x.c), borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', hoverOffset: 6 }] });
const polar = (items) => ({ labels: items.map((x) => x.l), datasets: [{ data: items.map((x) => x.v), backgroundColor: items.map((x) => x.c + 'cc'), borderWidth: 1, borderColor: items.map((x) => x.c) }] });
const doughnutOpts = { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.raw}` } } } };
const polarOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { r: { ticks: { display: false, backdropColor: 'transparent' }, grid: { color: 'rgba(136,150,180,0.18)' } } } };
const barOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw}h` } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } }, y: { stacked: true, grid: { color: 'rgba(136,150,180,0.15)' }, ticks: { font: { size: 10 }, callback: (v) => v + 'h' } } } };

/* ── Cards & pieces ──────────────────────────────────────────────────────── */
function Kpi({ accent, icon: Icon, label, value, unit, sub, onClick }) {
  return (
    <button onClick={onClick} className="card p-4 text-left relative overflow-hidden group hover:-translate-y-0.5 hover:shadow-cardHov transition-all">
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: accent }} />
      <div className="flex items-center justify-between mb-1.5">
        <span className="grid place-items-center h-7 w-7 rounded-lg" style={{ background: accent + '18', color: accent }}><Icon className="h-4 w-4" /></span>
        <ArrowRight className="h-3.5 w-3.5 text-ink-300 group-hover:text-brand-500 group-hover:translate-x-0.5 transition" />
      </div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">{label}</div>
      <div className="text-[22px] font-bold text-ink-900 leading-none tabular-nums mt-1">{value}{unit && <span className="text-[13px] text-ink-400 ml-0.5 font-semibold">{unit}</span>}</div>
      <div className="text-[11px] text-ink-400 mt-1">{sub}</div>
    </button>
  );
}

function ChartCard({ title, icon: Icon, count, onClick, children }) {
  return (
    <div className="card overflow-hidden">
      <button onClick={onClick} className="w-full px-5 py-3.5 border-b border-ink-100 flex items-center justify-between hover:bg-ink-50/50 transition group">
        <div className="panel-title"><Icon className="h-4 w-4 text-brand-500" /> {title}</div>
        <span className="text-[10.5px] text-ink-400 flex items-center gap-1">{count} <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition" /></span>
      </button>
      <div className="p-5">{children}</div>
    </div>
  );
}

function LegendRow({ color, label, value, total, raw }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="flex items-center gap-1.5 text-ink-600"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}</span>
      <span className="tabular-nums"><b className="text-ink-900">{raw ? value : num(value)}</b>{!raw && total ? <span className="text-ink-400 text-[10.5px] ml-1">{total ? Math.round((value / total) * 100) : 0}%</span> : ''}</span>
    </div>
  );
}

function MiniRing({ label, value, color }) {
  const r = 26, circ = 2 * Math.PI * r, off = circ - (value || 0) * circ;
  return (
    <div className="flex flex-col items-center gap-1 py-0.5">
      <div className="relative w-[66px] h-[66px]">
        <svg width="66" height="66" viewBox="0 0 66 66" className="-rotate-90">
          <circle cx="33" cy="33" r={r} fill="none" className="stroke-ink-100" strokeWidth="6" />
          <circle cx="33" cy="33" r={r} fill="none" stroke={color} strokeWidth="6" strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round" style={{ transition: 'stroke-dashoffset .5s' }} />
        </svg>
        <div className="absolute inset-0 grid place-items-center font-bold text-[13px] text-ink-900">{Math.round((value || 0) * 100)}%</div>
      </div>
      <div className="text-[9px] font-bold text-ink-400 uppercase tracking-wider">{label}</div>
    </div>
  );
}

const Empty = ({ text }) => <div className="text-center py-8 text-[12px] text-ink-400">{text}</div>;

function SuggestionCard({ s }) {
  const bg = { opportunity: 'bg-state-running/5 border-state-running/25', urgent: 'bg-state-down/5 border-state-down/25', warning: 'bg-state-idle/5 border-state-idle/25', info: 'bg-brand-50 border-brand-500/20' };
  const tc = { opportunity: 'text-state-running', urgent: 'text-state-down', warning: 'text-state-idle', info: 'text-brand-600' };
  return (
    <div className={clsx('rounded-lg px-3.5 py-3 flex items-start gap-3 border', bg[s.kind] || 'bg-ink-50 border-ink-200')}>
      <span className="text-[20px] shrink-0">{s.icon}</span>
      <div className="flex-1"><div className={clsx('font-bold text-[12.5px]', tc[s.kind])}>{s.title}</div><div className="text-[11.5px] text-ink-600 mt-0.5">{s.desc}</div></div>
      {s.action && <Link to={s.action.href} className="shrink-0 rounded-md bg-white border border-ink-200 hover:bg-ink-50 text-[11px] font-bold text-ink-700 px-2.5 py-1 flex items-center gap-1">{s.action.label} <ArrowRight className="h-3 w-3" /></Link>}
    </div>
  );
}

function ProcessFlow({ job }) {
  if (!job) return <div className="text-center py-8 text-[12.5px] text-ink-400">No active job. Start one from Planning &amp; Orders.</div>;
  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {STAGE_META.map((sm, idx) => {
        const stage = job.stages?.find((x) => x.stage === sm.key);
        const status = stage?.status || 'pending';
        const isActive = status === 'in_progress', isDone = status === 'completed', isPending = !isActive && !isDone;
        return (
          <div key={sm.key} className="flex items-center shrink-0">
            <div className="flex flex-col items-center gap-1 min-w-[80px]">
              <div className={clsx('w-[44px] h-[44px] rounded-lg grid place-items-center text-[18px] border-2 relative',
                isDone && 'bg-state-running/10 border-state-running', isActive && 'bg-brand-500/10 border-brand-500 ring-4 ring-brand-500/15', isPending && 'bg-ink-50 border-ink-200 opacity-50')}>
                {sm.icon}{isDone && <span className="absolute -top-1 -right-1 text-[11px]">✓</span>}
              </div>
              <div className={clsx('text-[9px] uppercase tracking-wider font-bold', isDone && 'text-state-running', isActive && 'text-brand-600', isPending && 'text-ink-400')}>{sm.label}</div>
              <div className="text-[10px] font-bold text-ink-700">{stage?.weightOutKg ? `${stage.weightOutKg} kg` : stage?.weightInKg ? `${stage.weightInKg} kg` : '—'}</div>
            </div>
            {idx < STAGE_META.length - 1 && <div className="w-5 h-0.5 bg-ink-200" />}
          </div>
        );
      })}
    </div>
  );
}

function OrdersAwaitingPlanningPanel({ orders, onOpen }) {
  const w = { high: 0, medium: 1, normal: 2 };
  const awaiting = (orders || []).filter((o) => (o.productionStatus || 'notStarted') === 'notStarted')
    .sort((a, b) => (w[a.priority || 'normal'] - w[b.priority || 'normal']) || ((a.dueDate ? +new Date(a.dueDate) : Infinity) - (b.dueDate ? +new Date(b.dueDate) : Infinity)));
  return (
    <div className="card">
      <button onClick={onOpen} className="w-full px-5 py-3.5 border-b border-ink-100 flex items-center justify-between hover:bg-ink-50/50 transition group">
        <div className="panel-title"><ShoppingCart className="h-4 w-4 text-brand-500" /> Orders Awaiting Planning</div>
        <span className="text-[10.5px] text-brand-600 font-semibold flex items-center gap-1">{awaiting.length} waiting <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition" /></span>
      </button>
      <div className="p-4">
        {awaiting.length === 0
          ? <div className="text-center py-8"><div className="text-[28px] mb-1">✓</div><div className="text-[12.5px] text-ink-700 font-bold">All caught up!</div><div className="text-[11px] text-ink-400 mt-0.5">No orders waiting to be planned.</div></div>
          : <div className="max-h-[300px] overflow-y-auto space-y-1.5">{awaiting.slice(0, 8).map((so) => <AwaitingOrderRow key={so._id} order={so} />)}</div>}
      </div>
    </div>
  );
}

function AwaitingOrderRow({ order }) {
  const due = order.dueDate ? Math.ceil((new Date(order.dueDate) - new Date()) / 86400000) : null;
  const pc = order.priority === 'high' ? 'border-l-state-down' : order.priority === 'medium' ? 'border-l-state-idle' : 'border-l-state-running';
  const first = order.lines?.[0];
  return (
    <div className={clsx('rounded-md border border-ink-100 border-l-[3px] bg-white px-2.5 py-2 flex items-center gap-2', pc)}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="font-mono text-[11px] font-bold text-brand-600">{order.orderNumber}</span>
          {order.priority === 'high' && <span className="chip-red text-[9px] font-bold">HIGH</span>}
          {due !== null && due < 0 && <span className="chip-red text-[9px] font-bold">{Math.abs(due)}d OVERDUE</span>}
          {due !== null && due >= 0 && due <= 3 && <span className="chip-yellow text-[9px] font-bold">{due}d LEFT</span>}
        </div>
        <div className="text-[12px] font-semibold text-ink-900 truncate">{order.customer}</div>
        <div className="text-[10.5px] text-ink-500 truncate">{first?.productName} · {first?.qty} {first?.uom || 'kg'}{order.lines?.length > 1 ? ` (+${order.lines.length - 1})` : ''}</div>
      </div>
      <Link to="/sales-orders" className="shrink-0 inline-flex items-center gap-1 bg-brand-500 hover:bg-brand-600 text-white text-[10.5px] font-bold px-2.5 py-1.5 rounded-md"><Calendar className="h-3 w-3" /> Plan</Link>
    </div>
  );
}

/* ── Detail modal — opens on any card click ─────────────────────────────── */
function DetailModal({ ctx, data, onClose }) {
  const { overview, machines, mStats, report, orders, alerts } = data;
  const TITLES = { machines: 'Machine Fleet', production: 'Production', oee: 'OEE Breakdown', quality: 'Quality Control', inventory: 'Inventory', dispatch: 'Dispatch', orders: 'Sales Orders — Planning', alerts: 'Active Alerts' };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-3xl my-8 max-h-[86vh] flex flex-col">
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between shrink-0">
          <h2 className="text-[15px] font-bold text-ink-900">{TITLES[ctx.type] || 'Details'}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto">
          {ctx.type === 'machines' && <MachinesDetail machines={machines} stats={mStats} report={report} />}
          {ctx.type === 'production' && <ProductionDetail overview={overview} report={report} />}
          {ctx.type === 'oee' && <ProductionDetail overview={overview} report={report} oeeFocus />}
          {ctx.type === 'quality' && <QualityDetail report={report} />}
          {ctx.type === 'inventory' && <InventoryDetail report={report} />}
          {ctx.type === 'dispatch' && <DispatchDetail overview={overview} report={report} />}
          {ctx.type === 'orders' && <OrdersDetail orders={orders} />}
          {ctx.type === 'alerts' && <AlertsDetail alerts={alerts} />}
        </div>
      </div>
    </div>
  );
}

function MTable({ head, rows }) {
  return (
    <div className="overflow-x-auto border border-ink-100 rounded-lg">
      <table className="table"><thead><tr>{head.map((h, i) => <th key={i} className={clsx('th', h.r && 'text-right')}>{h.t}</th>)}</tr></thead>
        <tbody className="divide-y divide-ink-100">{rows}</tbody></table>
    </div>
  );
}
const StateChip = ({ s }) => { const cc = { running: 'chip-green', idle: 'chip-yellow', down: 'chip-red', maintenance: 'chip-purple', offline: 'chip-gray' }; return <span className={clsx(cc[s] || 'chip-gray', 'text-[10px]')}>{cap(s)}</span>; };

function MachinesDetail({ machines, stats, report }) {
  const byCode = Object.fromEntries((report?.machines?.byMachine || []).map((m) => [m.code, m]));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {['running', 'idle', 'down', 'maintenance', 'offline'].map((k) => (
          <div key={k} className="rounded-lg border border-ink-200 p-2.5 text-center"><div className="text-[18px] font-bold tabular-nums" style={{ color: C[k] }}>{stats[k]}</div><div className="text-[9.5px] uppercase tracking-wide text-ink-400">{STATE_LABEL[k]}</div></div>
        ))}
      </div>
      <MTable head={[{ t: 'Machine' }, { t: 'Stage' }, { t: 'State' }, { t: 'Availability', r: true }, { t: 'Live' }]}
        rows={machines.map((m) => {
          const live = m.currentStatus?.live || {};
          const key = Object.keys(live).find((k) => typeof live[k] === 'number' && !['state', 'status'].includes(k));
          return (
            <tr key={m._id} className="tr-hover">
              <td className="td"><div className="font-semibold text-[12px] text-ink-900">{m.name}</div><div className="font-mono text-[10px] text-ink-400">{m.code}</div></td>
              <td className="td text-[11.5px] capitalize">{cap(m.stage)}</td>
              <td className="td"><StateChip s={m.currentStatus?.state || 'offline'} /></td>
              <td className="td text-right tabular-nums font-semibold">{byCode[m.code]?.availabilityPct ?? '—'}%</td>
              <td className="td text-[11px] text-ink-500">{key ? `${cap(key)}: ${live[key]}` : '—'}</td>
            </tr>
          );
        })} />
    </div>
  );
}

function ProductionDetail({ overview, report, oeeFocus }) {
  const oee = overview?.oee || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Availability" value={pct(oee.availability)} />
        <Stat label="Performance" value={pct(oee.performance)} />
        <Stat label="Quality" value={pct(oee.quality)} />
        <Stat label="OEE Total" value={pct(oee.oee)} accent={C.rework} />
      </div>
      {!oeeFocus && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Produced" value={`${num(oee.totalProduced)} kg`} />
          <Stat label="Good" value={`${num(oee.goodProduced)} kg`} accent={C.pass} />
          <Stat label="Rejects" value={`${num(oee.rejects)} kg`} accent={C.reject} />
          <Stat label="Jobs" value={num(report?.production?.jobs)} />
        </div>
      )}
      {report?.production?.byStatus && Object.keys(report.production.byStatus).length > 0 && (
        <div><Sub>Jobs by status</Sub>{Object.entries(report.production.byStatus).map(([k, v]) => <RowBar key={k} label={cap(k)} value={v} max={Math.max(...Object.values(report.production.byStatus))} color={C.brand} />)}</div>
      )}
    </div>
  );
}

function QualityDetail({ report }) {
  const q = report?.quality;
  if (!q?.checks) return <Empty text="No QC checks recorded yet." />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Checks" value={num(q.checks)} />
        <Stat label="Passed" value={num(q.pass)} accent={C.pass} />
        <Stat label="Rejected" value={num(q.reject)} accent={C.reject} />
        <Stat label="Rejection Rate" value={`${q.rejectionRatePct}%`} accent={C.idle} />
      </div>
      {q.byStage?.length > 0 && <div><Sub>Rejects by stage</Sub>{q.byStage.map((s) => <RowBar key={s.stage} label={cap(s.stage)} value={s.rejected} max={Math.max(...q.byStage.map((x) => x.sampled), 1)} color={C.reject} note={`${num(s.rejected)}/${num(s.sampled)}`} />)}</div>}
      {q.topDefects?.length > 0 && <div><Sub>Top defects</Sub><div className="flex flex-wrap gap-1.5">{q.topDefects.map((x) => <span key={x.code} className="chip-red text-[10.5px]">{x.code} · {x.qty}</span>)}</div></div>}
    </div>
  );
}

function InventoryDetail({ report }) {
  const inv = report?.inventory;
  if (!inv?.items) return <Empty text="No inventory items." />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2"><Stat label="Items" value={num(inv.items)} /><Stat label="Total Value" value={inr(inv.totalValue)} accent={C.brand} /><Stat label="Low Stock" value={num(inv.lowStock)} accent={C.reject} /></div>
      <div><Sub>Value by type</Sub>{inv.byType.map((t) => <RowBar key={t.type} label={cap(t.type)} value={t.value} max={Math.max(...inv.byType.map((x) => x.value), 1)} color={C[t.type] || C.brand} note={inr(t.value)} />)}</div>
      {inv.lowList?.length > 0 && <div><Sub>Low stock — reorder needed</Sub><div className="space-y-1">{inv.lowList.map((x) => <div key={x.sku} className="flex items-center justify-between text-[11.5px] px-2.5 py-1.5 rounded-md bg-state-down/5 border border-state-down/15"><span className="font-mono font-semibold text-ink-800">{x.sku}</span><span className="text-state-down tabular-nums font-semibold">{num(x.onHand)} / {num(x.reorderLevel)} {x.uom}</span></div>)}</div></div>}
    </div>
  );
}

function DispatchDetail({ overview, report }) {
  const d = report?.dispatch;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2"><Stat label="Total" value={num(d?.total)} /><Stat label="Delivered" value={num(d?.delivered)} accent={C.pass} /><Stat label="Pending (overview)" value={num(overview?.dispatch?.pending)} accent={C.idle} /></div>
      {d?.byStatus && Object.keys(d.byStatus).length > 0
        ? <div><Sub>By status</Sub>{Object.entries(d.byStatus).map(([k, v]) => <RowBar key={k} label={cap(k)} value={v} max={Math.max(...Object.values(d.byStatus))} color={C.cyan} />)}</div>
        : <Empty text="No dispatches in this period." />}
    </div>
  );
}

function OrdersDetail({ orders }) {
  const list = (orders || []).slice(0, 40);
  if (!list.length) return <Empty text="No sales orders found." />;
  return (
    <MTable head={[{ t: 'Order' }, { t: 'Customer' }, { t: 'Priority' }, { t: 'Production' }, { t: 'Due' }]}
      rows={list.map((o) => (
        <tr key={o._id} className="tr-hover">
          <td className="td font-mono text-[11px] font-bold text-brand-600">{o.orderNumber}</td>
          <td className="td text-[12px]">{o.customer}</td>
          <td className="td">{o.priority === 'high' ? <span className="chip-red text-[10px]">High</span> : o.priority === 'medium' ? <span className="chip-yellow text-[10px]">Medium</span> : <span className="chip-gray text-[10px]">Normal</span>}</td>
          <td className="td text-[11.5px]">{cap(o.productionStatus || 'notStarted')}</td>
          <td className="td text-[11px] text-ink-500">{o.dueDate ? new Date(o.dueDate).toLocaleDateString() : '—'}</td>
        </tr>
      ))} />
  );
}

function AlertsDetail({ alerts }) {
  if (!alerts?.length) return <Empty text="No active alerts. All systems nominal. ✓" />;
  return <div className="space-y-2">{alerts.map((a, i) => (
    <div key={i} className={clsx('alert-item', a.severity === 'crit' ? 'ai-crit' : a.severity === 'warn' ? 'ai-warn' : 'ai-info')}>
      <span className="text-[14px]">{a.icon || '⚠'}</span>
      <div className="flex-1"><div className="font-bold text-ink-900">{a.title}</div><div className="text-[11.5px] text-ink-600 mt-0.5">{a.desc}</div></div>
    </div>
  ))}</div>;
}

const Sub = ({ children }) => <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-400 mb-2">{children}</div>;
function Stat({ label, value, accent }) {
  return <div className="rounded-lg border border-ink-200 p-3"><div className="text-[9.5px] font-bold uppercase tracking-wider text-ink-400">{label}</div><div className="text-[18px] font-bold tabular-nums" style={accent ? { color: accent } : { color: 'inherit' }}>{value}</div></div>;
}
function RowBar({ label, value, max, color, note }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[11.5px] mb-1.5">
      <span className="w-24 shrink-0 text-ink-600 truncate">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-ink-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${p}%`, background: color }} /></div>
      <span className="w-16 shrink-0 text-right tabular-nums text-ink-500">{note || num(value)}</span>
    </div>
  );
}
