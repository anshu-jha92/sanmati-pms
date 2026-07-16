import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  Factory,
  Truck,
  ShieldCheck,
  Users,
  KeyRound,
  UsersRound,
  LogOut,
  Plug,
  Bell,
  BarChart3,
  Settings as SettingsIcon,
  Boxes,
  Gift,
  MapPin,
  Activity,
  TrendingDown,
  FileText,
  ShoppingCart,
  Calendar,
  CalendarClock,
  BookOpen,
  HardHat,
  Menu,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { authStore } from '../context/authStore.js';
import { authApi } from '../api/endpoints.js';
import { closeAllSockets } from '../hooks/useSocket.js';
import { NotificationBell } from '../components/NotificationBell.jsx';

/**
 * Full Sanmati PMS navigation — all 10 modules organized.
 */
const NAV_GROUPS = [
  { label: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: null },
  ]},
  { label: 'Orders', items: [
    { to: '/sales-orders',    label: 'Sales Orders',    icon: FileText,     perm: ['sales_orders', 'view'],    badge: { text: 'NEW', color: 'blue' } },
    { to: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart, perm: ['purchase_orders', 'view'] },
  ]},
  { label: 'Production', items: [
    { to: '/planning',         label: 'Planning & Scheduling',  icon: ClipboardList, perm: ['production', 'view'] },
    { to: '/tracking',         label: 'Order Tracking',    icon: MapPin,        perm: ['production', 'view'] },
    { to: '/machines',         label: 'Machines',          icon: Factory,       perm: ['machines', 'view'] },
    { to: '/downtime',         label: 'Downtime',          icon: TrendingDown,  perm: ['machines', 'view'] },
  ]},
  { label: 'Quality', items: [
    { to: '/qc', label: 'QC Inspection', icon: ShieldCheck, perm: ['qc', 'view'] },
  ]},
  { label: 'Inventory', items: [
    { to: '/raw-materials',   label: 'Raw Materials',   icon: Boxes,        perm: ['inventory', 'view'] },
    { to: '/finished-goods',  label: 'Finished Goods',  icon: Gift,         perm: ['inventory', 'view'] },
    { to: '/bom',             label: 'BOM',             icon: BookOpen,     perm: null },
  ]},
  { label: 'Dispatch', items: [
    { to: '/dispatch', label: 'Dispatching', icon: Truck, perm: ['dispatch', 'view'] },
  ]},
  { label: 'Reports', items: [
    { to: '/reports', label: 'Reports', icon: BarChart3, perm: ['reports', 'view'] },
  ]},
  { label: 'Admin', items: [
    { to: '/integrations', label: 'Integrations', icon: Plug,        perm: ['integrations', 'view'] },
    { to: '/employees',    label: 'Employees',    icon: Users,       perm: ['employees', 'view'] },
    { to: '/teams',        label: 'Teams',        icon: UsersRound,  perm: ['teams', 'view'] },
    { to: '/roles',        label: 'Roles & Permissions', icon: KeyRound,    perm: ['roles', 'view'] },
    { to: '/settings',     label: 'Settings',     icon: SettingsIcon, perm: null },
  ]},
];

function useClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return time;
}
function shiftLabel() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return 'A';
  if (h >= 14 && h < 22) return 'B';
  return 'C';
}
function shiftEndsIn() {
  const now = new Date();
  const h = now.getHours();
  let endHour;
  if (h >= 6 && h < 14) endHour = 14;
  else if (h >= 14 && h < 22) endHour = 22;
  else endHour = h < 6 ? 6 : 30;
  const end = new Date(now);
  if (endHour >= 24) { end.setDate(end.getDate() + 1); endHour -= 24; }
  end.setHours(endHour, 0, 0, 0);
  const diff = Math.max(0, end - now);
  const mins = Math.floor(diff / 60000);
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${hh}:${String(mm).padStart(2, '0')} left`;
}

export function AppLayout() {
  const user = authStore((s) => s.user);
  const hasPerm = authStore((s) => s.hasPerm);
  const refreshToken = authStore((s) => s.refreshToken);
  const clear = authStore((s) => s.clear);
  const setUser = authStore((s) => s.setUser);
  const nav = useNavigate();
  const location = useLocation();
  const clock = useClock();
  const [userMenu, setUserMenu] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const userMenuRef = useRef(null);

  // Close the profile dropdown when clicking anywhere outside it (or pressing Escape).
  useEffect(() => {
    if (!userMenu) return;
    const onPointerDown = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenu(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setUserMenu(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenu]);

  // Auto-close sidebar on mobile after route navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Re-hydrate the current user (permissions, roleSlugs, plantId) from the server
  // on app load, so a role/permission change by an admin takes effect on the next
  // reload — not only after a full logout/login.
  useEffect(() => {
    let cancelled = false;
    authApi.me().then((r) => { if (!cancelled && r?.data) setUser(r.data); }).catch(() => { /* keep cached principal */ });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = async () => {
    try { if (refreshToken) await authApi.logout(refreshToken); } catch { /* ignore */ }
    closeAllSockets();
    clear();
    nav('/login');
  };

  const allItems = NAV_GROUPS.flatMap((g) => g.items);
  const currentItem = allItems.find((i) =>
    i.to === '/' ? location.pathname === '/' : location.pathname.startsWith(i.to)
  );
  const pageTitle = currentItem?.label || 'Dashboard';
  const breadcrumb = location.pathname === '/'
    ? 'overview'
    : location.pathname.replace(/^\//, '').split('/')[0];

  return (
    <div className="min-h-screen flex bg-ink-50">
      {/* Sidebar Backdrop overlay for mobile screen */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-ink-900/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          "w-[230px] shrink-0 bg-white border-r border-ink-200 flex flex-col fixed left-0 top-0 bottom-0 z-50 shadow-[2px_0_16px_rgba(13,21,38,0.06)] transition-transform duration-300 ease-in-out lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="px-4 py-4 border-b border-ink-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="h-9 w-9 rounded-[9px] grid place-items-center text-[17px] shrink-0"
              style={{
                background: 'linear-gradient(135deg, #1a6bff, #0050d9)',
                boxShadow: '0 3px 10px rgba(26,107,255,0.32)',
              }}
            >
              🏭
            </div>
            <div>
              <div className="font-bold text-[14px] text-ink-900 leading-tight">Sanmati</div>
              <div className="text-[9.5px] text-ink-400 uppercase tracking-[0.08em]">Packaging PMS</div>
            </div>
          </div>
          {/* Close button inside sidebar for mobile */}
          <button
            className="lg:hidden p-1 rounded-md text-ink-400 hover:text-ink-900 hover:bg-ink-100"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 px-2 pb-3 overflow-y-auto">
          {NAV_GROUPS.map((group) => {
            const visible = group.items.filter((it) => !it.perm || hasPerm(...it.perm));
            if (visible.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="nav-section-label">{group.label}</div>
                {visible.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    end={it.to === '/'}
                    className={({ isActive }) => clsx('nav-link', isActive && 'active')}
                  >
                    <it.icon className="h-4 w-4" />
                    <span className="flex-1">{it.label}</span>
                    {it.badge && (
                      <span className={clsx(
                        'nav-badge',
                        it.badge.color === 'red' && 'bg-state-down/10 text-state-down',
                        it.badge.color === 'green' && 'bg-state-running/10 text-state-running',
                        it.badge.color === 'yellow' && 'bg-state-idle/10 text-state-idle',
                        it.badge.color === 'blue' && 'bg-brand-500/10 text-brand-600'
                      )}>
                        {it.badge.text}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-ink-200 bg-ink-50/60">
          <div className="flex items-center justify-center gap-1.5 text-[9.5px] font-bold text-state-running uppercase tracking-[0.08em]">
            <span className="pulse-dot" /> Live Sync
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 lg:ml-[230px] ml-0">
        <div className="sticky top-0 z-30 bg-white border-b border-ink-200 h-[54px] px-4 lg:px-5 flex items-center gap-3 lg:gap-4">
          {/* Hamburger button for mobile */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-1.5 -ml-1 rounded-md text-ink-600 hover:bg-ink-100 focus:outline-none shrink-0"
            aria-label="Open sidebar"
          >
            <Menu className="h-5.5 w-5.5" />
          </button>

          <div>
            <div className="text-[15px] lg:text-[17px] font-bold text-ink-900 leading-tight">{pageTitle}</div>
            <div className="text-[10px] lg:text-[11px] text-ink-400">/ {breadcrumb}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="chip-green text-[10px] font-bold">Shift {shiftLabel()} Active</div>
            <div className="chip-yellow text-[10px] font-bold">⏱ {shiftEndsIn()}</div>
            <div className="hidden md:block font-mono text-[13px] font-bold text-brand-500 tabular-nums bg-brand-50 px-2.5 py-1 rounded-md border border-brand-500/20">
              {clock.toLocaleTimeString('en-GB', { hour12: false })}
            </div>
            <NavLink
              to="/operator"
              className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-state-running text-white text-[11.5px] font-bold hover:bg-state-running/90"
              title="Switch to Operator View (simple shop-floor screen)"
            >
              <HardHat className="h-3.5 w-3.5" /> Operator View
            </NavLink>
            <NotificationBell />
            <div className="relative" ref={userMenuRef}>
              <button
                className="h-8 w-8 grid place-items-center rounded-md bg-ink-50 border border-ink-200 hover:bg-ink-100"
                onClick={() => setUserMenu((v) => !v)}
              >
                {user?.avatar
                  ? <img src={user.avatar} alt="" className="h-5 w-5 rounded-full object-cover" />
                  : <div className="h-5 w-5 rounded-full bg-brand-500 text-white text-[10px] font-bold grid place-items-center">
                      {(user?.name?.[0] || '?').toUpperCase()}
                    </div>}
              </button>
              {userMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 card !p-0 overflow-hidden">
                  <div className="px-3 py-2.5 border-b border-ink-100">
                    <div className="text-[12.5px] font-semibold text-ink-900">{user?.name}</div>
                    <div className="text-[10.5px] text-ink-400 truncate">{user?.email}</div>
                  </div>
                  <NavLink
                    to="/operator"
                    onClick={() => setUserMenu(false)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-state-running hover:bg-state-running/5 border-b border-ink-100"
                  >
                    <HardHat className="h-3.5 w-3.5" /> Open Operator View
                  </NavLink>
                  <button
                    onClick={logout}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-state-down hover:bg-state-down/5"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 max-w-[1600px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
