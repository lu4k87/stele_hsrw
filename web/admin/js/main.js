// Einstieg der Admin-Oberfläche: Sitzung laden, Anmeldung oder App-Rahmen zeigen, Routen einhängen.
import { h } from './dom.js';
import { bus } from './bus.js';
import { session, loadSession, applySession } from './session.js';
import { setRoutes, startRouter, matchRoute, parseLocation, setDirty } from './router.js';
import { ROUTES } from './routes.js';
import { createShell, permOk } from './shell.js';
import { renderLogin } from './views/login.js';
import { startIdleWatch } from './idle.js';
import { openPasswordDialog } from './account.js';
import { page, pageHeader, card, button } from './ui/page.js';
import { emptyState, errorState } from './ui/empty.js';
import { toast } from './ui/toast.js';

const appEl = document.getElementById('app');
let shell = null;
let stopIdle = null;
let loginNotice = null;
let passwordPromptOpen = false;

setRoutes(ROUTES);

function teardownShell() {
  if (stopIdle) { stopIdle(); stopIdle = null; }
  if (shell) { shell.destroy(); shell = null; }
}

async function render(loc = parseLocation()) {
  if (!session.authenticated) {
    teardownShell();
    renderLogin(appEl, {
      notice: loginNotice,
      onSuccess: () => { loginNotice = null; render(); },
    });
    return;
  }

  if (!shell) {
    shell = createShell();
    appEl.replaceChildren(shell.el);
    stopIdle = startIdleWatch();
  }

  if (session.user?.must_change_password && !passwordPromptOpen) {
    passwordPromptOpen = true;
    openPasswordDialog({ forced: true }).finally(() => { passwordPromptOpen = false; });
  }

  const match = matchRoute(loc.path);
  if (!match) {
    shell.showPage(page({},
      pageHeader({ title: 'Seite nicht gefunden' }),
      card({ body: emptyState({ icon: 'help-circle', title: 'Diese Seite gibt es nicht', text: 'Der Link ist veraltet oder falsch geschrieben.', actions: [button({ label: 'Zur Übersicht', icon: 'dashboard', variant: 'primary', href: '#/' })] }) }),
    ), null, 'Nicht gefunden');
    return;
  }
  if (!permOk(match.route.perm)) {
    shell.showPage(page({},
      pageHeader({ title: match.route.title }),
      card({ body: emptyState({ icon: 'lock', title: 'Keine Berechtigung', text: 'Für diesen Bereich fehlt Ihrer Rolle das nötige Recht. Eine Administratorin oder ein Administrator kann es unter „Rollen & Rechte“ vergeben.', actions: [button({ label: 'Zur Übersicht', icon: 'dashboard', href: '#/' })] }) }),
    ), match.route, match.route.title);
    return;
  }
  shell.mountView(match, loc.query);
}

// Sitzung abgelaufen (401 oder Leerlauf) → zur Anmeldung, Ziel-URL bleibt erhalten
bus.on('session:expired', () => {
  if (!session.authenticated) return;
  setDirty(false);
  applySession({ authenticated: false });
  loginNotice = { kind: 'warning', text: 'Sitzung abgelaufen – bitte erneut anmelden. Nicht gespeicherte Eingaben sind leider verloren.' };
  render();
});
bus.on('session:changed-auth', () => render());

async function boot() {
  try {
    await loadSession();
  } catch (err) {
    appEl.replaceChildren(h('div', { class: 'page page--narrow', style: { paddingTop: '10vh' } },
      card({ body: errorState({ title: 'Server nicht erreichbar', error: err, onRetry: () => { appEl.replaceChildren(); boot(); } }) })));
    return;
  }
  startRouter((loc) => render(loc));
}

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'AbortError') { e.preventDefault(); return; }
  console.error(e.reason);
  toast.error('Unerwarteter Fehler. Bitte die Seite neu laden, falls etwas nicht mehr reagiert.');
});

boot();
