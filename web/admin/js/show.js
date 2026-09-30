// Vorführseite /admin/show-stele-index.html: Backend zeigen (Rundgang), Info-Folie + Präsentation anlegen,
// UI-Bausteine ausprobieren. Gleiche Sitzung, gleiche API und gleiche Bausteine wie die Admin-Oberfläche.
import { h, mount as fill, initials } from './dom.js';
import { bus } from './bus.js';
import { session, loadSession, applySession, devLogin, logout } from './session.js';
import { icon } from './icons.js';
import { errorMessage } from './api.js';
import { page, pageHeader, card, button } from './ui/page.js';
import { emptyState, errorState } from './ui/empty.js';
import { toast } from './ui/toast.js';
import { initZoom } from './zoom.js';
import { toggleTheme, getEffectiveTheme, onThemeChange } from './theme.js';
import { renderTour } from './show/tour.js';
import { renderQuickCreate } from './show/quick-create.js';
import { renderGallery } from './show/gallery.js';
import { externalLink } from './show/common.js';

const appEl = document.getElementById('app');
let cleanups = [];
let ctrl = null;

initZoom();

function teardown() {
  ctrl?.abort();
  ctrl = new AbortController();
  for (const fn of cleanups) { try { fn(); } catch { /* Aufräumen darf nicht scheitern */ } }
  cleanups = [];
}

function themeButton() {
  const btn = h('button', { type: 'button', class: 'btn btn--ghost btn--icon' });
  const update = (t) => {
    const next = t === 'dark' ? 'Hell' : 'Dunkel';
    btn.setAttribute('aria-label', `Zu ${next} wechseln`);
    btn.title = `Zu ${next} wechseln`;
    btn.replaceChildren(icon(t === 'dark' ? 'sun' : 'moon'));
  };
  btn.addEventListener('click', toggleTheme);
  update(getEffectiveTheme());
  cleanups.push(onThemeChange(update));
  return btn;
}

function topbar() {
  const u = session.user;
  const nav = session.authenticated
    ? h('nav', { class: 'show-top__nav', 'aria-label': 'Abschnitte' },
      [['#rundgang', 'Rundgang', 'map'], ['#anlegen', 'Folie anlegen', 'plus'], ['#bausteine', 'UI-Bausteine', 'layers']]
        .map(([href, label, ic]) => h('a', { class: 'btn btn--ghost', href }, icon(ic), label)))
    : null;
  return h('header', { class: 'show-top' },
    h('a', { class: 'show-top__brand', href: '#top' },
      h('span', { class: 'show-top__mark', 'aria-hidden': 'true' }, icon('stele')),
      h('span', { class: 'show-top__brand-text' },
        h('span', { class: 'show-top__name' }, session.app.name || 'Stele CMS'),
        h('span', { class: 'show-top__sub' }, 'Vorführung'))),
    nav,
    h('div', { class: 'show-top__end' },
      u ? h('span', { class: 'show-top__user' },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(u.display_name || u.username)),
        h('span', { class: 'show-top__user-text' },
          h('span', { class: 'truncate fw-semibold' }, u.display_name || u.username),
          h('span', { class: 'truncate text-sm text-2' }, u.role?.name || ''))) : null,
      themeButton(),
      externalLink({ href: '/admin/', label: 'Admin öffnen', icon: 'external-link' }),
      u ? button({ label: 'Abmelden', icon: 'log-out', variant: 'ghost', onClick: doLogout }) : null,
    ),
  );
}

async function doLogout() {
  try { await logout(); } catch (err) { toast.error(errorMessage(err)); }
  render();
}

function loginCard() {
  const dev = session.devLogin?.enabled ? session.devLogin.users || [] : [];
  const buttons = dev.map((u) => h('button', {
    type: 'button', class: 'show-login__user',
    onClick: async (e) => {
      const b = e.currentTarget;
      b.setAttribute('aria-busy', 'true');
      try {
        await devLogin(u.username);
        toast.success(`Angemeldet als ${u.display_name}.`);
        render();
      } catch (err) {
        b.removeAttribute('aria-busy');
        toast.error(errorMessage(err));
      }
    },
  },
  h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(u.display_name || u.username)),
  h('span', { class: 'stack', style: { '--stack-gap': '0' } },
    h('span', { class: 'fw-semibold' }, u.display_name),
    h('span', { class: 'text-sm text-2' }, u.role_name))));

  return card({
    title: 'Anmelden',
    icon: 'log-in',
    subtitle: 'Die Vorführung nutzt dieselbe Anmeldung wie die Admin-Oberfläche.',
    body: dev.length
      ? h('div', { class: 'stack' },
        h('p', { class: 'text-2' }, 'Schnellanmeldung mit einem Demo-Konto (nur im Testbetrieb auf diesem Rechner):'),
        h('div', { class: 'show-login__grid' }, buttons))
      : emptyState({
        icon: 'lock',
        title: 'Nicht angemeldet',
        text: 'Bitte in der Admin-Oberfläche anmelden und diese Seite danach neu laden.',
        actions: [button({ label: 'Zur Anmeldung', icon: 'log-in', variant: 'primary', href: '/admin/' })],
      }),
  });
}

function render() {
  teardown();
  const signal = ctrl.signal;
  const onCleanup = (fn) => cleanups.push(fn);

  if (!session.authenticated) {
    fill(appEl, topbar(), h('main', { id: 'top', class: 'show-main' }, page({ narrow: true },
      pageHeader({ title: 'Stele CMS vorführen', description: 'Backend zeigen, Folien anlegen und alle Bedienelemente ausprobieren.' }),
      loginCard())));
    return;
  }

  fill(appEl, topbar(), h('main', { id: 'top', class: 'show-main' }, page({},
    pageHeader({
      title: 'Stele CMS vorführen',
      description: 'Rundgang durch alle Bereiche, eine Info-Folie samt Präsentation anlegen und die Bedienelemente ausprobieren. Links öffnen die Admin-Oberfläche in einem neuen Tab – diese Seite bleibt offen.',
    }),
    renderTour({ signal, onCleanup }),
    renderQuickCreate({ signal, onCleanup }),
    renderGallery({ signal, onCleanup }),
  )));
}

// Sitzung abgelaufen → zurück zur Anmeldung
bus.on('session:expired', () => {
  if (!session.authenticated) return;
  applySession({ authenticated: false });
  toast.warning('Sitzung abgelaufen – bitte erneut anmelden.');
  loadSession().catch(() => {}).finally(render);
});

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'AbortError') { e.preventDefault(); return; }
  console.error(e.reason);
  toast.error('Unerwarteter Fehler. Bitte die Seite neu laden, falls etwas nicht mehr reagiert.');
});

async function boot() {
  try {
    await loadSession();
  } catch (err) {
    fill(appEl, h('div', { class: 'page page--narrow', style: { paddingTop: '10vh' } },
      card({ body: errorState({ title: 'Server nicht erreichbar', error: err, onRetry: boot }) })));
    return;
  }
  render();
}

boot();
