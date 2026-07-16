import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, X, RefreshCw, Eye, Plus, Loader2, AlertTriangle, BookOpen,
  ShoppingCart, Trash2, Package, Calendar, MapPin, CheckCircle2, Hourglass,
  Settings as SettingsIcon, ArrowRight,
} from 'lucide-react';
import clsx from 'clsx';
import { salesOrderApi, bomApi, jobApi, inventoryApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { AvailabilityModal } from '../components/workflow/AvailabilityModal.jsx';

const PRIORITY_PILL = {
  high: 'chip-red',
  medium: 'chip-yellow',
  normal: 'chip-green',
};

const STATUS_PILL = {
  new: 'chip-blue',
  planning: 'chip-yellow',
  in_progress: 'chip-blue',
  fulfilled: 'chip-green',
  cancelled: 'chip-red',
  on_hold: 'chip-red',
};

function daysUntil(date) {
  if (!date) return null;
  return Math.ceil((new Date(date) - new Date()) / 86400000);
}

export function SalesOrdersPage() {
  const user = authStore((s) => s.user);
  const nav = useNavigate();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ status: '', priority: '' });
  const [checkingSoId, setCheckingSoId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const query = useQuery({
    queryKey: ['sales-orders', filters],
    queryFn: async () => (await salesOrderApi.list({ ...filters, plantId: user?.plantId })).data,
    refetchInterval: 60_000,
  });

  const orders = query.data || [];
  const hasFilter = Object.values(filters).some(Boolean);

  // Convert a Sales Order line into a Job Order, then navigate to Planning page
  // where the manager can set start date + assign operators per stage.
  const planMut = useMutation({
    mutationFn: async (so) => {
      // Already has at least one Job? Just navigate to Planning.
      if ((so.jobsCount || 0) > 0) return so;

      // Use the first line item by default (most SOs have a single line)
      const line = so.lines?.[0];
      if (!line) throw new Error('No line items to plan');

      // Resolve BOM externalId so the Job carries its bomSnapshot for traceability
      let bomSnapshot;
      try {
        // Backend's BOM list filter param is `sku`, not `productSku`.
        // Sending the wrong key = empty result = no BOM snapshot saved on the
        // job = operator's material request form has nothing to suggest.
        const bomResp = await bomApi.list({ sku: line.sku, active: true, limit: 1 });
        const bom = (bomResp.data || [])[0];
        if (bom) {
          bomSnapshot = {
            externalId: bom.externalId,
            version: bom.version,
            components: (bom.components || []).map((c) => ({
              sku: c.sku, name: c.name, qtyPerUnit: c.qtyPerUnit,
              uom: c.uom, scrapPct: c.scrapPct, stages: c.stages,
            })),
          };
        }
      } catch { /* BOM optional — proceed without it */ }

      const job = await jobApi.create({
        salesOrderId: so._id,
        salesOrderLineId: String(line._id),
        customer: so.customer,
        product: { sku: line.sku, name: line.productName },
        plannedQty: line.qty,
        uom: line.uom || 'kg',
        priority: so.priority || 'normal',
        dueDate: so.dueDate,
        plantId: user?.plantId,
        bomSnapshot,
      });
      return { so, job: job.data };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      // Land manager on Planning page where they can set date + assign stages
      nav('/planning');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (so) => salesOrderApi.delete(so._id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e) => window.alert(e?.message || 'Could not delete this sales order.'),
  });

  const handleDelete = (so) => {
    if (window.confirm(`Delete sales order ${so.orderNumber} (${so.customer})?\nThis also removes any not-yet-started jobs linked to it.`)) {
      deleteMut.mutate(so);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[17px] font-bold text-ink-900">Sales Orders Inbox</h2>
          <p className="text-[12.5px] text-ink-500">
            Auto-synced from external ERP. Create new orders manually or check availability and convert to Job Orders.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> New Sales Order
          </button>
          <button onClick={() => query.refetch()} className="btn-secondary" disabled={query.isFetching}>
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} /> Sync from ERP
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatChip accent="blue" label="Total" value={orders.length} />
        <StatChip accent="red" label="High Priority — Not Started"
          value={orders.filter(o => o.priority === 'high' && (o.productionStatus || 'notStarted') === 'notStarted').length} />
        <StatChip accent="yellow" label="Awaiting Planning"
          value={orders.filter(o => (o.productionStatus || 'notStarted') === 'notStarted').length} />
        <StatChip accent="green" label="Completed"
          value={orders.filter(o => o.productionStatus === 'completed').length} />
      </section>

      <div className="panel !p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
            <input
              className="input pl-8 py-1.5 text-[12.5px]"
              placeholder="Search by order number or customer…"
              value={filters.q || ''}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </div>
          <select className="input w-auto py-1.5 text-[12.5px]"
            value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="new">New</option>
            <option value="planning">Planning</option>
            <option value="in_progress">In Progress</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="on_hold">On Hold</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select className="input w-auto py-1.5 text-[12.5px]"
            value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
            <option value="">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="normal">Normal</option>
          </select>
          {hasFilter && (
            <button className="btn-ghost btn-sm text-state-down" onClick={() => setFilters({ status: '', priority: '' })}>
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {query.isLoading ? (
        <div className="text-center py-10 text-[12.5px] text-ink-400">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="panel text-center py-12">
          <ShoppingCart className="h-10 w-10 text-ink-300 mx-auto mb-2" />
          <div className="font-bold text-[14px] text-ink-700">No sales orders yet</div>
          <div className="text-[12px] text-ink-500 mt-1 mb-3">
            Click "New Sales Order" to create one, or sync from ERP.
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> New Sales Order
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {orders.map((so) => (
            <OrderCard
              key={so._id}
              order={so}
              onCheckAvailability={() => setCheckingSoId(so._id)}
              onPlan={(o) => planMut.mutate(o)}
              planning={planMut.isPending}
              onDelete={() => handleDelete(so)}
              deleting={deleteMut.isPending}
            />
          ))}
        </div>
      )}

      {checkingSoId && (
        <AvailabilityModal salesOrderId={checkingSoId} onClose={() => setCheckingSoId(null)} />
      )}

      {showCreate && (
        <NewSalesOrderModal
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['sales-orders'] });
          }}
        />
      )}
    </div>
  );
}

