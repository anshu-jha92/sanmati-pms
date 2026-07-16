import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PackageCheck, PackageMinus, PackagePlus, Search, X, Loader2, AlertTriangle,
  ChevronRight, User as UserIcon, Clock, Factory, ArrowLeft, Plus, Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import { materialIssueApi, adminApi, inventoryApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';

/* ════════════════════════════════════════════════════════════════════════
 * Material Issue page — store manager's cockpit
 *
 * Workflow:
 *   1. "Issue Material" button → open modal
 *   2. Select Job Order / Stage / Person
 *   3. Pick items + quantities (from available inventory)
 *   4. Submit → inventory decreases, issue tracked as WIP
 *   5. When operator finishes stage, "Report Consumption" → marks how much
 *      was consumed / returned / scrapped
 * ══════════════════════════════════════════════════════════════════════ */

const STAGES = [
  { key: 'printing',   label: 'Printing' },
  { key: 'inspection', label: 'Inspection' },
  { key: 'lamination', label: 'Lamination' },
  { key: 'hot_room',   label: 'Hot Room' },
  { key: 'slitting',   label: 'Slitting' },
  { key: 'cutting',    label: 'Cutting' },
  { key: 'packaging',  label: 'Packaging' },
  { key: 'general',    label: 'General (not stage-specific)' },
];

const STATUS_PILL = {
  issued:    'chip-yellow',
  consumed:  'chip-green',
  partial:   'chip-blue',
  returned:  'chip-gray',
  cancelled: 'chip-red',
};

export function MaterialIssuePage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ status: '' });
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState(null);

  const query = useQuery({
    queryKey: ['material-issues', filters],
    queryFn: async () => (await materialIssueApi.list({ ...filters, limit: 100 })).data,
    refetchInterval: 30_000,
  });

  const wipQuery = useQuery({
    queryKey: ['material-issues-wip'],
    queryFn: async () => (await materialIssueApi.wip()).data,
    refetchInterval: 30_000,
  });

  const issues = query.data || [];

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[17px] font-bold text-ink-900">Material Issues (WIP Tracking)</h2>
          <p className="text-[12.5px] text-ink-500">
            Issue raw materials from inventory to a job/person/stage. Inventory is deducted only on issue.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowIssueModal(true)}>
          <PackageMinus className="h-4 w-4" /> Issue Material
        </button>
      </header>

      {/* WIP Dashboard */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard accent="yellow" label="Open Issues (WIP)" value={wipQuery.data?.totalOpen ?? '—'} />
        <StatCard accent="blue" label="People on Floor" value={wipQuery.data ? (wipQuery.data.byPerson || []).length : '—'} />
        <StatCard accent="green" label="Total Issues Today" value={issues.filter((i) => isToday(i.issuedAt)).length} />
        <StatCard
          accent="red"
          label="Total Issue Value"
          value={`₹${issues.reduce((s, i) => s + (i.totalValue || 0), 0).toLocaleString('en-IN')}`}
        />
      </section>

      {wipQuery.data?.byStage && Object.keys(wipQuery.data.byStage).length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <Factory className="h-4 w-4 text-brand-500" />
              Open by Stage
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(wipQuery.data.byStage).map(([stage, count]) => (
              <div key={stage} className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-1.5 text-[11.5px] flex items-center gap-2">
                <span className="capitalize text-ink-600">{stage.replace(/_/g, ' ')}</span>
                <span className="font-bold text-brand-600">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="panel !p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="input w-auto py-1.5 text-[12.5px]"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">All statuses</option>
            <option value="issued">Issued (WIP)</option>
            <option value="consumed">Consumed</option>
            <option value="partial">Partial</option>
            <option value="returned">Returned</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            className="input w-auto py-1.5 text-[12.5px]"
            value={filters.stage || ''}
            onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
          >
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {(filters.status || filters.stage) && (
            <button
              className="btn-ghost btn-sm text-state-down"
              onClick={() => setFilters({ status: '' })}
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          <div className="ml-auto text-[11px] text-ink-400">
            {issues.length} issues
          </div>
        </div>
      </div>

      {/* Issues table */}
      <div className="panel !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="th">Issue #</th>
                <th className="th">Job / Product</th>
                <th className="th">Stage</th>
                <th className="th">Issued To</th>
                <th className="th text-right">Items</th>
                <th className="th text-right">Value</th>
                <th className="th">Issued At</th>
                <th className="th">Status</th>
                <th className="th">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {query.isLoading ? (
                <tr><td colSpan={9} className="td text-center py-8 text-[12px] text-ink-400">Loading…</td></tr>
              ) : issues.length === 0 ? (
                <tr><td colSpan={9} className="td text-center py-14">
                  <div className="text-[40px] mb-2">📦</div>
                  <div className="font-bold text-[14px] text-ink-900 mb-1">No material issues yet</div>
                  <div className="text-[12.5px] text-ink-500 mb-3">Click "Issue Material" when an operator needs raw materials.</div>
                </td></tr>
              ) : issues.map((i) => (
                <tr key={i._id} className="tr-hover cursor-pointer" onClick={() => setSelectedIssue(i)}>
                  <td className="td font-mono text-[11.5px] font-bold text-brand-600">{i.issueNumber}</td>
                  <td className="td">
                    <div className="font-semibold text-[12px]">{i.jobOrderNumber || '—'}</div>
                    <div className="text-[10.5px] text-ink-500">{i.productSku || i.productName || ''}</div>
                  </td>
                  <td className="td"><span className="chip-blue text-[10px] capitalize">{i.stage.replace(/_/g, ' ')}</span></td>
                  <td className="td text-[12px]">{i.issuedToName}</td>
                  <td className="td text-right tabular-nums">{i.items?.length || 0}</td>
                  <td className="td text-right tabular-nums font-semibold">₹{(i.totalValue || 0).toLocaleString('en-IN')}</td>
                  <td className="td text-[11px] text-ink-500">
                    {new Date(i.issuedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="td"><span className={`${STATUS_PILL[i.status]} text-[10px] capitalize`}>{i.status}</span></td>
                  <td className="td">
                    <ChevronRight className="h-4 w-4 text-ink-400" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showIssueModal && (
        <IssueMaterialModal
          onClose={() => setShowIssueModal(false)}
          onSaved={() => {
            setShowIssueModal(false);
            qc.invalidateQueries({ queryKey: ['material-issues'] });
            qc.invalidateQueries({ queryKey: ['material-issues-wip'] });
            qc.invalidateQueries({ queryKey: ['inventory'] });
          }}
        />
      )}

      {selectedIssue && (
        <IssueDetailModal
          issue={selectedIssue}
          onClose={() => setSelectedIssue(null)}
          onChanged={() => {
            setSelectedIssue(null);
            qc.invalidateQueries({ queryKey: ['material-issues'] });
            qc.invalidateQueries({ queryKey: ['material-issues-wip'] });
            qc.invalidateQueries({ queryKey: ['inventory'] });
          }}
        />
      )}
    </div>
  );
}

function isToday(d) {
  if (!d) return false;
  const date = new Date(d);
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function StatCard({ accent, label, value }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="sc-label">{label}</div>
      <div className="sc-val">{value}</div>
    </div>
  );
}

/* ════════════ ISSUE MATERIAL MODAL ════════════ */
function IssueMaterialModal({ onClose, onSaved }) {
  const user = authStore((s) => s.user);
  const [form, setForm] = useState({
    jobOrderNumber: '',
    stage: 'printing',
    issuedToName: '',
    issuedToUserId: '',
    notes: '',
  });
  const [lines, setLines] = useState([{ sku: '', name: '', qty: '', uom: 'kg' }]);
  const [error, setError] = useState('');

  // Load employees for dropdown
  const employees = useQuery({
    queryKey: ['employees-dropdown'],
    queryFn: async () => (await adminApi.listUsers()).data,
  });

  // Load inventory to suggest SKUs
  const inventory = useQuery({
    queryKey: ['inventory-for-issue'],
    queryFn: async () => (await inventoryApi.list({ limit: 500 })).data,
  });
  const items = inventory.data || [];
  const itemBySku = Object.fromEntries(items.map((i) => [i.sku, i]));

  const mut = useMutation({
    mutationFn: async () => {
      // Clean: turn empty strings into undefined so backend zod doesn't complain
      const clean = (v) => (v === '' || v == null ? undefined : v);
      const body = {
        stage: form.stage,
        jobOrderNumber: clean(form.jobOrderNumber),
        issuedToUserId: clean(form.issuedToUserId),
        issuedToName: clean(form.issuedToName),
        notes: clean(form.notes),
        plantId: clean(user?.plantId),
        items: lines
          .filter((l) => l.sku && l.qty)
          .map((l) => ({
            sku: String(l.sku).toUpperCase(),
            qty: Number(l.qty),
            uom: l.uom || 'kg',
            notes: clean(l.notes),
          })),
      };
      return (await materialIssueApi.issue(body)).data;
    },
    onSuccess: onSaved,
    onError: (e) => {
      if (e.code === 'E_INSUFFICIENT_STOCK' && e.details) {
        const msgs = e.details.map((d) => `${d.sku}: need ${d.requested}, only ${d.available || 0} available`);
        setError('Insufficient stock — ' + msgs.join('; '));
      } else if (e.code === 'E_VALIDATION' && e.details) {
        const msgs = e.details.map((d) => `${d.path}: ${d.message}`);
        setError(msgs.join('; '));
      } else {
        setError(e.message);
      }
    },
  });

  const updateLine = (i, patch) => setLines(lines.map((l, j) => i === j ? { ...l, ...patch } : l));
  const addLine = () => setLines([...lines, { sku: '', name: '', qty: '', uom: 'kg' }]);
  const removeLine = (i) => setLines(lines.filter((_, j) => i !== j));

  const onSkuPicked = (i, sku) => {
    const item = itemBySku[sku];
    if (item) {
      updateLine(i, { sku, name: item.name, uom: item.uom });
    } else {
      updateLine(i, { sku });
    }
  };

  const onPersonPicked = (userId) => {
    if (!userId) return setForm({ ...form, issuedToUserId: '', issuedToName: '' });
    const emp = (employees.data || []).find((e) => String(e._id) === userId);
    setForm({ ...form, issuedToUserId: userId, issuedToName: emp?.name || '' });
  };

  const canSubmit = (form.issuedToName || form.issuedToUserId) &&
    lines.some((l) => l.sku && l.qty);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}
        onClick={(e) => e.stopPropagation()}
        className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl my-4"
      >
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">WIP Tracking</div>
            <h2 className="text-[17px] font-bold text-ink-900">Issue Material</h2>
            <p className="text-[11.5px] text-ink-500 mt-0.5">
              Materials will be deducted from inventory and tracked as WIP against this person & stage.
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Job Order # (optional)</label>
              <input
                className="input font-mono"
                placeholder="JOB-12345"
                value={form.jobOrderNumber}
                onChange={(e) => setForm({ ...form, jobOrderNumber: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <label className="label">Stage *</label>
              <select
                className="input"
                value={form.stage}
                onChange={(e) => setForm({ ...form, stage: e.target.value })}
              >
                {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Issue To (employee) *</label>
              <select
                className="input"
                value={form.issuedToUserId}
                onChange={(e) => onPersonPicked(e.target.value)}
              >
                <option value="">-- Select employee --</option>
                {(employees.data || []).map((e) => (
                  <option key={e._id} value={e._id}>{e.name} ({e.employeeCode || e.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Or type name</label>
              <input
                className="input"
                placeholder="e.g. Rohan Kumar"
                value={form.issuedToName}
                onChange={(e) => setForm({ ...form, issuedToName: e.target.value, issuedToUserId: '' })}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="label !text-[12px]">Items to Issue *</div>
              <button type="button" onClick={addLine} className="btn-secondary btn-sm">
                <Plus className="h-3.5 w-3.5" /> Add item
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table border border-ink-100 rounded-lg">
                <thead>
                  <tr>
                    <th className="th">SKU</th>
                    <th className="th">Name</th>
                    <th className="th text-right">Qty</th>
                    <th className="th">UOM</th>
                    <th className="th text-right">Available</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    const inv = itemBySku[l.sku];
                    const available = inv ? (inv.onHand || 0) - (inv.reserved || 0) : null;
                    const short = inv && Number(l.qty) > available;
                    return (
                      <tr key={idx}>
                        <td className="td p-1">
                          <input
                            required list="skus"
                            className="input !py-1 text-[12px] font-mono"
                            placeholder="SKU"
                            value={l.sku}
                            onChange={(e) => onSkuPicked(idx, e.target.value.toUpperCase())}
                          />
                        </td>
                        <td className="td p-1">
                          <input
                            className="input !py-1 text-[12px]"
                            placeholder="Auto-filled"
                            value={l.name}
                            onChange={(e) => updateLine(idx, { name: e.target.value })}
                          />
                        </td>
                        <td className="td p-1">
                          <input
                            type="number" step="0.01" required
                            className={clsx('input !py-1 text-[12px] text-right tabular-nums', short && 'text-state-down font-bold')}
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
                        <td className="td text-right text-[11px] tabular-nums">
                          {inv ? (
                            <span className={short ? 'text-state-down font-bold' : 'text-state-running'}>
                              {available} {inv.uom}
                            </span>
                          ) : <span className="text-ink-400">—</span>}
                        </td>
                        <td className="td p-1">
                          {lines.length > 1 && (
                            <button
                              type="button" onClick={() => removeLine(idx)}
                              className="h-7 w-7 rounded-md text-state-down hover:bg-state-down/5 grid place-items-center"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <datalist id="skus">
              {items.map((i) => <option key={i._id} value={i.sku}>{i.name}</option>)}
            </datalist>
          </div>

          <div>
            <label className="label">Notes (optional)</label>
            <textarea
              rows="2" className="input"
              placeholder="Special instructions, lot number, etc."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
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
          <button
            type="submit"
            className={clsx(
              'inline-flex items-center gap-2 px-3.5 py-2 text-[12.5px] font-semibold rounded-lg',
              canSubmit && !mut.isPending
                ? 'bg-brand-500 text-white hover:bg-brand-600'
                : 'bg-ink-200 text-ink-400 cursor-not-allowed'
            )}
            disabled={!canSubmit || mut.isPending}
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageMinus className="h-4 w-4" />}
            Issue & Deduct from Inventory
          </button>
        </div>
      </form>
    </div>
  );
}

/* ════════════ ISSUE DETAIL / CONSUME MODAL ════════════ */
function IssueDetailModal({ issue, onClose, onChanged }) {
  const [mode, setMode] = useState('view');  // view | consume | cancel
  const [consumption, setConsumption] = useState(
    issue.items.map((l) => ({
      lineId: String(l._id),
      sku: l.sku,
      name: l.name,
      issuedQty: l.issuedQty,
      uom: l.uom,
      consumedQty: l.consumedQty || l.issuedQty,
      returnedQty: l.returnedQty || 0,
      scrapQty: l.scrapQty || 0,
    }))
  );
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const consumeMut = useMutation({
    mutationFn: async () => (await materialIssueApi.consume(issue._id, {
      items: consumption.map((c) => ({
        lineId: c.lineId,
        consumedQty: Number(c.consumedQty || 0),
        returnedQty: Number(c.returnedQty || 0),
        scrapQty: Number(c.scrapQty || 0),
      })),
      notes,
    })).data,
    onSuccess: onChanged,
    onError: (e) => setError(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: async () => (await materialIssueApi.cancel(issue._id)).data,
    onSuccess: onChanged,
    onError: (e) => setError(e.message),
  });

  const updateConsumption = (i, patch) => setConsumption(consumption.map((c, j) => i === j ? { ...c, ...patch } : c));

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl my-4"
      >
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">Material Issue</div>
            <h2 className="text-[18px] font-bold text-ink-900 font-mono">{issue.issueNumber}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`${STATUS_PILL[issue.status]} text-[10.5px] font-bold capitalize`}>{issue.status}</span>
              <span className="chip-blue text-[10px] capitalize">{issue.stage.replace(/_/g, ' ')}</span>
              {issue.jobOrderNumber && <span className="chip-gray text-[10px]">{issue.jobOrderNumber}</span>}
            </div>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div><div className="label !text-[10px]">Issued to</div><div className="font-semibold">{issue.issuedToName}</div></div>
            <div><div className="label !text-[10px]">Issued by</div><div className="font-semibold">{issue.issuedByName || '—'}</div></div>
            <div><div className="label !text-[10px]">Issued at</div><div className="font-semibold">{new Date(issue.issuedAt).toLocaleString('en-IN')}</div></div>
            <div><div className="label !text-[10px]">Total value</div><div className="font-bold text-brand-600">₹{(issue.totalValue || 0).toLocaleString('en-IN')}</div></div>
          </div>

          {mode === 'view' && (
            <div className="overflow-x-auto">
              <table className="table border border-ink-100 rounded-lg">
                <thead>
                  <tr>
                    <th className="th">SKU</th>
                    <th className="th">Name</th>
                    <th className="th text-right">Issued</th>
                    <th className="th text-right">Consumed</th>
                    <th className="th text-right">Returned</th>
                    <th className="th text-right">Scrap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {issue.items.map((l) => (
                    <tr key={l._id}>
                      <td className="td font-mono text-[11.5px] font-bold text-brand-600">{l.sku}</td>
                      <td className="td text-[12px]">{l.name}</td>
                      <td className="td text-right tabular-nums">{l.issuedQty} {l.uom}</td>
                      <td className="td text-right tabular-nums">{l.consumedQty || '—'}</td>
                      <td className="td text-right tabular-nums">{l.returnedQty || '—'}</td>
                      <td className="td text-right tabular-nums text-state-down">{l.scrapQty || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {mode === 'consume' && (
            <div>
              <div className="text-[12.5px] font-bold text-ink-900 mb-2">Report consumption</div>
              <div className="text-[11.5px] text-ink-500 mb-3">
                For each item, enter how much was <strong>consumed</strong>, how much <strong>returned</strong> to stock, and how much was <strong>scrap</strong>. Total must equal issued quantity.
              </div>
              <div className="overflow-x-auto">
                <table className="table border border-ink-100 rounded-lg">
                  <thead>
                    <tr>
                      <th className="th">SKU</th>
                      <th className="th text-right">Issued</th>
                      <th className="th text-right">Consumed</th>
                      <th className="th text-right">Returned</th>
                      <th className="th text-right">Scrap</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {consumption.map((c, i) => {
                      const total = Number(c.consumedQty || 0) + Number(c.returnedQty || 0) + Number(c.scrapQty || 0);
                      const matches = Math.abs(total - c.issuedQty) < 0.0001;
                      return (
                        <tr key={c.lineId}>
                          <td className="td font-mono text-[11.5px] font-bold text-brand-600">{c.sku}</td>
                          <td className="td text-right tabular-nums">{c.issuedQty} {c.uom}</td>
                          <td className="td p-1">
                            <input
                              type="number" step="0.01"
                              className="input !py-1 text-[12px] text-right tabular-nums"
                              value={c.consumedQty}
                              onChange={(e) => updateConsumption(i, { consumedQty: e.target.value })}
                            />
                          </td>
                          <td className="td p-1">
                            <input
                              type="number" step="0.01"
                              className="input !py-1 text-[12px] text-right tabular-nums"
                              value={c.returnedQty}
                              onChange={(e) => updateConsumption(i, { returnedQty: e.target.value })}
                            />
                          </td>
                          <td className="td p-1">
                            <input
                              type="number" step="0.01"
                              className={clsx('input !py-1 text-[12px] text-right tabular-nums', !matches && 'border-state-down')}
                              value={c.scrapQty}
                              onChange={(e) => updateConsumption(i, { scrapQty: e.target.value })}
                            />
                            {!matches && <div className="text-[9px] text-state-down mt-0.5">Totals to {total}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3">
                <label className="label">Notes</label>
                <textarea rows="2" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-state-down/5 border border-state-down/30 p-3 text-[12px] text-state-down">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex justify-between items-center gap-2">
          <div>
            {['issued', 'partial'].includes(issue.status) && mode === 'view' && (
              <button
                onClick={() => {
                  if (confirm('Cancel this issue and return all materials to stock?')) {
                    cancelMut.mutate();
                  }
                }}
                className="btn-secondary text-state-down"
                disabled={cancelMut.isPending}
              >
                {cancelMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Cancel & Return
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {mode === 'view' ? (
              <>
                <button className="btn-secondary" onClick={onClose}>Close</button>
                {['issued', 'partial'].includes(issue.status) && (
                  <button className="btn-primary" onClick={() => setMode('consume')}>
                    <PackageCheck className="h-4 w-4" /> Report Consumption
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="btn-secondary" onClick={() => setMode('view')}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={() => consumeMut.mutate()}
                  className="btn-primary"
                  disabled={consumeMut.isPending}
                >
                  {consumeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                  Submit Consumption
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
