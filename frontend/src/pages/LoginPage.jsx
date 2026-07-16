import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, LogIn } from 'lucide-react';
import { authApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { api } from '../api/client.js';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const nav = useNavigate();
  const location = useLocation();

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const { data } = await authApi.login(email, password);
      authStore.getState().setSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
      const me = await api.get('/api/v1/auth/me');
      authStore.getState().setUser(me.data);

      // Smart redirect:
      // - If user came from a protected route, send them back there
      // - Else if user is ONLY an operator (no admin/manager perms), → /operator
      // - Else → / (admin dashboard)
      let redirect = location.state?.from?.pathname;
      if (!redirect) {
        const slugs = (me.data.roleSlugs || []).map((s) => String(s).toLowerCase());
        const perms = me.data.permissions || [];
        const hasAdminAccess = perms.some((p) =>
          /^(production|inventory|sales_orders|purchase_orders|machines|qc|users|roles|teams|reports):(view|create|update|delete)$/.test(p)
            && p !== 'production:execute'
        );
        const isOperatorOnly = slugs.some((s) => /operator/i.test(s)) && !hasAdminAccess;
        redirect = isOperatorOnly ? '/operator' : '/';
      }
      nav(redirect, { replace: true });
    } catch (e) {
      setErr(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-ink-50">
      {/* Left — branding panel */}
      <div className="hidden lg:flex flex-col justify-between p-10 relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-500 to-cyan-500 text-white">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.15) 1px,transparent 1px), linear-gradient(90deg,rgba(255,255,255,0.15) 1px,transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="relative">
          <img
            src="/sanmati-logo.png"
            alt="Sanmati"
            className="h-16 w-auto object-contain bg-white rounded-xl p-3 shadow-2xl"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <h1 className="mt-8 text-4xl font-bold tracking-tight leading-tight">
            Production Management System
          </h1>
          <p className="mt-3 text-white/80 text-[15px] max-w-md">
            Live shop-floor telemetry, OEE analytics, QC tracking, and dispatch control —
            all in one unified console for Sanmati Packaging.
          </p>
        </div>
        <div className="relative space-y-3">
          <Feature label="7 machines, 24×7 live telemetry" />
          <Feature label="OEE trends by hour / shift / day" />
          <Feature label="Dynamic third-party API integrations" />
          <Feature label="Role-based access across production, QC, dispatch" />
        </div>
        <div className="relative text-[11px] text-white/60">
          © Sanmati Packaging Pvt. Ltd.
        </div>
      </div>

      {/* Right — form */}
      <div className="grid place-items-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <img
              src="/sanmati-logo.png"
              alt="Sanmati"
              className="h-10 w-auto"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <div>
              <div className="font-bold text-[15px] text-ink-900">Sanmati</div>
              <div className="text-[10px] text-ink-400 uppercase tracking-wider">Packaging PMS</div>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-ink-900">Sign in</h2>
          <p className="text-[13px] text-ink-500 mt-1">
            Welcome back. Access your factory control plane.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            {err && (
              <div className="rounded-lg bg-state-down/5 border border-state-down/20 px-3 py-2 text-[12.5px] text-state-down">
                {err}
              </div>
            )}

            <button
              className="btn-primary w-full justify-center py-2.5 text-[13px]"
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Sign in
            </button>

            <div className="text-center text-[11px] text-ink-400 pt-2">
              Default admin: <span className="font-mono text-ink-500">admin@factory.local</span>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Feature({ label }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <div className="h-5 w-5 rounded-md bg-white/20 grid place-items-center text-[10px]">✓</div>
      {label}
    </div>
  );
}
