/**
 * Departments — every department from the org blueprint, the roles inside it
 * (in reporting order), the people holding each role, and the machines that
 * department's people are running.
 *
 * READ-ONLY: builds entirely from adminApi.listUsers() + machineApi.live() and
 * the client-side role blueprint. Nothing is written to the database.
 *
 *   /departments        → all departments
 *   /departments/:key   → one department (roles → people → machines)
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  Building2, Users, Cpu, KeyRound, CheckCircle2, ArrowLeft, ArrowDown,
} from 'lucide-react';
import { adminApi, machineApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { DeptInsightPanel, DEPT_HAS_MACHINES } from '../components/org/DeptInsight.jsx';
import {
  DEPT_BY_KEY, departmentSummary, peopleByRole, machinesOfPerson,
  accessChips, responsibilityChips, reportsToSlug, ROLE_BY_SLUG,
  TIER_LABEL, initials,
} from '../lib/orgModel.js';

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

/* ══════════════════════════ LIST ══════════════════════════ */
export function DepartmentsPage() {
  const { users, machines, isLoading } = useOrgData();
  const depts = useMemo(() => departmentSummary(users, machines), [users, machines]);

  const totalPeople = new Set(depts.flatMap((d) => d.people.map((p) => String(p._id)))).size;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-ink-900">Departments</h1>
        <p className="text-[12px] text-ink-500 mt-0.5">
          Company → Department → Role → People → Machines. Pick a department to see who does what.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Building2} label="Departments" value={depts.length} color="#1a6bff" />
        <Stat icon={KeyRound} label="Roles" value={depts.reduce((n, d) => n + d.roleCount, 0)} color="#7c3aed" />
        <Stat icon={Users} label="People" value={totalPeople} color="#059669" />
        <Stat icon={Cpu} label="Machines" value={machines.length} color="#0891b2" />
      </div>

      {isLoading ? (
        <div className="card p-10 text-center text-[13px] text-ink-400">Loading departments…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {depts.map((d) => (
            <Link
              key={d.key}
              to={`/departments/${d.key}`}
              className="card p-4 hover:-translate-y-px hover:shadow-cardHov transition block"
              style={{ borderTop: `3px solid ${d.color}` }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-[15px] text-ink-900 truncate">{d.name}</div>
                  <div className="text-[11px] text-ink-400 mt-0.5">{d.roleCount} role{d.roleCount !== 1 ? 's' : ''}</div>
                </div>
                <span className="h-9 w-9 rounded-lg grid place-items-center shrink-0"
                  style={{ background: `${d.color}18`, color: d.color }}>
                  <Building2 className="h-5 w-5" />
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {d.roles.slice(0, 3).map((r) => (
                  <span key={r.slug} className="chip-gray text-[10px]">{r.name}</span>
                ))}
                {d.roles.length > 3 && <span className="chip-gray text-[10px]">+{d.roles.length - 3}</span>}
              </div>

              <div className="mt-3 pt-3 border-t border-ink-100 flex items-center gap-4 text-[11.5px]">
                <span className="inline-flex items-center gap-1 text-ink-600">
                  <Users className="h-3.5 w-3.5 text-ink-400" />
                  <b className="text-ink-900">{d.peopleCount}</b> people
                </span>
                {/* Machines only where this department's roles actually have machines access */}
                {DEPT_HAS_MACHINES.has(d.key) && (
                  <span className="inline-flex items-center gap-1 text-ink-600">
                    <Cpu className="h-3.5 w-3.5 text-ink-400" />
                    <b className="text-ink-900">{d.machineCount}</b> machines
                  </span>
                )}
              </div>

              {d.peopleCount > 0 && (
                <div className="mt-2 flex -space-x-1.5">
                  {d.people.slice(0, 6).map((p) => <Avatar key={p._id} user={p} size={22} />)}
                  {d.peopleCount > 6 && (
                    <span className="h-[22px] w-[22px] rounded-full bg-ink-100 border-2 border-white grid place-items-center text-[8px] font-bold text-ink-500">
                      +{d.peopleCount - 6}
                    </span>
                  )}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════ DETAIL ══════════════════════════ */
export function DepartmentDetailPage() {
  const { key } = useParams();
  const { users, machines, isLoading } = useOrgData();
  const dept = DEPT_BY_KEY[key];

  const byRole = useMemo(() => peopleByRole(users), [users]);

  // Roles in reporting order (most senior first)
  const roles = useMemo(
    () => (dept?.roles || []).slice().sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
    [dept]
  );

  // Machines this department's people are named on, grouped by stage
  const deptMachines = useMemo(() => {
    if (!dept) return [];
    const seen = new Map();
    for (const r of dept.roles) {
      for (const u of byRole[r.slug] || []) {
        for (const m of machinesOfPerson(u, machines)) seen.set(String(m._id), m);
      }
    }
    return [...seen.values()];
  }, [dept, byRole, machines]);

  if (!dept) {
    return (
      <div className="card p-10 text-center">
        <div className="font-bold text-[14px] text-ink-900">Department not found</div>
        <Link to="/departments" className="text-brand-500 text-[12.5px] hover:underline mt-2 inline-block">← All departments</Link>
      </div>
    );
  }

  const peopleCount = new Set(dept.roles.flatMap((r) => (byRole[r.slug] || []).map((u) => String(u._id)))).size;

  return (
    <div className="space-y-4">
      <Link to="/departments" className="inline-flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> All departments
      </Link>

      {/* Header */}
      <div className="card p-5" style={{ borderTop: `3px solid ${dept.color}` }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="h-11 w-11 rounded-xl grid place-items-center shrink-0"
              style={{ background: `${dept.color}18`, color: dept.color }}>
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-[20px] font-bold text-ink-900 leading-tight">{dept.name} Department</h1>
              <div className="text-[11.5px] text-ink-500 mt-0.5">
                Company → Plant → <b style={{ color: dept.color }}>{dept.name}</b> → Role → People
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[12px]">
            <span className="inline-flex items-center gap-1.5 text-ink-600"><KeyRound className="h-4 w-4 text-ink-400" /> <b className="text-ink-900">{roles.length}</b> roles</span>
            <span className="inline-flex items-center gap-1.5 text-ink-600"><Users className="h-4 w-4 text-ink-400" /> <b className="text-ink-900">{peopleCount}</b> people</span>
            {DEPT_HAS_MACHINES.has(dept.key) && (
              <span className="inline-flex items-center gap-1.5 text-ink-600"><Cpu className="h-4 w-4 text-ink-400" /> <b className="text-ink-900">{deptMachines.length}</b> machines</span>
            )}
          </div>
        </div>
      </div>

      {/* Role chain */}
      {isLoading ? (
        <div className="card p-10 text-center text-[13px] text-ink-400">Loading…</div>
      ) : (
        <div className="space-y-1">
          {roles.map((role, i) => (
            <div key={role.slug}>
              <RoleCard
                role={role}
                dept={dept}
                people={byRole[role.slug] || []}
                machines={machines}
              />
              {i < roles.length - 1 && (
                <div className="flex justify-center py-1.5">
                  <ArrowDown className="h-4 w-4 text-ink-300" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* What this department actually owns — machines only where the roles
          hold a machines permission; otherwise its own domain data. */}
      <DeptInsightPanel deptKey={dept.key} machines={machines} />
    </div>
  );
}

/* ── Role card — Access · Responsible for · People (click a person → org chart) ── */
function RoleCard({ role, dept, people, machines }) {
  const parent = reportsToSlug({ ...role, deptKey: dept.key });
  const parentRole = parent ? ROLE_BY_SLUG[parent] : null;
  const access = accessChips(role);
  const owns = responsibilityChips(role);

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-bold text-[15px] text-ink-900">{role.name}</div>
          <div className="text-[11.5px] text-ink-500 mt-0.5">{role.desc}</div>
          <div className="text-[10px] text-ink-400 mt-1">{TIER_LABEL[role.tier]}</div>
        </div>
        {parentRole && (
          <div className="text-[11px] text-ink-400 whitespace-nowrap">
            Reports to <b className="text-ink-700">{parentRole.name}</b>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 pt-3 border-t border-ink-100">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">
            <KeyRound className="h-3 w-3" /> Access
          </div>
          <div className="flex flex-wrap gap-1">
            {access.length ? access.map((a) => <span key={a} className="chip-blue text-[10px]">{a}</span>)
              : <span className="text-[11px] text-ink-400">—</span>}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">
            <CheckCircle2 className="h-3 w-3" /> Responsible for
          </div>
          <div className="flex flex-wrap gap-1">
            {owns.length ? owns.map((a) => <span key={a} className="chip-green text-[10px]">{a}</span>)
              : <span className="text-[11px] text-ink-400">View-only role</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-ink-100">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-2">
          <Users className="h-3 w-3" /> People ({people.length})
        </div>
        {people.length === 0 ? (
          <div className="text-[11.5px] text-ink-400 italic">Nobody assigned to this role yet.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {people.map((p) => {
              const mc = machinesOfPerson(p, machines).length;
              return (
                <Link
                  key={p._id}
                  to={`/org-chart/${p._id}`}
                  title={`Open ${p.name} in the org chart`}
                  className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border border-ink-200 bg-white hover:border-brand-500/40 hover:bg-brand-50 transition"
                >
                  <Avatar user={p} size={20} />
                  <span className="text-[12px] font-semibold text-ink-800">{p.name}</span>
                  {mc > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[9.5px] text-ink-500">
                      <Cpu className="h-2.5 w-2.5" /> {mc}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── shared bits ── */
export function Avatar({ user, size = 24 }) {
  const s = { width: size, height: size };
  if (user?.avatar) {
    return <img src={user.avatar} alt="" className="rounded-full object-cover border-2 border-white" style={s} />;
  }
  return (
    <span
      className="rounded-full bg-brand-500/15 text-brand-700 grid place-items-center font-bold border-2 border-white"
      style={{ ...s, fontSize: Math.max(8, size * 0.38) }}
    >
      {initials(user?.name)}
    </span>
  );
}

function Stat({ icon: Icon, label, value, color }) {
  return (
    <div className="card p-3.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">{label}</div>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="text-[22px] font-bold text-ink-900 tabular-nums mt-1">{value}</div>
    </div>
  );
}
