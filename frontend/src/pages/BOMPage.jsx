import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Search, X, ChevronDown, ChevronUp, Calculator, Package,
  Plus, Pencil, Trash2, Check,
} from 'lucide-react';
import clsx from 'clsx';
import { bomApi, inventoryApi } from '../api/endpoints.js';
import { ErrorNote } from '../components/ui/Primitives.jsx';
import { Can } from '../components/auth/Gates.jsx';

/* ════════════════════════════════════════════════════════════════════════
 * BOM (Bill of Materials) page
 * Author recipes in-app (New BOM), OR receive them from an external ERP via
 * POST /integrations/v1/bom. Either way they list here, can be edited, and
 * drive the material Requirements Calculator.
 * ══════════════════════════════════════════════════════════════════════ */

const STAGES = ['printing', 'inspection', 'lamination', 'hot_room', 'slitting', 'cutting', 'packaging', 'any'];
const stageLabel = (s) => (s || 'any').replace('_', ' ');

export function BOMPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ active: true });
  const [expanded, setExpanded] = useState(null);
  const [calculatorFor, setCalculatorFor] = useState(null);
  const [editing, setEditing] = useState(null);   // null | 'new' | bomObject
  const [toast, setToast] = useState('');

  const query = useQuery({
    queryKey: ['bom', filters],
    queryFn: async () => (await bomApi.list({ ...filters, limit: 100 })).data,
    refetchInterval: 60_000,
  });

  // Inventory SKUs — used as suggestions + name/uom auto-fill in the BOM editor.
  const materialsQ = useQuery({
    queryKey: ['bom', 'materials'],
    queryFn: async () => (await inventoryApi.list({ limit: 500 })).data,
  });
  const materials = materialsQ.data || [];

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const del = useMutation({
    mutationFn: (id) => bomApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bom'] }); setToast('BOM deleted ✓'); },
    onError: (e) => window.alert(e?.message || 'Could not delete this BOM.'),
  });

  const boms = query.data || [];
  const hasFilter = Boolean(filters.q);

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[17px] font-bold text-ink-900">Bill of Materials (BOM)</h2>
          <p className="text-[12.5px] text-ink-500 max-w-[70ch]">
            Har finished product ki recipe — kaunse raw material kitne lagenge. App me banao, ya external ERP se sync karo.
          </p>
        </div>
        <Can module="inventory" action="create">
          <button className="btn-primary" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> New BOM
          </button>
        </Can>
      </header>

      {toast && (
        <div className="rounded-lg bg-state-running/10 border border-state-running/25 px-4 py-2.5 text-sm text-state-running font-semibold flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0" /> {toast}
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard accent="blue" label="Total BOMs" value={boms.length} />
        <StatCard accent="green" label="Active" value={boms.filter((b) => b.active).length} />
        <StatCard accent="yellow" label="Total Components" value={boms.reduce((s, b) => s + (b.components?.length || 0), 0)} />
      </section>

      <div className="panel !p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-400" />
            <input
              className="input pl-8 py-1.5 text-[12.5px]"
              placeholder="Search by product SKU or name…"
              value={filters.q || ''}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </div>
          <label className="inline-flex items-center gap-1.5 text-[12px]">
            <input type="checkbox" checked={filters.active} onChange={(e) => setFilters({ ...filters, active: e.target.checked })} />
            Active only
          </label>
          {hasFilter && (
            <button className="btn-ghost btn-sm text-state-down" onClick={() => setFilters({ active: true })}>
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {query.isLoading ? (
        <div className="text-center py-10 text-[12.5px] text-ink-400">Loading BOMs…</div>
      ) : boms.length === 0 ? (
        <div className="panel text-center py-14">
          <div className="text-[40px] mb-2">📋</div>
          <div className="font-bold text-[14px] text-ink-900 mb-1">No BOMs yet</div>
          <div className="text-[12.5px] text-ink-500 max-w-[52ch] mx-auto">
            Ek recipe banane ke liye <b>New BOM</b> dabao — ya external ERP se
            <span className="font-mono text-[11px]"> POST /integrations/v1/bom</span> se sync karo.
          </div>
          <Can module="inventory" action="create">
            <button className="btn-primary mt-4 mx-auto" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> New BOM
            </button>
          </Can>
        </div>
      ) : (
        <div className="space-y-2">
          {boms.map((b) => (
            <BomCard
              key={b._id}
              bom={b}
              expanded={expanded === b._id}
              onToggle={() => setExpanded(expanded === b._id ? null : b._id)}
              onCalculate={() => setCalculatorFor(b)}
              onEdit={() => setEditing(b)}
              onDelete={() => {
                if (window.confirm(`Delete BOM "${b.productSku}" (v${b.version})? This can't be undone.`)) del.mutate(b._id);
              }}
            />
          ))}
        </div>
      )}

      {calculatorFor && (
        <RequirementsCalculator bom={calculatorFor} onClose={() => setCalculatorFor(null)} />
      )}

      {editing && (
        <BomFormModal
          bom={editing === 'new' ? null : editing}
          materials={materials}
          onClose={() => setEditing(null)}
          onSaved={(wasEdit) => { qc.invalidateQueries({ queryKey: ['bom'] }); setToast(wasEdit ? 'BOM saved ✓' : 'BOM created ✓'); setEditing(null); }}
        />
      )}
    </div>
  );
}

function StatCard({ accent, label, value }) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="sc-label">{label}</div>
      <div className="sc-val">{value}</div>
    </div>
  );
}

