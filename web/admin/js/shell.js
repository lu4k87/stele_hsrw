// App-Rahmen: Seitenleiste (Navigation nach Rechten, Badges), Kopfleiste (Brotkrumen, Testbetrieb,
// Stelen-Status, Benutzer-Menü) und das Einhängen der Ansichten mit sauberem Auf- und Abbau.
import { h, initials } from './dom.js';
import { icon } from './icons.js';
import { NAV } from './routes.js';
import { session, can, canAny, logout } from './session.js';
import { api } from './api.js';
import { bus } from './bus.js';
import { navigate, setDirty, setQuery, confirmLeave } from './router.js';
import { openMenu, closeMenu } from './ui/menu.js';
import { openDialog } from './ui/dialog.js';
import { toast } from './ui/toast.js';
import { loadingBlock, errorState, emptyState } from './ui/empty.js';
import { page, pageHeader, card } from './ui/page.js';
import { getThemePref, setThemePref, THEME_OPTIONS } from './theme.js';
import { openPasswordDialog } from './account.js';
import { formatRelative } from './format.js';

const COLLAPSE_KEY = 'stelecms.nav.collapsed';
const POLL_MS = 20000;

export function permOk(perm) {
  if (!perm) return true;
  return Array.isArray(perm) ? canAny(...perm) : can(perm);
}

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}
function writeCollapsed(v) {
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* egal */ }
}

