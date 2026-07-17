/**
 * Org model — derives the company hierarchy from data that ALREADY exists.
 * READ-ONLY: nothing here creates or mutates database records.
 *
 * Sources:
 *   • roleBlueprint.js  → departments, roles, tiers, access (the org catalogue)
 *   • adminApi.listUsers() → people + the roles they hold (roles are populated
 *                            as { _id, name, slug })
 *   • machineApi.live()   → machines + currentStatus.operatorName / supervisorName
 *
 * Reporting line: we do NOT invent a person→person link (there is no such field
 * in the DB). Instead the hierarchy is ROLE-based, which is the real org
 * structure: a role reports to the nearest lower-tier role in its own
 * department; a department's most senior role reports to the Plant Head.
 * People then sit inside the role they hold. This is honest and fully derived.
 */

import { DEPARTMENTS } from './roleBlueprint.js';

export const PLANT_HEAD = 'plant-head';
export const SYSTEM_ADMIN = 'system-admin';

/** Every blueprint role, flattened, carrying its department identity. */
export const ALL_ROLES = DEPARTMENTS.flatMap((d) =>
  d.roles.map((r) => ({ ...r, deptKey: d.key, deptName: d.name, deptColor: d.color }))
);
export const ROLE_BY_SLUG = Object.fromEntries(ALL_ROLES.map((r) => [r.slug, r]));
export const DEPT_BY_KEY = Object.fromEntries(DEPARTMENTS.map((d) => [d.key, d]));

/**
 * Which role does this role report to? Derived from tier within the department:
 * nearest strictly-lower tier in the same department, else the Plant Head.
 * The Plant Head is the root; System Admin sits outside the production chain.
 */
export function reportsToSlug(role) {
  if (!role || role.slug === PLANT_HEAD || role.slug === SYSTEM_ADMIN) return null;
  const dept = DEPT_BY_KEY[role.deptKey];
  const lower = (dept?.roles || [])
    .filter((r) => r.tier < role.tier)
    .sort((a, b) => b.tier - a.tier); // nearest lower tier first
  return lower.length ? lower[0].slug : PLANT_HEAD;
}

/** Role slugs a user holds that exist in the blueprint. */
export function roleSlugsOf(user) {
  return (user?.roles || [])
    .map((r) => (typeof r === 'string' ? r : r?.slug))
    .filter((s) => s && ROLE_BY_SLUG[s]);
}

/** A user's most senior blueprint role (lowest tier). Null if they hold none. */
export function primaryRole(user) {
  const roles = roleSlugsOf(user).map((s) => ROLE_BY_SLUG[s]);
  if (!roles.length) return null;
  return [...roles].sort((a, b) => a.tier - b.tier)[0];
}

/**
 * Who a person reports to.
 *   → { user, role } when exactly one person holds the parent role
 *   → { user: null, role } when that role is vacant or several people hold it
 *     (we name the role rather than guess a manager)
 *   → null for the Plant Head / System Admin (top of the chain)
 */
export function reportsTo(user, users = []) {
  const role = primaryRole(user);
  if (!role) return null;
  const parentSlug = reportsToSlug(role);
  if (!parentSlug) return null;
  const parentRole = ROLE_BY_SLUG[parentSlug];
  const holders = users.filter(
    (u) => String(u._id) !== String(user._id) && roleSlugsOf(u).includes(parentSlug)
  );
  return { user: holders.length === 1 ? holders[0] : null, role: parentRole };
}

/** Machines a person is named on (operator or supervisor), matched by name. */
export function machinesOfPerson(user, machines = []) {
  const n = String(user?.name || '').trim().toLowerCase();
  if (!n) return [];
  return machines.filter((m) => {
    const cs = m.currentStatus || {};
    return (
      String(cs.operatorName || '').trim().toLowerCase() === n ||
      String(cs.supervisorName || '').trim().toLowerCase() === n
    );
  });
}

