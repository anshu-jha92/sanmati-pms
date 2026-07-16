import { useState, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  User as UserIcon, Palette, Info, Camera, Trash2, Sun, Moon, Pencil, Check,
  Mail, Shield, Building2, Clock, KeyRound, X,
} from 'lucide-react';
import { authApi } from '../api/endpoints.js';
import { authStore } from '../context/authStore.js';
import { ErrorNote } from '../components/ui/Primitives.jsx';
import { resolveTheme, setTheme } from '../lib/theme.js';

const TABS = [
  { key: 'profile', label: 'Profile & Account', icon: UserIcon },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'about', label: 'About', icon: Info },
];

export function SettingsPage() {
  const [tab, setTab] = useState('profile');
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState('');
  const user = authStore((s) => s.user);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-ink-500">Preferences &amp; account — appearance is saved on this device; profile changes save to your account.</p>
      </header>

      {toast && (
        <div className="rounded-lg bg-state-running/10 border border-state-running/25 px-4 py-2.5 text-sm text-state-running font-semibold flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0" /> {toast}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 items-start">
        {/* Sub-nav */}
        <nav className="card p-1.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition text-left ${
                  active ? 'bg-brand-500/10 text-brand-600 font-semibold' : 'text-ink-600 hover:bg-ink-50'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" /> {t.label}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div className="space-y-4">
          {tab === 'profile' && <ProfileSection user={user} onEdit={() => setEditing(true)} />}
          {tab === 'appearance' && <AppearanceSection />}
          {tab === 'about' && <AboutSection user={user} />}
        </div>
      </div>

      {editing && (
        <EditProfileModal
          user={user}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setToast('Profile updated ✓'); }}
        />
      )}
    </div>
  );
}

/* ── Avatar ──────────────────────────────────────────────────────────────── */
function Avatar({ src, name, size = 56 }) {
  const initial = (name?.[0] || '?').toUpperCase();
  if (src) {
    return <img src={src} alt={name || 'avatar'} className="rounded-full object-cover border border-ink-200" style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-full bg-brand-500/10 text-brand-600 font-bold grid place-items-center border border-ink-200"
      style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initial}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold text-ink-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-[13.5px] font-medium text-ink-900">{children}</div>
    </div>
  );
}

/* ── Profile & Account ───────────────────────────────────────────────────── */
function ProfileSection({ user, onEdit }) {
  const role = user?.roleNames?.[0] || user?.roleSlugs?.[0] || '—';
  const lastLogin = user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—';
  return (
    <div className="card">
      <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-500/10 text-brand-600"><UserIcon className="h-4 w-4" /></span>
          <div>
            <h2 className="text-[15px] font-bold text-ink-900">My profile</h2>
            <p className="text-[12px] text-ink-500">Personalise how you appear. Your account is managed centrally.</p>
          </div>
        </div>
        <button className="btn-secondary text-xs" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit Profile</button>
      </div>
      <div className="p-5 flex items-start gap-5 flex-wrap">
        <Avatar src={user?.avatar} name={user?.name} size={72} />
        <div className="flex-1 min-w-[240px] grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          <Field label="Name">{user?.name || '—'}</Field>
          <Field label="Email"><span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-ink-400" />{user?.email || '—'}</span></Field>
          <Field label="Role"><span className="inline-flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-ink-400" />{role}</span></Field>
          <Field label="Plant"><span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-ink-400" />{user?.plantId ? 'Assigned' : '—'}</span></Field>
          <Field label="Employee code">{user?.employeeCode || '—'}</Field>
          <Field label="Last login"><span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-ink-400" />{lastLogin}</span></Field>
        </div>
      </div>
    </div>
  );
}

