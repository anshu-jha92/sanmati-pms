import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { inventoryApi } from '../api/endpoints.js';
import { Card, ErrorNote } from '../components/ui/Primitives.jsx';
import { DataTable, Pagination } from '../components/ui/DataTable.jsx';
import { FilterBar } from '../components/ui/FilterBar.jsx';
import { Can } from '../components/auth/Gates.jsx';

export function InventoryPage() {
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [showMove, setShowMove] = useState(false);

  const query = useQuery({
    queryKey: ['inventory', filters, page],
    queryFn: async () => await inventoryApi.list({ ...filters, page, limit: 50 }),
    keepPreviousData: true,
  });

  const columns = [
    { key: 'sku', label: 'SKU', render: (r) => <span className="font-mono text-xs">{r.sku}</span> },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'uom', label: 'UOM' },
    {
      key: 'onHand',
      label: 'On hand',
      className: 'text-right tabular-nums',
      render: (r) => {
        const low = r.reorderLevel && r.onHand <= r.reorderLevel;
        return <span className={low ? 'text-red-600 font-medium' : ''}>{r.onHand?.toLocaleString()}</span>;
      },
    },
    { key: 'reserved', label: 'Reserved', className: 'text-right tabular-nums', render: (r) => r.reserved?.toLocaleString() || 0 },
    { key: 'reorderLevel', label: 'Reorder', className: 'text-right tabular-nums', render: (r) => r.reorderLevel?.toLocaleString() || '—' },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Inventory</h1>
          <p className="text-sm text-ink-500">Raw materials, WIP, and finished goods. Movements are append-only.</p>
        </div>
        <Can module="inventory" action="create">
          <button className="btn-primary" onClick={() => setShowMove(true)}>
            <Plus className="h-4 w-4" /> Record movement
          </button>
        </Can>
      </header>

      <FilterBar value={filters} onChange={(v) => { setFilters(v); setPage(1); }} fields={['search']} />

      <Card bodyClass="p-0">
        <DataTable columns={columns} rows={query.data?.data} loading={query.isLoading} emptyTitle="No items" />
      </Card>
      <Pagination meta={query.data?.meta} onPage={setPage} />

      {showMove && <MovementModal onClose={() => setShowMove(false)} />}
    </div>
  );
}

function MovementModal({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ sku: '', type: 'IN', qty: 0, notes: '' });
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: async () => (await inventoryApi.recordMovement({ ...form, qty: Number(form.qty) })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
    onError: (e) => setErr(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="card w-full max-w-md p-6 space-y-3">
        <h2 className="text-lg font-semibold">Record movement</h2>
        <label>
          <span className="label">SKU</span>
          <input required className="input font-mono" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
        </label>
        <label>
          <span className="label">Type</span>
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {['IN', 'OUT', 'ADJUST', 'TRANSFER', 'ISSUE_TO_PROD', 'RECEIPT_FROM_PROD', 'RESERVE', 'UNRESERVE'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Quantity</span>
          <input required type="number" className="input" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
        </label>
        <label>
          <span className="label">Notes</span>
          <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        <ErrorNote message={err} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
