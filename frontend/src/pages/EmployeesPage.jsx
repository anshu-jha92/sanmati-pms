import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Power, RotateCcw, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { adminApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { BLUEPRINT_ROLES, blueprintPermissions } from '../lib/roleBlueprint.js';
import { Card, StatusPill, ErrorNote } from '../components/ui/Primitives.jsx';
import { DataTable, Pagination } from '../components/ui/DataTable.jsx';
import { FilterBar } from '../components/ui/FilterBar.jsx';
import { Can } from '../components/auth/Gates.jsx';

export function EmployeesPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  const roles = useQuery({ queryKey: ['roles'], queryFn: async () => (await adminApi.listRoles()).data });
  const teams = useQuery({ queryKey: ['teams'], queryFn: async () => (await adminApi.listTeams()).data });

  // Every assignable role: the full org blueprint plus any custom DB-only roles.
  // Blueprint roles not yet in the DB carry dbId=null and are created on assign.
  const roleOptions = useMemo(() => {
    const dbRoles = roles.data || [];
    const dbBySlug = Object.fromEntries(dbRoles.map((r) => [r.slug, r]));
    const bpSlugs = new Set(BLUEPRINT_ROLES.map((b) => b.slug));
    return [
      ...BLUEPRINT_ROLES.map((b) => ({ slug: b.slug, name: b.name, dbId: dbBySlug[b.slug]?._id || null, bp: b })),
      ...dbRoles.filter((r) => !bpSlugs.has(r.slug)).map((r) => ({ slug: r.slug, name: r.name, dbId: r._id, bp: null })),
    ];
  }, [roles.data]);

  const query = useQuery({
    queryKey: ['users', filters, page],
    queryFn: async () => await adminApi.listUsers({ ...filters, page, limit: 25 }),
    keepPreviousData: true,
  });

  const currentUserId = authStore((s) => s.user?.id);

  // Toggle active/suspended status — same endpoint as edit, just updates status.
  // 'active' → 'suspended' is "terminate", reverse is "reactivate".
  const statusMut = useMutation({
    mutationFn: async ({ id, status }) =>
      (await adminApi.updateUser(id, { status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  // Permanently delete an employee record.
  const deleteMut = useMutation({
    mutationFn: async (id) => (await adminApi.deleteUser(id)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => window.alert(e?.message || 'Could not delete this employee.'),
  });

  const columns = [
    { key: 'employeeCode', label: 'Code', render: (r) => <span className="font-mono text-xs">{r.employeeCode}</span> },
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'roles', label: 'Roles', render: (r) => (r.roles || []).map((x) => x.name).join(', ') || '—' },
    { key: 'teams', label: 'Teams', render: (r) => (r.teams || []).map((x) => x.name).join(', ') || '—' },
    { key: 'shift', label: 'Shift' },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <RowActions
          user={r}
          isSelf={String(r._id) === String(currentUserId)}
          onEdit={() => setEditingUser(r)}
          onTerminate={() => {
            if (window.confirm(`Terminate ${r.name}? They will no longer be able to log in.`)) {
              statusMut.mutate({ id: r._id, status: 'suspended' });
            }
          }}
          onReactivate={() => statusMut.mutate({ id: r._id, status: 'active' })}
          onDelete={() => {
            if (window.confirm(`Delete ${r.name} permanently? This removes their record and can't be undone.`)) {
              deleteMut.mutate(r._id);
            }
          }}
          isUpdating={statusMut.isPending || deleteMut.isPending}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Employees</h1>
          <p className="text-sm text-ink-500">Profiles, role assignments, team and machine mappings.</p>
        </div>
        <Can module="employees" action="create">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Add employee
          </button>
        </Can>
      </header>

      <FilterBar
        value={filters}
        onChange={(v) => { setFilters(v); setPage(1); }}
        fields={['search', 'team']}
        options={{ teams: teams.data || [] }}
      />

      <Card bodyClass="p-0">
        <DataTable columns={columns} rows={query.data?.data} loading={query.isLoading} emptyTitle="No employees" />
      </Card>
      <Pagination meta={query.data?.meta} onPage={setPage} />

      {showCreate && (
        <EmployeeFormModal
          mode="create"
          roleOptions={roleOptions}
          teams={teams.data || []}
          onClose={() => setShowCreate(false)}
        />
      )}

      {editingUser && (
        <EmployeeFormModal
          mode="edit"
          user={editingUser}
          roleOptions={roleOptions}
          teams={teams.data || []}
          onClose={() => setEditingUser(null)}
        />
      )}
    </div>
  );
}

/* ─── Per-row action buttons ─── */
function RowActions({ user, isSelf, onEdit, onTerminate, onReactivate, onDelete, isUpdating }) {
  const isActive = user.status === 'active';
  return (
    <div className="flex items-center gap-1">
      <Can module="employees" action="update">
        <button
          onClick={onEdit}
          className="h-7 w-7 rounded-md hover:bg-ink-100 text-ink-600 grid place-items-center"
          title="Edit employee"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </Can>
      <Can module="employees" action="update">
        {isActive ? (
          <button
            onClick={onTerminate}
            disabled={isUpdating}
            className="h-7 w-7 rounded-md hover:bg-state-down/10 text-state-down grid place-items-center"
            title="Terminate (deactivate)"
          >
            <Power className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={onReactivate}
            disabled={isUpdating}
            className="h-7 w-7 rounded-md hover:bg-state-running/10 text-state-running grid place-items-center"
            title="Reactivate"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </Can>
      {!isSelf && (
        <Can module="employees" action="delete">
          <button
            onClick={onDelete}
            disabled={isUpdating}
            className="h-7 w-7 rounded-md hover:bg-state-down/10 text-state-down grid place-items-center disabled:opacity-40"
            title="Delete employee"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Can>
      )}
    </div>
  );
}

/* ─── Unified Create/Edit modal ─── */
function EmployeeFormModal({ mode, user, onClose, roleOptions, teams }) {
  const isEdit = mode === 'edit';
  const qc = useQueryClient();
  const [form, setForm] = useState({
    employeeCode: user?.employeeCode || '',
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    password: '',  // empty for edit (only changed if user types new one)
    // Roles are tracked by SLUG so blueprint roles (not yet in the DB) are selectable.
    roles: (user?.roles || []).map((r) => r.slug).filter(Boolean),
    teams: (user?.teams || []).map((t) => t._id || t),
    shift: user?.shift || 'General',
    status: user?.status || 'active',
  });
  const [err, setErr] = useState('');

  // Real-time validation — drives Save button enable/disable
  const passwordOk = isEdit ? (form.password.length === 0 || form.password.length >= 8) : form.password.length >= 8;
  const canSubmit = (
    form.employeeCode.trim().length > 0 &&
    form.name.trim().length > 0 &&
    /^\S+@\S+\.\S+$/.test(form.email) &&
    passwordOk &&
    form.roles.length > 0
  );

  const mut = useMutation({
    mutationFn: async () => {
      // Resolve selected role slugs to DB ids, creating any blueprint role that
      // isn't in the DB yet (materialise-on-assign) with its recommended access.
      const roleIds = [];
      for (const slug of form.roles) {
        const opt = roleOptions.find((o) => o.slug === slug);
        if (!opt) continue;
        if (opt.dbId) { roleIds.push(opt.dbId); continue; }
        // Materialise the blueprint role. If it was created concurrently, fall
        // back to the now-existing one instead of surfacing a duplicate error.
        let created;
        try {
          created = (await adminApi.createRole({
            name: opt.bp.name,
            slug: opt.bp.slug,
            description: opt.bp.desc,
            permissions: blueprintPermissions(opt.bp),
          })).data;
        } catch (e) {
          if (e.code === 'E_DUPLICATE') {
            const fresh = (await adminApi.listRoles()).data;
            created = fresh.find((r) => r.slug === opt.bp.slug);
          }
          if (!created) throw e;
        }
        roleIds.push(created._id);
      }

      const payload = { ...form, roles: roleIds };
      if (!payload.phone) delete payload.phone;
      // Don't send empty password on edit — server only changes it when present
      if (isEdit && !payload.password) delete payload.password;

      if (isEdit) {
        return (await adminApi.updateUser(user._id, payload)).data;
      }
      return (await adminApi.createUser(payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
    onError: (e) => {
      if (Array.isArray(e.details) && e.details.length > 0) {
        const lines = e.details.map((d) => `• ${d.path || 'field'}: ${d.message}`);
        setErr(`${e.message || 'Could not save'}:\n${lines.join('\n')}`);
      } else if (e.code === 'E_DUPLICATE') {
        setErr('A user with this email or employee code already exists.');
      } else {
        setErr(e.message || 'Could not save');
      }
    },
  });

  const submit = (e) => {
    e.preventDefault();
    setErr('');
    if (!form.employeeCode.trim()) return setErr('Employee code is required');
    if (!form.name.trim()) return setErr('Name is required');
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return setErr('Please enter a valid email');
    if (!isEdit && form.password.length < 8) return setErr('Password must be at least 8 characters');
    if (isEdit && form.password.length > 0 && form.password.length < 8) return setErr('New password must be at least 8 characters');
    if (form.roles.length === 0) return setErr('Please assign at least one role');
    mut.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="card w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? `Edit employee — ${user?.name}` : 'Add employee'}</h2>
          {isEdit && <StatusPill status={form.status} />}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Employee code" required value={form.employeeCode} onChange={(v) => setForm({ ...form, employeeCode: v })} />
          <Field label="Name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Email" type="email" required value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <div>
            <Field
              label={isEdit ? 'New password (leave blank to keep current)' : 'Password'}
              type="password"
              required={!isEdit}
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
            />
            <div className={`text-[10px] mt-1 ${form.password.length > 0 && form.password.length < 8 ? 'text-state-down' : 'text-ink-400'}`}>
              {form.password.length === 0
                ? (isEdit ? 'Leave blank to keep existing password' : 'Min 8 characters')
                : form.password.length < 8
                  ? `${8 - form.password.length} more character${(8 - form.password.length) === 1 ? '' : 's'} needed`
                  : '✓ OK'}
            </div>
          </div>
          <label>
            <span className="label">Shift</span>
            <select className="input" value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })}>
              {['A', 'B', 'C', 'General'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <RolePicker value={form.roles} onChange={(v) => setForm({ ...form, roles: v })} options={roleOptions} />
          <MultiSelect label="Teams" value={form.teams} onChange={(v) => setForm({ ...form, teams: v })} options={teams.map((t) => ({ value: t._id, label: t.name }))} />

          {isEdit && (
            <label className="col-span-2">
              <span className="label">Status</span>
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended (terminated)</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          )}
        </div>

        <ErrorNote message={err} />

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className={clsx(
              'btn-primary',
              (mut.isPending || !canSubmit) && '!bg-ink-200 !text-ink-400 cursor-not-allowed pointer-events-none'
            )}
            disabled={mut.isPending || !canSubmit}
          >
            {mut.isPending ? 'Saving…' : (isEdit ? 'Save changes' : 'Save')}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required }) {
  return (
    <label>
      <span className="label">{label}{required && ' *'}</span>
      <input
        className="input"
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/* Role picker — a scrollable checkbox list of EVERY role (blueprint + custom).
 * Blueprint roles not yet in the DB show a "suggested" badge and are created
 * on save (materialise-on-assign). Values are role slugs. */
function RolePicker({ options, value, onChange }) {
  const toggle = (slug) => onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug]);
  return (
    <label className="col-span-2 block">
      <span className="label">Roles <span className="normal-case font-normal text-ink-400">— {value.length} selected</span></span>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-ink-200 bg-white divide-y divide-ink-100">
        {options.length === 0 ? (
          <div className="px-3 py-3 text-[12px] text-ink-400 text-center">Loading roles…</div>
        ) : options.map((o) => {
          const checked = value.includes(o.slug);
          return (
            <label key={o.slug} className={clsx('flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-[12.5px] transition', checked ? 'bg-brand-50' : 'hover:bg-ink-50')}>
              <input type="checkbox" className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600 focus:ring-brand-500" checked={checked} onChange={() => toggle(o.slug)} />
              <span className="flex-1 text-ink-800 truncate">{o.name}</span>
              {o.dbId
                ? <span className="chip-green text-[9px]">active</span>
                : <span className="chip-blue text-[9px]">suggested</span>}
            </label>
          );
        })}
      </div>
      <div className="text-[10px] text-ink-400 mt-1">Sab roles yahan hain. “Suggested” role choose karoge to save karte waqt DB me apne aap ban jayega.</div>
    </label>
  );
}

function MultiSelect({ label, options, value, onChange }) {
  return (
    <label>
      <span className="label">{label}</span>
      <select
        multiple
        className="input h-24"
        value={value}
        onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
