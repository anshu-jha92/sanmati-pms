import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { adminApi } from '../api/endpoints.js';
import { Card, StatusPill, ErrorNote } from '../components/ui/Primitives.jsx';
import { DataTable } from '../components/ui/DataTable.jsx';
import { Can } from '../components/auth/Gates.jsx';

export function TeamsPage() {
  const [showCreate, setShowCreate] = useState(false);

  const query = useQuery({
    queryKey: ['teams'],
    queryFn: async () => (await adminApi.listTeams()).data,
  });

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'slug', label: 'Slug', render: (r) => <span className="font-mono text-xs">{r.slug}</span> },
    { key: 'type', label: 'Type' },
    { key: 'leader.name', label: 'Leader', render: (r) => r.leader?.name || '—' },
    { key: 'active', label: 'Status', render: (r) => <StatusPill status={r.active ? 'active' : 'inactive'} /> },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Teams</h1>
          <p className="text-sm text-ink-500">Production, QC, dispatch, and other functional groupings.</p>
        </div>
        <Can module="teams" action="create">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New team
          </button>
        </Can>
      </header>

      <Card bodyClass="p-0">
        <DataTable columns={columns} rows={query.data} loading={query.isLoading} emptyTitle="No teams" />
      </Card>

      {showCreate && <CreateTeamModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateTeamModal({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', slug: '', type: 'production', description: '' });
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: async () => (await adminApi.createTeam(form)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      onClose();
    },
    onError: (e) => setErr(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="card w-full max-w-md p-6 space-y-3">
        <h2 className="text-lg font-semibold">New team</h2>
        <label>
          <span className="label">Name</span>
          <input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          <span className="label">Slug</span>
          <input required className="input font-mono" pattern="[a-z0-9_-]+" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        </label>
        <label>
          <span className="label">Type</span>
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {['production', 'qc', 'dispatch', 'maintenance', 'planning', 'other'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          <span className="label">Description</span>
          <textarea rows={2} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
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
