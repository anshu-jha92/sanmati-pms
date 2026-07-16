import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Save, Lock, ChevronRight, ChevronDown, Crown, Sparkles, Users, Check,
} from 'lucide-react';
import { adminApi } from '../api/endpoints.js';
import { Card, ErrorNote, Empty } from '../components/ui/Primitives.jsx';
import { Can } from '../components/auth/Gates.jsx';
import { authStore } from '../context/authStore.js';

/**
 * Roles & Permissions — department-grouped RBAC editor.
 *
 * Left rail groups roles by DEPARTMENT (a client-side org blueprint, since the
 * role model has no department field). Roles that already exist in the DB are
 * "active" and fully editable; blueprint roles that don't exist yet are shown
 * as "suggested". Right panel is the module × action matrix with an ALL column.
 * Ticking the grid stages changes; the "Edit this role" button opens a modal to
 * name and SAVE them (create for a blueprint role, update for a live one). No DB
 * write happens until the user confirms in that modal. Delete asks for a single
 * in-app confirmation.
 */

/* ── Org blueprint: departments → roles → recommended access ─────────────── */
const LEVELS = {
  view: ['view'],
  edit: ['view', 'create', 'update'],
  exec: ['view', 'execute'],
  appr: ['view', 'update', 'approve'],
  full: ['view', 'create', 'update', 'delete'],
  all: ['view', 'create', 'update', 'delete', 'execute', 'approve', 'admin'],
};

