// Farbschema: 'light' | 'dark' | 'system' (gespeichert im Browser, nur Komfort).
const KEY = 'stelecms.theme';
const listeners = new Set();
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePref() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

/** Tatsächlich sichtbares Schema ('light' | 'dark'), auch bei „Wie System“. */
export function getEffectiveTheme() {
  const pref = getThemePref();
  if (pref === 'light' || pref === 'dark') return pref;
  return systemDark.matches ? 'dark' : 'light';
}

export function setThemePref(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref);
  } catch { /* Speicher nicht verfügbar – gilt nur für diese Sitzung */ }
  if (pref === 'light' || pref === 'dark') document.documentElement.setAttribute('data-theme', pref);
  else document.documentElement.removeAttribute('data-theme');
  notify();
}

/** Zwischen Hell und Dunkel umschalten (ausgehend vom sichtbaren Schema). */
export function toggleTheme() {
  setThemePref(getEffectiveTheme() === 'dark' ? 'light' : 'dark');
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  const t = getEffectiveTheme();
  for (const fn of listeners) fn(t);
}

systemDark.addEventListener('change', () => { if (getThemePref() === 'system') notify(); });

export const THEME_OPTIONS = [
  { value: 'light', label: 'Hell', icon: 'sun' },
  { value: 'dark', label: 'Dunkel', icon: 'moon' },
  { value: 'system', label: 'Wie System', icon: 'settings' },
];
