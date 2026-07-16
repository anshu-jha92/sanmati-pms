import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Package, Loader2, AlertTriangle, Search, X, Eye, Trash2, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';
import { purchaseOrderApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';

export function PurchaseOrdersPage() {
  const user = authStore((s) => s.user);
  const qc = useQueryClient();
  const [filters, setFilters] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPo, setSelectedPo] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const query = useQuery({
    queryKey: ['purchase-orders', filters],
    queryFn: async () => (await purchaseOrderApi.list(filters)).data,
    refetchInterval: 60_000,
  });

  const pos = query.data || [];

  const suggestions = useQuery({
    queryKey: ['po-suggestions', user?.plantId],
    queryFn: async () => (await purchaseOrderApi.suggestions(user?.plantId)).data,
    refetchInterval: 120_000,
  });

  const deleteMut = useMutation({
    mutationFn: (po) => purchaseOrderApi.delete(po._id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['po-suggestions'] });
    },
    onError: (e) => window.alert(e?.message || 'Could not delete this entry.'),
  });

  const handleDelete = (po) => {
    if (window.confirm(`Delete goods-receipt ${po.poNumber}?\nThe received stock will be reversed (removed) from inventory.`)) {
      deleteMut.mutate(po);
    }
  };

  const stats = {
    total: pos.length,
    totalValue: pos.reduce((s, p) => s + (p.totalValue || 0), 0),
    linesReceived: pos.reduce((s, p) => s + (p.lines?.length || 0), 0),
    thisMonth: pos.filter((p) => {
      if (!p.receivedAt) return false;
      const d = new Date(p.receivedAt);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
  };

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[17px] font-bold text-ink-900">Purchase Orders / Goods Received</h2>
          <p className="text-[12.5px] text-ink-500">
            Record goods received from suppliers. Inventory updates automatically on submission.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button className="btn-primary w-full sm:w-auto justify-center" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New Entry (Goods Received)
          </button>
          <button className="btn-secondary w-full sm:w-auto justify-center">
            <RefreshCw className="h-4 w-4" /> Sync from ERP
          </button>
        </div>
      </header>

      {(suggestions.data || []).length > 0 && (
        <div>
          <button
            onClick={() => setShowSuggestions(!showSuggestions)}
            className="btn-sm inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold bg-state-idle/10 text-state-idle border border-state-idle/30 hover:bg-state-idle/20"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {suggestions.data.length} items need reorder
          </button>
        </div>
      )}

      {showSuggestions && (suggestions.data || []).length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <AlertTriangle className="h-4 w-4 text-state-idle" />
              Low Stock — Reorder Required
            </div>
            <button onClick={() => setShowSuggestions(false)} className="text-ink-400 hover:text-ink-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {(suggestions.data || []).map((s) => (
              <div key={s._id} className="rounded-lg bg-state-idle/5 border border-state-idle/30 p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-mono text-[11px] font-bold text-brand-600">{s.sku}</div>
                    <div className="font-bold text-[12px] text-ink-900">{s.name}</div>
                  </div>
                  <AlertTriangle className="h-4 w-4 text-state-idle" />
                </div>
                <div className="text-[11px] space-y-0.5">
                  <div className="flex justify-between"><span className="text-ink-500">Current</span><span className="font-bold tabular-nums text-state-down">{s.onHand} {s.uom}</span></div>
                  <div className="flex justify-between"><span className="text-ink-500">Reorder at</span><span className="font-bold tabular-nums">{s.reorderLevel} {s.uom}</span></div>
                  <div className="flex justify-between"><span className="text-ink-500">Suggested qty</span><span className="font-bold tabular-nums text-state-running">{s.suggestedOrderQty} {s.uom}</span></div>
                </div>
                <button
                  className="btn-primary btn-sm w-full mt-2 justify-center text-[10.5px] py-1.5"
                  onClick={() => {
                    setShowCreate({ prefillLines: [{ sku: s.sku, name: s.name, qty: s.suggestedOrderQty, uom: s.uom }] });
                    setShowSuggestions(false);
                  }}
                >
                  <Plus className="h-3 w-3" /> Record Receipt
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard accent="blue" label="Total Receipts" value={stats.total} />
        <StatCard accent="green" label="Items Received" value={stats.linesReceived} />
        <StatCard accent="yellow" label="This Month" value={stats.thisMonth} />
        <StatCard accent="green" label="Total Value" value={`₹${stats.totalValue.toLocaleString('en-IN')}`} />
      </section>

      <div className="panel !p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
            <input className="input pl-8 py-1.5 text-[12.5px]" placeholder="Search PO # or supplier…"
              value={filters.q || ''} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="panel !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr>
              <th className="th">PO / GRN #</th>
              <th className="th">Supplier</th>
              <th className="th">Phone</th>
              <th className="th text-right">Items</th>
              <th className="th text-right">Total Value</th>
              <th className="th">Received On</th>
              <th className="th">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-ink-100">
              {query.isLoading ? (
                <tr><td colSpan={7} className="td text-center py-8 text-[12px] text-ink-400">Loading…</td></tr>
              ) : pos.length === 0 ? (
                <tr><td colSpan={7} className="td text-center py-14">
                  <div className="text-[40px] mb-2">📦</div>
                  <div className="font-bold text-[14px] text-ink-900 mb-1">No goods receipts yet</div>
                  <div className="text-[12.5px] text-ink-500 mb-3">Click "New Entry" when goods arrive from a supplier.</div>
                  <button className="btn-primary" onClick={() => setShowCreate(true)}>
                    <Plus className="h-4 w-4" /> First Entry
                  </button>
                </td></tr>
              ) : pos.map((po) => (
                <tr key={po._id} className="tr-hover cursor-pointer" onClick={() => setSelectedPo(po)}>
                  <td className="td"><span className="font-mono text-[11.5px] font-bold text-brand-600">{po.poNumber}</span></td>
                  <td className="td text-[12px] font-semibold">{po.supplier}</td>
                  <td className="td text-[11.5px] text-ink-600">{po.supplierPhone || '—'}</td>
                  <td className="td text-right tabular-nums text-[12px]">{po.lines?.length || 0}</td>
                  <td className="td text-right tabular-nums text-[12px] font-bold">₹{(po.totalValue || 0).toLocaleString('en-IN')}</td>
                  <td className="td text-[11.5px]">
                    {po.receivedAt ? new Date(po.receivedAt).toLocaleDateString() : '—'}
                    <span className="chip-green text-[9px] ml-2">✓ Received</span>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setSelectedPo(po)}
                        className="rounded-md border border-ink-200 bg-ink-50 text-ink-600 text-[10px] font-semibold px-2 py-1 inline-flex items-center gap-1 hover:bg-ink-100"
                      >
                        <Eye className="h-3 w-3" /> View
                      </button>
                      <button
                        onClick={() => handleDelete(po)}
                        disabled={deleteMut.isPending}
                        title="Delete entry"
                        className="rounded-md border border-state-down/30 bg-state-down/5 text-state-down text-[10px] font-semibold px-2 py-1 inline-flex items-center gap-1 hover:bg-state-down/10 disabled:opacity-40"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <NewGoodsReceiptModal
          prefillLines={typeof showCreate === 'object' ? showCreate.prefillLines : undefined}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['purchase-orders'] });
            qc.invalidateQueries({ queryKey: ['inventory'] });
            qc.invalidateQueries({ queryKey: ['po-suggestions'] });
          }}
        />
      )}

      {selectedPo && <ViewPoModal po={selectedPo} onClose={() => setSelectedPo(null)} />}
    </div>
  );
}