const DEPARTMENTS = [
  { key: 'leadership', name: 'Leadership', color: '#5b6472', icon: Crown, roles: [
    { slug: 'system-admin', name: 'System / IT Admin', tier: 1, desc: 'Full platform access — users, roles, integrations. Not in the production chain.', perms: 'all' },
    { slug: 'plant-head', name: 'Plant Head / GM', tier: 1, desc: 'Full visibility and the final sign-off on orders, production and purchases.',
      perms: { dashboard: 'view', reports: 'view', sales_orders: 'appr', production: 'appr', qc: 'appr', purchase_orders: 'appr', inventory: 'view', dispatch: 'view', machines: 'view', employees: 'view', teams: 'view' } },
  ]},
  { key: 'sales', name: 'Sales', color: '#188a4e', roles: [
    { slug: 'sales-manager', name: 'Sales Manager', tier: 2, desc: 'Owns the order book — approves and prioritises sales orders.',
      perms: { sales_orders: 'appr', production: 'view', inventory: 'view', dispatch: 'view', dashboard: 'view', reports: 'view' } },
    { slug: 'sales-executive', name: 'Sales Executive', tier: 3, desc: 'Takes enquiries into the system and checks stock availability.',
      perms: { sales_orders: 'edit', inventory: 'view' } },
  ]},
  { key: 'planning', name: 'Planning / PPC', color: '#4f46e5', roles: [
    { slug: 'production-planner', name: 'Production Planner (PPC)', tier: 3, desc: 'Turns orders into a runnable schedule; assigns machines & operators.',
      perms: { sales_orders: 'view', production: 'edit', machines: 'view', inventory: 'view', dashboard: 'view' } },
  ]},
  { key: 'production', name: 'Production', color: '#2563eb', roles: [
    { slug: 'production-manager', name: 'Production Manager', tier: 2, desc: 'Owns the whole floor across shifts; releases jobs and clears holds.',
      perms: { production: 'full', machines: 'edit', qc: 'view', inventory: 'view', dashboard: 'view', reports: 'view', employees: 'view' } },
    { slug: 'shift-supervisor', name: 'Shift Supervisor / Line In-charge', tier: 3, desc: 'Runs one shift (A/B/C); assigns operators and starts/confirms stages.',
      perms: { production: 'exec', machines: 'edit', qc: 'view', inventory: 'view' } },
    { slug: 'machine-operator', name: 'Machine Operator', tier: 4, desc: 'Runs a specific machine — printing / lamination / slitting / cutting / packaging.',
      perms: { production: 'exec', machines: 'view', inventory: 'view' } },
  ]},
  { key: 'quality', name: 'Quality (QA/QC)', color: '#7c3aed', roles: [
    { slug: 'quality-manager', name: 'Quality Manager (QA Head)', tier: 2, desc: 'Owns the quality bar and every hold / rework / scrap decision.',
      perms: { qc: 'appr', production: 'view', reports: 'view', dashboard: 'view' } },
    { slug: 'qc-inspector', name: 'QC Inspector', tier: 3, desc: 'Inspects material inline and at final stage; logs defects.',
      perms: { qc: 'edit', production: 'view' } },
  ]},
  { key: 'store', name: 'Store / Materials', color: '#c9791b', roles: [
    { slug: 'store-manager', name: 'Store / Materials Manager', tier: 2, desc: 'Owns raw-material, WIP and finished-goods stock accuracy.',
      perms: { inventory: 'full', purchase_orders: 'view', reports: 'view', dashboard: 'view' } },
    { slug: 'store-keeper', name: 'Store Keeper', tier: 3, desc: 'Issues and receives stock day-to-day against jobs / BOM.',
      perms: { inventory: 'edit' } },
  ]},
  { key: 'purchase', name: 'Purchase', color: '#0d9488', roles: [
    { slug: 'purchase-manager', name: 'Purchase Manager', tier: 2, desc: 'Owns supply — approves POs, manages suppliers and costs.',
      perms: { purchase_orders: 'full', inventory: 'view', integrations: 'view', reports: 'view' } },
    { slug: 'purchase-executive', name: 'Purchase Executive', tier: 3, desc: 'Raises POs and records goods receipts.',
      perms: { purchase_orders: 'edit', inventory: 'view' } },
  ]},
  { key: 'dispatch', name: 'Dispatch / Logistics', color: '#e35d16', roles: [
    { slug: 'dispatch-manager', name: 'Dispatch / Logistics Manager', tier: 2, desc: 'Gets finished goods out on time with the right paperwork.',
      perms: { dispatch: 'full', sales_orders: 'view', inventory: 'view', reports: 'view', dashboard: 'view' } },
    { slug: 'dispatch-operator', name: 'Dispatch Operator', tier: 3, desc: 'Packs, loads and books out each consignment.',
      perms: { dispatch: 'edit' } },
  ]},
  { key: 'maintenance', name: 'Maintenance', color: '#e11d48', roles: [
    { slug: 'maintenance-incharge', name: 'Maintenance In-charge', tier: 3, desc: 'Keeps machines up; owns planned and breakdown downtime.',
      perms: { machines: 'edit', dashboard: 'view' } },
  ]},
  { key: 'administration', name: 'Administration', color: '#475569', roles: [
    { slug: 'hr-admin', name: 'HR / People Admin', tier: 3, desc: 'Owns employee records, teams and shift assignment.',
      perms: { employees: 'full', teams: 'full', roles: 'view', dashboard: 'view' } },
  ]},
];

const TIER_LABEL = { 1: 'Tier 1 · Leadership', 2: 'Tier 2 · Manager', 3: 'Tier 3 · Supervisor', 4: 'Tier 4 · Operator' };

/* Expand a blueprint role's { module: level } into a matrix { module: {action:true} } */
function blueprintMatrix(bp, modules) {
  const map = Object.fromEntries(modules.map((m) => [m, {}]));
  if (!bp || !bp.perms) return map;
  if (bp.perms === 'all') { for (const m of modules) map[m] = Object.fromEntries(LEVELS.all.map((a) => [a, true])); return map; }
  for (const [mod, lvl] of Object.entries(bp.perms)) {
    if (!map[mod]) map[mod] = {};
    for (const a of LEVELS[lvl] || []) map[mod][a] = true;
  }
  return map;
}