/** How a person is attached to a machine — drives the "what are they doing" line. */
export function relationToMachine(user, machine) {
  const n = String(user?.name || '').trim().toLowerCase();
  const cs = machine.currentStatus || {};
  if (String(cs.operatorName || '').trim().toLowerCase() === n) return 'Operator';
  if (String(cs.supervisorName || '').trim().toLowerCase() === n) return 'Supervisor';
  return null;
}

/** slug → [users holding it]. A person holding 2 roles appears under both. */
export function peopleByRole(users = []) {
  const map = {};
  for (const u of users) {
    for (const slug of roleSlugsOf(u)) (map[slug] ||= []).push(u);
  }
  for (const k of Object.keys(map)) map[k].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return map;
}

/**
 * Build the role tree rooted at the Plant Head.
 * node = { role, people, children[], teamSize, directReports }
 */
export function buildOrgTree(users = []) {
  const byRole = peopleByRole(users);

  const childSlugs = {};
  for (const r of ALL_ROLES) {
    const parent = reportsToSlug(r);
    if (parent) (childSlugs[parent] ||= []).push(r.slug);
  }

  const build = (slug) => {
    const role = ROLE_BY_SLUG[slug];
    const kids = (childSlugs[slug] || [])
      .map((s) => ROLE_BY_SLUG[s])
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))
      .map((r) => build(r.slug));
    const people = byRole[slug] || [];
    const teamSize = kids.reduce((n, k) => n + k.people.length + k.teamSize, 0);
    const directReports = kids.reduce((n, k) => n + k.people.length, 0);
    return { role, people, children: kids, teamSize, directReports };
  };

  return { root: build(PLANT_HEAD), admin: build(SYSTEM_ADMIN), byRole };
}

/* ────────────────────────────────────────────────────────────────
 * PERSON-centric tree (what the Org Chart renders)
 *
 *   System Admin → Plant Head → Department → people, nested by tier.
 *
 * Only departments that actually have people are included — no "vacant" noise.
 * A lower tier nests under the tier above ONLY when that tier has exactly one
 * person (unambiguous). When several people share the parent tier we attach at
 * the department level instead of inventing a reporting line that isn't in the
 * data. Nothing here is persisted.
 * ──────────────────────────────────────────────────────────────── */

const countPeople = (nodes) =>
  nodes.reduce((n, x) => n + (x.type === 'person' ? 1 : 0) + countPeople(x.children), 0);

/**
 * Root nodes for the Org Chart, in the order the business reads it:
 *
 *   System / IT Admin  →  Plant Head / GM  →  every Department
 *                              →  every Role in that department
 *                                    →  the employees holding it
 *
 * Every department and role from the blueprint is shown (same catalogue as the
 * Roles & Permissions page). A role nobody holds renders as an explicit
 * "no one assigned" hint rather than being hidden.
 */
/**
 * People of one department as person rows, nested by tier. A lower tier nests
 * under the tier above ONLY when that tier has exactly one person (unambiguous);
 * otherwise it sits at the department level — we never invent a reporting line.
 */
function deptPeopleTree(dept, users) {
  const byTier = new Map();
  for (const u of users) {
    for (const slug of roleSlugsOf(u)) {
      const r = ROLE_BY_SLUG[slug];
      if (r.deptKey !== dept.key) continue;
      if (!byTier.has(r.tier)) byTier.set(r.tier, []);
      const bucket = byTier.get(r.tier);
      if (!bucket.some((x) => String(x.user._id) === String(u._id))) {
        bucket.push({ type: 'person', user: u, role: r, children: [] });
      }
    }
  }
  const top = [];
  let prev = null;
  for (const t of [...byTier.keys()].sort((a, b) => a - b)) {
    const group = byTier.get(t).sort((a, b) => String(a.user.name).localeCompare(String(b.user.name)));
    if (prev && prev.length === 1) prev[0].children.push(...group);
    else top.push(...group);
    prev = group;
  }
  return top;
}

