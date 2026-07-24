import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, RefreshCw, Search, X, AlertTriangle, TrendingDown, Package,
  Edit3, Loader2, PackageMinus, Factory, Clock, ChevronRight, User as UserIcon,
  PackageCheck, ArrowLeft, Trash2, ShoppingCart, Truck, Send, CheckCircle2,
} from 'lucide-react';
import clsx from 'clsx';
import { inventoryApi, materialIssueApi, adminApi, materialRequestApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { BASE_URL } from '../api/client.js';
import { ItemTrackingModal } from '../components/inventory/ItemTrackingModal.jsx';

/* ════════════════════════════════════════════════════════════════════════
 * Raw Materials page — direct fetch version
 *
 * We bypass react-query and useAPI helpers entirely to eliminate any chance
 * of them mangling the URL, filters, or auth. This calls the backend
 * /api/v1/inventory/items endpoint directly with fetch() and dumps whatever
 * comes back into the table.
 * ══════════════════════════════════════════════════════════════════════ */

const CATEGORIES = {
  raw: { label: 'Raw Material' },
  consumable: { label: 'Consumable' },
  packaging: { label: 'Packaging' },
  finished_good: { label: 'Finished Good' },
  finished: { label: 'Finished Good' },
};

export function RawMaterialsPage({ category = 'raw' }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filters, setFilters] = useState({ lowStockOnly: false });
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [adjustItem, setAdjustItem] = useState(null);
  const [issueModal, setIssueModal] = useState(null);   // null | true | { prefillSku }
  const [showWIP, setShowWIP] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [trackingSku, setTrackingSku] = useState(null);
  const qc = useQueryClient();

  async function refresh() {
    setLoading(true);
    setErr('');
    try {
      const token = authStore.getState().accessToken;
      const url = new URL('/api/v1/inventory/items', BASE_URL);
      url.searchParams.set('limit', '200');

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });

      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

      if (!res.ok) {
        setErr(json?.error?.message || `HTTP ${res.status}: ${res.statusText}`);
        setItems([]);
      } else {
        // Accept both { ok: true, data: [...] } and raw array shapes
        const list = Array.isArray(json) ? json
          : Array.isArray(json?.data) ? json.data
          : [];
        // Client-side category filter — so /raw-materials and /finished-goods both work
        let filtered = list;
        if (category === 'finished_good') {
          filtered = list.filter((i) => i.type === 'finished' || i.category === 'finished_good' || i.category === 'finished');
        } else if (category === 'raw') {
          // show everything that is NOT finished_good on the raw page
          filtered = list.filter((i) => !(i.type === 'finished' || i.category === 'finished_good' || i.category === 'finished'));
        }
        setItems(filtered);
      }
    } catch (e) {
      setErr(e.message || 'Network error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const stats = useMemo(() => {
    const totalItems = items.length;
    const lowStock = items.filter((i) => i.reorderLevel > 0 && i.onHand < i.reorderLevel).length;
    const outOfStock = items.filter((i) => !i.onHand || i.onHand === 0).length;
    const totalValue = items.reduce((s, i) => s + (i.onHand || 0) * (i.unitCost || 0), 0);
    return { totalItems, lowStock, outOfStock, totalValue };
  }, [items]);

  const visibleItems = useMemo(() => {
    let out = items;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      out = out.filter((i) =>
        i.sku?.toLowerCase().includes(q) ||
        i.name?.toLowerCase().includes(q)
      );
    }
    if (filters.lowStockOnly) {
      out = out.filter((i) => i.reorderLevel > 0 && i.onHand < i.reorderLevel);
    }
    return out;
  }, [items, filters]);

  const sync = useMutation({
    mutationFn: async () => (await inventoryApi.sync()).data,
    onSuccess: () => setTimeout(refresh, 1500),
  });

  const isFG = category === 'finished_good';

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-secondary" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> New Entry
        </button>
        <button className="btn-secondary" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <button className="btn-secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
          <RefreshCw className={`h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
          {sync.isPending ? 'Syncing…' : 'Sync from ERP'}
        </button>
        {stats.lowStock > 0 && !isFG && (
          <button
            onClick={() => setFilters({ ...filters, lowStockOnly: !filters.lowStockOnly })}
            className={clsx(
              'btn-sm inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold border',
              filters.lowStockOnly
                ? 'bg-state-down text-white border-state-down'
                : 'bg-state-down/10 text-state-down border-state-down/30'
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {stats.lowStock} low stock
          </button>
        )}
        {!isFG && (
          <>
            <button
              onClick={() => setShowWIP(!showWIP)}
              className={clsx(
                'btn-sm inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold border',
                showWIP
                  ? 'bg-state-idle text-white border-state-idle'
                  : 'bg-state-idle/10 text-state-idle border-state-idle/30 hover:bg-state-idle/20'
              )}
            >
              <Factory className="h-3.5 w-3.5" />
              {showWIP ? 'Hide WIP' : 'View WIP'}
            </button>
            <PendingRequestsButton showRequests={showRequests} onToggle={() => setShowRequests(!showRequests)} />
            <button className="btn-primary ml-auto" onClick={() => setIssueModal(true)}>
              <PackageMinus className="h-4 w-4" /> Issue Material
            </button>
          </>
        )}
      </div>

      {/* WIP Panel — toggles open below action bar */}
      {showWIP && !isFG && <WIPPanel onSelectIssue={setSelectedIssue} />}

      {/* Material Requests Panel — operator → inventory hand-off */}
      {showRequests && !isFG && <MaterialRequestsPanel />}

      {err && (
        <div className="rounded-lg bg-state-down/5 border border-state-down/30 p-3 text-[12px] text-state-down">
          <strong>Couldn't load:</strong> {err}
        </div>
      )}

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard accent="blue" label="Total Items" value={stats.totalItems} />
        <StatCard accent="red" label="Low Stock" value={stats.lowStock} meta="below reorder" />
        <StatCard accent="yellow" label="Out of Stock" value={stats.outOfStock} />
        <StatCard accent="green" label="Inventory Value" value={`₹${Math.round(stats.totalValue).toLocaleString('en-IN')}`} />
      </section>

      {/* Filter bar */}
      <div className="panel !p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
            <input
              className="input pl-8 py-1.5 text-[12.5px]"
              placeholder="Search by SKU or name…"
              value={filters.q || ''}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </div>
          {(filters.q || filters.lowStockOnly) && (
            <button
              className="btn-ghost btn-sm text-state-down"
              onClick={() => setFilters({ lowStockOnly: false })}
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          <div className="ml-auto text-[11px] text-ink-400 bg-ink-50 border border-ink-200 px-2.5 py-1 rounded-md">
            {visibleItems.length} items shown ({items.length} loaded)
          </div>
        </div>
      </div>

      {/* Items table */}
      <div className="panel !p-0 overflow-hidden">
        <div className="panel-header !px-4 !py-3 !mb-0 !border-b border-ink-100">
          <div className="panel-title">
            <Package className="h-4 w-4 text-brand-500" />
            {isFG ? 'Finished Goods' : 'Raw Materials'}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="th">SKU</th>
                <th className="th">Name</th>
                <th className="th">Category</th>
                <th className="th text-right">On Hand</th>
                <th className="th text-right">Reserved</th>
                <th className="th text-right">Available</th>
                <th className="th text-right">Reorder Level</th>
                <th className="th text-right">Unit Cost</th>
                <th className="th">Status</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {loading ? (
                <tr><td colSpan={10} className="td text-center py-8 text-[12px] text-ink-400">Loading…</td></tr>
              ) : visibleItems.length === 0 ? (
                <tr><td colSpan={10} className="td text-center py-10 text-[12.5px] text-ink-500">
                  No items. Click "New Entry" or "Sync from ERP".
                </td></tr>
              ) : visibleItems.map((i) => {
                const belowReorder = i.reorderLevel > 0 && i.onHand < i.reorderLevel;
                const available = (i.onHand || 0) - (i.reserved || 0);
                const catLabel = CATEGORIES[i.category]?.label || CATEGORIES[i.type]?.label || i.category || i.type || '—';
                return (
                  <tr key={i._id} className="tr-hover">
                    <td className="td font-mono text-[11.5px] font-bold text-brand-600">
                      <button
                        onClick={() => setTrackingSku(i.sku)}
                        className="hover:underline cursor-pointer"
                        title="View full tracking history"
                      >
                        {i.sku}
                      </button>
                    </td>
                    <td className="td">{i.name}</td>
                    <td className="td">
                      <span className="chip-gray text-[10px]">{catLabel}</span>
                    </td>
                    <td className={clsx(
                      'td text-right tabular-nums font-bold',
                      belowReorder ? 'text-state-down' : 'text-ink-900'
                    )}>
                      {i.onHand || 0} <span className="text-[10px] text-ink-400">{i.uom}</span>
                    </td>
                    <td className="td text-right tabular-nums text-ink-500">{i.reserved || 0}</td>
                    <td className="td text-right tabular-nums font-semibold">
                      {available} <span className="text-[10px] text-ink-400">{i.uom}</span>
                    </td>
                    <td className="td text-right tabular-nums text-[11.5px] text-ink-500">
                      {i.reorderLevel ? `${i.reorderLevel} ${i.uom}` : '—'}
                    </td>
                    <td className="td text-right tabular-nums text-[11.5px]">
                      {i.unitCost ? `₹${i.unitCost.toFixed(2)}` : '—'}
                    </td>
                    <td className="td">
                      {belowReorder ? (
                        <span className="chip-red text-[10px]">⚠ Low</span>
                      ) : !i.onHand ? (
                        <span className="chip-red text-[10px]">✗ Out</span>
                      ) : (
                        <span className="chip-green text-[10px]">✓ OK</span>
                      )}
                    </td>
                    <td className="td">
                      <div className="flex gap-1">
                        {!isFG && (
                          <button
                            onClick={() => setIssueModal({ prefillSku: i.sku })}
                            title="Issue this material"
                            className="rounded-md border border-state-running/30 bg-state-running/10 text-state-running text-[10px] font-semibold px-2 py-1 hover:bg-state-running/20"
                          >
                            <PackageMinus className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          onClick={() => setAdjustItem(i)}
                          title="Adjust stock"
                          className="rounded-md border border-brand-500/20 bg-brand-50 text-brand-600 text-[10px] font-semibold px-2 py-1 hover:bg-brand-500/10"
                        >
                          <TrendingDown className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => setEditItem(i)}
                          title="Edit"
                          className="rounded-md border border-ink-200 bg-ink-50 text-ink-600 text-[10px] font-semibold px-2 py-1 hover:bg-ink-100"
                        >
                          <Edit3 className="h-3 w-3" />
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

      {(showCreate || editItem) && (
        <InventoryForm
          item={editItem}
          category={category}
          onClose={() => { setShowCreate(false); setEditItem(null); }}
          onSaved={() => { setShowCreate(false); setEditItem(null); refresh(); }}
        />
      )}

      {adjustItem && (
        <AdjustStockModal
          item={adjustItem}
          onClose={() => setAdjustItem(null)}
          onSaved={() => { setAdjustItem(null); refresh(); }}
        />
      )}

      {issueModal && (
        <IssueMaterialModal
          prefillSku={typeof issueModal === 'object' ? issueModal.prefillSku : undefined}
          onClose={() => setIssueModal(null)}
          onSaved={() => { setIssueModal(null); refresh(); qc.invalidateQueries({ queryKey: ['material-issues'] }); }}
        />
      )}

      {selectedIssue && (
        <IssueDetailModal
          issue={selectedIssue}
          onClose={() => setSelectedIssue(null)}
          onChanged={() => {
            setSelectedIssue(null);
            refresh();
            qc.invalidateQueries({ queryKey: ['material-issues'] });
          }}
        />
      )}

      {trackingSku && (
        <ItemTrackingModal
          sku={trackingSku}
          onClose={() => setTrackingSku(null)}
        />
      )}
    </div>
  );
}

function StatCard({ accent, label, value, meta }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="sc-label">{label}</div>
      <div className="sc-val">{value}</div>
      {meta && <div className="sc-meta">{meta}</div>}
    </div>
  );
}

function InventoryForm({ item, category, onClose, onSaved }) {
  const user = authStore((s) => s.user);
  const [form, setForm] = useState({
    sku: item?.sku || '',
    name: item?.name || '',
    category: item?.category || category,
    uom: item?.uom || 'kg',
    onHand: item?.onHand ?? 0,
    reorderLevel: item?.reorderLevel ?? (category === 'raw' ? 80 : 0),
    reorderQty: item?.reorderQty ?? 0,
    unitCost: item?.unitCost ?? 0,
    location: item?.location || '',
    supplier: item?.supplier || '',
    barcode: item?.barcode || '',
    notes: item?.notes || '',
  });
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        onHand: Number(form.onHand),
        reorderLevel: Number(form.reorderLevel),
        reorderQty: Number(form.reorderQty),
        unitCost: Number(form.unitCost),
        plantId: user?.plantId,
      };
      if (item) return (await inventoryApi.update(item._id, payload)).data;
      return (await inventoryApi.create(payload)).data;
    },
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-[17px] font-bold">{item ? 'Edit Item' : 'New Inventory Entry'}</h2>
            <p className="text-[12px] text-ink-500 mt-0.5">
              Fill all parameters. Reorder level of 80 KG is default for raw materials.
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">✕</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="SKU *" value={form.sku} onChange={(v) => setForm({ ...form, sku: v.toUpperCase() })} mono required disabled={!!item} />
          <Field label="Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
          <div>
            <label className="label">Category *</label>
            <select
              className="input"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="raw">Raw Material</option>
              <option value="consumable">Consumable</option>
              <option value="packaging">Packaging</option>
              <option value="finished_good">Finished Good</option>
            </select>
          </div>
          <div>
            <label className="label">UOM</label>
            <select
              className="input"
              value={form.uom}
              onChange={(e) => setForm({ ...form, uom: e.target.value })}
            >
              <option value="kg">kg</option>
              <option value="g">g</option>
              <option value="m">m</option>
              <option value="pcs">pcs</option>
              <option value="rolls">rolls</option>
              <option value="L">L</option>
            </select>
          </div>
          <Field label="On Hand" type="number" value={form.onHand} onChange={(v) => setForm({ ...form, onHand: v })} />
          <Field label="Reorder Level" type="number" value={form.reorderLevel} onChange={(v) => setForm({ ...form, reorderLevel: v })} />
          <Field label="Reorder Qty" type="number" value={form.reorderQty} onChange={(v) => setForm({ ...form, reorderQty: v })} />
          <Field label="Unit Cost (₹)" type="number" step="0.01" value={form.unitCost} onChange={(v) => setForm({ ...form, unitCost: v })} />
          <Field label="Location" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
          <Field label="Default Supplier" value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} />
          <Field label="Barcode" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} mono />
          <div className="col-span-2">
            <label className="label">Notes</label>
            <textarea className="input" rows="2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>

        {error && <div className="mt-3 rounded-lg bg-state-down/5 border border-state-down/20 p-2.5 text-[12px] text-state-down">{error}</div>}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {item ? 'Save changes' : 'Create item'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', step, required, disabled, mono }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type={type}
        step={step}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={clsx('input', mono && 'font-mono')}
      />
    </div>
  );
}

function AdjustStockModal({ item, onClose, onSaved }) {
  const [type, setType] = useState('RECEIPT');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: async () => (await inventoryApi.recordMovement({
      itemId: item._id,
      type,
      qty: Number(qty),
      reason,
    })).data,
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });

  const delta = type === 'RECEIPT' ? Number(qty) : -Number(qty);
  const newBalance = Math.max(0, (item.onHand || 0) + delta);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md p-5"
      >
        <h2 className="text-[16px] font-bold mb-1">Adjust Stock</h2>
        <div className="text-[12px] text-ink-500 mb-4">
          <span className="font-mono font-bold text-brand-600">{item.sku}</span> · {item.name}
        </div>

        <div className="rounded-lg bg-ink-50 border border-ink-100 p-3 mb-4 flex justify-between text-[12px]">
          <span className="text-ink-500">Current</span>
          <span className="font-bold text-ink-900 tabular-nums">{item.onHand || 0} {item.uom}</span>
        </div>

        <div>
          <label className="label">Movement type</label>
          <div className="grid grid-cols-4 gap-1">
            {[
              { k: 'RECEIPT', lbl: 'Receipt' },
              { k: 'CONSUMPTION', lbl: 'Consume' },
              { k: 'ADJUSTMENT', lbl: 'Adjust' },
              { k: 'SCRAP', lbl: 'Scrap' },
            ].map((t) => (
              <button
                key={t.k}
                type="button"
                onClick={() => setType(t.k)}
                className={clsx(
                  'rounded-md border-2 text-[10.5px] font-bold py-2',
                  type === t.k ? 'bg-brand-50 text-brand-600 border-brand-500/30' : 'bg-white text-ink-500 border-ink-200'
                )}
              >
                {t.lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <label className="label">Quantity ({item.uom})</label>
          <input
            type="number"
            step="0.1"
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="input !text-[18px] !font-bold !text-brand-600 tabular-nums"
          />
        </div>

        {qty && (
          <div className="mt-2 text-[11.5px] text-ink-500">
            New balance: <span className="font-bold tabular-nums text-ink-900">{newBalance} {item.uom}</span>
          </div>
        )}

        <div className="mt-3">
          <label className="label">Reason</label>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className="input" />
        </div>

        {error && <div className="mt-3 rounded-lg bg-state-down/5 border border-state-down/20 p-2 text-[12px] text-state-down">{error}</div>}

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!qty || mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Record
          </button>
        </div>
      </form>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * WIP PANEL — shows materials currently issued to production, grouped by Job
 * ══════════════════════════════════════════════════════════════════════ */
const STATUS_PILL = {
  issued:    'chip-yellow',
  consumed:  'chip-green',
  partial:   'chip-blue',
  returned:  'chip-gray',
  cancelled: 'chip-red',
};

function WIPPanel({ onSelectIssue }) {
  const issuedQuery = useQuery({
    queryKey: ['material-issues', 'wip-issued'],
    queryFn: async () => (await materialIssueApi.list({ status: 'issued', limit: 100 })).data,
    refetchInterval: 30_000,
  });
  const partialQuery = useQuery({
    queryKey: ['material-issues', 'wip-partial'],
    queryFn: async () => (await materialIssueApi.list({ status: 'partial', limit: 50 })).data,
    refetchInterval: 30_000,
  });

  const wipIssues = useMemo(() => {
    return [...(issuedQuery.data || []), ...(partialQuery.data || [])]
      .sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  }, [issuedQuery.data, partialQuery.data]);

  const groupedByJob = useMemo(() => {
    const groups = {};
    for (const issue of wipIssues) {
      const key = issue.jobOrderNumber || '__no_job__';
      if (!groups[key]) {
        groups[key] = {
          jobOrderNumber: issue.jobOrderNumber,
          productSku: issue.productSku,
          productName: issue.productName,
          issues: [],
          totalValue: 0,
          totalItems: 0,
        };
      }
      groups[key].issues.push(issue);
      groups[key].totalValue += issue.totalValue || 0;
      groups[key].totalItems += (issue.items || []).length;
    }
    return groups;
  }, [wipIssues]);

  const stats = {
    open: wipIssues.length,
    jobs: Object.keys(groupedByJob).filter((k) => k !== '__no_job__').length,
    people: new Set(wipIssues.map((i) => i.issuedToName).filter(Boolean)).size,
    value: wipIssues.reduce((s, i) => s + (i.totalValue || 0), 0),
  };

  const isLoading = issuedQuery.isLoading || partialQuery.isLoading;

  return (
    <div className="rounded-xl border-2 border-state-idle/20 bg-state-idle/5 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Factory className="h-5 w-5 text-state-idle" />
          <h3 className="font-bold text-[15px] text-ink-900">Work in Progress</h3>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px]">
          <span><strong className="text-state-idle">{stats.open}</strong> issues</span>
          <span><strong className="text-state-idle">{stats.jobs}</strong> jobs</span>
          <span><strong className="text-state-idle">{stats.people}</strong> people</span>
          <span><strong className="text-state-idle">₹{Math.round(stats.value).toLocaleString('en-IN')}</strong></span>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-6 text-[12px] text-ink-400">Loading WIP…</div>
      ) : Object.keys(groupedByJob).length === 0 ? (
        <div className="bg-white rounded-lg border border-ink-100 text-center py-8">
          <div className="text-[32px] mb-1">🏭</div>
          <div className="font-bold text-[13px] text-ink-900">No materials in progress right now</div>
          <div className="text-[11.5px] text-ink-500 mt-1">
            Click "Issue Material" above to send raw materials to an operator/job/stage.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {Object.entries(groupedByJob).map(([key, grp]) => (
            <WIPJobGroup key={key} group={grp} onSelectIssue={onSelectIssue} />
          ))}
        </div>
      )}
    </div>
  );
}

function WIPJobGroup({ group, onSelectIssue }) {
  const [expanded, setExpanded] = useState(true);
  const hasJob = group.jobOrderNumber;
  return (
    <div className="rounded-lg bg-white border border-ink-200 overflow-hidden">
      <div
        className="px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-ink-50 border-b border-ink-100"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight className={clsx('h-4 w-4 text-ink-400 transition-transform', expanded && 'rotate-90')} />
        <Factory className="h-4 w-4 text-brand-500" />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {hasJob ? (
              <span className="font-mono text-[12.5px] font-bold text-brand-600">{group.jobOrderNumber}</span>
            ) : (
              <span className="text-[11.5px] italic text-ink-500">No Job Order</span>
            )}
            {group.productSku && (
              <span className="chip-blue text-[10px] font-mono">{group.productSku}</span>
            )}
            {group.productName && (
              <span className="text-[12px] font-semibold text-ink-700">{group.productName}</span>
            )}
          </div>
        </div>
        <div className="text-[10.5px] text-ink-500 flex gap-2">
          <span><strong>{group.issues.length}</strong> issues</span>
          <span>•</span>
          <span><strong>{group.totalItems}</strong> items</span>
          <span>•</span>
          <span><strong>₹{Math.round(group.totalValue).toLocaleString('en-IN')}</strong></span>
        </div>
      </div>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead className="bg-ink-50/40">
              <tr>
                <th className="th !text-[10px]">Issue #</th>
                <th className="th !text-[10px]">Stage</th>
                <th className="th !text-[10px]">Issued To</th>
                <th className="th !text-[10px]">Items</th>
                <th className="th !text-[10px]">Time</th>
                <th className="th !text-[10px]">Status</th>
                <th className="th !text-[10px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {group.issues.map((issue) => (
                <tr key={issue._id} className="cursor-pointer hover:bg-ink-50" onClick={() => onSelectIssue(issue)}>
                  <td className="td font-mono text-[11px] font-bold text-brand-600">{issue.issueNumber}</td>
                  <td className="td"><span className="chip-blue text-[9.5px] capitalize">{issue.stage.replace(/_/g, ' ')}</span></td>
                  <td className="td text-[11.5px]">
                    <div className="flex items-center gap-1">
                      <UserIcon className="h-3 w-3 text-ink-400" />
                      <span>{issue.issuedToName}</span>
                    </div>
                  </td>
                  <td className="td text-[11px]">
                    {(issue.items || []).slice(0, 2).map((l, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-[10px] text-ink-700">{l.sku}</span>
                        <span className="text-ink-400">·</span>
                        <span className="tabular-nums">{l.issuedQty} {l.uom}</span>
                      </div>
                    ))}
                    {(issue.items || []).length > 2 && (
                      <div className="text-[9.5px] text-ink-400">+{issue.items.length - 2} more</div>
                    )}
                  </td>
                  <td className="td text-[10.5px] text-ink-500">
                    <div className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(issue.issuedAt)}</div>
                  </td>
                  <td className="td">
                    <span className={`${STATUS_PILL[issue.status]} text-[9.5px] capitalize`}>{issue.status}</span>
                  </td>
                  <td className="td"><ChevronRight className="h-3.5 w-3.5 text-ink-400" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

/* ════════════════════════════════════════════════════════════════════════
 * Material Issue detail modal — view + report consumption + cancel
 * ══════════════════════════════════════════════════════════════════════ */
function IssueDetailModal({ issue, onClose, onChanged }) {
  const [mode, setMode] = useState('view');
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

  const updateC = (i, patch) => setConsumption(consumption.map((c, j) => i === j ? { ...c, ...patch } : c));

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl my-4">
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
              <div className="text-[11.5px] text-ink-500 mb-3">Consumed + Returned + Scrap = Issued</div>
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
                            <input type="number" step="0.01"
                              className="input !py-1 text-[12px] text-right tabular-nums"
                              value={c.consumedQty}
                              onChange={(e) => updateC(i, { consumedQty: e.target.value })} />
                          </td>
                          <td className="td p-1">
                            <input type="number" step="0.01"
                              className="input !py-1 text-[12px] text-right tabular-nums"
                              value={c.returnedQty}
                              onChange={(e) => updateC(i, { returnedQty: e.target.value })} />
                          </td>
                          <td className="td p-1">
                            <input type="number" step="0.01"
                              className={clsx('input !py-1 text-[12px] text-right tabular-nums', !matches && 'border-state-down')}
                              value={c.scrapQty}
                              onChange={(e) => updateC(i, { scrapQty: e.target.value })} />
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
            <div className="rounded-lg bg-state-down/5 border border-state-down/30 p-3 text-[12px] text-state-down">{error}</div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex justify-between items-center gap-2">
          <div>
            {['issued', 'partial'].includes(issue.status) && mode === 'view' && (
              <button
                onClick={() => { if (confirm('Cancel this issue and return all materials to stock?')) cancelMut.mutate(); }}
                className="btn-secondary text-state-down" disabled={cancelMut.isPending}>
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
                <button onClick={() => consumeMut.mutate()} className="btn-primary" disabled={consumeMut.isPending}>
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

/* ════════════════════════════════════════════════════════════════════════
 * ISSUE MATERIAL MODAL — issue raw materials to a job/person/stage
 * Inventory deducts on submit, WIP record gets created.
 * ══════════════════════════════════════════════════════════════════════ */
const STAGES = [
  { key: 'printing',   label: 'Printing' },
  { key: 'inspection', label: 'Inspection' },
  { key: 'lamination', label: 'Lamination' },
  { key: 'hot_room',   label: 'Hot Room' },
  { key: 'slitting',   label: 'Slitting' },
  { key: 'cutting',    label: 'Cutting' },
  { key: 'packaging',  label: 'Packaging' },
  { key: 'general',    label: 'General' },
];

function IssueMaterialModal({ onClose, onSaved, prefillSku }) {
  const user = authStore((s) => s.user);
  const [form, setForm] = useState({
    jobOrderNumber: '',
    stage: 'printing',
    issuedToName: '',
    issuedToUserId: '',
    notes: '',
  });
  const [lines, setLines] = useState([
    { sku: prefillSku || '', name: '', qty: '', uom: 'kg' },
  ]);
  const [error, setError] = useState('');

  const employees = useQuery({
    queryKey: ['employees-dropdown'],
    queryFn: async () => (await adminApi.listUsers()).data,
  });

  const inventory = useQuery({
    queryKey: ['inventory-for-issue'],
    queryFn: async () => (await inventoryApi.list({ limit: 500 })).data,
  });
  const items = inventory.data || [];
  const itemBySku = Object.fromEntries(items.map((i) => [i.sku, i]));

  // Pre-fill name if SKU was passed in
  useEffect(() => {
    if (prefillSku && itemBySku[prefillSku]) {
      setLines((ls) => ls.map((l, i) => i === 0
        ? { ...l, sku: prefillSku, name: itemBySku[prefillSku].name, uom: itemBySku[prefillSku].uom }
        : l));
    }
  // eslint-disable-next-line
  }, [inventory.data]);

  const mut = useMutation({
    mutationFn: async () => {
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
    if (item) updateLine(i, { sku, name: item.name, uom: item.uom });
    else updateLine(i, { sku });
  };

  const onPersonPicked = (userId) => {
    if (!userId) return setForm({ ...form, issuedToUserId: '', issuedToName: '' });
    const emp = (employees.data || []).find((e) => String(e._id) === userId);
    setForm({ ...form, issuedToUserId: userId, issuedToName: emp?.name || '' });
  };

  const canSubmit = (form.issuedToName || form.issuedToUserId) && lines.some((l) => l.sku && l.qty);

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
              Materials will be deducted from inventory and tracked as WIP against this person &amp; stage.
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                            required list="skus-issue"
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
              </table>
            </div>
            <datalist id="skus-issue">
              {items.map((i) => <option key={i._id} value={i.sku}>{i.name}</option>)}
            </datalist>
          </div>

          <div>
            <label className="label">Notes (optional)</label>
            <textarea rows="2" className="input"
              placeholder="Special instructions, lot number, etc."
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
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageMinus className="h-4 w-4" />}
            Issue & Deduct from Inventory
          </button>
        </div>
      </form>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * MATERIAL REQUESTS PANEL — for inventory team
 *
 * Lists pending requests from operators. Each card shows the requested
 * items, available stock, and lets the inventory clerk:
 *   - Issue all items (deducts stock + adds to job's stage materialsAdded)
 *   - Reject the request with a reason
 * ══════════════════════════════════════════════════════════════════════ */

function PendingRequestsButton({ showRequests, onToggle }) {
  // Show pending count as a badge so the inventory clerk knows there's work
  const requests = useQuery({
    queryKey: ['material-requests', 'pending-count'],
    queryFn: async () => (await materialRequestApi.list({ status: 'pending' })).data,
    refetchInterval: 15_000,
  });
  const pendingCount = (requests.data || []).length;

  return (
    <button
      onClick={onToggle}
      className={clsx(
        'btn-sm inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold border',
        showRequests
          ? 'bg-brand-500 text-white border-brand-500'
          : 'bg-brand-50 text-brand-700 border-brand-500/30 hover:bg-brand-100'
      )}
    >
      <ShoppingCart className="h-3.5 w-3.5" />
      {showRequests ? 'Hide Requests' : 'Material Requests'}
      {pendingCount > 0 && (
        <span className="bg-state-down text-white text-[9.5px] px-1.5 py-0.5 rounded-full">
          {pendingCount}
        </span>
      )}
    </button>
  );
}

function MaterialRequestsPanel() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('pending');
  const [issueModalReq, setIssueModalReq] = useState(null);
  const [rejectModalReq, setRejectModalReq] = useState(null);

  const requests = useQuery({
    queryKey: ['material-requests', statusFilter],
    queryFn: async () => (await materialRequestApi.list(
      statusFilter === 'all' ? {} : { status: statusFilter }
    )).data,
    refetchInterval: 15_000,
  });

  const list = requests.data || [];

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <ShoppingCart className="h-4 w-4 text-brand-500" />
          Material Requests
          <span className="ml-2 text-[10.5px] text-ink-500 font-normal">
            ({list.length} {statusFilter})
          </span>
        </div>
        <div className="flex gap-1">
          {['pending', 'partial', 'issued', 'all'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                'px-2.5 py-1 rounded-md text-[10.5px] font-bold capitalize border transition',
                statusFilter === s
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-ink-600 border-ink-200 hover:border-ink-300'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {requests.isLoading ? (
        <div className="text-center py-6 text-[12.5px] text-ink-400">Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-center py-8">
          <CheckCircle2 className="h-10 w-10 mx-auto text-state-running mb-2" />
          <div className="font-bold text-[14px] text-ink-900">All caught up!</div>
          <div className="text-[11.5px] text-ink-500 mt-1">No {statusFilter} material requests right now.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((r) => (
            <RequestRow
              key={r._id}
              request={r}
              onIssue={() => setIssueModalReq(r)}
              onReject={() => setRejectModalReq(r)}
            />
          ))}
        </div>
      )}

      {issueModalReq && (
        <IssueRequestModal
          request={issueModalReq}
          onClose={() => setIssueModalReq(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['material-requests'] });
            qc.invalidateQueries({ queryKey: ['inventory'] });
            qc.invalidateQueries({ queryKey: ['inventory-list'] });
            setIssueModalReq(null);
          }}
        />
      )}

      {rejectModalReq && (
        <RejectRequestModal
          request={rejectModalReq}
          onClose={() => setRejectModalReq(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['material-requests'] });
            setRejectModalReq(null);
          }}
        />
      )}
    </div>
  );
}

function RequestRow({ request, onIssue, onReject }) {
  const isPending = ['pending', 'partial'].includes(request.status);
  const isUrgent = request.priority === 'urgent';
  const ageHours = Math.floor((Date.now() - new Date(request.createdAt)) / 3600000);

  // Check if any line is short on stock
  const hasShortage = request.lines.some((l) => !l.sufficient);

  const statusMeta = {
    pending:   { cls: 'bg-state-idle/10 text-state-idle border-state-idle/30',         label: 'PENDING' },
    partial:   { cls: 'bg-state-idle/10 text-state-idle border-state-idle/30',         label: 'PARTIAL' },
    issued:    { cls: 'bg-state-running/10 text-state-running border-state-running/30', label: 'ISSUED' },
    rejected:  { cls: 'bg-state-down/10 text-state-down border-state-down/30',         label: 'REJECTED' },
    cancelled: { cls: 'bg-ink-100 text-ink-500 border-ink-200',                        label: 'CANCELLED' },
  }[request.status] || {};

  return (
    <div className={clsx(
      'rounded-lg border-2 bg-white p-3',
      isUrgent && isPending ? 'border-state-down/30' : 'border-ink-100'
    )}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-ink-400">
              MR-{String(request._id).slice(-6).toUpperCase()}
            </span>
            <span className="font-bold text-[13px] text-brand-600">{request.jobOrderNumber}</span>
            <span className="text-ink-400">·</span>
            <span className="text-[12px] capitalize text-ink-700">{request.stageName?.replace(/_/g, ' ')}</span>
            {isUrgent && (
              <span className="bg-state-down text-white text-[9px] font-bold px-1.5 py-0.5 rounded">🔥 URGENT</span>
            )}
            <span className={clsx('text-[9.5px] font-bold px-2 py-0.5 rounded-md border', statusMeta.cls)}>
              {statusMeta.label}
            </span>
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5">
            {request.productName} · {request.customerName}
          </div>
          <div className="text-[10.5px] text-ink-400 mt-0.5">
            By {request.requestedByName} · {ageHours < 1 ? 'just now' : `${ageHours}h ago`}
          </div>
        </div>
        {isPending && (
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={onReject}
              className="btn-secondary btn-sm !text-state-down hover:!bg-state-down/5"
            >
              <X className="h-3.5 w-3.5" /> Reject
            </button>
            <button
              onClick={onIssue}
              disabled={hasShortage}
              className={clsx(
                'btn-sm rounded-lg px-3 py-1.5 text-[12px] font-bold inline-flex items-center gap-1.5',
                hasShortage
                  ? 'bg-ink-200 text-ink-400 cursor-not-allowed'
                  : 'bg-state-running text-white hover:brightness-95'
              )}
              title={hasShortage ? 'Insufficient stock' : 'Issue all items'}
            >
              <Truck className="h-3.5 w-3.5" /> Issue
            </button>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="space-y-1 bg-ink-50 rounded-md p-2">
        {request.lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between text-[12px]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10.5px] text-ink-400">{l.sku}</span>
              <span className="text-ink-700">{l.name}</span>
              {l.fromBom && <span className="text-[9px] bg-brand-50 text-brand-600 px-1 py-0.5 rounded font-bold">BOM</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className={clsx(
                'text-[10.5px]',
                l.sufficient ? 'text-state-running' : 'text-state-down font-semibold'
              )}>
                stock: {l.currentAvailable ?? 0}
              </span>
              <span className="font-bold tabular-nums text-ink-900">
                {l.qtyIssued > 0 && <span className="text-state-running">{l.qtyIssued}/</span>}
                {l.qtyRequested} {l.uom}
              </span>
            </div>
          </div>
        ))}
      </div>

      {request.operatorNote && (
        <div className="mt-2 text-[11px] text-ink-600 bg-state-idle/5 rounded p-1.5">
          <strong>Note:</strong> {request.operatorNote}
        </div>
      )}
      {hasShortage && isPending && (
        <div className="mt-2 text-[11px] text-state-down">
          ⚠ One or more items are short on stock. Issue partially or reject.
        </div>
      )}
      {request.rejectionReason && (
        <div className="mt-2 text-[11px] text-state-down">
          <strong>Rejection reason:</strong> {request.rejectionReason}
        </div>
      )}
    </div>
  );
}

function IssueRequestModal({ request, onClose, onDone }) {
  const [issuedQtys, setIssuedQtys] = useState(
    Object.fromEntries(request.lines.map((l) => [l.sku, l.qtyRequested - (l.qtyIssued || 0)]))
  );

  const issueMut = useMutation({
    mutationFn: async () => (await materialRequestApi.issue(request._id, {
      lines: Object.entries(issuedQtys)
        .filter(([, qty]) => Number(qty) > 0)
        .map(([sku, qty]) => ({ sku, qtyIssued: Number(qty) })),
    })).data,
    onSuccess: onDone,
  });

  const totalLines = request.lines.length;
  const filledLines = Object.values(issuedQtys).filter((q) => Number(q) > 0).length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">Issue Materials</div>
            <h2 className="text-[17px] font-bold text-ink-900">
              {request.jobOrderNumber} · {request.stageName?.replace(/_/g, ' ')}
            </h2>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 grid place-items-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto flex-1">
          {request.lines.map((l, i) => (
            <div key={i} className="rounded-lg border border-ink-100 bg-white p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10.5px] text-ink-400">{l.sku}</span>
                    <span className="font-bold text-[13px] text-ink-900">{l.name}</span>
                  </div>
                  <div className="text-[10.5px] text-ink-500 mt-0.5">
                    Available: <strong>{l.currentAvailable ?? 0}</strong> {l.uom}
                    {' · '}
                    Requested: <strong>{l.qtyRequested}</strong> {l.uom}
                    {l.qtyIssued > 0 && <> · Issued: <strong>{l.qtyIssued}</strong> {l.uom}</>}
                  </div>
                </div>
                <div className="flex items-baseline gap-1">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max={l.currentAvailable}
                    value={issuedQtys[l.sku] || 0}
                    onChange={(e) => setIssuedQtys({ ...issuedQtys, [l.sku]: e.target.value })}
                    className="input py-1.5 text-[14px] tabular-nums w-24 text-right"
                  />
                  <span className="text-[12px] text-ink-500 ml-1">{l.uom}</span>
                </div>
              </div>
              {Number(issuedQtys[l.sku]) > l.currentAvailable && (
                <div className="text-[10.5px] text-state-down">
                  ⚠ Cannot issue more than available stock ({l.currentAvailable} {l.uom})
                </div>
              )}
            </div>
          ))}

          {issueMut.error && (
            <div className="rounded-lg bg-state-down/5 border border-state-down/20 p-3 text-[12px] text-state-down">
              {issueMut.error.message}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center py-3 text-[14px]">
            Cancel
          </button>
          <button
            onClick={() => issueMut.mutate()}
            disabled={filledLines === 0 || issueMut.isPending}
            className={clsx(
              'flex-[2] rounded-lg text-white text-[15px] font-bold py-3 transition flex items-center justify-center gap-2',
              filledLines > 0 && !issueMut.isPending
                ? 'bg-state-running hover:brightness-95 active:scale-[0.99]'
                : 'bg-ink-300 cursor-not-allowed'
            )}
          >
            {issueMut.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Truck className="h-5 w-5" />}
            ISSUE {filledLines}/{totalLines} ITEM{totalLines !== 1 ? 'S' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectRequestModal({ request, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const rejectMut = useMutation({
    mutationFn: async () => (await materialRequestApi.reject(request._id, { reason })).data,
    onSuccess: onDone,
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-md p-5 space-y-3">
        <h2 className="text-lg font-semibold">Reject Material Request</h2>
        <div className="text-[12.5px] text-ink-600">
          {request.jobOrderNumber} — {request.stageName?.replace(/_/g, ' ')}
        </div>
        <textarea
          rows="3"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejection (e.g. out of stock, wrong batch, see requestor)…"
          className="input text-[13px]"
        />
        {rejectMut.error && (
          <div className="text-[12px] text-state-down">{rejectMut.error.message}</div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => rejectMut.mutate()}
            disabled={!reason.trim() || rejectMut.isPending}
            className={clsx(
              'btn-primary !bg-state-down',
              (!reason.trim() || rejectMut.isPending) && '!bg-ink-300 cursor-not-allowed'
            )}
          >
            {rejectMut.isPending ? 'Rejecting…' : 'Reject Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
