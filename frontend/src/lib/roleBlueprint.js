/**
 * Org role blueprint — the client-side catalogue of departments → roles →
 * recommended access. Shared by the Roles & Permissions page (to display &
 * create roles) and the Employees page (to offer every role for assignment,
 * materialising a blueprint role in the DB the first time it's assigned).
 */

export const LEVELS = {
  view: ['view'],
  edit: ['view', 'create', 'update'],
  exec: ['view', 'execute'],
  appr: ['view', 'update', 'approve'],
  full: ['view', 'create', 'update', 'delete'],
  all: ['view', 'create', 'update', 'delete', 'execute', 'approve', 'admin'],
};

export const DEPARTMENTS = [
  { key: 'leadership', name: 'Leadership', color: '#5b6472', roles: [
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

/** Flat list of every blueprint role, in department order. */
export const BLUEPRINT_ROLES = DEPARTMENTS.flatMap((d) => d.roles);

/** Expand a blueprint role's { module: level } into a matrix { module: {action:true} }. */
export function blueprintMatrix(bp, modules) {
  const map = Object.fromEntries(modules.map((m) => [m, {}]));
  if (!bp || !bp.perms) return map;
  if (bp.perms === 'all') { for (const m of modules) map[m] = Object.fromEntries(LEVELS.all.map((a) => [a, true])); return map; }
  for (const [mod, lvl] of Object.entries(bp.perms)) {
    if (!map[mod]) map[mod] = {};
    for (const a of LEVELS[lvl] || []) map[mod][a] = true;
  }
  return map;
}

/** Blueprint role → API permissions payload [{ module, actions[] }] (skips 'all'). */
export function blueprintPermissions(bp, allModules = []) {
  if (!bp || !bp.perms) return [];
  if (bp.perms === 'all') return allModules.map((m) => ({ module: m, actions: LEVELS.all }));
  return Object.entries(bp.perms)
    .map(([mod, lvl]) => ({ module: mod, actions: LEVELS[lvl] || [] }))
    .filter((p) => p.actions.length);
}