export function buildChartTree(users = []) {
  const byRole = peopleByRole(users);

  // Every department except Leadership (its two roles are the chain above).
  const deptNodes = DEPARTMENTS
    .filter((d) => d.key !== 'leadership')
    .map((d) => {
      const children = deptPeopleTree(d, users);
      return { type: 'dept', dept: d, roleCount: d.roles.length, count: countPeople(children), children };
    });

  // Leadership chain: the person holding the role, or the role itself if vacant
  // (so the top of the chart still reads System Admin → Plant Head).
  const chain = (slug, below) => {
    const role = ROLE_BY_SLUG[slug];
    const people = byRole[slug] || [];
    if (!people.length) return [{ type: 'role', role, people: [], children: below }];
    return people.map((u, i) => ({
      type: 'person', user: u, role, children: i === 0 ? below : [],
    }));
  };

  return chain(SYSTEM_ADMIN, chain(PLANT_HEAD, deptNodes));
}

/** Total people in a node's subtree (excluding the node itself). */
export function subtreeCount(node) {
  return countPeople(node.children);
}

/** Stable key for expand/collapse state. */
export function nodeKey(node) {
  if (node.type === 'dept') return `dept:${node.dept.key}`;
  if (node.type === 'role') return `role:${node.role.slug}`;
  return `p:${node.user._id}:${node.role?.slug || '-'}`;
}

/** Flatten a node's whole subtree into a list of { user, role } (excludes the node itself). */
export function subtreePeople(node) {
  const out = [];
  const walk = (n) => {
    for (const kid of n.children) {
      for (const u of kid.people) out.push({ user: u, role: kid.role });
      walk(kid);
    }
  };
  walk(node);
  return out;
}

/** Find the tree node for a given role slug. */
export function findNode(node, slug) {
  if (!node) return null;
  if (node.role?.slug === slug) return node;
  for (const k of node.children) {
    const hit = findNode(k, slug);
    if (hit) return hit;
  }
  return null;
}

/** Per-department roll-up used by the Departments list. */
export function departmentSummary(users = [], machines = []) {
  const byRole = peopleByRole(users);
  return DEPARTMENTS.map((d) => {
    const people = new Map();
    for (const r of d.roles) for (const u of byRole[r.slug] || []) people.set(String(u._id), u);
    const staff = [...people.values()];
    const machineSet = new Map();
    for (const u of staff) for (const m of machinesOfPerson(u, machines)) machineSet.set(String(m._id), m);
    return {
      ...d,
      roleCount: d.roles.length,
      people: staff,
      peopleCount: staff.length,
      machines: [...machineSet.values()],
      machineCount: machineSet.size,
    };
  });
}

/** Access chips for a role: module names it can touch (from the blueprint perms). */
export function accessChips(role) {
  if (!role?.perms) return [];
  if (role.perms === 'all') return ['Full platform access'];
  return Object.keys(role.perms).map(labelModule);
}

/** Responsibilities = the modules the role can actually change/approve/execute. */
export function responsibilityChips(role) {
  if (!role?.perms) return [];
  if (role.perms === 'all') return ['Users', 'Roles', 'Integrations', 'All modules'];
  const OWNING = new Set(['edit', 'exec', 'appr', 'full', 'all']);
  return Object.entries(role.perms)
    .filter(([, lvl]) => OWNING.has(lvl))
    .map(([mod]) => labelModule(mod));
}

export function labelModule(m) {
  const MAP = {
    sales_orders: 'Sales Orders',
    purchase_orders: 'Purchase Orders',
    qc: 'Quality Control',
    machine_data: 'Machine Data',
  };
  return MAP[m] || String(m).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const TIER_LABEL = { 1: 'Tier 1 · Leadership', 2: 'Tier 2 · Manager', 3: 'Tier 3 · Supervisor / Executive', 4: 'Tier 4 · Operator' };

/** Initials for the avatar fallback. */
export function initials(name) {
  return String(name || '?')
    .trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