/* ── Appearance ──────────────────────────────────────────────────────────── */
function AppearanceSection() {
  const [theme, setThemeState] = useState(resolveTheme);
  const choose = (t) => { setThemeState(t); setTheme(t); };
  return (
    <div className="card">
      <div className="px-5 py-4 border-b border-ink-100 flex items-center gap-2">
        <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-500/10 text-brand-600"><Palette className="h-4 w-4" /></span>
        <div>
          <h2 className="text-[15px] font-bold text-ink-900">Appearance</h2>
          <p className="text-[12px] text-ink-500">Theme applies instantly across the whole app and is saved on this device.</p>
        </div>
      </div>
      <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[13.5px] font-semibold text-ink-900">Theme</div>
          <div className="text-[12px] text-ink-500">Light or dark interface</div>
        </div>
        <div className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-0.5">
          <button
            onClick={() => choose('light')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold transition ${theme === 'light' ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-800'}`}
          >
            <Sun className="h-3.5 w-3.5" /> Light
          </button>
          <button
            onClick={() => choose('dark')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold transition ${theme === 'dark' ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-800'}`}
          >
            <Moon className="h-3.5 w-3.5" /> Dark
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── About ───────────────────────────────────────────────────────────────── */
function AboutSection({ user }) {
  const rows = [
    ['Application', 'Sanmati — Production Monitor'],
    ['Version', '1.0.0'],
    ['Theme storage', 'Local (this device)'],
    ['Account', user?.name ? `Signed in as ${user.name}` : 'Managed centrally'],
  ];
  return (
    <div className="card">
      <div className="px-5 py-4 border-b border-ink-100 flex items-center gap-2">
        <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-500/10 text-brand-600"><Info className="h-4 w-4" /></span>
        <h2 className="text-[15px] font-bold text-ink-900">About</h2>
      </div>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
        {rows.map(([k, val]) => <Field key={k} label={k}>{val}</Field>)}
      </div>
    </div>
  );
}

/* ── Downscale an image file to a compact square avatar data URL ──────────── */
function fileToAvatar(file, max = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = max; canvas.height = max;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, max, max);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ── Edit profile modal — name, email, photo and password ────────────────── */
function EditProfileModal({ user, onClose, onSaved }) {
  const setUser = authStore((s) => s.setUser);
  const fileRef = useRef(null);
  const [form, setForm] = useState({ name: user?.name || '', email: user?.email || '' });
  const [avatar, setAvatar] = useState(user?.avatar || null); // data URL | null
  const [avatarTouched, setAvatarTouched] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  // Only treat password as "being changed" when a NEW password is entered — a
  // browser-autofilled current-password field must not block a name/email save.
  const wantsPassword = pw.next.length > 0 || pw.confirm.length > 0;
  const pwProblem = wantsPassword
    ? (pw.next.length < 8 ? 'New password must be at least 8 characters'
      : pw.next !== pw.confirm ? 'New passwords do not match'
      : !pw.current ? 'Enter your current password to confirm the change'
      : '')
    : '';
  // Enable Save as soon as anything actually changed (name, email, photo, or password).
  const dirty =
    form.name.trim() !== (user?.name || '') ||
    form.email.trim().toLowerCase() !== (user?.email || '') ||
    avatarTouched ||
    wantsPassword;
  const canSubmit = dirty && form.name.trim() && emailValid && !pwProblem;

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setErr('Please choose an image under 8 MB.'); return; }
    try {
      const dataUrl = await fileToAvatar(file);
      setAvatar(dataUrl); setAvatarTouched(true); setErr('');
    } catch (ex) { setErr(ex.message || 'Could not process that image.'); }
  };

  const mut = useMutation({
    mutationFn: async () => {
      const body = {};
      if (form.name.trim() !== (user?.name || '')) body.name = form.name.trim();
      if (form.email.trim().toLowerCase() !== (user?.email || '')) body.email = form.email.trim();
      if (avatarTouched) body.avatar = avatar; // null removes it
      if (pw.next) { body.currentPassword = pw.current; body.newPassword = pw.next; }
      if (Object.keys(body).length === 0) return { data: null };
      return adminUpdate(body);
    },
    onSuccess: async () => {
      // Pull the fresh principal so name/email/avatar update everywhere (sidebar too).
      try { const r = await authApi.me(); if (r?.data) setUser(r.data); } catch { /* ignore */ }
      onSaved();
    },
    onError: (e) => {
      if (e.code === 'E_BAD_PASSWORD') setErr('Your current password is incorrect.');
      else if (e.code === 'E_DUPLICATE') setErr('That email is already in use.');
      else setErr(e.message || 'Could not save your profile.');
    },
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 overflow-y-auto" onClick={mut.isPending ? undefined : onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); setErr(''); mut.mutate(); }}
        className="card w-full max-w-md p-6 space-y-4 my-8"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-500/10 text-brand-600"><UserIcon className="h-4 w-4" /></span>
            <div>
              <h2 className="text-[15px] font-bold text-ink-900">Edit profile</h2>
              <p className="text-[11.5px] text-ink-500">Name, email &amp; photo update everywhere you appear.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-700 p-1"><X className="h-4 w-4" /></button>
        </div>

        {/* Photo */}
        <div className="flex items-center gap-4">
          <Avatar src={avatar} name={form.name} size={64} />
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => fileRef.current?.click()}>
              <Camera className="h-3.5 w-3.5" /> Change photo
            </button>
            <button
              type="button"
              disabled={!avatar}
              className="btn-secondary text-xs text-state-down disabled:opacity-40 disabled:cursor-not-allowed"
              title={avatar ? 'Remove photo' : 'No photo to remove'}
              onClick={() => { setAvatar(null); setAvatarTouched(true); }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
          </div>
        </div>

        <label className="block"><span className="label">Full name</span>
          <input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="block"><span className="label">Email</span>
          <input required type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          {form.email && !emailValid && <div className="text-[10px] mt-1 text-state-down">Enter a valid email address</div>}
        </label>

        {/* Password */}
        <div className="border-t border-ink-100 pt-3">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-700 mb-2"><KeyRound className="h-3.5 w-3.5 text-ink-400" /> Change password <span className="font-normal text-ink-400">— optional</span></div>
          <div className="space-y-2">
            <input type="password" autoComplete="off" className="input" placeholder="Current password"
              value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            <input type="password" autoComplete="new-password" className="input" placeholder="New password (min 8 chars)"
              value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <input type="password" autoComplete="new-password" className="input" placeholder="Confirm new password"
              value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          {pwProblem && <div className="text-[10.5px] mt-1.5 text-state-down">{pwProblem}</div>}
        </div>

        <ErrorNote message={err} />

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={mut.isPending}>Cancel</button>
          <button type="submit" disabled={!canSubmit || mut.isPending}
            className={`btn-primary ${(!canSubmit || mut.isPending) ? '!bg-ink-200 !text-ink-400 cursor-not-allowed pointer-events-none' : ''}`}>
            <Check className="h-4 w-4" /> {mut.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

// Small indirection so the mutation reads clearly above.
function adminUpdate(body) { return authApi.updateProfile(body); }
