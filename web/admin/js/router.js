// Hash-Router (#/pfad?x=1) mit Parametern (:id) und Schutz vor ungespeicherten Änderungen.
import { confirmDialog } from './ui/dialog.js';

let routes = [];
let onChange = null;
let dirty = null;
let currentHash = location.hash;

export function setRoutes(list) {
  routes = list.map((r) => {
    const keys = [];
    const pattern = r.path.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; });
    return { ...r, keys, re: new RegExp(`^${pattern}/?$`) };
  });
}

export function parseLocation() {
  const raw = decodeURI(location.hash.replace(/^#/, '')) || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function matchRoute(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

/** '#/pfad?x=1' aus Pfad + Query-Objekt. */
export function href(path, query = null) {
  const q = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined && v !== '')).toString() : '';
  return `#${path}${q ? `?${q}` : ''}`;
}

export function navigate(path, { query = null, replace = false } = {}) {
  const target = path.startsWith('#') ? path : href(path, query);
  if (replace) {
    history.replaceState(null, '', target);
    handle();
  } else if (location.hash === target) {
    handle();
  } else {
    location.hash = target;
  }
}

/** Query-Parameter der aktuellen Seite ändern, ohne die Ansicht neu aufzubauen. */
export function setQuery(query, { replace = true } = {}) {
  const { path, query: current } = parseLocation();
  const next = href(path, { ...current, ...query });
  if (replace) history.replaceState(null, '', next); else history.pushState(null, '', next);
  currentHash = location.hash;
}

/** Ungespeicherte Änderungen melden: setDirty('Die Präsentation hat ungespeicherte Änderungen.') / setDirty(false). */
export function setDirty(message) {
  dirty = message ? { message: message === true ? 'Es gibt ungespeicherte Änderungen. Beim Verlassen gehen sie verloren.' : message } : null;
}
export function isDirty() { return !!dirty; }

/** Vor dem Verlassen fragen (auch für eigene Aktionen wie Abmelden). Liefert true, wenn fortgefahren werden darf. */
export async function confirmLeave() {
  if (!dirty) return true;
  const ok = await confirmDialog({
    title: 'Ungespeicherte Änderungen verwerfen?',
    message: dirty.message,
    confirmLabel: 'Verwerfen und verlassen',
    cancelLabel: 'Hier bleiben',
    danger: true,
    icon: 'log-out',
  });
  if (ok) dirty = null;
  return ok;
}

function handle() {
  currentHash = location.hash;
  if (onChange) onChange(parseLocation());
}

export function startRouter(callback) {
  onChange = callback;
  window.addEventListener('hashchange', async () => {
    if (location.hash === currentHash) return;
    if (dirty) {
      const target = location.hash;
      history.replaceState(null, '', currentHash || '#/');
      if (!(await confirmLeave())) return;
      history.replaceState(null, '', target);
    }
    handle();
  });
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
  handle();
}
