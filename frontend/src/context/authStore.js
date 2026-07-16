import { create } from 'zustand';

const STORAGE_KEY = 'pa.auth.v1';

function readPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePersisted(state) {
  try {
    const payload = { accessToken: state.accessToken, refreshToken: state.refreshToken, user: state.user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode — ignore */
  }
}

const initial = readPersisted() || { accessToken: null, refreshToken: null, user: null };

export const authStore = create((set, get) => ({
  ...initial,

  setSession: ({ accessToken, refreshToken, user }) => {
    set({ accessToken, refreshToken, user });
    writePersisted(get());
  },

  setTokens: ({ accessToken, refreshToken }) => {
    set({ accessToken, refreshToken });
    writePersisted(get());
  },

  setUser: (user) => {
    set({ user });
    writePersisted(get());
  },

  clear: () => {
    set({ accessToken: null, refreshToken: null, user: null });
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  },

  hasPerm: (module, action) => {
    const perms = get().user?.permissions || [];
    return (
      perms.includes('*:*') ||
      perms.includes(`${module}:*`) ||
      perms.includes(`${module}:${action}`)
    );
  },
}));
