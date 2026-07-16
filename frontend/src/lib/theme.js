/**
 * Theme (light/dark) — stored on this device only (localStorage), applied by
 * toggling a `dark` class on <html>. Because the Tailwind palette is driven by
 * CSS variables, flipping that class re-themes the whole app instantly.
 */
const KEY = 'pa.theme';

export function getStoredTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'dark' || t === 'light' ? t : null;
  } catch {
    return null;
  }
}

/** Resolve the theme to apply: the saved preference, else light by default. */
export function resolveTheme() {
  return getStoredTheme() || 'light';
}

export function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
}

/** Run once at boot, before React renders, so there's no light→dark flash. */
export function initTheme() {
  applyTheme(resolveTheme());
}
