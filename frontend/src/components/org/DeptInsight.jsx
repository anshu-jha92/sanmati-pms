/**
 * Department-aware insight panel — shows each department the data IT actually
 * owns, instead of showing "Machines" everywhere.
 *
 * What a department sees is driven by the same signal the RBAC uses: the modules
 * its blueprint roles have permission on. Sanmati is a flexible-packaging maker
 * (print → laminate → slit → cut → pack), so only Leadership, Planning, Production
 * and Maintenance have any `machines` permission — Sales, Quality, Store, Purchase,
 * Dispatch and Administration do not, and get their own domain data instead.
 *
 * READ-ONLY: every query here is a GET against an existing endpoint. Nothing is
 * created or modified. Panels degrade gracefully if the viewer lacks permission
 * for that module.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  Cpu, ShoppingCart, CalendarClock, ShieldCheck, Boxes, Truck,
  Wrench, Users, Gauge, AlertTriangle,
} from 'lucide-react';
import {
  salesOrderApi, jobApi, qcApi, inventoryApi, purchaseOrderApi,
  dispatchApi, downtimeApi, adminApi,
} from '../../api/endpoints.js';

/** Departments whose roles actually hold a `machines` permission. */
export const DEPT_HAS_MACHINES = new Set(['leadership', 'planning', 'production', 'maintenance']);

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const cap = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/* ── shared bits ── */
function Tile({ label, value, color = '#0f172a', sub }) {
  return (
    <div className="rounded-lg border border-ink-200 p-3">
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-ink-400">{label}</div>
      <div className="text-[19px] font-bold tabular-nums leading-none mt-1" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-ink-400 mt-1">{sub}</div>}
    </div>
  );
}

const Tiles = ({ children }) => <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{children}</div>;

function Shell({ icon: Icon, title, count, children }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-brand-500" />
        <h2 className="font-bold text-[14px] text-ink-900">{title}</h2>
        {count !== undefined && <span className="chip-gray text-[10px]">{count}</span>}
      </div>
      {children}
    </div>
  );
}

const Empty = ({ text }) => (
  <div className="text-[12px] text-ink-400 py-6 text-center bg-ink-50/50 rounded-lg border border-dashed border-ink-200">{text}</div>
);

const NoAccess = () => (
  <div className="text-[11.5px] text-ink-400 py-5 text-center bg-ink-50/50 rounded-lg border border-dashed border-ink-200">
    This data isn’t visible with your current access.
  </div>
);

/** Every panel uses this so a 403 never breaks the page. */
function useSafe(key, fn) {
  return useQuery({ queryKey: key, queryFn: fn, retry: false, staleTime: 30_000 });
}