function StatCard({ accent, label, value }) {
  return <div className={`stat-card accent-${accent}`}><div className="sc-label">{label}</div><div className="sc-val">{value}</div></div>;
}

/**
 * Turn any API error into a readable message.
 * The api client throws ApiClientError with { status, code, message, details }.
 */
function friendlyError(err) {
  if (!err) return '';
  const code = err.code;
  const details = err.details;

  if (code === 'E_DUPLICATE' && details) {
    const field = Object.keys(details)[0];
    const value = details[field];
    if (field === 'poNumber') {
      return `A Purchase Order with number "${value}" already exists. Please use a different PO number, or leave it blank to auto-generate one.`;
    }
    if (field === 'sku') {
      return `An inventory item with SKU "${value}" already exists elsewhere. Pick a different SKU or use the existing one as-is.`;
    }
    return `That ${field} is already in use (value: ${value}).`;
  }
  if (code === 'E_VALIDATION' && Array.isArray(details)) {
    return details.map((d) => `${d.path}: ${d.message}`).join('; ');
  }
  if (/duplicate/i.test(err.message || '')) {
    return 'The PO number is already in use. Please use a different one, or leave it blank to auto-generate.';
  }
  return err.message || 'Something went wrong. Please try again.';
}

function NewGoodsReceiptModal({ prefillLines, onClose, onSaved }) {
  const user = authStore((s) => s.user);
  const [form, setForm] = useState({
    poNumber: '',
    supplier: '',
    supplierPhone: '',
    supplierEmail: '',
    invoiceNumber: '',
    vehicleNumber: '',
    receivedAt: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [lines, setLines] = useState(prefillLines || [{ sku: '', name: '', qty: '', uom: 'kg', unitCost: '' }]);
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: async () => (await purchaseOrderApi.create({
      ...form,
      plantId: user?.plantId,
      receivedAt: form.receivedAt || undefined,
      poNumber: form.poNumber || undefined,
      lines: lines.filter((l) => l.sku && l.name && l.qty)
        .map((l) => ({
          sku: l.sku,
          name: l.name,
          qty: Number(l.qty),
          uom: l.uom || 'kg',
          unitCost: l.unitCost ? Number(l.unitCost) : 0,
        })),
    })).data,
    onSuccess: onSaved,
    onError: (e) => setError(friendlyError(e)),
  });

  const updateLine = (idx, patch) => setLines(lines.map((l, i) => i === idx ? { ...l, ...patch } : l));
  const addLine = () => setLines([...lines, { sku: '', name: '', qty: '', uom: 'kg', unitCost: '' }]);
  const removeLine = (idx) => setLines(lines.filter((_, i) => i !== idx));
  const canSubmit = form.supplier && lines.some((l) => l.sku && l.name && l.qty);
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);

  const clearErrorAndEditPO = (e) => {
    setForm({ ...form, poNumber: e.target.value.toUpperCase() });
    if (error) setError('');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}
        onClick={(e) => e.stopPropagation()}
        className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl my-4">
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">Goods Receipt Entry</div>
            <h2 className="text-[17px] font-bold text-ink-900">Record incoming goods from supplier</h2>
            <p className="text-[11.5px] text-ink-500 mt-0.5">
              Fill in the details — inventory will update automatically on submission.
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">PO No. (leave empty to auto-generate)</label>
              <input className="input font-mono" placeholder="Auto"
                value={form.poNumber} onChange={clearErrorAndEditPO} />
            </div>
            <div>
              <label className="label">Received Date *</label>
              <input type="date" required className="input"
                value={form.receivedAt} onChange={(e) => setForm({ ...form, receivedAt: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className="label">Supplier / Party Name *</label>
              <input required className="input" placeholder="e.g. Sharma Paper Mills"
                value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
            </div>
            <div>
              <label className="label">Phone No.</label>
              <input className="input" placeholder="+91 98765 43210"
                value={form.supplierPhone} onChange={(e) => setForm({ ...form, supplierPhone: e.target.value })} />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input"
                value={form.supplierEmail} onChange={(e) => setForm({ ...form, supplierEmail: e.target.value })} />
            </div>
            <div>
              <label className="label">Invoice No.</label>
              <input className="input" placeholder="INV-4567"
                value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} />
            </div>
            <div>
              <label className="label">Vehicle No.</label>
              <input className="input font-mono" placeholder="UP16 AB 1234"
                value={form.vehicleNumber} onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value.toUpperCase() })} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="label !text-[12px]">Items Received (multiple supported) *</div>
              <button type="button" onClick={addLine} className="btn-secondary btn-sm">
                <Plus className="h-3.5 w-3.5" /> Add item
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table border border-ink-100 rounded-lg">
                <thead><tr>
                  <th className="th">Item Code (SKU)</th>
                  <th className="th">Item Name</th>
                  <th className="th text-right">Qty Received</th>
                  <th className="th">UOM</th>
                  <th className="th text-right">Unit Cost (₹)</th>
                  <th className="th text-right">Total</th>
                  <th className="th"></th>
                </tr></thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={idx}>
                      <td className="td p-1">
                        <input required className="input !py-1 text-[12px] font-mono" placeholder="BOPP-FILM-20"
                          value={l.sku} onChange={(e) => updateLine(idx, { sku: e.target.value.toUpperCase() })} />
                      </td>
                      <td className="td p-1">
                        <input required className="input !py-1 text-[12px]" placeholder="BOPP Film 20mic"
                          value={l.name} onChange={(e) => updateLine(idx, { name: e.target.value })} />
                      </td>
                      <td className="td p-1">
                        <input type="number" step="0.1" required className="input !py-1 text-[12px] text-right tabular-nums"
                          placeholder="500" value={l.qty} onChange={(e) => updateLine(idx, { qty: e.target.value })} />
                      </td>
                      <td className="td p-1">
                        <select className="input !py-1 text-[12px]" value={l.uom} onChange={(e) => updateLine(idx, { uom: e.target.value })}>
                          <option>kg</option><option>g</option><option>m</option><option>pcs</option><option>L</option><option>rolls</option>
                        </select>
                      </td>
                      <td className="td p-1">
                        <input type="number" step="0.01" className="input !py-1 text-[12px] text-right tabular-nums"
                          placeholder="0" value={l.unitCost} onChange={(e) => updateLine(idx, { unitCost: e.target.value })} />
                      </td>
                      <td className="td text-right tabular-nums text-[12px] font-bold">
                        ₹{((Number(l.qty) || 0) * (Number(l.unitCost) || 0)).toFixed(2)}
                      </td>
                      <td className="td p-1">
                        {lines.length > 1 && (
                          <button type="button" onClick={() => removeLine(idx)} className="h-7 w-7 rounded-md text-state-down hover:bg-state-down/5 grid place-items-center">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-ink-50/60">
                    <td colSpan={5} className="td text-right font-bold text-[12px]">Total Value</td>
                    <td className="td text-right font-bold text-[13px] text-brand-600">₹{total.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <label className="label">Notes (optional)</label>
            <textarea rows="2" className="input" placeholder="Damaged packaging, short count, special instructions, etc."
              value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <div className="rounded-lg bg-state-running/5 border border-state-running/20 p-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-state-running shrink-0" />
            <div className="text-[11.5px] text-state-running">
              On save, these items will be <strong>auto-added to inventory</strong>. New SKUs are created automatically. Existing SKUs get their quantity increased.
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-state-down/5 border border-state-down/30 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-state-down shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-bold text-[12px] text-state-down mb-0.5">Couldn't save</div>
                  <div className="text-[11.5px] text-state-down/90">{error}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit"
            className={clsx('inline-flex items-center gap-2 px-3.5 py-2 text-[12.5px] font-semibold rounded-lg',
              canSubmit && !mut.isPending ? 'bg-state-running text-white hover:brightness-95' : 'bg-ink-200 text-ink-400 cursor-not-allowed')}
            disabled={!canSubmit || mut.isPending}>
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
            Save & Add to Inventory
          </button>
        </div>
      </form>
    </div>
  );
}

function ViewPoModal({ po, onClose }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">Goods Receipt</div>
            <h2 className="text-[18px] font-bold text-ink-900">{po.poNumber}</h2>
            <div className="text-[12px] text-ink-500 mt-0.5">{po.supplier}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="chip-green text-[10.5px] font-bold">✓ Received & Added to Inventory</span>
            <button onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">✕</button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
            <div><div className="label !text-[10px]">Supplier</div><div className="font-semibold">{po.supplier}</div></div>
            <div><div className="label !text-[10px]">Phone</div><div className="font-semibold">{po.supplierPhone || '—'}</div></div>
            <div><div className="label !text-[10px]">Received On</div><div className="font-semibold">{po.receivedAt ? new Date(po.receivedAt).toLocaleDateString() : '—'}</div></div>
            <div><div className="label !text-[10px]">Total Value</div><div className="font-bold text-brand-600">₹{(po.totalValue || 0).toLocaleString('en-IN')}</div></div>
          </div>

          <div className="overflow-x-auto">
            <table className="table border border-ink-100 rounded-lg">
              <thead><tr>
                <th className="th">SKU</th>
                <th className="th">Name</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right">Unit Cost</th>
                <th className="th text-right">Total</th>
              </tr></thead>
              <tbody className="divide-y divide-ink-100">
                {(po.lines || []).map((line) => (
                  <tr key={line._id || line.sku}>
                    <td className="td font-mono text-[11.5px] font-bold text-brand-600">{line.sku}</td>
                    <td className="td text-[12px]">{line.name}</td>
                    <td className="td text-right tabular-nums font-semibold">{line.qty} {line.uom}</td>
                    <td className="td text-right tabular-nums text-[11.5px]">{line.unitCost ? `₹${line.unitCost.toFixed(2)}` : '—'}</td>
                    <td className="td text-right tabular-nums font-bold">₹{(line.lineTotal || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {po.notes && (
            <div>
              <div className="label">Notes</div>
              <div className="rounded-md bg-ink-50 border border-ink-100 p-3 text-[12px] text-ink-700">{po.notes}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
