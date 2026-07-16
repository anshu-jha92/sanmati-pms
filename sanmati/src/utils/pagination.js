export function parsePagination(query, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  const skip = (page - 1) * limit;
  // Allow sort as "field" or "-field" with comma separators
  let sort = { createdAt: -1 };
  if (query.sort && typeof query.sort === 'string') {
    sort = {};
    for (const part of query.sort.split(',')) {
      const p = part.trim();
      if (!p) continue;
      if (p.startsWith('-')) sort[p.slice(1)] = -1;
      else sort[p] = 1;
    }
  }
  return { page, limit, skip, sort };
}

export function paginatedMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}
