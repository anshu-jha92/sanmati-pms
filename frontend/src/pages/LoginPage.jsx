import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, LogIn, Mail, Lock, Copy, Check } from 'lucide-react';
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
    <div className="min-h-screen grid place-items-center p-4 relative overflow-hidden bg-gradient-to-br from-brand-700 via-brand-500 to-cyan-500">
      {/* faint grid */}
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px,transparent 1px), linear-gradient(90deg,rgba(255,255,255,0.6) 1px,transparent 1px)',
          backgroundSize: '34px 34px',
        }}
      />
      {/* soft glow accents */}
      <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-cyan-300/20 blur-3xl" />

      <form onSubmit={submit} autoComplete="off" className="relative w-full max-w-[400px]">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/5">
          {/* accent bar */}
          <div className="h-1.5 bg-gradient-to-r from-brand-500 via-brand-400 to-cyan-500" />

          <div className="px-8 pt-8 pb-7">
            {/* Logo */}
            <div className="flex flex-col items-center text-center">
              <div className="h-16 w-16 rounded-2xl bg-white grid place-items-center shadow-[0_6px_20px_rgba(26,107,255,0.18)] ring-1 ring-ink-100">
                <img
                  src="/sanmati-logo.png"
                  alt="Sanmati"
                  className="h-11 w-11 object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.parentElement.innerHTML =
                      '<span style="font-weight:800;color:#1a6bff;font-size:18px">SP</span>';
                  }}
                />
              </div>
              <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.22em] text-brand-600">
                Production Management System
              </div>
              <h1 className="mt-1 text-[22px] font-bold text-ink-900 leading-tight">Sign in</h1>
              <p className="text-[12.5px] text-ink-500 mt-1">Welcome back. Access your factory control plane.</p>
            </div>

            {/* Inputs */}
            <div className="mt-7 space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-1.5">Username</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                  <input
                    className="input pl-9"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                  <input
                    className="input pl-9"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              {err && (
                <div className="rounded-lg bg-state-down/5 border border-state-down/20 px-3 py-2 text-[12.5px] text-state-down">
                  {err}
                </div>
              )}

              <button
                className="w-full justify-center inline-flex items-center gap-2 py-2.5 rounded-lg text-[13.5px] font-bold text-white bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-700 hover:to-brand-600 shadow-lg shadow-brand-500/25 transition disabled:opacity-60"
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                Sign in
              </button>
            </div>

            {/* Demo credentials — shown for reference, NOT pre-filled */}
            <div className="mt-6 rounded-xl border border-dashed border-ink-200 bg-ink-50/70 p-3">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-400 text-center mb-2">
                Demo login credentials
              </div>
              <CredRow label="Username" value="admin@example.com" />
              <div className="h-px bg-ink-200/70 my-1.5" />
              <CredRow label="Password" value="StrongP@ssw0rd" />
            </div>
          </div>
        </div>

        <div className="text-center text-[11px] text-white/70 mt-4">© Sanmati Packaging Pvt. Ltd.</div>
      </form>
    </div>
  );
}

function CredRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked — ignore */ }
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-ink-400 w-[62px] shrink-0">{label}</span>
      <code className="flex-1 font-mono text-[12px] font-semibold text-ink-800 truncate">{value}</code>
      <button
        type="button"
        onClick={copy}
        title={`Copy ${label.toLowerCase()}`}
        className="h-6 w-6 grid place-items-center rounded-md text-ink-400 hover:text-brand-600 hover:bg-white transition shrink-0"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-state-running" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
