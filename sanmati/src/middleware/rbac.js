import { ApiError } from '../utils/http.js';

/**
 * Usage:
 *   router.post('/orders', authenticate, require('production', 'create'), handler)
 *
 * The admin role has wildcard: permission `*:*` grants everything. The seed
 * installs this for the System Admin role.
 */
export function require(module, action) {
  return (req, _res, next) => {
    const set = req.permissionSet;
    if (!set) return next(ApiError.unauthorized());
    if (set.has('*:*') || set.has(`${module}:*`) || set.has(`${module}:${action}`)) {
      return next();
    }
    return next(ApiError.forbidden(`Missing permission ${module}:${action}`, { code: 'E_RBAC' }));
  };
}

/**
 * Allow if ANY of the listed (module,action) pairs match — useful for endpoints
 * that serve multiple modules (e.g. global search).
 */
export function requireAny(...pairs) {
  return (req, _res, next) => {
    const set = req.permissionSet;
    if (!set) return next(ApiError.unauthorized());
    if (set.has('*:*')) return next();
    for (const [module, action] of pairs) {
      if (set.has(`${module}:*`) || set.has(`${module}:${action}`)) return next();
    }
    return next(ApiError.forbidden('Insufficient permissions', { code: 'E_RBAC' }));
  };
}
