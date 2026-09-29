// Anmeldeseite: Benutzername/Passwort, Sperr-Hinweis mit Countdown, Feststelltaste-Warnung,
// im Testbetrieb zusätzlich Schnellanmeldung mit Demo-Konten (nur lokal).
import { h, initials } from '../dom.js';
import { icon } from '../icons.js';
import { session, login, devLogin } from '../session.js';
import { ApiError, errorMessage } from '../api.js';

export function renderLogin(root, { notice = null, onSuccess } = {}) {
  document.title = `Anmelden · ${session.app.name || 'Stele CMS'}`;

  const alertBox = h('div', { class: 'alert', role: 'alert', hidden: true });
  const showAlert = (kind, text) => {
    alertBox.className = `alert alert--${kind}`;
    alertBox.replaceChildren(icon(kind === 'danger' ? 'alert-circle' : kind === 'warning' ? 'alert-triangle' : 'info'),
      h('div', { class: 'alert__body' }, h('div', {}, text)));
    alertBox.hidden = false;
  };
  if (notice) showAlert(notice.kind || 'info', notice.text);

  const user = h('input', { class: 'input', id: 'login-user', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const pass = h('input', { class: 'input', id: 'login-pass', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const toggle = h('button', { type: 'button', class: 'btn btn--secondary btn--icon', 'aria-label': 'Passwort anzeigen', title: 'Passwort anzeigen', 'aria-pressed': 'false' }, icon('eye'));
  toggle.addEventListener('click', () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
    toggle.title = toggle.getAttribute('aria-label');
    toggle.replaceChildren(icon(show ? 'eye-off' : 'eye'));
    pass.focus();
  });
  const caps = h('div', { class: 'login__caps', hidden: true, role: 'status' }, icon('alert-triangle'), 'Feststelltaste ist aktiv.');
  pass.addEventListener('keyup', (e) => { caps.hidden = !(e.getModifierState && e.getModifierState('CapsLock')); });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary btn--lg btn--block' }, icon('log-in'), 'Anmelden');

  let lockTimer = null;
  function lockCountdown(seconds) {
    clearInterval(lockTimer);
    let left = Math.max(1, Math.round(seconds));
    const tick = () => {
      if (left <= 0) {
        clearInterval(lockTimer);
        submit.disabled = false;
        showAlert('info', 'Die Sperre ist aufgehoben. Bitte erneut anmelden.');
        return;
      }
      const m = Math.floor(left / 60);
      const s = String(left % 60).padStart(2, '0');
      showAlert('danger', `Zu viele Fehlversuche – das Konto ist vorübergehend gesperrt. Erneut versuchen in ${m}:${s} min.`);
      left -= 1;
    };
    submit.disabled = true;
    tick();
    lockTimer = setInterval(tick, 1000);
  }

  const form = h('form', { class: 'login__form', novalidate: true },
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'login-user' }, 'Benutzername'), user),
    h('div', { class: 'field' },
      h('label', { class: 'field__label', for: 'login-pass' }, 'Passwort'),
      h('div', { class: 'input-group' }, pass, toggle),
      caps),
    submit,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!user.value.trim() || !pass.value) {
      showAlert('danger', 'Bitte Benutzername und Passwort eingeben.');
      (user.value.trim() ? pass : user).focus();
      return;
    }
    submit.setAttribute('aria-busy', 'true');
    try {
      await login(user.value.trim(), pass.value);
      clearInterval(lockTimer);
      onSuccess?.();
    } catch (err) {
      pass.value = '';
      if (err instanceof ApiError && err.code === 'account_locked') lockCountdown(err.details?.retry_after_s || 300);
      else showAlert('danger', errorMessage(err));
      pass.focus();
    } finally {
      submit.removeAttribute('aria-busy');
    }
  });

  // Schnellanmeldung im Testbetrieb
  let devBlock = null;
  if (session.devLogin?.enabled && session.devLogin.users?.length) {
    devBlock = h('section', { class: 'dev-login', 'aria-labelledby': 'dev-login-title' },
      h('div', { class: 'dev-login__head' }, icon('zap'),
        h('div', {},
          h('div', { class: 'dev-login__title', id: 'dev-login-title' }, 'Testbetrieb: Schnellanmeldung'),
          h('div', { class: 'dev-login__text' }, 'Mit einem Demo-Konto anmelden, um Rollen und Rechte auszuprobieren. Nur lokal verfügbar – die endgültige Anmeldung wird für den Netzwerkbetrieb eingerichtet.'))),
      h('div', { class: 'dev-login__grid' }, session.devLogin.users.map((u) => {
        const b = h('button', { type: 'button', class: 'dev-login__btn' },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(u.display_name)),
          h('span', { class: 'dev-login__who' },
            h('span', { class: 'dev-login__role' }, u.role_name),
            h('span', { class: 'dev-login__name' }, u.display_name)));
        b.setAttribute('aria-label', `Als ${u.role_name} anmelden (${u.display_name})`);
        b.addEventListener('click', async () => {
          b.setAttribute('aria-busy', 'true');
          try {
            await devLogin(u.username);
            onSuccess?.();
          } catch (err) {
            showAlert('danger', errorMessage(err));
          } finally {
            b.removeAttribute('aria-busy');
          }
        });
        return b;
      })),
    );
  }

  const brand = h('section', { class: 'login__brand', 'aria-label': 'Stele CMS' },
    h('div', { class: 'login__logo' }, h('span', { class: 'brand-mark' }, icon('stele')), session.app.name || 'Stele CMS'),
    h('div', { class: 'login__claim' },
      h('h1', {}, 'Inhalte für die digitale Stele'),
      h('p', {}, 'Präsentationen gestalten, planen und veröffentlichen – mit Blick auf den Live-Zustand der Stele.')),
    h('div', { class: 'login__art', 'aria-hidden': 'true' },
      h('div', { class: 'mini-stele' },
        h('div', { class: 'mini-stele__screen' },
          h('div', { class: 'mini-stele__head' }, h('span'), h('span')),
          h('div', { class: 'mini-stele__slide' }, h('i'), h('i'), h('i'), h('b'), h('b')),
          h('div', { class: 'mini-stele__foot' }, h('span'))),
        h('div', { class: 'mini-stele__pole' }),
        h('div', { class: 'mini-stele__base' }))),
    h('ul', { class: 'login__features' },
      h('li', {}, icon('images'), 'Bilder, Videos, PDFs, Info-Folien und Webseiten'),
      h('li', {}, icon('calendar-clock'), 'Zeitpläne und Freigaben'),
      h('li', {}, icon('activity'), 'Monitoring der Stelen in Echtzeit')),
  );

  const panel = h('section', { class: 'login__panel' },
    h('div', { class: 'login__card' },
      h('div', { class: 'login__head' },
        h('h2', {}, 'Anmelden'),
        h('p', {}, session.app.org_name ? `Zugang für ${session.app.org_name}` : 'Mit Ihrem Konto anmelden')),
      alertBox,
      form,
      devBlock ? h('div', { class: 'divider-text' }, 'oder') : null,
      devBlock,
      h('p', { class: 'login__foot' }, `${session.app.name || 'Stele CMS'} ${session.app.version || ''}`.trim()),
    ),
  );

  root.replaceChildren(h('div', { class: 'login' }, brand, panel));
  requestAnimationFrame(() => user.focus());
}
