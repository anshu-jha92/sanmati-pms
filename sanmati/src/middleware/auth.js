import { verifyAccessToken } from '../utils/tokens.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { User } from '../models/User.js';
import { cacheService } from '../services/cache.service.js';

/**
 * Parses Bearer token, attaches req.user (lean object including permission set).
 * We cache the resolved user+permissions in Redis for ~60s keyed by userId+tokenVersion,
 * so hot paths skip a DB round-trip per request.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing access token');
  }
  const token = header.slice(7);
  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired token', { code: 'E_TOKEN' });
  }

  const userId = decoded.sub;
  const cacheKey = `auth:user:${userId}:v${decoded.tv ?? 0}`;
  let principal = await cacheService.get(cacheKey);
  if (!principal) {
    const user = await User.findById(userId)
      .select('name email employeeCode status tokenVersion plantId roles teams assignedMachines shift avatar lastLoginAt')
      .populate({ path: 'roles', select: 'slug name permissions' })
      .lean();

    if (!user || user.status !== 'active') {
      throw ApiError.unauthorized('User inactive or not found');
    }
    if ((user.tokenVersion ?? 0) !== (decoded.tv ?? 0)) {
      throw ApiError.unauthorized('Token revoked');
    }

    const permSet = new Set();
    for (const r of user.roles || []) {
      for (const p of r.permissions || []) {
        for (const a of p.actions || []) permSet.add(`${p.module}:${a}`);
      }
    }

    principal = {
      id: String(user._id),
      name: user.name,
      email: user.email,
      employeeCode: user.employeeCode,
      avatar: user.avatar || null,
      lastLoginAt: user.lastLoginAt || null,
      plantId: user.plantId ? String(user.plantId) : null,
      roleSlugs: (user.roles || []).map((r) => r.slug),
      roleNames: (user.roles || []).map((r) => r.name),
      teamIds: (user.teams || []).map(String),
      machineIds: (user.assignedMachines || []).map(String),
      shift: user.shift,
      permissions: Array.from(permSet),
    };
    await cacheService.set(cacheKey, principal, 60);
  }

  req.user = principal;
  req.permissionSet = new Set(principal.permissions);
  next();
});
