// Farbschema: 'light' | 'dark' | 'system' (gespeichert im Browser, nur Komfort).
const KEY = 'stelecms.theme';

export function getThemePref() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export function setThemePref(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref);
  } catch { /* Speicher nicht verfügbar – gilt nur für diese Sitzung */ }
  if (pref === 'light' || pref === 'dark') document.documentElement.setAttribute('data-theme', pref);
  else document.documentElement.removeAttribute('data-theme');
}

export const THEME_OPTIONS = [
  { value: 'light', label: 'Hell', icon: 'sun' },
  { value: 'dark', label: 'Dunkel', icon: 'moon' },
  { value: 'system', label: 'Wie System', icon: 'settings' },
];
