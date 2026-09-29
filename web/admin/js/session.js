// Sitzung: angemeldeter Benutzer, effektive Rechte, App-Infos. can('presentations.publish') prüft Rechte.
import { api, setCsrfToken } from './api.js';
import { bus } from './bus.js';

export const session = {
  authenticated: false,
  user: null,
  permissions: new Set(),
  csrf: null,
  idleTimeoutS: 3600,
  devLogin: { enabled: false, users: [] },
  app: { name: 'Stele CMS', version: '', org_name: '', test_mode: false },
};

export function applySession(payload = {}) {
  session.authenticated = !!payload.authenticated;
  session.user = payload.user || null;
  session.permissions = new Set(payload.permissions || []);
  session.csrf = payload.csrf_token || null;
  session.idleTimeoutS = payload.idle_timeout_s || session.idleTimeoutS;
  if (payload.dev_login) session.devLogin = payload.dev_login;
  if (payload.app) session.app = { ...session.app, ...payload.app };
  setCsrfToken(session.csrf);
  bus.emit('session:changed', session);
  return session;
}

export async function loadSession() {
  return applySession(await api.get('/api/auth/session'));
}

export async function login(username, password) {
  return applySession(await api.post('/api/auth/login', { username, password }));
}

export async function devLogin(username) {
  return applySession(await api.post('/api/auth/dev-login', { username }));
}

export async function logout() {
  try {
    await api.post('/api/auth/logout');
  } finally {
    // Sitzungsdaten verwerfen, Testbetrieb-Infos neu holen (für die Anmeldeseite)
    applySession({ authenticated: false });
    try { await loadSession(); } catch { /* Server nicht erreichbar – Anmeldeseite zeigt Fehler */ }
  }
}

export function can(perm) { return session.permissions.has(perm); }
export function canAny(...perms) { return perms.some((p) => session.permissions.has(p)); }
export function canAll(...perms) { return perms.every((p) => session.permissions.has(p)); }
export function isAdmin() { return !!session.user?.role?.is_admin; }
