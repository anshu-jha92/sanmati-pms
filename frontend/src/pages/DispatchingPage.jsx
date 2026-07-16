import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Printer, Truck, MapPin, Package, CheckCircle2, X, Trash2, Check,
} from 'lucide-react';
import clsx from 'clsx';
import { dispatchApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { ErrorNote } from '../components/ui/Primitives.jsx';
import { Can } from '../components/auth/Gates.jsx';

/* Real dispatch lifecycle (matches the backend model). */
const STATUS_PILL = {
  planned:    { text: 'Planned',    cls: 'bg-state-idle/10 text-state-idle' },
  packed:     { text: 'Packed',     cls: 'bg-brand-500/10 text-brand-600' },
  loaded:     { text: 'Loaded',     cls: 'bg-brand-500/10 text-brand-600' },
  dispatched: { text: 'In Transit', cls: 'bg-brand-500/15 text-brand-700' },
  delivered:  { text: 'Delivered',  cls: 'bg-state-running/10 text-state-running' },
  cancelled:  { text: 'Cancelled',  cls: 'bg-state-down/10 text-state-down' },
};
const FLOW = ['planned', 'packed', 'loaded', 'dispatched', 'delivered'];
const NEXT = { planned: 'packed', packed: 'loaded', loaded: 'dispatched', dispatched: 'delivered' };
const NEXT_LABEL = { planned: 'Mark Packed', packed: 'Mark Loaded', loaded: 'Mark Dispatched', dispatched: 'Mark Delivered' };

const lineQtyTotal = (d) => (d.lines || []).reduce((n, l) => n + (Number(l.qty) || 0), 0);

export function DispatchingPage() {
  const user = authStore((s) => s.user);
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState('');

  const queue = useQuery({
    queryKey: ['dispatch', user?.plantId],
    queryFn: async () => (await dispatchApi.list({ plantId: user?.plantId, limit: 50 })).data,
    refetchInterval: 30_000,
  });

  const list = queue.data || [];
  const selected = list.find((x) => String(x._id) === String(selectedId)) || list[0];

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const transition = useMutation({
    mutationFn: ({ id, status }) => dispatchApi.transition(id, { status }),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['dispatch'] }); flash(v.status === 'cancelled' ? 'Dispatch cancelled' : `Marked ${STATUS_PILL[v.status]?.text || v.status} ✓`); },
    onError: (e) => window.alert(e?.message || 'Could not update this dispatch.'),
  });

  const printChallan = (d) => {
    if (!d) { window.alert('Pehle queue me se ek dispatch select karo.'); return; }
    openChallan(d);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Can module="dispatch" action="create">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New Dispatch
          </button>
        </Can>
        <button className="btn-secondary" onClick={() => printChallan(selected)} disabled={!selected}
          title={selected ? 'Print the selected dispatch challan' : 'Select a dispatch first'}>
          <Printer className="h-4 w-4" /> Print Challan
        </button>
      </div>

      {toast && (
        <div className="rounded-lg bg-state-running/10 border border-state-running/25 px-4 py-2.5 text-sm text-state-running font-semibold flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0" /> {toast}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-3">
        {/* Queue */}
        <div className="panel !p-0 overflow-hidden">
          <div className="panel-header !px-4 !py-3 !mb-0 !border-b border-ink-100">
            <div className="panel-title">
              <Truck className="h-4 w-4 text-brand-500" /> Dispatch Queue
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="th">Dispatch #</th>
                  <th className="th">Customer</th>
                  <th className="th text-right">Qty</th>
                  <th className="th">Vehicle</th>
                  <th className="th">Status</th>
                  <th className="th">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {queue.isLoading ? (
                  <tr><td colSpan={6} className="td text-center py-8 text-[12px] text-ink-400">Loading…</td></tr>
                ) : list.length === 0 ? (
                  <tr><td colSpan={6} className="td text-center py-8 text-[12px] text-ink-500">
                    No dispatches yet. Click <b>New Dispatch</b> to book one out.
                  </td></tr>
                ) : list.map((d) => {
                  const status = STATUS_PILL[d.status] || STATUS_PILL.planned;
                  return (
                    <tr key={d._id} onClick={() => setSelectedId(d._id)}
                      className={clsx('tr-hover cursor-pointer', selected?._id === d._id && 'bg-brand-50/40')}>
                      <td className="td"><span className="font-mono text-[11.5px] font-bold text-brand-600">{d.dispatchNumber}</span></td>
                      <td className="td text-[12px]">{d.customer || '—'}</td>
                      <td className="td text-right"><span className="font-bold text-[12px] text-state-running tabular-nums">{lineQtyTotal(d).toLocaleString()}</span></td>
                      <td className="td font-mono text-[11px]">{d.vehicle?.number || '—'}</td>
                      <td className="td"><span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-md', status.cls)}>{status.text}</span></td>
                      <td className="td">
                        <button
                          onClick={(e) => { e.stopPropagation(); openChallan(d); }}
                          className="rounded-md border border-ink-200 bg-ink-50 text-ink-600 text-[10px] font-semibold px-2 py-1 inline-flex items-center gap-1 hover:bg-ink-100"
                          title="Print challan">
                          <Printer className="h-3 w-3" /> Challan
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Delivery trail */}
        <div className="panel">
          {selected ? (
            <>
              <div className="panel-header">
                <div className="panel-title">
                  <MapPin className="h-4 w-4 text-brand-500" /> {selected.dispatchNumber} — Delivery Trail
                </div>
              </div>

              <div className="text-[11.5px] text-ink-500 mb-3 space-y-0.5">
                <div><span className="text-ink-400">Customer:</span> <b className="text-ink-800">{selected.customer}</b></div>
                <div><span className="text-ink-400">Vehicle:</span> <span className="font-mono">{selected.vehicle?.number || '—'}</span>
                  {selected.vehicle?.driverName ? ` · ${selected.vehicle.driverName}` : ''}
                  {selected.vehicle?.driverPhone ? ` · ${selected.vehicle.driverPhone}` : ''}</div>
                <div><span className="text-ink-400">Items:</span> {(selected.lines || []).length} line(s) · {lineQtyTotal(selected).toLocaleString()} total qty</div>
              </div>

              <div className="relative pl-6 mb-4">
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-ink-200" />
                {selected.status === 'cancelled' ? (
                  <TrailItem dot="red" title="✕ Cancelled" meta="Yeh dispatch cancel kar diya gaya" />
                ) : (
                  <>
                    <TrailItem dot={reached(selected.status, 'packed') ? 'green' : 'gray'} title="📦 Packed & tagged"
                      meta={reached(selected.status, 'packed') ? 'Packed for shipment' : 'Awaiting packing'} />
                    <TrailItem dot={reached(selected.status, 'loaded') ? 'green' : 'gray'} title="🏗 Loaded on vehicle"
                      meta={reached(selected.status, 'loaded') ? (selected.vehicle?.number || 'Loaded') : 'Awaiting loading'} />
                    <TrailItem dot={selected.status === 'dispatched' ? 'blue' : reached(selected.status, 'dispatched') ? 'green' : 'gray'}
                      title={reached(selected.status, 'delivered') ? '🚚 Dispatched' : selected.status === 'dispatched' ? '🚚 In Transit' : '⏳ Awaiting dispatch'}
                      meta={selected.actualDispatchAt ? new Date(selected.actualDispatchAt).toLocaleString() : (selected.vehicle?.number || '—')}
                      active={selected.status === 'dispatched'} />
                    <TrailItem dot={selected.status === 'delivered' ? 'green' : 'gray'} title="✓ Delivered"
                      meta={selected.deliveredAt ? new Date(selected.deliveredAt).toLocaleString() : 'Not delivered yet'} />
                  </>
                )}
              </div>

              <Can module="dispatch" action="update">
                {selected.status !== 'delivered' && selected.status !== 'cancelled' && (
                  <div className="flex items-center gap-2 flex-wrap border-t border-ink-100 pt-3">
                    {NEXT[selected.status] && (
                      <button className="btn-primary text-xs" disabled={transition.isPending}
                        onClick={() => transition.mutate({ id: selected._id, status: NEXT[selected.status] })}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> {NEXT_LABEL[selected.status]}
                      </button>
                    )}
                    <button className="btn-secondary text-xs text-state-down" disabled={transition.isPending}
                      onClick={() => { if (window.confirm('Cancel this dispatch?')) transition.mutate({ id: selected._id, status: 'cancelled' }); }}>
                      Cancel
                    </button>
                  </div>
                )}
              </Can>
            </>
          ) : (
            <div className="text-center py-10 text-[12.5px] text-ink-400">
              Select a dispatch to see its delivery trail.
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateDispatchModal
          onClose={() => setShowCreate(false)}
          onCreated={(doc) => { qc.invalidateQueries({ queryKey: ['dispatch'] }); setSelectedId(doc?._id || null); setShowCreate(false); flash('Dispatch created ✓'); }}
        />
      )}
    </div>
  );
}

const reached = (cur, target) => FLOW.indexOf(cur) >= FLOW.indexOf(target);

function TrailItem({ dot, title, meta, active }) {
  const dotColor = {
    green: 'bg-state-running border-state-running',
    blue: 'bg-brand-500 border-brand-500',
    gray: 'bg-ink-300 border-ink-300',
    red: 'bg-state-down border-state-down',
  }[dot];
  return (
    <div className="relative pb-4 last:pb-0">
      <span className={clsx('absolute left-[-19px] top-[6px] h-2 w-2 rounded-full border-2', dotColor, active && 'animate-pulse')} />
      <div className="font-bold text-[12px] text-ink-900">{title}</div>
      <div className="text-[10.5px] text-ink-400 mt-0.5 font-mono">{meta}</div>
    </div>
  );
}

/* ── Create dispatch modal ───────────────────────────────────────────────── */
const genDispatchNo = () => 'DSP-' + Math.abs(Date.now()).toString(36).toUpperCase().slice(-6);

function CreateDispatchModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    dispatchNumber: genDispatchNo(),
    customer: '',
    reference: '',
    vehicleNumber: '',
    driverName: '',
    driverPhone: '',
    plannedAt: '',
    notes: '',
  });
  const [lines, setLines] = useState([{ sku: '', qty: '', uom: 'kg', lot: '' }]);
  const [err, setErr] = useState('');

  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines((ls) => [...ls, { sku: '', qty: '', uom: 'kg', lot: '' }]);
  const removeLine = (i) => setLines((ls) => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls);

  const validLines = lines.filter((l) => l.sku.trim() && Number(l.qty) > 0);
  const canSubmit = form.dispatchNumber.trim() && form.customer.trim() && validLines.length > 0;

  const mut = useMutation({
    mutationFn: async () => {
      const vehicle = {};
      if (form.vehicleNumber.trim()) vehicle.number = form.vehicleNumber.trim();
      if (form.driverName.trim()) vehicle.driverName = form.driverName.trim();
      if (form.driverPhone.trim()) vehicle.driverPhone = form.driverPhone.trim();
      const payload = {
        dispatchNumber: form.dispatchNumber.trim(),
        customer: form.customer.trim(),
        lines: validLines.map((l) => ({
          sku: l.sku.trim(), qty: Number(l.qty),
          ...(l.uom.trim() ? { uom: l.uom.trim() } : {}),
          ...(l.lot.trim() ? { lotNumber: l.lot.trim() } : {}),
        })),
        ...(Object.keys(vehicle).length ? { vehicle } : {}),
        ...(form.reference.trim() ? { salesOrderExternalId: form.reference.trim() } : {}),
        ...(form.plannedAt ? { plannedDispatchAt: form.plannedAt } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      };
      return (await dispatchApi.create(payload)).data;
    },
    onSuccess: (doc) => onCreated(doc),
    onError: (e) => {
      if (e.code === 'E_DUPLICATE') setErr('Yeh dispatch number pehle se use ho chuka hai — dusra number do.');
      else if (Array.isArray(e.details) && e.details.length) setErr(`${e.message}:\n${e.details.map((d) => `• ${d.path}: ${d.message}`).join('\n')}`);
      else setErr(e.message || 'Could not create dispatch.');
    },
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 overflow-y-auto" onClick={mut.isPending ? undefined : onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); setErr(''); mut.mutate(); }}
        className="card w-full max-w-2xl p-6 space-y-4 my-8">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-500/10 text-brand-600"><Truck className="h-4 w-4" /></span>
            <div>
              <h2 className="text-[15px] font-bold text-ink-900">New Dispatch</h2>
              <p className="text-[11.5px] text-ink-500">Finished goods ko customer ko book out karo.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-700 p-1"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label><span className="label">Dispatch #</span>
            <input className="input font-mono" value={form.dispatchNumber} onChange={(e) => setForm({ ...form, dispatchNumber: e.target.value })} /></label>
          <label><span className="label">Customer *</span>
            <input required className="input" placeholder="e.g. Parle Products" value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} /></label>
          <label><span className="label">Reference / SO ID</span>
            <input className="input" placeholder="optional" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
          <label><span className="label">Planned dispatch</span>
            <input type="datetime-local" className="input" value={form.plannedAt} onChange={(e) => setForm({ ...form, plannedAt: e.target.value })} /></label>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="label !mb-0">Items *</span>
            <button type="button" onClick={addLine} className="text-[11.5px] font-semibold text-brand-600 hover:underline inline-flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" /> Add item
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_80px_70px_1fr_28px] sm:items-center">
                <input className="input" placeholder="SKU (e.g. PARLE-POUCH-150G)" value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value })} />
                <input className="input tabular-nums" type="number" min="0" step="any" placeholder="Qty" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                <input className="input" placeholder="UOM" value={l.uom} onChange={(e) => setLine(i, { uom: e.target.value })} />
                <input className="input" placeholder="Lot / batch" value={l.lot} onChange={(e) => setLine(i, { lot: e.target.value })} />
                <button type="button" onClick={() => removeLine(i)} disabled={lines.length <= 1}
                  className="text-ink-300 hover:text-state-down disabled:opacity-30 disabled:cursor-not-allowed p-1" title="Remove item">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label><span className="label">Vehicle no.</span>
            <input className="input" placeholder="MH12-AB-3421" value={form.vehicleNumber} onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })} /></label>
          <label><span className="label">Driver name</span>
            <input className="input" value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} /></label>
          <label><span className="label">Driver phone</span>
            <input className="input" value={form.driverPhone} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} /></label>
        </div>

        <label className="block"><span className="label">Notes</span>
          <textarea rows={2} className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>

        <ErrorNote message={err} />

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={mut.isPending}>Cancel</button>
          <button type="submit" disabled={!canSubmit || mut.isPending}
            className={`btn-primary ${(!canSubmit || mut.isPending) ? '!bg-ink-200 !text-ink-400 cursor-not-allowed pointer-events-none' : ''}`}>
            <Package className="h-4 w-4" /> {mut.isPending ? 'Creating…' : 'Create dispatch'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Printable delivery challan (opens a clean print window) ──────────────── */
function openChallan(d) {
  const esc = (s) => String(s ?? '—').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = (d.lines || []).map((l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(l.sku)}</td>
      <td class="r">${esc((Number(l.qty) || 0).toLocaleString())}</td>
      <td>${esc(l.uom || '')}</td>
      <td>${esc(l.lotNumber || '')}</td>
    </tr>`).join('');
  const total = (d.lines || []).reduce((n, l) => n + (Number(l.qty) || 0), 0);
  const when = d.plannedDispatchAt ? new Date(d.plannedDispatchAt).toLocaleString() : new Date().toLocaleString();
  const v = d.vehicle || {};
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Challan ${esc(d.dispatchNumber)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0d1526;margin:0;padding:32px;font-size:13px}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a6bff;padding-bottom:14px}
    .brand{font-size:20px;font-weight:800;color:#0d1526} .brand span{color:#1a6bff}
    .sub{color:#566682;font-size:11px;margin-top:2px} h1{font-size:15px;letter-spacing:.06em;text-transform:uppercase;margin:0;color:#445070}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 28px;margin:20px 0}
    .meta div{font-size:12px} .meta b{color:#0d1526} .k{color:#8896b4;font-size:10px;text-transform:uppercase;letter-spacing:.08em;display:block}
    table{width:100%;border-collapse:collapse;margin-top:8px} th,td{border:1px solid #e2e6f0;padding:7px 9px;text-align:left;font-size:12px}
    th{background:#f5f7fd;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#566682} .r{text-align:right}
    tfoot td{font-weight:700;background:#f5f7fd}
    .sign{display:flex;justify-content:space-between;margin-top:56px} .sign div{width:40%;border-top:1px solid #8896b4;padding-top:6px;font-size:11px;color:#566682;text-align:center}
    .note{margin-top:14px;font-size:11px;color:#566682}
    @media print{ body{padding:16px} }
  </style></head><body>
    <div class="hd">
      <div><div class="brand">Sanmati <span>Packaging</span></div><div class="sub">Flexible Packaging · Printing · Lamination · Slitting</div></div>
      <div style="text-align:right"><h1>Delivery Challan</h1><div class="sub">${esc(d.dispatchNumber)}</div></div>
    </div>
    <div class="meta">
      <div><span class="k">Customer</span><b>${esc(d.customer)}</b></div>
      <div><span class="k">Date</span><b>${esc(when)}</b></div>
      <div><span class="k">Vehicle</span><b>${esc(v.number)}</b></div>
      <div><span class="k">Driver</span><b>${esc(v.driverName)}${v.driverPhone ? ' · ' + esc(v.driverPhone) : ''}</b></div>
      ${d.salesOrderExternalId ? `<div><span class="k">Reference</span><b>${esc(d.salesOrderExternalId)}</b></div>` : ''}
      <div><span class="k">Status</span><b>${esc((d.status || 'planned').toUpperCase())}</b></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>SKU / Product</th><th class="r">Qty</th><th>UOM</th><th>Lot / Batch</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#8896b4">No items</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="r">${total.toLocaleString()}</td><td colspan="2"></td></tr></tfoot>
    </table>
    ${d.notes ? `<div class="note"><b>Notes:</b> ${esc(d.notes)}</div>` : ''}
    <div class="sign"><div>Prepared by (Sanmati)</div><div>Received by (Customer)</div></div>
  </body></html>`;

  const w = window.open('', '_blank', 'width=820,height=920');
  if (!w) { window.alert('Popup block ho gaya — challan print karne ke liye popups allow karo.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* user can print manually */ } }, 300);
}
