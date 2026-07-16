import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, ShieldCheck, Gauge, Boxes, Truck, Factory, Printer, RefreshCw,
  AlertTriangle, TrendingDown, CheckCircle2,
} from 'lucide-react';
import clsx from 'clsx';
import { reportsApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';

/* ── formatters ──────────────────────────────────────────────────────────── */
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const dur = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};
const cap = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const C = { running: '#059669', idle: '#d97706', down: '#dc2626', maintenance: '#7c3aed', offline: '#8896b4', brand: '#1a6bff', pass: '#059669', reject: '#dc2626', rework: '#7c3aed', hold: '#d97706' };

const PRESETS = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: 'today', label: 'Today', days: 0 },
];

export function ReportsPage() {
  const user = authStore((s) => s.user);
  const [preset, setPreset] = useState('30d');

  const { fromISO, toISO } = useMemo(() => {
    const to = new Date();
    const p = PRESETS.find((x) => x.key === preset) || PRESETS[1];
    const from = new Date();
    if (p.key === 'today') from.setHours(0, 0, 0, 0);
    else from.setDate(from.getDate() - p.days);
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }, [preset]);

  const q = useQuery({
    queryKey: ['reports', 'summary', fromISO, toISO, user?.plantId],
    queryFn: async () => (await reportsApi.summary({ from: fromISO, to: toISO, plantId: user?.plantId })).data,
    refetchInterval: 60_000,
  });

  const d = q.data;
  const quality = d?.quality;
  const machines = d?.machines;
  const inventory = d?.inventory;
  const production = d?.production;
  const dispatch = d?.dispatch;

  const passRate = quality?.checks > 0 ? Math.round((quality.pass / quality.checks) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-brand-500" /> Reports &amp; Analytics
          </h1>
          <p className="text-sm text-ink-500">
            Quality, machine utilisation, inventory, production aur dispatch ka roll-up — chuni gayi period ke liye.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-0.5">
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => setPreset(p.key)}
                className={clsx('px-3 py-1.5 rounded-md text-[12px] font-semibold transition',
                  preset === p.key ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-800')}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={() => q.refetch()} disabled={q.isFetching}
            className="btn-secondary text-xs inline-flex items-center gap-1.5">
            <RefreshCw className={clsx('h-3.5 w-3.5', q.isFetching && 'animate-spin')} /> Refresh
          </button>
          <button onClick={() => window.print()} className="btn-secondary text-xs"><Printer className="h-3.5 w-3.5" /> Print</button>
        </div>
      </header>

      {q.isLoading ? (
        <div className="text-center py-16 text-[13px] text-ink-400">Loading analytics…</div>
      ) : !d ? (
        <div className="card p-10 text-center text-[13px] text-ink-500">Could not load the report.</div>
      ) : (
        <>
          {/* KPI row */}
          <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi icon={Gauge} accent={C.brand} label="Availability" value={`${machines?.availabilityPct ?? 0}%`} sub={`${machines?.count ?? 0} machines`} />
            <Kpi icon={CheckCircle2} accent={C.pass} label="QC Pass Rate" value={`${passRate}%`} sub={`${quality?.checks ?? 0} checks`} />
            <Kpi icon={TrendingDown} accent={C.reject} label="Rejection Rate" value={`${quality?.rejectionRatePct ?? 0}%`} sub={`${num(quality?.rejected)} of ${num(quality?.sampled)}`} />
            <Kpi icon={Boxes} accent={C.idle} label="Inventory Value" value={inr(inventory?.totalValue)} sub={`${inventory?.items ?? 0} items`} />
            <Kpi icon={Factory} accent={C.rework} label="Jobs" value={num(production?.jobs)} sub={`${production?.completed ?? 0} completed`} />
            <Kpi icon={Truck} accent="#0891b2" label="Dispatches" value={num(dispatch?.total)} sub={`${dispatch?.delivered ?? 0} delivered`} />
          </section>

          {/* Quality + Machines */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section icon={ShieldCheck} title="Quality" accent={C.pass}>
              {quality?.checks ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-5 flex-wrap">
                    <Donut
                      size={128} thickness={16}
                      center={<div className="text-center"><div className="text-[22px] font-bold text-ink-900 leading-none">{passRate}%</div><div className="text-[10px] text-ink-400 uppercase tracking-wide mt-0.5">pass</div></div>}
                      segments={[
                        { value: quality.pass, color: C.pass, label: 'Pass' },
                        { value: quality.reject, color: C.reject, label: 'Reject' },
                        { value: quality.rework, color: C.rework, label: 'Rework' },
                        { value: quality.hold, color: C.hold, label: 'Hold' },
                      ]}
                    />
                    <div className="flex-1 min-w-[160px] space-y-1.5">
                      <Legend color={C.pass} label="Passed" value={quality.pass} />
                      <Legend color={C.reject} label="Rejected" value={quality.reject} />
                      <Legend color={C.rework} label="Rework" value={quality.rework} />
                      <Legend color={C.hold} label="Hold" value={quality.hold} />
                    </div>
                  </div>

                  {quality.byStage?.length > 0 && (
                    <div>
                      <SubLabel>Rejects by stage</SubLabel>
                      <div className="space-y-1.5">
                        {quality.byStage.map((s) => (
                          <HBar key={s.stage} label={cap(s.stage)} value={s.rejected} max={Math.max(...quality.byStage.map((x) => x.sampled), 1)}
                            trackValue={s.sampled} color={C.reject} note={`${num(s.rejected)}/${num(s.sampled)}`} />
                        ))}
                      </div>
                    </div>
                  )}

                  {quality.topDefects?.length > 0 && (
                    <div>
                      <SubLabel>Top defects</SubLabel>
                      <div className="flex flex-wrap gap-1.5">
                        {quality.topDefects.map((x) => (
                          <span key={x.code} className="chip-red text-[10.5px]">{x.code} · {x.qty}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : <Empty text="Is period me koi QC check record nahi hua." />}
            </Section>

            <Section icon={Gauge} title="Machine Utilisation" accent={C.brand}
              right={<span className="text-[11px] text-ink-400">Availability <b className="text-ink-700">{machines?.availabilityPct ?? 0}%</b></span>}>
              {machines?.byMachine?.length ? (
                <div className="space-y-3">
                  {machines.byMachine.map((m) => {
                    const tracked = m.tracked || 1;
                    const segs = [
                      { w: (m.running / tracked) * 100, color: C.running },
                      { w: (m.idle / tracked) * 100, color: C.idle },
                      { w: (m.down / tracked) * 100, color: C.down },
                      { w: (m.maintenance / tracked) * 100, color: C.maintenance },
                      { w: (m.offline / tracked) * 100, color: C.offline },
                    ].filter((s) => s.w > 0);
                    return (
                      <div key={m.code}>
                        <div className="flex items-center justify-between text-[11.5px] mb-1">
                          <span className="font-semibold text-ink-800 truncate">{m.name} <span className="text-ink-400 font-mono text-[10px]">· {cap(m.stage)}</span></span>
                          <span className="tabular-nums font-bold" style={{ color: m.availabilityPct >= 70 ? C.running : m.availabilityPct >= 40 ? C.idle : C.down }}>{m.availabilityPct}%</span>
                        </div>
                        <div className="h-3 rounded-full overflow-hidden bg-ink-100 flex">
                          {segs.map((s, i) => <div key={i} style={{ width: `${s.w}%`, background: s.color }} />)}
                        </div>
                        <div className="flex gap-3 mt-1 text-[10px] text-ink-400 tabular-nums">
                          <span style={{ color: C.running }}>▮ Run {dur(m.running)}</span>
                          <span style={{ color: C.idle }}>▮ Idle {dur(m.idle)}</span>
                          <span style={{ color: C.down }}>▮ Down {dur(m.down)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <Empty text="Koi machine data nahi." />}
            </Section>
          </div>

          {/* Inventory + Production + Dispatch */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section icon={Boxes} title="Inventory" accent={C.idle}
              right={<span className="text-[11px] text-ink-400">Value <b className="text-ink-700">{inr(inventory?.totalValue)}</b></span>}>
              {inventory?.items ? (
                <div className="space-y-4">
                  <div>
                    <SubLabel>Value by type</SubLabel>
                    <div className="space-y-1.5">
                      {inventory.byType.map((t) => (
                        <HBar key={t.type} label={cap(t.type)} value={t.value} max={Math.max(...inventory.byType.map((x) => x.value), 1)} color={C.brand} note={inr(t.value)} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <SubLabel>Low stock — reorder needed ({inventory.lowStock})</SubLabel>
                    {inventory.lowList.length ? (
                      <div className="space-y-1">
                        {inventory.lowList.map((x) => (
                          <div key={x.sku} className="flex items-center justify-between text-[11.5px] px-2.5 py-1.5 rounded-md bg-state-down/5 border border-state-down/15">
                            <span className="font-mono font-semibold text-ink-800 truncate">{x.sku}</span>
                            <span className="text-state-down tabular-nums font-semibold shrink-0">{num(x.onHand)} / {num(x.reorderLevel)} {x.uom}</span>
                          </div>
                        ))}
                      </div>
                    ) : <div className="text-[12px] text-state-running flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Sab stock reorder level ke upar hai.</div>}
                  </div>
                </div>
              ) : <Empty text="Koi inventory item nahi." />}
            </Section>

            <div className="grid grid-cols-1 gap-4">
              <Section icon={Factory} title="Production" accent={C.rework}
                right={<span className="text-[11px] text-ink-400">{num(production?.producedKg)} kg produced</span>}>
                {production?.jobs ? (
                  <StatusBars data={production.byStatus} colorFor={(k) => ({ completed: C.running, in_progress: C.brand, released: C.idle, planned: C.offline, draft: C.offline }[k] || C.offline)} />
                ) : <Empty text="Is period me koi job nahi bani." />}
              </Section>

              <Section icon={Truck} title="Dispatch" accent="#0891b2">
                {dispatch?.total ? (
                  <StatusBars data={dispatch.byStatus} colorFor={(k) => ({ delivered: C.running, dispatched: C.brand, loaded: C.idle, packed: C.idle, planned: C.offline, cancelled: C.down }[k] || C.offline)} />
                ) : <Empty text="Is period me koi dispatch nahi." />}
              </Section>
            </div>
          </div>

          <div className="text-[11px] text-ink-400 text-center pt-1">
            {d.range && <>Showing {new Date(d.range.from).toLocaleDateString()} → {new Date(d.range.to).toLocaleDateString()}</>}
          </div>
        </>
      )}
    </div>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */
function Kpi({ icon: Icon, accent, label, value, sub }) {
  return (
    <div className="card p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: accent }} />
      <div className="flex items-center gap-2 mb-1.5">
        <span className="grid place-items-center h-7 w-7 rounded-lg" style={{ background: accent + '18', color: accent }}><Icon className="h-4 w-4" /></span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">{label}</span>
      </div>
      <div className="text-[22px] font-bold text-ink-900 leading-none tabular-nums">{value}</div>
      <div className="text-[11px] text-ink-400 mt-1">{sub}</div>
    </div>
  );
}

function Section({ icon: Icon, title, accent, right, children }) {
  return (
    <div className="card">
      <div className="px-5 py-3.5 border-b border-ink-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center h-7 w-7 rounded-lg" style={{ background: (accent || '#1a6bff') + '18', color: accent || '#1a6bff' }}><Icon className="h-4 w-4" /></span>
          <h2 className="text-[14px] font-bold text-ink-900">{title}</h2>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

const SubLabel = ({ children }) => <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-400 mb-2">{children}</div>;
const Empty = ({ text }) => <div className="text-center py-6 text-[12px] text-ink-400">{text}</div>;

function Legend({ color, label, value }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="flex items-center gap-1.5 text-ink-600"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}</span>
      <span className="font-bold text-ink-900 tabular-nums">{num(value)}</span>
    </div>
  );
}

function HBar({ label, value, max, color, note, trackValue }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const trackPct = trackValue && max > 0 ? Math.min(100, (trackValue / max) * 100) : null;
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      <span className="w-24 shrink-0 text-ink-600 truncate">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-ink-100 relative overflow-hidden">
        {trackPct !== null && <div className="absolute inset-y-0 left-0 rounded-full bg-ink-200" style={{ width: `${trackPct}%` }} />}
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-16 shrink-0 text-right tabular-nums text-ink-500">{note}</span>
    </div>
  );
}

function StatusBars({ data, colorFor }) {
  const entries = Object.entries(data || {});
  const max = Math.max(...entries.map(([, v]) => v), 1);
  if (!entries.length) return <Empty text="No data." />;
  return (
    <div className="space-y-1.5">
      {entries.sort((a, b) => b[1] - a[1]).map(([k, v]) => (
        <HBar key={k} label={cap(k)} value={v} max={max} color={colorFor(k)} note={num(v)} />
      ))}
    </div>
  );
}

/* Multi-segment SVG donut with an optional center node. */
function Donut({ segments, size = 120, thickness = 14, center }) {
  const total = segments.reduce((n, s) => n + (s.value || 0), 0);
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} className="stroke-ink-100" />
        {total > 0 && segments.map((s, i) => {
          const len = ((s.value || 0) / total) * circ;
          if (len <= 0) return null;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc}
              transform={`rotate(-90 ${size / 2} ${size / 2})`} />
          );
          acc += len;
          return el;
        })}
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center">{center}</div>}
    </div>
  );
}
