import { Navigate, useLocation } from 'react-router-dom';
import { authStore } from '../../context/authStore';

export function ProtectedRoute({ children }) {
  const token = authStore((s) => s.accessToken);
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

/**
 * Route-level RBAC guard. Requires a token AND the given permission; otherwise
 * bounces to the dashboard. Keeps a user out of a page (even by typing its URL)
 * that their role doesn't grant. Client-side only — the API also enforces RBAC.
 * Usage: <RequirePerm module="roles" action="view"><RolesPage /></RequirePerm>
 */
export function RequirePerm({ module, action = 'view', children }) {
  const token = authStore((s) => s.accessToken);
  const hasPerm = authStore((s) => s.hasPerm);
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!hasPerm(module, action)) return <Navigate to="/" replace />;
  return children;
}

/**
 * <Can module="production" action="create">...</Can>
 * Hides children if the current user lacks the permission.
 */
export function Can({ module, action, fallback = null, children }) {
  const hasPerm = authStore((s) => s.hasPerm);
  return hasPerm(module, action) ? children : fallback;
}