function BomCard({ bom, expanded, onToggle, onCalculate, onEdit, onDelete }) {
  return (
    <div className="card overflow-hidden">
      <div className="p-4 flex items-center gap-3 cursor-pointer hover:bg-ink-50" onClick={onToggle}>
        <div className="h-10 w-10 rounded-lg bg-brand-500/10 text-brand-600 grid place-items-center shrink-0">
          <BookOpen className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[13px] font-bold text-brand-600">{bom.productSku}</span>
            <span className="chip-gray text-[10px]">v{bom.version}</span>
            {bom.active ? <span className="chip-green text-[10px]">Active</span> : <span className="chip-red text-[10px]">Inactive</span>}
            {String(bom.externalId || '').startsWith('LOCAL-')
              ? <span className="chip-blue text-[10px]">In-app</span>
              : <span className="chip-gray text-[10px]">ERP</span>}
          </div>
          <div className="font-bold text-[14px] text-ink-900 truncate">{bom.productName || bom.productSku}</div>
          <div className="text-[11.5px] text-ink-500 mt-0.5">
            Produces {bom.outputQty} {bom.outputUom} · {bom.components?.length || 0} components
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onCalculate(); }} className="btn-secondary btn-sm shrink-0">
          <Calculator className="h-3.5 w-3.5" /> Calculate
        </button>
        <Can module="inventory" action="update">
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit BOM"
            className="h-8 w-8 rounded-md hover:bg-ink-100 text-ink-500 grid place-items-center shrink-0">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </Can>
        <Can module="inventory" action="delete">
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete BOM"
            className="h-8 w-8 rounded-md hover:bg-state-down/10 text-ink-400 hover:text-state-down grid place-items-center shrink-0">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Can>
        {expanded ? <ChevronUp className="h-4 w-4 text-ink-400 shrink-0" /> : <ChevronDown className="h-4 w-4 text-ink-400 shrink-0" />}
      </div>
      {expanded && (
        <div className="border-t border-ink-100 bg-ink-50/40 p-4">
          <div className="text-[11px] text-ink-500 uppercase font-bold tracking-wider mb-2">Components (per {bom.outputQty} {bom.outputUom})</div>
          <div className="overflow-x-auto">
            <table className="table border border-ink-100 rounded-lg bg-white min-w-[640px]">
              <thead>
                <tr>
                  <th className="th">SKU</th>
                  <th className="th">Name</th>
                  <th className="th text-right">Qty / unit</th>
                  <th className="th">UOM</th>
                  <th className="th text-right">Scrap %</th>
                  <th className="th text-right">Effective</th>
                  <th className="th">Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {(bom.components || []).map((c, i) => (
                  <tr key={i}>
                    <td className="td font-mono text-[11.5px] font-bold text-brand-600">{c.sku}</td>
                    <td className="td text-[12px]">{c.name || '—'}</td>
                    <td className="td text-right tabular-nums">{c.qtyPerUnit}</td>
                    <td className="td text-[11.5px]">{c.uom}</td>
                    <td className="td text-right tabular-nums text-[11.5px] text-ink-500">{c.scrapPct || 0}%</td>
                    <td className="td text-right tabular-nums font-semibold">
                      {(c.qtyPerUnit * (1 + (c.scrapPct || 0) / 100)).toFixed(4)}
                    </td>
                    <td className="td"><span className="chip-gray text-[10px] capitalize">{stageLabel(c.stage)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bom.notes && (
            <div className="mt-3 text-[11.5px] text-ink-600 bg-white p-2 rounded border border-ink-100">
              <span className="text-ink-400 font-bold">Notes:</span> {bom.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Create / edit a BOM recipe ──────────────────────────────────────────── */
const blankComp = () => ({ sku: '', name: '', qtyPerUnit: '', uom: 'kg', scrapPct: '0', stage: 'printing' });

function BomFormModal({ bom, materials, onClose, onSaved }) {
  const isEdit = !!bom;
  const [form, setForm] = useState({
    productSku: bom?.productSku || '',
    productName: bom?.productName || '',
    version: bom?.version || 'v1',
    active: bom?.active ?? true,
    outputQty: bom?.outputQty ?? 1000,
    outputUom: bom?.outputUom || 'pcs',
    notes: bom?.notes || '',
  });
  const [comps, setComps] = useState(
    bom?.components?.length
      ? bom.components.map((c) => ({
          sku: c.sku || '', name: c.name || '', qtyPerUnit: String(c.qtyPerUnit ?? ''),
          uom: c.uom || 'kg', scrapPct: String(c.scrapPct ?? 0), stage: c.stage || 'any',
        }))
      : [blankComp()]
  );
  const [err, setErr] = useState('');

  const bySku = useMemo(() => Object.fromEntries((materials || []).map((m) => [String(m.sku).toUpperCase(), m])), [materials]);

  const setComp = (i, patch) => setComps((cs) => cs.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  const addComp = () => setComps((cs) => [...cs, blankComp()]);
  const removeComp = (i) => setComps((cs) => cs.length > 1 ? cs.filter((_, idx) => idx !== i) : cs);
  const onSku = (i, sku) => {
    const m = bySku[sku.trim().toUpperCase()];
    setComp(i, { sku, ...(m ? { name: comps[i].name || m.name || '', uom: m.uom || comps[i].uom } : {}) });
  };

  const validComps = comps.filter((c) => c.sku.trim() && Number(c.qtyPerUnit) > 0);
  const canSubmit = form.productSku.trim() && Number(form.outputQty) > 0 && validComps.length > 0;

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        productSku: form.productSku.trim(),
        productName: form.productName.trim() || undefined,
        version: (form.version.trim() || 'v1'),
        active: form.active,
        outputQty: Number(form.outputQty),
        outputUom: form.outputUom.trim() || 'pcs',
        notes: form.notes.trim() || undefined,
        components: validComps.map((c) => ({
          sku: c.sku.trim(),
          name: c.name.trim() || undefined,
          qtyPerUnit: Number(c.qtyPerUnit),
          uom: c.uom.trim() || 'kg',
          scrapPct: Number(c.scrapPct) || 0,
          stage: c.stage || 'any',
        })),
      };
      return isEdit ? (await bomApi.update(bom._id, payload)).data : (await bomApi.create(payload)).data;
    },
    onSuccess: () => onSaved(isEdit),
    onError: (e) => {
      if (e.code === 'E_DUPLICATE') setErr('Yeh BOM pehle se maujood hai.');
      else if (Array.isArray(e.details) && e.details.length) setErr(`${e.message}:\n${e.details.map((d) => `• ${d.path}: ${d.message}`).join('\n')}`);
      else setErr(e.message || 'Could not save this BOM.');
    },
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 overflow-y-auto" onClick={mut.isPending ? undefined : onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); setErr(''); mut.mutate(); }}
        className="card w-full max-w-3xl p-6 space-y-4 my-8">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-500/10 text-brand-600"><BookOpen className="h-4 w-4" /></span>
            <div>
              <h2 className="text-[15px] font-bold text-ink-900">{isEdit ? 'Edit BOM' : 'New BOM'}</h2>
              <p className="text-[11.5px] text-ink-500">Product ki recipe: kaunse raw material, kitni qty, kitna scrap.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-700 p-1"><X className="h-4 w-4" /></button>
        </div>

        {/* Product */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="col-span-2"><span className="label">Product SKU *</span>
            <input required className="input font-mono uppercase" placeholder="POUCH-NAMKEEN-250G" value={form.productSku}
              onChange={(e) => setForm({ ...form, productSku: e.target.value })} disabled={isEdit} />
          </label>
          <label><span className="label">Version</span>
            <input className="input" placeholder="v1" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></label>
          <label className="inline-flex items-end pb-2 gap-1.5 text-[12.5px]">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
          </label>
          <label className="col-span-2"><span className="label">Product name</span>
            <input className="input" placeholder="Printed Namkeen Pouch 250g" value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} /></label>
          <label><span className="label">Output qty *</span>
            <input type="number" min="1" step="any" className="input tabular-nums" value={form.outputQty} onChange={(e) => setForm({ ...form, outputQty: e.target.value })} /></label>
          <label><span className="label">Output UOM</span>
            <input className="input" placeholder="pcs" value={form.outputUom} onChange={(e) => setForm({ ...form, outputUom: e.target.value })} /></label>
        </div>
        <div className="text-[11px] text-ink-400 -mt-1">
          Neeche di gayi quantities <b>{form.outputQty || 0} {form.outputUom || 'units'}</b> banane ke liye hain (per-batch). Calculator isi ratio se scale karta hai.
        </div>

        {/* Components */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="label !mb-0">Components *</span>
            <button type="button" onClick={addComp} className="text-[11.5px] font-semibold text-brand-600 hover:underline inline-flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" /> Add material
            </button>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[680px] space-y-2">
              <div className="grid grid-cols-[1.3fr_1.3fr_80px_64px_64px_120px_74px_26px] gap-2 text-[10px] font-bold uppercase tracking-wider text-ink-400 px-0.5">
                <span>SKU</span><span>Name</span><span className="text-right">Qty/unit</span><span>UOM</span><span className="text-right">Scrap%</span><span>Stage</span><span className="text-right">Effective</span><span></span>
              </div>
              {comps.map((c, i) => {
                const eff = Number(c.qtyPerUnit) > 0 ? (Number(c.qtyPerUnit) * (1 + (Number(c.scrapPct) || 0) / 100)) : 0;
                return (
                  <div key={i} className="grid grid-cols-[1.3fr_1.3fr_80px_64px_64px_120px_74px_26px] gap-2 items-center">
                    <input className="input font-mono uppercase" list="bom-mat-skus" placeholder="BOPP-FILM-20" value={c.sku} onChange={(e) => onSku(i, e.target.value)} />
                    <input className="input" placeholder="Material name" value={c.name} onChange={(e) => setComp(i, { name: e.target.value })} />
                    <input className="input tabular-nums text-right" type="number" min="0" step="any" placeholder="0.05" value={c.qtyPerUnit} onChange={(e) => setComp(i, { qtyPerUnit: e.target.value })} />
                    <input className="input" placeholder="kg" value={c.uom} onChange={(e) => setComp(i, { uom: e.target.value })} />
                    <input className="input tabular-nums text-right" type="number" min="0" max="100" step="any" value={c.scrapPct} onChange={(e) => setComp(i, { scrapPct: e.target.value })} />
                    <select className="input capitalize" value={c.stage} onChange={(e) => setComp(i, { stage: e.target.value })}>
                      {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
                    </select>
                    <span className="text-right tabular-nums text-[12px] font-semibold text-ink-700 pr-1">{eff ? eff.toFixed(4) : '—'}</span>
                    <button type="button" onClick={() => removeComp(i)} disabled={comps.length <= 1}
                      className="text-ink-300 hover:text-state-down disabled:opacity-30 disabled:cursor-not-allowed p-0.5" title="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <datalist id="bom-mat-skus">
            {materials.map((m) => <option key={m._id} value={m.sku}>{m.name}</option>)}
          </datalist>
          <div className="text-[10.5px] text-ink-400 mt-1.5">SKU type karo — Raw Materials me maujood item pick karoge to naam &amp; UOM auto-fill ho jaayenge. Effective = qty × (1 + scrap%).</div>
        </div>

        <label className="block"><span className="label">Notes</span>
          <textarea rows={2} className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>

        <ErrorNote message={err} />

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={mut.isPending}>Cancel</button>
          <button type="submit" disabled={!canSubmit || mut.isPending}
            className={`btn-primary ${(!canSubmit || mut.isPending) ? '!bg-ink-200 !text-ink-400 cursor-not-allowed pointer-events-none' : ''}`}>
            <Check className="h-4 w-4" /> {mut.isPending ? 'Saving…' : (isEdit ? 'Save BOM' : 'Create BOM')}
          </button>
        </div>
      </form>
    </div>
  );
}

function RequirementsCalculator({ bom, onClose }) {
  const [qtyInput, setQtyInput] = useState(String(bom.outputQty || 100));
  const [result, setResult] = useState(null);
  const [computedFor, setComputedFor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const qty = Math.max(0, Math.floor(Number(qtyInput) || 0));
  const validQty = qty >= 1;

  async function calculate(targetQty = qty) {
    if (!(targetQty >= 1)) { setErr('Target output kam se kam 1 hona chahiye.'); return; }
    setLoading(true); setErr('');
    try {
      const { data } = await bomApi.requirements(bom.productSku, targetQty);
      setResult(data);
      setComputedFor(data?.targetQty ?? targetQty);
    } catch (e) {
      setErr(e?.message || 'Could not calculate.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  // Auto-recalculate (debounced) on mount and whenever the target qty changes,
  // so the result always reflects the number in the box. Recalculate forces it now.
  useEffect(() => {
    if (!validQty) return;
    const t = setTimeout(() => calculate(qty), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between">
          <div>
            <div className="text-[11px] text-ink-400 uppercase tracking-wider font-bold">Material Requirements</div>
            <h2 className="text-[17px] font-bold text-ink-900">{bom.productName || bom.productSku}</h2>
            <p className="text-[11.5px] text-ink-500 mt-0.5">Kitni raw material lagegi ek production target ke liye — inventory se compare ke saath.</p>
          </div>
          <button type="button" onClick={onClose} className="h-7 w-7 rounded-md bg-ink-50 hover:bg-ink-100 text-ink-500 grid place-items-center">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="label">Target output ({bom.outputUom})</label>
              <input
                type="number" min="1" step="1" value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') calculate(qty); }}
                className="input !text-[18px] !font-bold tabular-nums"
              />
            </div>
            <button type="button" onClick={() => calculate(qty)} className="btn-primary" disabled={loading || !validQty}>
              <Calculator className={clsx('h-4 w-4', loading && 'animate-spin')} /> {loading ? 'Calculating…' : 'Recalculate'}
            </button>
          </div>

          <ErrorNote message={err} />

          {result && (
            <>
              <div className={clsx('rounded-lg border p-3 flex items-center gap-2',
                result.canFulfill ? 'bg-state-running/5 border-state-running/20 text-state-running' : 'bg-state-down/5 border-state-down/20 text-state-down')}>
                <Package className="h-4 w-4 shrink-0" />
                <div className="text-[12px] font-semibold">
                  {result.canFulfill
                    ? `✓ Can fulfill this order — all ${result.requirements.length} materials in stock`
                    : `⚠ Cannot fulfill — ${result.shortages.length} material(s) short`}
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-ink-400 px-0.5">
                <span>Requirement calculated for <b className="text-ink-700 tabular-nums">{computedFor} {bom.outputUom}</b></span>
                {result.scalingFactor ? <span className="tabular-nums">Scaling ×{Number(result.scalingFactor).toFixed(2)}</span> : null}
              </div>

              <div className="overflow-x-auto">
                <table className="table border border-ink-100 rounded-lg">
                  <thead>
                    <tr>
                      <th className="th">SKU</th>
                      <th className="th">Name</th>
                      <th className="th text-right">Required</th>
                      <th className="th text-right">Available</th>
                      <th className="th text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {result.requirements.map((r, i) => (
                      <tr key={i}>
                        <td className="td font-mono text-[11.5px] font-bold text-brand-600">{r.sku}</td>
                        <td className="td text-[12px]">{r.name || '—'}</td>
                        <td className="td text-right tabular-nums font-bold">
                          {r.qtyRequired} {r.uom}
                          {r.scrapPct > 0 && (
                            <div className="text-[10px] text-ink-400 font-normal">{r.rawQtyRequired} + {r.scrapPct}% scrap</div>
                          )}
                        </td>
                        <td className="td text-right tabular-nums">{r.inventory ? `${r.inventory.available} ${r.uom}` : '—'}</td>
                        <td className="td text-right">
                          {r.sufficient ? <span className="chip-green text-[10px]">✓ OK</span>
                            : <span className="chip-red text-[10px]">Short by {r.shortBy.toFixed(2)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