function StatChip({ accent, label, value }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="sc-label">{label}</div>
      <div className="sc-val">{value}</div>
    </div>
  );
}

/* Production status badge config — reflects whether jobs are running */
const PRODUCTION_STATUS = {
  notStarted: {
    label: 'Production Not Started',
    cls: 'bg-state-idle/10 text-state-idle border-state-idle/30',
    icon: Hourglass,
  },
  planned: {
    label: 'Planned — Not Started',
    cls: 'bg-brand-50 text-brand-600 border-brand-500/20',
    icon: Calendar,
  },
  inProgress: {
    label: 'In Progress',
    cls: 'bg-state-running/10 text-state-running border-state-running/30',
    icon: ArrowRight,
  },
  completed: {
    label: 'Completed',
    cls: 'bg-state-running/10 text-state-running border-state-running/30',
    icon: CheckCircle2,
  },
};

function OrderCard({ order, onCheckAvailability, onPlan, planning, onDelete, deleting }) {
  const due = daysUntil(order.dueDate);
  const isUrgent = due !== null && due <= 3 && order.productionStatus !== 'completed';
  const prodStatus = PRODUCTION_STATUS[order.productionStatus || 'notStarted'];
  const ProdIcon = prodStatus.icon;
  const canPlan = ['notStarted', 'planned'].includes(order.productionStatus || 'notStarted');
  const firstJob = order.jobs?.[0];

  return (
    <div className="card overflow-hidden">
      <div className={clsx(
        'h-1',
        order.productionStatus === 'completed' ? 'bg-state-running' :
        order.productionStatus === 'inProgress' ? 'bg-gradient-to-r from-brand-500 to-state-running' :
        order.priority === 'high' ? 'bg-state-down' :
        'bg-gradient-to-r from-brand-500 to-brand-600'
      )} />
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="font-mono text-[13px] font-bold text-brand-600">{order.orderNumber}</div>
            <div className="font-bold text-[14px] text-ink-900 mt-0.5">{order.customer}</div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`${PRIORITY_PILL[order.priority]} text-[10px] font-bold capitalize`}>{order.priority}</span>
            <button
              onClick={() => onDelete?.()}
              disabled={deleting}
              title="Delete order"
              className="text-ink-300 hover:text-state-down transition p-0.5 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Production status pill — most important visual cue */}
        <div className={clsx(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10.5px] font-bold',
          prodStatus.cls
        )}>
          <ProdIcon className="h-3 w-3" />
          {prodStatus.label}
        </div>

        <div className="space-y-1 text-[11.5px]">
          <div className="flex justify-between">
            <span className="text-ink-400">Line items</span>
            <span className="font-bold tabular-nums">{order.lines?.length || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-400">Total value</span>
            <span className="font-bold tabular-nums">₹{(order.totalValue || 0).toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-400">Due date</span>
            <span className={clsx('font-bold tabular-nums', isUrgent && 'text-state-down')}>
              {order.dueDate ? new Date(order.dueDate).toLocaleDateString('en-IN') : '—'}
              {due !== null && order.productionStatus !== 'completed' && (
                <span className={clsx('ml-1 text-[10px]',
                  due < 0 ? 'text-state-down' :
                  due <= 3 ? 'text-state-idle' :
                  'text-ink-500'
                )}>
                  ({due < 0 ? `${Math.abs(due)}d overdue` : `${due}d left`})
                </span>
              )}
            </span>
          </div>
          {order.jobsCount > 0 && (
            <div className="flex justify-between">
              <span className="text-ink-400">Jobs created</span>
              <span className="font-bold tabular-nums">{order.jobsCount}</span>
            </div>
          )}
        </div>

        {/* Line items preview */}
        {order.lines?.length > 0 && (
          <div className="rounded-md bg-ink-50 p-2 space-y-1">
            {order.lines.slice(0, 2).map((line, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className="text-ink-700 truncate pr-2">{line.productName}</span>
                <span className="font-bold tabular-nums">{line.qty} {line.uom || 'kg'}</span>
              </div>
            ))}
            {order.lines.length > 2 && (
              <div className="text-[10px] text-ink-400">+{order.lines.length - 2} more</div>
            )}
          </div>
        )}

        {/* Action buttons — Plan & Schedule until production starts, Track once started */}
        <div className="flex gap-1.5">
          {canPlan ? (
            <>
              <button onClick={onCheckAvailability} className="flex-1 btn-secondary btn-sm">
                <Eye className="h-3.5 w-3.5" /> Check Stock
              </button>
              <button
                onClick={() => onPlan(order)}
                disabled={planning}
                className="flex-1 btn-primary btn-sm whitespace-nowrap"
              >
                {planning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calendar className="h-3.5 w-3.5" />}
                Plan & Schedule
              </button>
            </>
          ) : (
            <>
              <button onClick={onCheckAvailability} className="btn-secondary btn-sm">
                <Eye className="h-3.5 w-3.5" /> Stock
              </button>
              {firstJob && (
                <Link
                  to={`/tracking?orderNumber=${firstJob.orderNumber}`}
                  className="flex-1 btn-primary btn-sm whitespace-nowrap"
                >
                  <MapPin className="h-3.5 w-3.5" /> Track Production
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * NEW SALES ORDER MODAL — with BOM autocomplete for SKU dropdown
 * ══════════════════════════════════════════════════════════════════════ */
function NewSalesOrderModal({ onClose, onSaved }) {
  const user = authStore((s) => s.user);
  const [form, setForm] = useState({
    orderNumber: '',
    customer: '',
    customerEmail: '',
    customerPhone: '',
    priority: 'normal',
    dueDate: '',
    notes: '',
  });
  const [lines, setLines] = useState([{ productSku: '', productName: '', qty: '', uom: 'kg', unitPrice: 0 }]);
  const [error, setError] = useState('');

  // Load Finished Goods (FG) inventory — these are what we sell
  const fgQuery = useQuery({
    queryKey: ['fg-for-so'],
    queryFn: async () => (await inventoryApi.list({ category: 'finished_good', limit: 200 })).data,
  });
  // Also load BOMs to cross-reference which FGs have a BOM available
  const bomsQuery = useQuery({
    queryKey: ['boms-for-so'],
    queryFn: async () => (await bomApi.list({ active: true, limit: 200 })).data,
  });
  const fgItems = fgQuery.data || [];
  const boms = bomsQuery.data || [];
  const fgBySku = Object.fromEntries(fgItems.map((i) => [i.sku, i]));
  const bomBySku = Object.fromEntries(boms.map((b) => [b.productSku, b]));

  const mut = useMutation({
    mutationFn: async () => {
      const totalValue = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
      const body = {
        orderNumber: form.orderNumber || `SO-${Date.now()}`,
        customer: form.customer,
        customerEmail: form.customerEmail || undefined,
        customerPhone: form.customerPhone || undefined,
        priority: form.priority,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        notes: form.notes || undefined,
        plantId: user?.plantId,
        totalValue,
        lines: lines
          .filter((l) => l.productSku && l.qty)
          .map((l) => ({
            sku: String(l.productSku).toUpperCase(),
            productName: l.productName || l.productSku,
            qty: Number(l.qty),
            uom: l.uom || 'kg',
            unitPrice: Number(l.unitPrice) || 0,
            lineValue: (Number(l.qty) || 0) * (Number(l.unitPrice) || 0),
          })),
      };
      return (await salesOrderApi.create(body)).data;
    },
    onSuccess: onSaved,
    onError: (e) => {
      if (e.code === 'E_VALIDATION' && e.details) {
        setError(e.details.map((d) => `${d.path}: ${d.message}`).join('; '));
      } else {
        setError(e.message);
      }
    },
  });

  const updateLine = (i, patch) => setLines(lines.map((l, j) => i === j ? { ...l, ...patch } : l));
  const addLine = () => setLines([...lines, { productSku: '', productName: '', qty: '', uom: 'kg', unitPrice: 0 }]);
  const removeLine = (i) => setLines(lines.filter((_, j) => i !== j));

  // When SKU is picked, auto-fill name from FG. Cross-reference BOM exists.
  const onSkuPicked = (i, sku) => {
    const upper = String(sku).toUpperCase();
    const fg = fgBySku[upper];
    if (fg) {
      updateLine(i, {
        productSku: upper,
        productName: fg.name || upper,
        uom: fg.uom || 'kg',
      });
    } else {
      updateLine(i, { productSku: upper });
    }
  };

  const canSubmit = form.customer && lines.some((l) => l.productSku && l.qty);
  const totalValue = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}
        onClick={(e) => e.stopPropagation()}
        className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl my-4"
      >
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">Sales Orders</div>
            <h2 className="text-[17px] font-bold text-ink-900">New Sales Order</h2>
            <p className="text-[11.5px] text-ink-500 mt-0.5">
              Pick a finished good from inventory. System will auto-link to the BOM for production planning.
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Customer & meta */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Order Number</label>
              <input
                className="input font-mono"
                placeholder="Auto-generated if blank"
                value={form.orderNumber}
                onChange={(e) => setForm({ ...form, orderNumber: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <label className="label">Customer Name *</label>
              <input
                required className="input"
                placeholder="Customer / company name"
                value={form.customer}
                onChange={(e) => setForm({ ...form, customer: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Customer Email</label>
              <input
                type="email" className="input"
                placeholder="contact@example.com"
                value={form.customerEmail}
                onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Customer Phone</label>
              <input
                className="input"
                placeholder="+91 98765 43210"
                value={form.customerPhone}
                onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Priority</label>
              <select
                className="input"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="normal">Normal</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="label">Due Date</label>
              <input
                type="date" className="input"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
          </div>

          {/* Line items with BOM dropdown */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="label !text-[12px]">Line Items *</div>
              <div className="flex items-center gap-2">
                {fgItems.length > 0 && (
                  <span className="text-[10.5px] text-ink-500 inline-flex items-center gap-1">
                    <Package className="h-3 w-3" /> {fgItems.length} FG{fgItems.length !== 1 ? 's' : ''}
                  </span>
                )}
                {boms.length > 0 && (
                  <span className="text-[10.5px] text-ink-500 inline-flex items-center gap-1">
                    <BookOpen className="h-3 w-3" /> {boms.length} BOM{boms.length !== 1 ? 's' : ''}
                  </span>
                )}
                <button type="button" onClick={addLine} className="btn-secondary btn-sm">
                  <Plus className="h-3.5 w-3.5" /> Add line
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="table border border-ink-100 rounded-lg">
                <thead>
                  <tr>
                    <th className="th">Product SKU *</th>
                    <th className="th">Product Name</th>
                    <th className="th text-right">Qty *</th>
                    <th className="th">UOM</th>
                    <th className="th text-right">Unit Price (₹)</th>
                    <th className="th text-right">Line Total</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    const fg = fgBySku[l.productSku];
                    const bom = bomBySku[l.productSku];
                    const lineTotal = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
                    const fgAvailable = fg ? (fg.onHand || 0) - (fg.reserved || 0) : null;
                    const requestedQty = Number(l.qty) || 0;
                    const isShort = fg && requestedQty > fgAvailable;
                    return (
                      <tr key={idx}>
                        <td className="td p-1">
                          <input
                            required list="fg-skus"
                            className="input !py-1 text-[12px] font-mono"
                            placeholder="Pick finished good"
                            value={l.productSku}
                            onChange={(e) => onSkuPicked(idx, e.target.value)}
                          />
                          <div className="flex flex-col gap-0.5 mt-0.5">
                            {fg && (
                              <div className={clsx('text-[9px] font-semibold flex items-center gap-1',
                                isShort ? 'text-state-down' : 'text-state-running'
                              )}>
                                <Package className="h-2.5 w-2.5" />
                                {fgAvailable} {fg.uom} in stock
                                {isShort && ' — needs production'}
                              </div>
                            )}
                            {bom && (
                              <div className="text-[9px] text-brand-600 font-semibold flex items-center gap-1">
                                <BookOpen className="h-2.5 w-2.5" /> BOM v{bom.version} available
                              </div>
                            )}
                            {fg && !bom && (
                              <div className="text-[9px] text-state-idle font-semibold flex items-center gap-1">
                                <AlertTriangle className="h-2.5 w-2.5" /> No BOM (only stock sale)
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="td p-1">
                          <input
                            className="input !py-1 text-[12px]"
                            placeholder={fg ? 'Auto-filled' : 'Product name'}
                            value={l.productName}
                            onChange={(e) => updateLine(idx, { productName: e.target.value })}
                          />
                        </td>
                        <td className="td p-1">
                          <input
                            type="number" step="0.01" required
                            className={clsx('input !py-1 text-[12px] text-right tabular-nums',
                              isShort && 'text-state-down font-bold')}
                            value={l.qty}
                            onChange={(e) => updateLine(idx, { qty: e.target.value })}
                          />
                        </td>
                        <td className="td p-1">
                          <select
                            className="input !py-1 text-[12px]"
                            value={l.uom}
                            onChange={(e) => updateLine(idx, { uom: e.target.value })}
                          >
                            <option>kg</option><option>g</option><option>m</option>
                            <option>pcs</option><option>L</option><option>rolls</option>
                          </select>
                        </td>
                        <td className="td p-1">
                          <input
                            type="number" step="0.01"
                            className="input !py-1 text-[12px] text-right tabular-nums"
                            value={l.unitPrice}
                            onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                          />
                        </td>
                        <td className="td text-right tabular-nums font-semibold text-[12px]">
                          ₹{lineTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="td p-1">
                          {lines.length > 1 && (
                            <button type="button" onClick={() => removeLine(idx)}
                              className="h-7 w-7 rounded-md text-state-down hover:bg-state-down/5 grid place-items-center">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-ink-50">
                    <td colSpan={5} className="td text-right text-[11px] font-semibold text-ink-600">Total Order Value</td>
                    <td className="td text-right tabular-nums font-bold text-[14px] text-brand-600">
                      ₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="td"></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <datalist id="fg-skus">
              {fgItems.map((i) => (
                <option key={i._id} value={i.sku}>{i.name}</option>
              ))}
            </datalist>

            {fgItems.length === 0 && (
              <div className="text-[11px] text-ink-500 mt-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-state-idle" />
                No finished goods in inventory yet. Go to <Link to="/finished-goods" className="text-brand-600 underline">Finished Goods</Link> to add some, or type the SKU manually.
              </div>
            )}
          </div>

          <div>
            <label className="label">Notes (optional)</label>
            <textarea rows="2" className="input"
              placeholder="Special instructions, payment terms, etc."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          {error && (
            <div className="rounded-lg bg-state-down/5 border border-state-down/30 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-state-down shrink-0 mt-0.5" />
              <div className="text-[11.5px] text-state-down flex-1">{error}</div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit"
            className={clsx('inline-flex items-center gap-2 px-3.5 py-2 text-[12.5px] font-semibold rounded-lg',
              canSubmit && !mut.isPending ? 'bg-brand-500 text-white hover:bg-brand-600' : 'bg-ink-200 text-ink-400 cursor-not-allowed')}
            disabled={!canSubmit || mut.isPending}>
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create Sales Order
          </button>
        </div>
      </form>
    </div>
  );
}
