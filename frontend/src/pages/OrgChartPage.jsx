/**
 * Org Chart — the reporting structure, rooted at the Plant Head.
 *
 * The hierarchy is ROLE-based (derived from the blueprint's department + tier),
 * with the people who hold each role nested inside it. We deliberately do NOT
 * invent a person→person reporting link — no such field exists in the DB and
 * this page is strictly READ-ONLY.
 *
 *   /org-chart        → the tree
 *   /org-chart/:id    → one person: their role, team, tasks and machines
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  Network, Users, Cpu, ChevronRight, ChevronDown, Search, ArrowLeft,
  Building2, KeyRound, CheckCircle2, Eye, Briefcase,
} from 'lucide-react';
import { adminApi, machineApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { Avatar } from './DepartmentsPage.jsx';
import { DeptInsightPanel, DEPT_HAS_MACHINES } from '../components/org/DeptInsight.jsx';
import {
  buildOrgTree, buildChartTree, subtreePeople, subtreeCount, nodeKey,
  primaryRole, roleSlugsOf, ROLE_BY_SLUG,
  machinesOfPerson, relationToMachine, accessChips, responsibilityChips,
  reportsToSlug, TIER_LABEL, DEPT_BY_KEY,
} from '../lib/orgModel.js';

const STATE_CHIP = {
  running: 'chip-green', idle: 'chip-yellow', down: 'chip-red',
  maintenance: 'chip-purple', offline: 'chip-gray',
};
const STATE_LABEL = {
  running: 'Running', idle: 'Idle', down: 'Down',
  maintenance: 'Maintenance', offline: 'Offline',
};

function useOrgData() {
  const user = authStore((s) => s.user);
  const usersQ = useQuery({
    queryKey: ['org', 'users'],
    queryFn: async () => (await adminApi.listUsers({ limit: 200 })).data,
  });
  const machinesQ = useQuery({
    queryKey: ['machines', 'live', user?.plantId],
    queryFn: async () => (await machineApi.live(user?.plantId)).data,
    refetchInterval: 15_000,
  });
  return {
    users: usersQ.data || [],
    machines: machinesQ.data || [],
    isLoading: usersQ.isLoading || machinesQ.isLoading,
  };
}

/* ══════════════════════════ TREE ══════════════════════════ */
export function OrgChartPage() {
  const { users, machines, isLoading } = useOrgData();
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState({});

  const roots = useMemo(() => buildChartTree(users), [users]);

  const allKeys = useMemo(() => {
    const out = [];
    const walk = (n) => { out.push(nodeKey(n)); n.children.forEach(walk); };
    roots.forEach(walk);
    return out;
  }, [roots]);

  // Departments start collapsed (see defaultCollapsed in TreeNode), so these two
  // set every key explicitly rather than relying on the default.
  const expandAll = () => setCollapsed(Object.fromEntries(allKeys.map((k) => [k, false])));
  const collapseAll = () => setCollapsed(Object.fromEntries(allKeys.map((k) => [k, true])));

  const matches = (node) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const hay =
      node.type === 'dept' ? node.dept.name
      : node.type === 'role' ? `${node.role.name} ${node.role.deptName || ''}`
      : `${node.user.name} ${node.user.email || ''} ${node.role?.name || ''}`;
    if (hay.toLowerCase().includes(needle)) return true;
    return node.children.some(matches);
  };

  const totalPeople = useMemo(
    () => new Set(users.filter((u) => u.roles?.length).map((u) => String(u._id))).size,
    [users]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[20px] font-bold text-ink-900">Org Chart</h1>
          <p className="text-[12px] text-ink-500 mt-0.5">Reporting structure — who reports to whom.</p>
        </div>
        <div className="flex items-center gap-4 text-[11.5px] text-ink-500">
          <span><b className="text-ink-900">{totalPeople}</b> people</span>
          <span><b className="text-ink-900">{machines.length}</b> machines</span>
        </div>
      </div>

      <div className="card p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <input
            placeholder="Search a person by name, role or department…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="input pl-9 py-1.5 text-[13px]"
          />
        </div>
        <button onClick={expandAll} className="btn-secondary text-[12px] py-1.5 px-3">Expand all</button>
        <button onClick={collapseAll} className="btn-secondary text-[12px] py-1.5 px-3">Collapse all</button>
        <div className="text-[10.5px] text-ink-400 ml-auto hidden lg:block max-w-[260px]">
          Click a person to open their team, tasks and machines.
        </div>
      </div>

      {isLoading ? (
        <div className="card p-10 text-center text-[13px] text-ink-400">Loading org chart…</div>
      ) : roots.length === 0 ? (
        <div className="card p-10 text-center">
          <Network className="h-10 w-10 mx-auto text-ink-300 mb-2" />
          <div className="font-bold text-[14px] text-ink-900">No one is mapped to a role yet</div>
          <div className="text-[11.5px] text-ink-500 mt-1">
            Assign roles on the <Link to="/employees" className="text-brand-600 hover:underline">Employees</Link> page and the chart builds itself.
          </div>
        </div>
      ) : (
        <div className="card p-4 sm:p-5 overflow-x-auto">
          <div className="min-w-[460px]">
            {roots.map((n) => (
              <TreeNode key={nodeKey(n)} node={n} machines={machines}
                collapsed={collapsed} setCollapsed={setCollapsed} matches={matches} depth={0} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Display-only count pill — deliberately not a link/button. */
const Badge = ({ icon: Icon, children, tone = 'gray' }) => (
  <span
    aria-hidden={false}
    className={clsx(
      'hidden sm:inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold whitespace-nowrap',
      'cursor-default select-none pointer-events-none',
      tone === 'brand' ? 'border-brand-500/25 bg-brand-50 text-brand-700' : 'border-ink-200 bg-ink-50 text-ink-600'
    )}
  >
    <Icon className="h-3 w-3" /> {children}
  </span>
);

function TreeNode({ node, machines, collapsed, setCollapsed, matches, depth }) {
  if (!matches(node)) return null;
  const key = nodeKey(node);
  // Departments start CLOSED on first load, so the chart opens as a clean
  // overview (System Admin → Plant Head → the department list) and you drill in
  // by choice. Everything else starts open. An explicit toggle always wins.
  const defaultCollapsed = node.type === 'dept';
  const isCollapsed = collapsed[key] ?? defaultCollapsed;
  const hasKids = node.children.length > 0;
  const color =
    node.type === 'dept' ? node.dept.color : (DEPT_BY_KEY[node.role?.deptKey]?.color || '#64748b');

  return (
    <div className={clsx(depth > 0 && 'ml-3 pl-4 border-l border-ink-200')}>
      <div className="flex items-center gap-2.5 py-1.5 group">
        <button
          onClick={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}
          className={clsx(
            'h-5 w-5 grid place-items-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-700 shrink-0 transition',
            !hasKids && 'invisible pointer-events-none'
          )}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {/* ── DEPARTMENT ── */}
        {node.type === 'dept' && (
          <>
            <span className="h-7 w-7 rounded-lg grid place-items-center shrink-0" style={{ background: `${color}18`, color }}>
              <Building2 className="h-3.5 w-3.5" />
            </span>
            <Link to={`/departments/${node.dept.key}`} className="min-w-0 flex-1">
              <div className="text-[13px] font-bold truncate hover:underline" style={{ color }}>
                {node.dept.name} Department
              </div>
              <div className="text-[10.5px] text-ink-400">
                {node.roleCount} role{node.roleCount !== 1 ? 's' : ''} · {node.count} {node.count === 1 ? 'person' : 'people'}
              </div>
            </Link>
            <Link to={`/departments/${node.dept.key}`} title="Open department"
              className="h-9 w-9 grid place-items-center rounded-lg border border-ink-200 bg-white text-ink-400 hover:text-brand-600 hover:border-brand-500/40 hover:bg-brand-50 shrink-0 transition">
              <Eye className="h-4 w-4" />
            </Link>
          </>
        )}

        {/* ── ROLE ── */}
        {node.type === 'role' && (
          <>
            <span className="h-6 w-6 rounded-md grid place-items-center shrink-0 border" style={{ borderColor: `${color}40`, color }}>
              <KeyRound className="h-3 w-3" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold truncate" style={{ color }}>{node.role.name}</div>
              {node.people.length === 0 && (
                <div className="text-[10px] text-ink-300">No one assigned yet</div>
              )}
            </div>
            {node.people.length > 0 && (
              <Badge icon={Users}>{node.people.length} {node.people.length === 1 ? 'person' : 'people'}</Badge>
            )}
          </>
        )}

        {/* ── PERSON ── */}
        {node.type === 'person' && (
          <>
            <Avatar user={node.user} size={30} />
            <Link to={`/org-chart/${node.user._id}`} className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-ink-900 truncate group-hover:text-brand-600 transition">
                {node.user.name}
              </div>
              <div className="text-[11px] truncate" style={{ color }}>{node.role?.name || '—'}</div>
            </Link>
            <div className="flex items-center gap-1.5 shrink-0">
              {(() => {
                const reports = subtreeCount(node);
                const mCount = machinesOfPerson(node.user, machines).length;
                return (
                  <>
                    {reports > 0 && <Badge icon={Users}>{reports} report{reports !== 1 ? 's' : ''}</Badge>}
                    {mCount > 0 && <Badge icon={Cpu} tone="brand">{mCount} machine{mCount !== 1 ? 's' : ''}</Badge>}
                  </>
                );
              })()}
              <Link to={`/org-chart/${node.user._id}`} title={`View ${node.user.name}`}
                className="h-9 w-9 grid place-items-center rounded-lg border border-ink-200 bg-white text-ink-400 hover:text-brand-600 hover:border-brand-500/40 hover:bg-brand-50 shrink-0 transition">
                <Eye className="h-4 w-4" />
              </Link>
            </div>
          </>
        )}
      </div>

      {node.type === 'dept' && node.children.length === 0 && (
        <div className="ml-3 pl-4 border-l border-ink-200 py-1.5 text-[10.5px] text-ink-300 italic">
          No one assigned to this department yet
        </div>
      )}

      {hasKids && !isCollapsed && (
        <div>
          {node.children.map((k) => (
            <TreeNode key={nodeKey(k)} node={k} machines={machines}
              collapsed={collapsed} setCollapsed={setCollapsed} matches={matches} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════ PERSON ══════════════════════════ */
export function OrgPersonPage() {
  const { id } = useParams();
  const { users, machines, isLoading } = useOrgData();

  const person = users.find((u) => String(u._id) === String(id));
  const tree = useMemo(() => buildOrgTree(users), [users]);

  const role = person ? primaryRole(person) : null;
  const allRoles = person ? roleSlugsOf(person).map((s) => ROLE_BY_SLUG[s]) : [];
  const parentRole = role ? ROLE_BY_SLUG[reportsToSlug(role) || ''] : null;

  // Their node in the tree → team + direct reports
  const node = useMemo(() => {
    if (!role) return null;
    const find = (n) => (n.role.slug === role.slug ? n : n.children.reduce((hit, k) => hit || find(k), null));
    return find(tree.root) || find(tree.admin);
  }, [tree, role]);

  const team = useMemo(() => (node ? subtreePeople(node) : []), [node]);
  const directs = useMemo(
    () => (node ? node.children.flatMap((k) => k.people.map((u) => ({ user: u, role: k.role }))) : []),
    [node]
  );
  const myMachines = useMemo(() => (person ? machinesOfPerson(person, machines) : []), [person, machines]);

  // Machines across their whole org (their own + their team's)
  const orgMachines = useMemo(() => {
    const seen = new Map();
    for (const m of myMachines) seen.set(String(m._id), m);
    for (const { user } of team) for (const m of machinesOfPerson(user, machines)) seen.set(String(m._id), m);
    return [...seen.values()];
  }, [myMachines, team, machines]);

  if (isLoading) return <div className="card p-10 text-center text-[13px] text-ink-400">Loading…</div>;
  if (!person) {
    return (
      <div className="card p-10 text-center">
        <div className="font-bold text-[14px] text-ink-900">Person not found</div>
        <Link to="/org-chart" className="text-brand-500 text-[12.5px] hover:underline mt-2 inline-block">← Org Chart</Link>
      </div>
    );
  }

  const dept = role ? DEPT_BY_KEY[role.deptKey] : null;
  // Machines are only meaningful for departments whose roles hold a `machines`
  // permission (Leadership, Planning, Production, Maintenance).
  const showMachines = !!role && DEPT_HAS_MACHINES.has(role.deptKey);

  return (
    <div className="space-y-4">
      <Link to="/org-chart" className="inline-flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Org Chart
      </Link>

      {/* Header */}
      <div className="card p-5 flex items-center gap-4 flex-wrap">
        <Avatar user={person} size={56} />
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold text-ink-900 leading-tight">{person.name}</h1>
          <div className="text-[12px] mt-0.5" style={{ color: dept?.color || '#64748b' }}>
            {role ? role.name : 'No blueprint role'}
            {parentRole && <span className="text-ink-400"> · reports to <b className="text-ink-600">{parentRole.name}</b></span>}
          </div>
          <div className="text-[11px] text-ink-400 mt-0.5">
            {person.email}{person.employeeCode ? ` · ${person.employeeCode}` : ''}
            {dept && <> · <Link to={`/departments/${dept.key}`} className="text-brand-600 hover:underline">{dept.name} Department</Link></>}
          </div>
        </div>
        <span className={clsx('ml-auto text-[10px]', person.status === 'active' ? 'chip-green' : 'chip-gray')}>
          {person.status || 'unknown'}
        </span>
      </div>

      {/* Stats */}
      <div className={clsx('grid grid-cols-1 gap-3', showMachines ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        <Stat label="Team size" value={team.length} sub="people under them" icon={Users} color="#7c3aed" />
        <Stat label="Direct reports" value={directs.length} sub="report to them directly" icon={Network} color="#1a6bff" />
        {showMachines && (
          <Stat label="Machines" value={orgMachines.length} sub="across their org" icon={Cpu} color="#ea580c" />
        )}
      </div>

      {/* Role access / responsibilities */}
      {role && (
        <div className="card p-5">
          <div className="text-[13px] font-bold text-ink-900 mb-1">{role.name}</div>
          <div className="text-[11.5px] text-ink-500">{role.desc}</div>
          <div className="text-[10px] text-ink-400 mt-1">{TIER_LABEL[role.tier]}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 pt-3 border-t border-ink-100">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">
                <KeyRound className="h-3 w-3" /> Access
              </div>
              <div className="flex flex-wrap gap-1">
                {accessChips(role).map((a) => <span key={a} className="chip-blue text-[10px]">{a}</span>)}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">
                <CheckCircle2 className="h-3 w-3" /> Responsible for
              </div>
              <div className="flex flex-wrap gap-1">
                {responsibilityChips(role).length
                  ? responsibilityChips(role).map((a) => <span key={a} className="chip-green text-[10px]">{a}</span>)
                  : <span className="text-[11px] text-ink-400">View-only role</span>}
              </div>
            </div>
          </div>
          {allRoles.length > 1 && (
            <div className="mt-3 pt-3 border-t border-ink-100">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">Also holds</div>
              <div className="flex flex-wrap gap-1">
                {allRoles.filter((r) => r.slug !== role.slug).map((r) => (
                  <span key={r.slug} className="chip-gray text-[10px]">{r.name}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Team */}
        <div className="card">
          <div className="px-5 py-3.5 border-b border-ink-100 flex items-center justify-between">
            <div className="panel-title"><Users className="h-4 w-4 text-brand-500" /> Team — reports up to {person.name}</div>
            <span className="chip-gray text-[10px]">{team.length}</span>
          </div>
          <div className="p-4">
            {team.length === 0 ? (
              <div className="text-[12px] text-ink-400 text-center py-6">No one reports to this role.</div>
            ) : (
              <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
                {team.map(({ user: u, role: r }) => (
                  <Link key={`${u._id}-${r.slug}`} to={`/org-chart/${u._id}`}
                    className="flex items-center gap-2 p-2 rounded-lg border border-ink-100 hover:border-brand-500/30 hover:bg-brand-50/40 transition">
                    <Avatar user={u} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold text-ink-900 truncate">{u.name}</div>
                      <div className="text-[10.5px]" style={{ color: DEPT_BY_KEY[r.deptKey]?.color }}>{r.name}</div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] text-ink-400 shrink-0">
                      <Cpu className="h-3 w-3" /> {machinesOfPerson(u, machines).length}
                    </span>
                    <Eye className="h-3.5 w-3.5 text-ink-300 shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Second column is department-aware: machines only for departments whose
            roles actually hold a machines permission; everyone else sees the data
            their department genuinely owns (order book, QC, stock, POs…). */}
        {!showMachines ? (
          <DeptInsightPanel deptKey={role?.deptKey} machines={machines} />
        ) : (
        <div className="card">
          <div className="px-5 py-3.5 border-b border-ink-100 flex items-center justify-between">
            <div className="panel-title"><Cpu className="h-4 w-4 text-brand-500" /> Machines &amp; current work</div>
            <span className="chip-gray text-[10px]">{orgMachines.length}</span>
          </div>
          <div className="p-4">
            {orgMachines.length === 0 ? (
              <div className="text-[12px] text-ink-400 text-center py-6">
                No machine assigned to this person or their team.
                <div className="text-[11px] mt-1">Set an operator/supervisor on a machine’s <b>Configure</b> tab.</div>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
                {orgMachines.map((m) => {
                  const cs = m.currentStatus || {};
                  const rel = relationToMachine(person, m);
                  return (
                    <Link key={m._id} to={`/machines/${m._id}`}
                      className="block p-2.5 rounded-lg border border-ink-100 hover:border-brand-500/30 hover:bg-brand-50/40 transition">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11.5px] font-bold text-brand-600">{m.code}</span>
                        <span className="text-[11px] text-ink-500 truncate">{m.name}</span>
                        <span className={clsx('ml-auto text-[9.5px] shrink-0', STATE_CHIP[cs.state] || 'chip-gray')}>
                          {STATE_LABEL[cs.state] || 'Offline'}
                        </span>
                      </div>
                      <div className="text-[10.5px] text-ink-500 mt-1 flex items-center gap-1.5 flex-wrap">
                        <span className="capitalize">{String(m.stage || '').replace('_', ' ')}</span>
                        {rel && <><span className="text-ink-300">·</span><span className="font-semibold text-ink-600">{rel}</span></>}
                        {cs.currentJobNumber && (
                          <>
                            <span className="text-ink-300">·</span>
                            <span className="inline-flex items-center gap-1">
                              <Briefcase className="h-2.5 w-2.5" />
                              Job <b className="font-mono text-ink-700">{cs.currentJobNumber}</b>
                            </span>
                          </>
                        )}
                      </div>
                      {cs.currentProduct && (
                        <div className="text-[10.5px] text-ink-400 mt-0.5 truncate">Task: {cs.currentProduct}</div>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon, color }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">{label}</div>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="text-[26px] font-bold tabular-nums leading-none mt-1" style={{ color }}>{value}</div>
      <div className="text-[11px] text-ink-400 mt-1">{sub}</div>
    </div>
  );
}