export function createShell() {
  const navLinks = new Map();
  const badgeState = { reviews: 0, offline: 0, alerts: 0, alertsKind: 'danger' };
  let pollTimer = null;
  let current = null;
  let mountToken = 0;
  let lastDashboard = null;

  // ---------- Seitenleiste ----------
  const collapseLabel = h('span', { class: 'sidebar__collapse-label' });
  const collapseIcon = h('span', { style: { display: 'contents' } });
  const collapseBtn = h('button', { type: 'button', class: 'sidebar__collapse' }, collapseIcon, collapseLabel);
  const navEl = h('nav', { class: 'sidebar__nav', 'aria-label': 'Hauptnavigation' });
  const sidebar = h('aside', { class: 'sidebar' },
    h('a', { class: 'sidebar__brand', href: '#/', title: 'Zur Übersicht' },
      h('span', { class: 'brand-mark' }, icon('stele')),
      h('span', { class: 'sidebar__brand-text' },
        h('span', { class: 'sidebar__brand-name' }, session.app.name || 'Stele CMS'),
        h('span', { class: 'sidebar__brand-org' }, session.app.org_name || 'Digitale Stele'),
      ),
    ),
    navEl,
    h('div', { class: 'sidebar__footer' }, collapseBtn),
  );

  function renderNav() {
    navLinks.clear();
    const link = (it) => {
      const a = h('a', { class: 'nav-link', href: it.href, title: it.label, dataset: { nav: it.id } },
        icon(it.icon), h('span', { class: 'nav-link__label' }, it.label));
      navLinks.set(it.id, { a, def: it });
      return h('li', {}, a);
    };
    const blocks = [];
    for (const entry of NAV) {
      if (entry.group) {
        const items = entry.items.filter((it) => permOk(it.perm));
        if (!items.length) continue;
        const gid = `nav-${entry.group}`;
        blocks.push(h('div', { class: 'nav-group' },
          h('div', { class: 'nav-group__label', id: gid }, entry.group),
          h('ul', { class: 'nav-list', 'aria-labelledby': gid }, items.map(link))));
      } else if (permOk(entry.perm)) {
        blocks.push(h('div', { class: 'nav-group' }, h('ul', { class: 'nav-list' }, link(entry))));
      }
    }
    navEl.replaceChildren(...blocks);
    applyBadges();
  }

  function setCollapsed(v) {
    app.classList.toggle('is-collapsed', v);
    writeCollapsed(v);
    collapseIcon.replaceChildren(icon(v ? 'chevrons-right' : 'chevrons-left'));
    collapseLabel.textContent = v ? 'Leiste ausklappen' : 'Leiste einklappen';
    collapseBtn.title = v ? 'Leiste ausklappen' : 'Leiste einklappen';
    collapseBtn.setAttribute('aria-expanded', String(!v));
  }
  collapseBtn.addEventListener('click', () => setCollapsed(!app.classList.contains('is-collapsed')));

  // ---------- Kopfleiste ----------
  const menuBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--icon topbar__menu', 'aria-label': 'Navigation öffnen', 'aria-expanded': 'false' }, icon('menu'));
  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Brotkrumen' });
  const envBadge = h('button', { type: 'button', class: 'env-badge', title: 'Was bedeutet Testbetrieb?' },
    icon('info', { size: 16 }), h('span', { class: 'env-badge__text' }, 'Testbetrieb · lokal'));
  const stelePill = h('a', { class: 'stele-pill', href: '#/steles', hidden: true });
  const userBtn = h('button', { type: 'button', class: 'user-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  const topbar = h('header', { class: 'topbar' },
    menuBtn, crumbs,
    h('div', { class: 'topbar__right' }, envBadge, stelePill, userBtn),
  );

  envBadge.addEventListener('click', () => openDialog({
    title: 'Testbetrieb',
    size: 'sm',
    content: h('div', { class: 'stack' },
      h('p', {}, 'Das CMS läuft im lokalen Testbetrieb:'),
      h('ul', { class: 'stack stack--sm' },
        h('li', {}, 'Erreichbar nur auf diesem Rechner (localhost).'),
        h('li', {}, 'Die Anmeldung kann über Demo-Konten simuliert werden (Schnellanmeldung).'),
        h('li', {}, 'Netzwerkzugriff, HTTPS und die endgültige Anmeldung werden später eingerichtet.')),
      can('settings.manage') ? h('p', { class: 'text-2' }, 'Die Schnellanmeldung lässt sich unter Einstellungen → Sicherheit abschalten.') : null,
    ),
    actions: [
      can('settings.manage') ? { label: 'Zu den Einstellungen', onClick: () => { navigate('/settings'); } } : null,
      { label: 'Verstanden', variant: 'primary' },
    ].filter(Boolean),
  }));

  function renderUser() {
    const u = session.user || {};
    userBtn.replaceChildren(
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(u.display_name || u.username)),
      h('span', { class: 'user-button__text' },
        h('span', { class: 'user-button__name' }, u.display_name || u.username || ''),
        h('span', { class: 'user-button__role' }, u.role?.name || '')),
      icon('chevron-down'),
    );
    userBtn.setAttribute('aria-label', `Benutzer-Menü: ${u.display_name || u.username || ''}`);
  }
  userBtn.addEventListener('click', () => {
    const u = session.user || {};
    const pref = getThemePref();
    openMenu(userBtn, [
      { heading: `${u.display_name || u.username} · ${u.role?.name || ''}` },
      { label: 'Profil', icon: 'user', href: '#/profile' },
      { label: 'Passwort ändern', icon: 'key', onClick: () => openPasswordDialog() },
      { separator: true },
      { heading: 'Darstellung' },
      ...THEME_OPTIONS.map((t) => ({ label: t.label, icon: t.icon, checked: pref === t.value, onClick: () => setThemePref(t.value) })),
      { separator: true },
      { label: 'Abmelden', icon: 'log-out', onClick: () => doLogout() },
    ]);
  });

  async function doLogout() {
    if (!(await confirmLeave())) return;
    await logout();
    toast.info('Abgemeldet.');
    bus.emit('session:changed-auth');
  }
  const offLogoutReq = bus.on('session:logout-request', () => doLogout());

  // ---------- Inhalt ----------
  const content = h('main', { class: 'content', id: 'main', tabindex: '-1' });
  const scrim = h('div', { class: 'scrim', 'aria-hidden': 'true' });
  const skip = h('button', { type: 'button', class: 'skip-link', onClick: () => content.focus() }, 'Zum Inhalt springen');
  const app = h('div', { class: 'app' }, skip, sidebar, h('div', { class: 'main' }, topbar, content), scrim);

  const setNavOpen = (open) => {
    app.classList.toggle('nav-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Navigation schließen' : 'Navigation öffnen');
  };
  menuBtn.addEventListener('click', () => setNavOpen(!app.classList.contains('nav-open')));
  scrim.addEventListener('click', () => setNavOpen(false));
  navEl.addEventListener('click', (e) => { if (e.target.closest('a')) setNavOpen(false); });
  app.addEventListener('keydown', (e) => { if (e.key === 'Escape' && app.classList.contains('nav-open')) setNavOpen(false); });

  // ---------- Badges und Stelen-Status (Polling) ----------
  function applyBadges() {
    for (const [, { a, def }] of navLinks) {
      a.querySelector('.badge')?.remove();
      if (!def.badge) continue;
      let n = 0;
      let kind = 'danger';
      let label = '';
      if (def.badge === 'reviews') { n = badgeState.reviews; kind = 'info'; label = `${n} Freigabe${n === 1 ? '' : 'n'} offen`; }
      if (def.badge === 'offline') { n = badgeState.offline; label = `${n} Stele${n === 1 ? '' : 'n'} offline`; }
      if (def.badge === 'alerts') { n = badgeState.alerts; kind = badgeState.alertsKind; label = `${n} Warnung${n === 1 ? '' : 'en'}`; }
      if (n > 0) {
        a.append(h('span', { class: ['badge', kind !== 'danger' && `badge--${kind}`], title: label }, String(n), h('span', { class: 'visually-hidden' }, ` – ${label}`)));
      }
    }
  }

  function renderStelePill(steles) {
    if (!Array.isArray(steles) || !steles.length) { stelePill.hidden = true; return; }
    stelePill.hidden = false;
    stelePill.href = can('monitoring.view') ? '#/monitoring' : '#/steles';
    const offline = steles.filter((s) => s.status === 'offline' || s.status === 'never');
    let cls = 'online';
    let name;
    let state;
    if (steles.length === 1) {
      const s = steles[0];
      name = s.name;
      state = { online: 'Online', offline: 'Offline', standby: 'Nachtmodus', never: 'Nicht verbunden' }[s.status] || 'Unbekannt';
      cls = { online: 'online', offline: 'offline', standby: 'standby', never: 'warning' }[s.status] || 'warning';
      stelePill.title = s.last_seen_at ? `${s.name}: zuletzt gemeldet ${formatRelative(s.last_seen_at)}` : `${s.name}: noch nie gemeldet`;
    } else {
      name = `${steles.length} Stelen`;
      state = offline.length ? `${offline.length} offline` : 'alle online';
      cls = offline.length ? 'offline' : 'online';
      stelePill.title = steles.map((s) => `${s.name}: ${s.status}`).join('\n');
    }
    stelePill.className = `stele-pill stele-pill--${cls}`;
    stelePill.replaceChildren(
      h('span', { class: ['dot', cls === 'online' && 'dot--pulse'], 'aria-hidden': 'true' }),
      icon('stele'),
      h('span', { class: 'stele-pill__name' }, name),
      h('span', { class: 'stele-pill__state' }, state),
    );
    stelePill.setAttribute('aria-label', `Stelen-Status: ${name}, ${state}`);
  }

  async function poll() {
    if (!session.authenticated || document.hidden) return;
    try {
      const d = await api.get('/api/dashboard', { background: true });
      lastDashboard = d;
      badgeState.reviews = can('presentations.publish') && Array.isArray(d.reviews) ? d.reviews.length : 0;
      badgeState.offline = Array.isArray(d.steles) ? d.steles.filter((s) => s.status === 'offline').length : 0;
      const alerts = Array.isArray(d.alerts) ? d.alerts : [];
      const errors = alerts.filter((a) => a.level === 'error').length;
      badgeState.alerts = can('monitoring.view') ? (errors || alerts.length) : 0;
      badgeState.alertsKind = errors ? 'danger' : 'warning';
      applyBadges();
      renderStelePill(can('steles.view') ? d.steles : null);
      bus.emit('dashboard:update', d);
    } catch { /* Hintergrundabfrage – Fehler zeigt die jeweilige Ansicht */ }
  }
  const onVisible = () => { if (!document.hidden) poll(); };
  document.addEventListener('visibilitychange', onVisible);
  const offNavRefresh = bus.on('nav:refresh', () => poll());

  // ---------- Brotkrumen / Titel ----------
  function setCrumbs(route, title) {
    const parts = [];
    if (route.group) parts.push(h('span', {}, route.group), icon('chevron-right'));
    if (route.parent) parts.push(h('a', { href: route.parent.href }, route.parent.label), icon('chevron-right'));
    parts.push(h('span', { class: 'crumbs__current', 'aria-current': 'page' }, title));
    crumbs.replaceChildren(...parts);
    document.title = `${title} · ${session.app.name || 'Stele CMS'}`;
  }

  function setActiveNav(id) {
    for (const [nid, { a }] of navLinks) {
      if (nid === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  }

  // ---------- Ansichten ----------
  function teardown() {
    if (!current) return;
    current.abort.abort();
    try { current.cleanup?.(); } catch (err) { console.error('Fehler beim Verlassen der Ansicht', err); }
    current = null;
  }

  function showPage(node, route, title) {
    teardown();
    mountToken += 1;
    setActiveNav(route?.nav || null);
    setCrumbs(route || {}, title);
    content.replaceChildren(node);
  }

  async function mountView(match, query) {
    teardown();
    setDirty(false);
    closeMenu();
    const token = ++mountToken;
    const { route, params } = match;
    setActiveNav(route.nav);
    setCrumbs(route, route.title);
    content.replaceChildren(loadingBlock());
    window.scrollTo(0, 0);

    let mod;
    try {
      mod = await route.load();
    } catch (err) {
      if (token !== mountToken) return;
      console.warn(`Ansicht für ${route.path} nicht geladen`, err);
      content.replaceChildren(page({},
        pageHeader({ title: route.title }),
        card({ body: emptyState({ icon: 'settings', title: 'Diese Ansicht ist noch nicht verfügbar', text: 'Sie wird gerade fertiggestellt. Bitte später erneut öffnen.' }) })));
      return;
    }
    if (token !== mountToken) return;

    const root = h('div', { class: 'view' });
    content.replaceChildren(root);
    const abort = new AbortController();
    current = { abort, cleanup: null };
    const ctx = {
      params,
      query,
      route,
      signal: abort.signal,
      navigate,
      setQuery,
      setDirty,
      setTitle: (title) => { if (token === mountToken) setCrumbs(route, title); },
      refreshNav: () => poll(),
      get dashboard() { return lastDashboard; },
    };
    try {
      const fn = mod.default || mod.mount;
      const cleanup = await fn(root, ctx);
      if (token === mountToken) current.cleanup = typeof cleanup === 'function' ? cleanup : null;
      else if (typeof cleanup === 'function') cleanup();
    } catch (err) {
      if (token !== mountToken || err?.name === 'AbortError') return;
      console.error(err);
      root.replaceChildren(page({}, pageHeader({ title: route.title }), card({ body: errorState({ error: err, onRetry: () => mountView(match, query) }) })));
    }
  }

  // ---------- Start ----------
  function refreshUser() {
    renderUser();
    renderNav();
    envBadge.hidden = !session.app.test_mode;
    sidebar.querySelector('.sidebar__brand-org').textContent = session.app.org_name || 'Digitale Stele';
  }
  const offSession = bus.on('session:changed', () => { if (session.authenticated) refreshUser(); });

  setCollapsed(readCollapsed());
  refreshUser();
  poll();
  pollTimer = setInterval(poll, POLL_MS);

  return {
    el: app,
    content,
    mountView,
    showPage,
    setActiveNav,
    destroy() {
      teardown();
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
      offNavRefresh();
      offSession();
      offLogoutReq();
      app.remove();
    },
  };
}