/* ══════════════ SALES — the order book ══════════════ */
function SalesPanel() {
  const q = useSafe(['org', 'sales-orders'], async () => (await salesOrderApi.list({ limit: 100 })).data);
  if (q.isError) return <Shell icon={ShoppingCart} title="Sales — Order Book"><NoAccess /></Shell>;
  const orders = q.data || [];
  const now = Date.now();
  const awaiting = orders.filter((o) => (o.productionStatus || 'notStarted') === 'notStarted');
  const inProd = orders.filter((o) => o.productionStatus === 'inProgress');
  const overdue = orders.filter((o) => o.dueDate && new Date(o.dueDate).getTime() < now && o.status !== 'fulfilled');

  return (
    <Shell icon={ShoppingCart} title="Sales — Order Book" count={orders.length}>
      <Tiles>
        <Tile label="Total orders" value={num(orders.length)} />
        <Tile label="Awaiting planning" value={num(awaiting.length)} color="#d97706" />
        <Tile label="In production" value={num(inProd.length)} color="#1a6bff" />
        <Tile label="Overdue" value={num(overdue.length)} color="#dc2626" />
      </Tiles>
      {orders.length === 0 ? <div className="mt-3"><Empty text="No sales orders yet." /></div> : (
        <div className="mt-3">
          <Sub>Latest orders</Sub>
          <div className="space-y-1">
            {orders.slice(0, 5).map((o) => (
              <Link key={o._id} to="/sales-orders" className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-ink-100 hover:bg-brand-50/40 transition">
                <span className="font-mono text-[11px] font-bold text-brand-600">{o.orderNumber}</span>
                <span className="text-[11.5px] text-ink-700 truncate flex-1">{o.customer}</span>
                {o.priority === 'high' && <span className="chip-red text-[9px]">HIGH</span>}
                <span className="text-[10.5px] text-ink-400 shrink-0">{o.dueDate ? new Date(o.dueDate).toLocaleDateString() : '—'}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

/* ══════════════ PLANNING / PPC — the schedule ══════════════ */
function PlanningPanel({ machines }) {
  const q = useSafe(['org', 'jobs'], async () => (await jobApi.list({ limit: 100 })).data);
  if (q.isError) return <Shell icon={CalendarClock} title="Planning — Job Schedule"><NoAccess /></Shell>;
  const jobs = q.data || [];
  const by = (s) => jobs.filter((j) => j.status === s).length;

  return (
    <Shell icon={CalendarClock} title="Planning — Job Schedule" count={jobs.length}>
      <Tiles>
        <Tile label="Total jobs" value={num(jobs.length)} />
        <Tile label="Planned" value={num(by('planned'))} color="#d97706" />
        <Tile label="In progress" value={num(by('in_progress'))} color="#1a6bff" />
        <Tile label="Machines free" value={num(machines.filter((m) => m.currentStatus?.state === 'idle').length)} color="#059669" sub={`of ${machines.length} machines`} />
      </Tiles>
      {jobs.length === 0 && <div className="mt-3"><Empty text="No jobs scheduled yet." /></div>}
    </Shell>
  );
}

/* ══════════════ PRODUCTION — machines + active jobs ══════════════ */
function ProductionPanel({ machines }) {
  const q = useSafe(['org', 'jobs'], async () => (await jobApi.list({ limit: 100 })).data);
  const jobs = q.data || [];
  const st = (s) => machines.filter((m) => (m.currentStatus?.state || 'offline') === s).length;
  const byStage = {};
  for (const m of machines) (byStage[m.stage || 'other'] ||= []).push(m);

  return (
    <Shell icon={Cpu} title="Production — Machines & Jobs" count={machines.length}>
      <Tiles>
        <Tile label="Running" value={num(st('running'))} color="#059669" />
        <Tile label="Idle" value={num(st('idle'))} color="#d97706" />
        <Tile label="Down" value={num(st('down'))} color="#dc2626" />
        <Tile label="Active jobs" value={num(jobs.filter((j) => j.status === 'in_progress').length)} color="#1a6bff" />
      </Tiles>
      {machines.length === 0 ? <div className="mt-3"><Empty text="No machines yet." /></div> : (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {Object.entries(byStage).map(([stage, list]) => (
            <div key={stage} className="rounded-lg border border-ink-100 p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[11.5px] font-bold text-ink-900 capitalize">{cap(stage)}</div>
                <span className="chip-gray text-[9.5px]">{list.length}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {list.map((m) => (
                  <Link key={m._id} to={`/machines/${m._id}`}
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-ink-200 bg-ink-50 hover:bg-brand-50 hover:text-brand-700 transition">
                    {m.code}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

/* ══════════════ QUALITY — checks ══════════════ */
function QualityPanel() {
  const q = useSafe(['org', 'qc'], async () => (await qcApi.list({ limit: 200 })).data);
  if (q.isError) return <Shell icon={ShieldCheck} title="Quality — Inspections"><NoAccess /></Shell>;
  const checks = q.data || [];
  const d = (x) => checks.filter((c) => c.decision === x).length;
  const passRate = checks.length ? Math.round((d('pass') / checks.length) * 100) : 0;

  return (
    <Shell icon={ShieldCheck} title="Quality — Inspections" count={checks.length}>
      <Tiles>
        <Tile label="Checks" value={num(checks.length)} />
        <Tile label="Passed" value={num(d('pass'))} color="#059669" />
        <Tile label="Rejected" value={num(d('reject'))} color="#dc2626" />
        <Tile label="Pass rate" value={`${passRate}%`} color="#1a6bff" />
      </Tiles>
      {checks.length === 0 && <div className="mt-3"><Empty text="No QC checks recorded yet." /></div>}
    </Shell>
  );
}

/* ══════════════ STORE / MATERIALS — stock ══════════════ */
function StorePanel() {
  const q = useSafe(['org', 'inventory'], async () => (await inventoryApi.list({ limit: 200 })).data);
  if (q.isError) return <Shell icon={Boxes} title="Store — Inventory"><NoAccess /></Shell>;
  const items = q.data || [];
  const value = items.reduce((n, i) => n + (i.onHand || 0) * (i.unitCost || 0), 0);
  const low = items.filter((i) => (i.reorderLevel || 0) > 0 && (i.onHand || 0) < i.reorderLevel);

  return (
    <Shell icon={Boxes} title="Store — Inventory" count={items.length}>
      <Tiles>
        <Tile label="Items" value={num(items.length)} />
        <Tile label="Stock value" value={inr(Math.round(value))} color="#1a6bff" />
        <Tile label="Low stock" value={num(low.length)} color="#dc2626" />
        <Tile label="Types" value={num(new Set(items.map((i) => i.type)).size)} />
      </Tiles>
      {low.length > 0 && (
        <div className="mt-3">
          <Sub>Reorder needed</Sub>
          <div className="space-y-1">
            {low.slice(0, 5).map((i) => (
              <Link key={i._id} to="/raw-materials" className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-state-down/5 border border-state-down/15 text-[11.5px]">
                <span className="font-mono font-semibold text-ink-800">{i.sku}</span>
                <span className="text-state-down tabular-nums font-semibold">{num(i.onHand)} / {num(i.reorderLevel)} {i.uom}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {items.length === 0 && <div className="mt-3"><Empty text="No inventory items yet." /></div>}
    </Shell>
  );
}

/* ══════════════ PURCHASE — POs ══════════════ */
function PurchasePanel() {
  const q = useSafe(['org', 'pos'], async () => (await purchaseOrderApi.list({ limit: 100 })).data);
  if (q.isError) return <Shell icon={ShoppingCart} title="Purchase — Orders"><NoAccess /></Shell>;
  const pos = q.data || [];
  const by = (s) => pos.filter((p) => p.status === s).length;
  const value = pos.reduce((n, p) => n + (p.totalValue || 0), 0);

  return (
    <Shell icon={ShoppingCart} title="Purchase — Orders" count={pos.length}>
      <Tiles>
        <Tile label="POs" value={num(pos.length)} />
        <Tile label="Pending" value={num(by('submitted') + by('approved'))} color="#d97706" />
        <Tile label="Received" value={num(by('received'))} color="#059669" />
        <Tile label="Value" value={inr(Math.round(value))} color="#1a6bff" />
      </Tiles>
      {pos.length === 0 && <div className="mt-3"><Empty text="No purchase orders yet." /></div>}
    </Shell>
  );
}

/* ══════════════ DISPATCH — consignments ══════════════ */
function DispatchPanel() {
  const q = useSafe(['org', 'dispatch'], async () => (await dispatchApi.list({ limit: 100 })).data);
  if (q.isError) return <Shell icon={Truck} title="Dispatch — Consignments"><NoAccess /></Shell>;
  const list = q.data || [];
  const by = (s) => list.filter((d) => d.status === s).length;

  return (
    <Shell icon={Truck} title="Dispatch — Consignments" count={list.length}>
      <Tiles>
        <Tile label="Total" value={num(list.length)} />
        <Tile label="Pending" value={num(by('pending') + by('ready'))} color="#d97706" />
        <Tile label="In transit" value={num(by('dispatched'))} color="#1a6bff" />
        <Tile label="Delivered" value={num(by('delivered'))} color="#059669" />
      </Tiles>
      {list.length === 0 && <div className="mt-3"><Empty text="No dispatches yet." /></div>}
    </Shell>
  );
}

/* ══════════════ MAINTENANCE — machine health ══════════════ */
function MaintenancePanel({ machines }) {
  const q = useSafe(['org', 'downtime-24h'], async () => (await downtimeApi.summary({})).data);
  const totals = q.data?.totals || {};
  const st = (s) => machines.filter((m) => (m.currentStatus?.state || 'offline') === s).length;
  const hrs = (sec) => `${Math.round(((sec || 0) / 3600) * 10) / 10}h`;
  const attention = machines.filter((m) => ['down', 'maintenance'].includes(m.currentStatus?.state));

  return (
    <Shell icon={Wrench} title="Maintenance — Machine Health" count={machines.length}>
      <Tiles>
        <Tile label="Down now" value={num(st('down'))} color="#dc2626" />
        <Tile label="In maintenance" value={num(st('maintenance'))} color="#7c3aed" />
        <Tile label="Running" value={num(st('running'))} color="#059669" />
        <Tile label="Downtime (24h)" value={hrs(totals.downtime)} color="#d97706" sub="idle + down" />
      </Tiles>
      {attention.length > 0 ? (
        <div className="mt-3">
          <Sub>Needs attention</Sub>
          <div className="flex flex-wrap gap-1.5">
            {attention.map((m) => (
              <Link key={m._id} to={`/machines/${m._id}`}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-state-down/25 bg-state-down/5 text-[11px] font-semibold text-state-down hover:bg-state-down/10 transition">
                <AlertTriangle className="h-3 w-3" /> {m.code}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 text-[11.5px] text-state-running font-semibold text-center py-3 bg-state-running/5 rounded-lg border border-state-running/15">
          ✓ All machines healthy
        </div>
      )}
    </Shell>
  );
}

/* ══════════════ ADMINISTRATION — people ══════════════ */
function AdminPanel() {
  const usersQ = useSafe(['org', 'users'], async () => (await adminApi.listUsers({ limit: 200 })).data);
  const teamsQ = useSafe(['org', 'teams'], async () => (await adminApi.listTeams()).data);
  const users = usersQ.data || [];
  const teams = teamsQ.data || [];

  return (
    <Shell icon={Users} title="Administration — People" count={users.length}>
      <Tiles>
        <Tile label="Employees" value={num(users.length)} />
        <Tile label="Active" value={num(users.filter((u) => u.status === 'active').length)} color="#059669" />
        <Tile label="Teams" value={num(teams.length)} color="#1a6bff" />
        <Tile label="With roles" value={num(users.filter((u) => u.roles?.length).length)} color="#7c3aed" />
      </Tiles>
    </Shell>
  );
}

/* ══════════════ LEADERSHIP — plant overview ══════════════ */
function LeadershipPanel({ machines }) {
  const jobsQ = useSafe(['org', 'jobs'], async () => (await jobApi.list({ limit: 100 })).data);
  const soQ = useSafe(['org', 'sales-orders'], async () => (await salesOrderApi.list({ limit: 100 })).data);
  const jobs = jobsQ.data || [];
  const orders = soQ.data || [];
  const st = (s) => machines.filter((m) => (m.currentStatus?.state || 'offline') === s).length;

  return (
    <Shell icon={Gauge} title="Leadership — Plant Overview">
      <Tiles>
        <Tile label="Machines running" value={`${st('running')}/${machines.length}`} color="#059669" />
        <Tile label="Active jobs" value={num(jobs.filter((j) => j.status === 'in_progress').length)} color="#1a6bff" />
        <Tile label="Open orders" value={num(orders.filter((o) => o.status !== 'fulfilled').length)} color="#d97706" />
        <Tile label="Machines down" value={num(st('down'))} color="#dc2626" />
      </Tiles>
    </Shell>
  );
}

const Sub = ({ children }) => (
  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">{children}</div>
);

const PANELS = {
  leadership: LeadershipPanel,
  sales: SalesPanel,
  planning: PlanningPanel,
  production: ProductionPanel,
  quality: QualityPanel,
  store: StorePanel,
  purchase: PurchasePanel,
  dispatch: DispatchPanel,
  maintenance: MaintenancePanel,
  administration: AdminPanel,
};

/** The right panel for a department. Returns null for unknown keys. */
export function DeptInsightPanel({ deptKey, machines = [] }) {
  const P = PANELS[deptKey];
  if (!P) return null;
  return <P machines={machines} />;
}
