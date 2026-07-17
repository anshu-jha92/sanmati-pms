import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Users, Check, Search } from 'lucide-react';
import clsx from 'clsx';
import { adminApi } from '../api/endpoints.js';
import { Card, StatusPill, ErrorNote } from '../components/ui/Primitives.jsx';
import { DataTable } from '../components/ui/DataTable.jsx';
import { Can } from '../components/auth/Gates.jsx';
import { Avatar } from './DepartmentsPage.jsx';

/**
 * Team types — one per org department (colours mirror roleBlueprint.js) plus
 * "other", so a team can exist for any part of the business, not just the shop
 * floor. Kept in sync with the enum on Team.js / admin.controller.js.
 */
export const TEAM_TYPES = [
  { value: 'production',     label: 'Production',           color: '#2563eb' },
  { value: 'qc',             label: 'Quality (QA/QC)',      color: '#7c3aed' },
  { value: 'planning',       label: 'Planning / PPC',       color: '#4f46e5' },
  { value: 'store',          label: 'Store / Materials',    color: '#c9791b' },
  { value: 'purchase',       label: 'Purchase',             color: '#0d9488' },
  { value: 'sales',          label: 'Sales',                color: '#188a4e' },
  { value: 'dispatch',       label: 'Dispatch / Logistics', color: '#e35d16' },
  { value: 'maintenance',    label: 'Maintenance',          color: '#e11d48' },
  { value: 'administration', label: 'Administration',       color: '#475569' },
  { value: 'other',          label: 'Other',                color: '#64748b' },
];
const TYPE_BY_VALUE = Object.fromEntries(TEAM_TYPES.map((t) => [t.value, t]));

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function TeamsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [q, setQ] = useState('');

  const query = useQuery({
    queryKey: ['teams'],
    queryFn: async () => (await adminApi.listTeams()).data,
  });

  // Members live on the user side (user.teams), so roll them up here. Read-only.
  const usersQ = useQuery({
    queryKey: ['org', 'users'],
    queryFn: async () => (await adminApi.listUsers({ limit: 200 })).data,
    retry: false,
  });

  const membersByTeam = useMemo(() => {
    const map = {};
    for (const u of usersQ.data || []) {
      for (const t of u.teams || []) {
        const id = String(t._id || t);
        (map[id] ||= []).push(u);
      }
    }
    return map;
  }, [usersQ.data]);

  const rows = useMemo(() => {
    const list = query.data || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((t) =>
      `${t.name} ${t.slug} ${t.type} ${t.leader?.name || ''}`.toLowerCase().includes(needle)
    );
  }, [query.data, q]);

  const columns = [
    {
      key: 'name',
      label: 'Team',
      render: (r) => {
        const meta = TYPE_BY_VALUE[r.type] || TYPE_BY_VALUE.other;
        return (
          <div className="flex items-center gap-2.5">
            <span className="h-9 w-9 rounded-lg grid place-items-center shrink-0 font-bold text-[11px]"
              style={{ background: `${meta.color}18`, color: meta.color }}>
              {String(r.name || '?').slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-[13px] text-ink-900 truncate">{r.name}</div>
              {r.description
                ? <div className="text-[10.5px] text-ink-400 truncate max-w-[220px]">{r.description}</div>
                : <div className="font-mono text-[10px] text-ink-400">{r.slug}</div>}
            </div>
          </div>
        );
      },
    },
    { key: 'slug', label: 'Slug', render: (r) => <span className="font-mono text-[11px] text-ink-500">{r.slug}</span> },
    {
      key: 'type',
      label: 'Type',
      render: (r) => {
        const meta = TYPE_BY_VALUE[r.type] || TYPE_BY_VALUE.other;
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap"
            style={{ borderColor: `${meta.color}40`, background: `${meta.color}12`, color: meta.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
            {meta.label}
          </span>
        );
      },
    },
    {
      key: 'leader',
      label: 'Leader',
      render: (r) => (r.leader ? (
        <Link to={`/org-chart/${r.leader._id}`} className="inline-flex items-center gap-1.5 hover:text-brand-600 transition">
          <Avatar user={r.leader} size={24} />
          <span className="text-[12px] font-medium text-ink-800">{r.leader.name}</span>
        </Link>
      ) : <span className="text-ink-300">—</span>),
    },
    {
      key: 'members',
      label: 'Members',
      render: (r) => {
        const list = membersByTeam[String(r._id)] || [];
        if (!list.length) return <span className="text-ink-300 tabular-nums">0</span>;
        return (
          <div className="flex items-center gap-1.5">
            <div className="flex -space-x-1.5">
              {list.slice(0, 4).map((u) => <Avatar key={u._id} user={u} size={22} />)}
            </div>
            <span className="text-[11.5px] font-semibold text-ink-700 tabular-nums">{list.length}</span>
          </div>
        );
      },
    },
    { key: 'active', label: 'Status', render: (r) => <StatusPill status={r.active ? 'active' : 'inactive'} /> },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Teams</h1>
          <p className="text-sm text-ink-500">Functional groupings across every department — production, QC, sales, store and more.</p>
        </div>
        <Can module="teams" action="create">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New team
          </button>
        </Can>
      </header>

      <div className="card p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <input
            placeholder="Search by name, slug, type or leader…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input pl-9 py-1.5 text-[13px]"
          />
        </div>
        <span className="text-[11.5px] text-ink-500">
          <b className="text-ink-900">{rows.length}</b> of {(query.data || []).length} team{(query.data || []).length !== 1 ? 's' : ''}
        </span>
      </div>

      <Card bodyClass="p-0">
        <DataTable columns={columns} rows={rows} loading={query.isLoading} emptyTitle="No teams" emptySub="Create one with “New team”." />
      </Card>

      {showCreate && <CreateTeamModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateTeamModal({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', slug: '', type: 'production', description: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [err, setErr] = useState('');

  // Slug auto-follows the name until the user edits it themselves.
  const setName = (name) =>
    setForm((f) => ({ ...f, name, slug: slugTouched ? f.slug : slugify(name) }));

  const slugOk = /^[a-z0-9_-]+$/.test(form.slug);
  const canSubmit = form.name.trim().length > 0 && form.slug.length > 0 && slugOk && !!form.type;

  const missing = [];
  if (!form.name.trim()) missing.push('name');
  if (!form.slug) missing.push('slug');
  else if (!slugOk) missing.push('a slug with only lowercase letters, numbers, - or _');

  const mut = useMutation({
    mutationFn: async () => (await adminApi.createTeam(form)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      onClose();
    },
    onError: (e) => setErr(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (canSubmit) mut.mutate(); }}
        className="card w-full max-w-lg p-6 space-y-4 my-8 max-h-[90vh] overflow-y-auto"
      >
        <div>
          <h2 className="text-lg font-semibold">New team</h2>
          <p className="text-[11.5px] text-ink-500 mt-0.5">A team groups people for one part of the business.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Name *</span>
            <input className="input" value={form.name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Printing Line A" />
          </label>
          <label className="block">
            <span className="label">Slug *</span>
            <input
              className="input font-mono"
              value={form.slug}
              onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: e.target.value }); }}
              placeholder="printing-line-a"
            />
            <div className={clsx('text-[10px] mt-1', form.slug && !slugOk ? 'text-state-down' : 'text-ink-400')}>
              {!form.slug ? 'Auto-filled from the name' : slugOk ? '✓ OK' : 'Only a-z, 0-9, - and _'}
            </div>
          </label>
        </div>

        {/* Type — rendered inside the card as a grid, so nothing overflows the
            modal the way a native <select> popup did. */}
        <div>
          <span className="label">Type *</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-1">
            {TEAM_TYPES.map((t) => {
              const active = form.type === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setForm({ ...form, type: t.value })}
                  className={clsx(
                    'flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11.5px] font-semibold text-left transition',
                    active ? 'ring-2' : 'hover:bg-ink-50'
                  )}
                  style={active
                    ? { borderColor: t.color, background: `${t.color}12`, color: t.color, '--tw-ring-color': `${t.color}40` }
                    : { borderColor: '#e2e8f0', color: '#475569' }}
                >
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="truncate flex-1">{t.label}</span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
          <div className="text-[10px] text-ink-400 mt-1.5">
            One per department — so a team can exist for sales, store or purchase too, not just the shop floor.
          </div>
        </div>

        <label className="block">
          <span className="label">Description</span>
          <textarea rows={2} className="input" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What this team is responsible for (optional)" />
        </label>

        <ErrorNote message={err} />

        <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
          {!canSubmit && missing.length > 0 && (
            <span className="mr-auto text-[11px] text-ink-500">
              Still needed: <b className="text-state-down">{missing.join(', ')}</b>
            </span>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            disabled={mut.isPending || !canSubmit}
            className={clsx('btn-primary', (mut.isPending || !canSubmit) && '!bg-ink-200 !text-ink-400 cursor-not-allowed pointer-events-none')}
          >
            {mut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