const DISMISS_KEY = 'pa.roles.dismissed.v1';
function readDismissed() {
  try { const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function RolesPage() {
  const qc = useQueryClient();
  const [sel, setSel] = useState(null);              // { slug, dbRole|null, bp|null, deptColor }
  // Start with every department collapsed — the user expands the one they want.
  const [collapsed, setCollapsed] = useState(() => Object.fromEntries(DEPARTMENTS.map((d) => [d.key, true])));
  const [editCtx, setEditCtx] = useState(null);       // role-form modal context | null
  const [confirmTarget, setConfirmTarget] = useState(null); // { kind:'delete'|'dismiss', name, id?, slug? } | null
  const [confirmErr, setConfirmErr] = useState('');
  const [okMsg, setOkMsg] = useState('');             // success toast
  const [dismissed, setDismissed] = useState(readDismissed); // hidden blueprint slugs (localStorage)

  const modulesQ = useQuery({ queryKey: ['roles', 'modules'], queryFn: async () => (await adminApi.listModules()).data });
  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: async () => (await adminApi.listRoles()).data });

  const dbBySlug = useMemo(
    () => Object.fromEntries((rolesQ.data || []).map((r) => [r.slug, r])),
    [rolesQ.data]
  );
  const blueprintSlugs = useMemo(() => new Set(DEPARTMENTS.flatMap((d) => d.roles.map((r) => r.slug))), []);
  const otherRoles = useMemo(
    () => (rolesQ.data || []).filter((r) => !blueprintSlugs.has(r.slug)),
    [rolesQ.data, blueprintSlugs]
  );

  const totalActive = rolesQ.data?.length || 0;

  // Current user's own role slugs — used to lock editing/deleting one's own role.
  const ownSlugs = authStore((s) => s.user?.roleSlugs) || [];

  // Auto-dismiss the success toast.
  useEffect(() => {
    if (!okMsg) return undefined;
    const t = setTimeout(() => setOkMsg(''), 2600);
    return () => clearTimeout(t);
  }, [okMsg]);

  const delMut = useMutation({
    mutationFn: (id) => adminApi.deleteRole(id),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setConfirmTarget(null);
      setConfirmErr('');
      setOkMsg('Role deleted ✓');
      // If the deleted role was selected, drop its DB reference so the panel resets.
      setSel((s) => (s && s.dbRole && s.dbRole._id === id ? { ...s, dbRole: null } : s));
    },
    onError: (e) => setConfirmErr(e?.message || 'Could not delete this role.'),
  });

  // Default selection: first existing role, else first blueprint role.
  useEffect(() => {
    if (sel || !rolesQ.data) return;
    for (const d of DEPARTMENTS) {
      for (const r of d.roles) {
        if (dbBySlug[r.slug]) { setSel({ slug: r.slug, dbRole: dbBySlug[r.slug], bp: r, deptColor: d.color }); return; }
      }
    }
    const first = DEPARTMENTS[0].roles[0];
    setSel({ slug: first.slug, dbRole: null, bp: first, deptColor: DEPARTMENTS[0].color });
  }, [rolesQ.data, dbBySlug, sel]);

  // Keep the selected role's DB reference fresh after edits.
  const liveSel = sel
    ? { ...sel, dbRole: sel.bp ? (dbBySlug[sel.slug] || null) : (rolesQ.data || []).find((r) => r._id === sel.dbRole?._id) || null }
    : null;

  const pick = (slug, bp, deptColor) => setSel({ slug, dbRole: dbBySlug[slug] || null, bp, deptColor });
  const pickDb = (role) => setSel({ slug: role.slug, dbRole: role, bp: null, deptColor: '#475569' });

  // A blueprint role is "hidden" only while it has no real DB row behind it.
  const isHidden = (slug) => dismissed.includes(slug) && !dbBySlug[slug];
  const persistDismissed = (arr) => { setDismissed(arr); try { localStorage.setItem(DISMISS_KEY, JSON.stringify(arr)); } catch { /* ignore */ } };
  const hiddenSlugs = dismissed.filter((slug) => blueprintSlugs.has(slug) && !dbBySlug[slug]);

  const requestDelete = (role) => { setConfirmErr(''); setConfirmTarget({ kind: 'delete', name: role.name, id: role._id }); };
  const requestDismiss = (bp) => { if (bp.slug === 'system-admin') return; setConfirmErr(''); setConfirmTarget({ kind: 'dismiss', name: bp.name, slug: bp.slug }); };
  const doConfirm = () => {
    if (!confirmTarget) return;
    if (confirmTarget.kind === 'delete') { setConfirmErr(''); delMut.mutate(confirmTarget.id); return; }
    persistDismissed([...new Set([...dismissed, confirmTarget.slug])]);
    setSel((s) => (s && s.slug === confirmTarget.slug && !s.dbRole ? null : s));
    setConfirmTarget(null);
    setOkMsg('Suggestion hidden ✓');
  };

  const modules = modulesQ.data?.modules || [];
  const actions = modulesQ.data?.actions || [];

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Roles &amp; Permissions</h1>
          <p className="text-sm text-ink-500">Dynamic RBAC organised by department — {totalActive} role{totalActive === 1 ? '' : 's'} live, {blueprintSlugs.size} in the blueprint.</p>
        </div>
        <Can module="roles" action="create">
          <button className="btn-primary" onClick={() => setEditCtx({ mode: 'new', exists: false, roleId: null, name: '', slug: '', description: '', permissions: [] })}>
            <Plus className="h-4 w-4" /> New role
          </button>
        </Can>
      </header>

      {okMsg && (
        <div className="rounded-lg bg-state-running/10 border border-state-running/25 px-4 py-2.5 text-sm text-state-running font-semibold flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0" /> {okMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 items-start">
        {/* ── Left rail: departments ── */}
        <Card bodyClass="p-0">
          <div className="max-h-[calc(100vh-190px)] overflow-y-auto">
            {DEPARTMENTS.map((dept) => {
              const isLead = dept.key === 'leadership';
              const open = !collapsed[dept.key];
              const visibleRoles = dept.roles.filter((r) => !isHidden(r.slug));
              if (visibleRoles.length === 0) return null;
              const createdCount = visibleRoles.filter((r) => dbBySlug[r.slug]).length;
              return (
                <div key={dept.key} className="border-b border-ink-100 last:border-0">
                  <button
                    onClick={() => setCollapsed((c) => ({ ...c, [dept.key]: !c[dept.key] }))}
                    className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-ink-50/70 transition"
                  >
                    {isLead
                      ? <Crown className="h-3.5 w-3.5" style={{ color: dept.color }} />
                      : <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: dept.color }} />}
                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink-500 flex-1 text-left">{dept.name}</span>
                    <span className="text-[10px] font-bold text-ink-400 tabular-nums bg-ink-100 rounded-full px-1.5 py-0.5">
                      {isLead ? visibleRoles.length : `${createdCount}/${visibleRoles.length}`}
                    </span>
                    {open ? <ChevronDown className="h-3.5 w-3.5 text-ink-400" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-400" />}
                  </button>

                  {open && (
                    <div className="pb-1.5">
                      {visibleRoles.map((r) => {
                        const db = dbBySlug[r.slug];
                        const active = liveSel?.slug === r.slug;
                        const ownRole = ownSlugs.includes(r.slug);
                        return (
                          <div
                            key={r.slug}
                            role="button"
                            tabIndex={0}
                            onClick={() => pick(r.slug, r, dept.color)}
                            onKeyDown={(e) => { if (e.key === 'Enter') pick(r.slug, r, dept.color); }}
                            className={`group w-full text-left pl-8 pr-2 py-2 flex items-center gap-2 transition border-l-[3px] cursor-pointer ${
                              active ? 'bg-brand-50' : 'hover:bg-ink-50/70'
                            }`}
                            style={{ borderLeftColor: active ? dept.color : 'transparent' }}
                          >
                            <div className="flex-1 min-w-0">
                              <div className={`text-[13px] font-semibold truncate ${db ? 'text-ink-900' : 'text-ink-400'}`}>{r.name}</div>
                              <div className="font-mono text-[10.5px] text-ink-400 truncate">{r.slug}</div>
                            </div>
                            {db?.isSystem
                              ? <Lock className="h-3 w-3 text-ink-400 shrink-0" />
                              : db
                                ? <span className="h-1.5 w-1.5 rounded-full bg-state-running shrink-0" title="Active" />
                                : <span className="text-[9px] font-bold uppercase tracking-wide text-ink-300 border border-ink-200 rounded px-1 py-0.5 shrink-0">plan</span>}
                            {!ownRole && r.slug !== 'system-admin' && (db ? !db.isSystem : true) && (
                              <Can module="roles" action="delete">
                                <button
                                  onClick={(e) => { e.stopPropagation(); if (db) requestDelete(db); else requestDismiss(r); }}
                                  title={db ? 'Delete role' : 'Hide this suggestion'}
                                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-300 hover:text-state-down transition p-0.5 shrink-0"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </Can>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Custom roles that aren't part of the blueprint */}
            {otherRoles.length > 0 && (
              <div className="border-t border-ink-100">
                <div className="px-3.5 py-2.5 flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-ink-400" />
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink-500 flex-1">Other roles</span>
                  <span className="text-[10px] font-bold text-ink-400 bg-ink-100 rounded-full px-1.5 py-0.5">{otherRoles.length}</span>
                </div>
                {otherRoles.map((r) => {
                  const ownRole = ownSlugs.includes(r.slug);
                  return (
                    <div key={r._id} role="button" tabIndex={0}
                      onClick={() => pickDb(r)}
                      onKeyDown={(e) => { if (e.key === 'Enter') pickDb(r); }}
                      className={`group w-full text-left pl-8 pr-2 py-2 flex items-center gap-2 border-l-[3px] cursor-pointer ${liveSel?.dbRole?._id === r._id ? 'bg-brand-50 border-l-ink-400' : 'hover:bg-ink-50/70 border-l-transparent'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-ink-900 truncate">{r.name}</div>
                        <div className="font-mono text-[10.5px] text-ink-400 truncate">{r.slug}</div>
                      </div>
                      {r.isSystem && <Lock className="h-3 w-3 text-ink-400" />}
                      {!r.isSystem && !ownRole && (
                        <Can module="roles" action="delete">
                          <button
                            onClick={(e) => { e.stopPropagation(); requestDelete(r); }}
                            title="Delete role"
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-300 hover:text-state-down transition p-0.5 shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </Can>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {hiddenSlugs.length > 0 && (
              <div className="border-t border-ink-100 px-3.5 py-2.5 flex items-center gap-2">
                <span className="text-[11px] text-ink-400 flex-1">{hiddenSlugs.length} suggestion{hiddenSlugs.length === 1 ? '' : 's'} hidden</span>
                <button className="text-[11px] font-semibold text-brand-600 hover:underline" onClick={() => persistDismissed([])}>Restore all</button>
              </div>
            )}
          </div>
        </Card>

        {/* ── Right: matrix / preview ── */}
        <Card bodyClass="p-0">
          {liveSel && modulesQ.data ? (
            <RolePanel
              role={liveSel.dbRole}
              bp={liveSel.bp}
              accent={liveSel.deptColor}
              modules={modules}
              actions={actions}
              isOwn={ownSlugs.includes(liveSel.dbRole ? liveSel.dbRole.slug : liveSel.slug)}
              onRequestEdit={setEditCtx}
              onRequestDelete={requestDelete}
              onRequestDismiss={requestDismiss}
            />
          ) : (
            <Empty title="Select a role to view its permissions" />
          )}
        </Card>
      </div>

      {editCtx && (
        <RoleFormModal
          ctx={editCtx}
          onClose={() => setEditCtx(null)}
          onSaved={(wasEdit) => {
            qc.invalidateQueries({ queryKey: ['roles'] });
            setOkMsg(wasEdit ? 'Permissions saved ✓' : 'Role created ✓');
            setEditCtx(null);
          }}
        />
      )}

      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.kind === 'delete' ? 'Delete role' : 'Remove suggestion'}
          message={confirmTarget.kind === 'delete'
            ? <>Delete role <b>“{confirmTarget.name}”</b>? This can’t be undone.</>
            : <><b>“{confirmTarget.name}”</b> is a suggested role that isn’t created yet — removing it just hides it from your list. You can restore it any time.</>}
          confirmLabel={confirmTarget.kind === 'delete' ? 'Delete' : 'Remove'}
          pendingLabel={confirmTarget.kind === 'delete' ? 'Deleting…' : 'Removing…'}
          pending={confirmTarget.kind === 'delete' && delMut.isPending}
          error={confirmErr}
          onCancel={() => { setConfirmTarget(null); setConfirmErr(''); }}
          onConfirm={doConfirm}
        />
      )}
    </div>
  );
}

/* ── Shared matrix header + body ─────────────────────────────────────────── */
function MatrixTable({ modules, actions, matrix, readonly, onToggle, onToggleAll }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="border-b border-ink-100">
            <th className="text-left px-5 py-2.5 text-[10.5px] font-bold uppercase tracking-wider text-ink-500">Module</th>
            {actions.map((a) => (
              <th key={a} className="px-2 py-2.5 text-[10.5px] font-bold uppercase tracking-wider text-ink-500 text-center">{a}</th>
            ))}
            <th className="px-2 py-2.5 text-[10.5px] font-bold uppercase tracking-wider text-brand-600 text-center">All</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((mod) => {
            const allOn = actions.every((a) => matrix[mod]?.[a]);
            return (
              <tr key={mod} className="border-b border-ink-100/70 hover:bg-ink-50/40">
                <td className="px-5 py-2.5 font-semibold capitalize text-ink-800">{mod.replace(/_/g, ' ')}</td>
                {actions.map((a) => (
                  <td key={a} className="px-2 py-2.5 text-center">
                    <input type="checkbox" disabled={readonly}
                      className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500 disabled:opacity-60"
                      checked={!!matrix[mod]?.[a]} onChange={() => onToggle(mod, a)} />
                  </td>
                ))}
                <td className="px-2 py-2.5 text-center">
                  <input type="checkbox" disabled={readonly}
                    className="h-4 w-4 rounded border-brand-300 text-brand-600 focus:ring-brand-500 disabled:opacity-60"
                    checked={allOn} onChange={() => onToggleAll(mod)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RoleHeader({ accent, title, badge, badgeCls, desc, tier, right }) {
  return (
    <div className="px-5 py-4 border-b border-ink-100" style={{ borderTop: `3px solid ${accent}` }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[17px] font-bold text-ink-900">{title}</h2>
            {badge && <span className={`text-[10px] font-bold uppercase tracking-wide rounded px-2 py-0.5 ${badgeCls}`}>{badge}</span>}
            {tier && <span className="text-[10.5px] text-ink-400 font-medium">{TIER_LABEL[tier]}</span>}
          </div>
          {desc && <p className="text-[12.5px] text-ink-500 mt-1 max-w-[70ch]">{desc}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">{right}</div>
      </div>
    </div>
  );
}

/* ── Role panel — editable grid + actions (mutations happen in the modals) ──
 * Editable for every role EXCEPT the System Admin role and the admin's own role
 * (both locked to prevent lockout). Ticking the grid stages permissions; "Edit
 * this role" opens the form modal to name + save them. Delete asks the parent to
 * open a confirmation dialog.                                                   */
function RolePanel({ role, bp, accent, modules, actions, isOwn, onRequestEdit, onRequestDelete, onRequestDismiss }) {
  const exists = !!role;                       // already a real role in the DB?
  const isSystem = !!role?.isSystem;
  const locked = isSystem || isOwn;            // System Admin / own role → read-only
  const [matrix, setMatrix] = useState(() => (exists ? buildMatrix(role, modules) : blueprintMatrix(bp, modules)));
  useEffect(() => {
    setMatrix(exists ? buildMatrix(role, modules) : blueprintMatrix(bp, modules));
  }, [role, bp, modules, exists]);

  const readonly = locked;
  const toggle = (mod, a) => setMatrix((m) => ({ ...m, [mod]: { ...m[mod], [a]: !m[mod]?.[a] } }));
  const toggleAll = (mod) => setMatrix((m) => {
    const allOn = actions.every((a) => m[mod]?.[a]);
    return { ...m, [mod]: Object.fromEntries(actions.map((a) => [a, !allOn])) };
  });

  const stagedPermissions = () => modules
    .map((mod) => ({ module: mod, actions: actions.filter((a) => matrix[mod]?.[a]) }))
    .filter((p) => p.actions.length);

  const title = exists ? role.name : bp?.name;
  const desc = (exists ? role.description : null) || bp?.desc;
  const slug = exists ? role.slug : bp?.slug;
  const badge = isSystem ? 'System' : exists ? 'Active' : 'Suggested';
  const badgeCls = isSystem ? 'bg-ink-100 text-ink-500' : exists ? 'bg-state-running/10 text-state-running' : 'bg-amber-100 text-amber-700';

  const openEditor = () => onRequestEdit({
    mode: 'edit',
    exists,
    roleId: role?._id || null,
    name: title || '',
    slug: slug || '',
    description: (exists ? role.description : bp?.desc) || '',
    permissions: stagedPermissions(),
  });

  return (
    <div>
      <RoleHeader
        accent={accent} title={title} tier={bp?.tier}
        badge={badge} badgeCls={badgeCls}
        desc={desc}
        right={!locked && (
          <>
            {/* Delete — to the left of the primary button. Real once the role exists. */}
            <Can module="roles" action="delete">
              <button
                className="btn-secondary text-xs text-state-down"
                title={exists ? 'Delete this role' : 'Remove this suggested role from the list (you can restore it later)'}
                onClick={() => (exists ? onRequestDelete(role) : onRequestDismiss(bp))}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </Can>
            {/* Primary — opens the form modal to name + save (create or update). */}
            <Can module="roles" action={exists ? 'update' : 'create'}>
              <button className="btn-primary text-xs" onClick={openEditor}>
                <Save className="h-3.5 w-3.5" /> Edit this role
              </button>
            </Can>
          </>
        )}
      />
      {!exists && !locked && (
        <div className="px-5 py-2.5 bg-amber-50/60 border-b border-amber-100 text-[12px] text-amber-800 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          From the org blueprint — not created yet. Adjust the ticks below, then click <b>Edit this role</b> to name it and save.
        </div>
      )}
      <MatrixTable modules={modules} actions={actions} matrix={matrix} readonly={readonly} onToggle={toggle} onToggleAll={toggleAll} />
      {locked && (
        <div className="px-5 py-3 text-xs text-ink-500 bg-ink-50 border-t border-ink-100 flex items-center gap-2">
          <Lock className="h-3.5 w-3.5" />
          {isOwn && !isSystem
            ? "This is your own role — you can't change your own permissions. Ask another admin to edit it."
            : 'The System Admin role is locked. Create a new role to customise permissions.'}
        </div>
      )}
    </div>
  );
}

function buildMatrix(role, modules) {
  const map = Object.fromEntries(modules.map((m) => [m, {}]));
  for (const p of role.permissions || []) map[p.module] = Object.fromEntries((p.actions || []).map((a) => [a, true]));
  return map;
}

/* ── In-app confirmation dialog (replaces window.confirm) ────────────────── */
function ConfirmDialog({ title, message, confirmLabel = 'Confirm', pendingLabel = 'Working…', pending, error, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={pending ? undefined : onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-6 space-y-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-ink-600">{message}</p>
        {error && <ErrorNote message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
          <button type="button" className="btn-primary !bg-state-down hover:!bg-state-down/90 border-transparent" onClick={onConfirm} disabled={pending}>
            <Trash2 className="h-4 w-4" /> {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Role form modal — create a new role, or edit/save an existing/blueprint one.
 * Permissions come from `ctx.permissions` (the grid the user just ticked). Only
 * this modal writes to the DB, and only when the user clicks Save.             */
function RoleFormModal({ ctx, onClose, onSaved }) {
  const isEdit = ctx.mode === 'edit';
  const slugLocked = isEdit;                 // never rename a blueprint/existing slug here
  const [form, setForm] = useState({ name: ctx.name || '', slug: ctx.slug || '', description: ctx.description || '' });
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [err, setErr] = useState('');

  const slugify = (s) => String(s).toLowerCase().trim()
    .replace(/[^a-z0-9\s_-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  const handleName = (v) => setForm((f) => ({ ...f, name: v, slug: (slugTouched || slugLocked) ? f.slug : slugify(v) }));
  const handleSlug = (v) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: slugify(v) })); };
  const slugIsValid = /^[a-z0-9_-]+$/.test(form.slug);
  const canSubmit = form.name.trim() && slugIsValid;

  const mut = useMutation({
    mutationFn: async () => {
      const permissions = ctx.permissions || [];
      if (ctx.exists) {
        // Update a live role — name / description / permissions (slug stays fixed).
        return (await adminApi.updateRole(ctx.roleId, { name: form.name.trim(), description: form.description, permissions })).data;
      }
      // Create — a blueprint role being materialised, or a brand-new blank role.
      return (await adminApi.createRole({ name: form.name.trim(), slug: form.slug, description: form.description, permissions })).data;
    },
    onSuccess: () => onSaved?.(ctx.exists),
    onError: (e) => {
      if (Array.isArray(e.details) && e.details.length) setErr(`${e.message}:\n${e.details.map((d) => `• ${d.path}: ${d.message}`).join('\n')}`);
      else if (e.code === 'E_DUPLICATE') setErr('A role with this name or slug already exists.');
      else setErr(e.message || 'Could not save this role.');
    },
  });

  const permCount = (ctx.permissions || []).reduce((n, p) => n + (p.actions?.length || 0), 0);
  const title = isEdit ? 'Edit role' : 'New role';
  const submitLabel = ctx.exists ? 'Save changes' : 'Create role';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={mut.isPending ? undefined : onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); setErr(''); mut.mutate(); }} className="card w-full max-w-md p-6 space-y-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {isEdit && (
          <div className="text-[12px] text-ink-500 -mt-1">
            {ctx.exists
              ? 'Editing a live role. Slug can’t be changed.'
              : 'This role isn’t created yet — saving will create it.'}{' '}
            Saving applies the <b>{permCount}</b> permission{permCount === 1 ? '' : 's'} you ticked in the grid.
          </div>
        )}
        <label><span className="label">Name</span>
          <input required className="input" placeholder="e.g. Production Operator" value={form.name} onChange={(e) => handleName(e.target.value)} /></label>
        <label><span className="label">Slug</span>
          <input required disabled={slugLocked} className={`input font-mono ${slugLocked ? 'opacity-60 cursor-not-allowed' : ''}`} pattern="[a-z0-9_-]+" placeholder="auto-generated from name" value={form.slug} onChange={(e) => handleSlug(e.target.value)} />
          <div className={`text-[10px] mt-1 ${form.slug && !slugIsValid ? 'text-state-down' : 'text-ink-400'}`}>
            {slugLocked ? 'Slug is fixed once a role exists' : (form.slug && !slugIsValid ? 'Use only lowercase letters, numbers, hyphens, underscores' : 'Lowercase only, no spaces')}
          </div>
        </label>
        <label><span className="label">Description</span>
          <textarea rows={2} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <ErrorNote message={err} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={mut.isPending}>Cancel</button>
          <button type="submit" disabled={!canSubmit || mut.isPending}
            className={`btn-primary ${(!canSubmit || mut.isPending) ? '!bg-ink-200 !text-ink-400 cursor-not-allowed pointer-events-none' : ''}`}>
            <Save className="h-4 w-4" /> {mut.isPending ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
