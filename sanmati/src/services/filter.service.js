import mongoose from 'mongoose';

/**
 * Builds a Mongo match stage from the common filter set used across dashboards/reports:
 *
 *   plantId, teamId, machineId, operatorId, employeeId, stage,
 *   dateFrom, dateTo, month (YYYY-MM), year (YYYY)
 *
 * The calling code supplies a `mapping` that says which fields in the target collection
 * correspond to which filter — e.g. the MachineData collection uses `metadata.machineId`
 * whereas ProductionOrder uses `stageProgress.operator`. Keeps filter semantics consistent
 * while avoiding hardcoded query builders per endpoint.
 */

const toObjectId = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(v) : null);

export function buildFilter(query, mapping = {}) {
  const match = {};

  // Simple ID filters
  for (const [qKey, fieldKey] of Object.entries({
    plantId: 'plantField',
    teamId: 'teamField',
    machineId: 'machineField',
    operatorId: 'operatorField',
    employeeId: 'employeeField',
  })) {
    const v = query[qKey];
    const field = mapping[fieldKey];
    if (v && field) {
      if (Array.isArray(v)) {
        const ids = v.map(toObjectId).filter(Boolean);
        if (ids.length) match[field] = { $in: ids };
      } else {
        const id = toObjectId(v);
        if (id) match[field] = id;
      }
    }
  }

  // Stage (enum string)
  if (query.stage && mapping.stageField) {
    match[mapping.stageField] = query.stage;
  }

  // Date range (explicit)
  const dateField = mapping.dateField;
  if (dateField) {
    const range = {};
    if (query.dateFrom) range.$gte = new Date(query.dateFrom);
    if (query.dateTo) range.$lte = new Date(query.dateTo);
    // Month / Year shorthand (inclusive)
    if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
      const [y, m] = query.month.split('-').map(Number);
      range.$gte = new Date(Date.UTC(y, m - 1, 1));
      range.$lt = new Date(Date.UTC(y, m, 1));
    } else if (query.year && /^\d{4}$/.test(query.year)) {
      const y = Number(query.year);
      range.$gte = new Date(Date.UTC(y, 0, 1));
      range.$lt = new Date(Date.UTC(y + 1, 0, 1));
    }
    if (Object.keys(range).length) match[dateField] = range;
  }

  // Free-text search
  if (query.q && mapping.textSearch) {
    match.$text = { $search: query.q };
  }

  return match;
}

/**
 * Scope filter to a user's accessible plants/teams/machines based on their assignments.
 * Admin (permission '*:*') bypasses all scoping; operators only see their own machines, etc.
 * This is how we ensure "operator-wise" filters are respected implicitly.
 */
export function scopeToPrincipal(filter, principal, mapping) {
  if (!principal) return filter;
  if (principal.permissions.includes('*:*')) return filter;

  // Restrict to user's plant if that field is in mapping
  if (mapping.plantField && principal.plantId) {
    filter[mapping.plantField] = filter[mapping.plantField] ?? new mongoose.Types.ObjectId(principal.plantId);
  }

  // If user is a pure operator (no reports access), limit to their machines
  const isOperator =
    !principal.permissions.includes('reports:view') &&
    principal.machineIds?.length > 0 &&
    mapping.machineField;
  if (isOperator) {
    const existing = filter[mapping.machineField];
    const own = principal.machineIds.map((id) => new mongoose.Types.ObjectId(id));
    filter[mapping.machineField] = existing ? { $in: own.filter((o) => String(o) === String(existing)) } : { $in: own };
  }

  return filter;
}
