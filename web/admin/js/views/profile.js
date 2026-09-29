// Profil (#/profile): eigene Angaben, Passwort, Rolle und Rechte (lesbar gruppiert), Darstellung.
import { h, useStyles, initials, mount as fill } from '../dom.js';
import { api, ApiError, errorMessage } from '../api.js';
import { session, applySession, can } from '../session.js';
import { icon } from '../icons.js';
import { formatRelative, formatDateTime, plural } from '../format.js';
import { page, pageHeader, card, button } from '../ui/page.js';
import { field, input, segmented, setFieldErrors, clearFieldErrors } from '../ui/form.js';
import { toast } from '../ui/toast.js';
import { skeletonLines } from '../ui/empty.js';
import { getThemePref, setThemePref, THEME_OPTIONS } from '../theme.js';
import { openPasswordDialog } from '../account.js';

export default async function mount(root, ctx) {
  await useStyles('/admin/css/views/profile.css');
  const u = session.user || {};

  // ---------- Angaben ----------
  const nameIn = input({ value: u.display_name || '', maxLength: 80, autocomplete: 'name' });
  const mailIn = input({ type: 'email', value: u.email || '', maxLength: 120, autocomplete: 'email' });
  const saveState = h('span', { class: 'text-2 text-sm', role: 'status' });
  const form = h('form', { class: 'form', novalidate: true },
    field({ label: 'Anzeigename', control: nameIn, required: true, name: 'display_name', hint: 'So erscheinen Sie im Protokoll und bei Freigaben.' }),
    field({ label: 'E-Mail', control: mailIn, optional: true, name: 'email' }),
    h('div', { class: 'cluster cluster--end' }, saveState, button({ label: 'Speichern', icon: 'save', variant: 'primary', type: 'submit' })));
  const dirty = () => nameIn.value.trim() !== (session.user?.display_name || '') || mailIn.value.trim() !== (session.user?.email || '');
  form.addEventListener('input', () => { const d = dirty(); ctx.setDirty(d ? 'Ihre Angaben sind noch nicht gespeichert.' : false); saveState.textContent = d ? 'Ungespeicherte Änderungen' : ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errors = {};
    if (!nameIn.value.trim()) errors.display_name = 'Bitte einen Anzeigenamen eingeben.';
    if (mailIn.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailIn.value.trim())) errors.email = 'Bitte eine gültige E-Mail-Adresse eingeben.';
    if (Object.keys(errors).length) { setFieldErrors(form, errors); return; }
    clearFieldErrors(form);
    if (!dirty()) { toast.info('Keine Änderungen.'); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.setAttribute('aria-busy', 'true');
    try {
      applySession(await api.patch('/api/auth/profile', { display_name: nameIn.value.trim(), email: mailIn.value.trim() }));
      ctx.setDirty(false);
      saveState.textContent = '';
      renderHead();
      toast.success('Angaben gespeichert.');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields || {}).length) setFieldErrors(form, err.fields);
      else toast.error(errorMessage(err));
    } finally { btn.removeAttribute('aria-busy'); }
  });

  // ---------- Kopf ----------
  const head = h('div', { class: 'prf-head' });
  function renderHead() {
    const x = session.user || {};
    fill(head, 
      h('span', { class: 'avatar avatar--lg', 'aria-hidden': 'true' }, initials(x.display_name || x.username)),
      h('div', { class: 'stack', style: { '--stack-gap': '2px' } },
        h('span', { class: 'prf-name' }, x.display_name),
        h('span', { class: 'text-2' }, `@${x.username} · ${x.role?.name || ''}`),
        h('span', { class: 'text-2 text-sm' }, x.last_login_at ? `Letzte Anmeldung ${formatRelative(x.last_login_at)} (${formatDateTime(x.last_login_at)})` : '')));
  }
  renderHead();

  // ---------- Rechte ----------
  const permsSlot = h('div', {}, skeletonLines(5));
  async function loadPerms() {
    try {
      const r = await api.get('/api/permissions', { signal: ctx.signal });
      const mine = session.permissions;
      const groups = (r.groups || []).map((g) => ({ ...g, have: g.permissions.filter((p) => mine.has(p.key)) }));
      const total = groups.reduce((n, g) => n + g.have.length, 0);
      fill(permsSlot, h('div', { class: 'stack' },
        h('p', { class: 'text-2' }, session.user?.role?.is_admin
          ? 'Als Administrator haben Sie alle Rechte.'
          : `Ihre Rolle „${session.user?.role?.name || ''}“ umfasst ${plural(total, 'Recht', 'Rechte')}. Änderungen daran nimmt eine Administratorin oder ein Administrator vor.`),
        h('div', { class: 'prf-groups' }, groups.map((g) => h('section', { class: 'prf-group' },
          h('h3', { class: 'prf-group__title' }, g.label),
          g.have.length
            ? h('ul', { class: 'prf-perms' }, g.have.map((p) => h('li', {}, icon('check', { size: 16 }), h('span', { class: 'prf-perm__label' }, p.label))))
            : h('p', { class: 'prf-none' }, icon('minus', { size: 16 }), 'Kein Zugriff'))))));
    } catch (err) {
      if (err.name !== 'AbortError') fill(permsSlot, h('p', { class: 'text-2' }, `Rechte konnten nicht geladen werden: ${errorMessage(err)}`));
    }
  }

  // ---------- Darstellung ----------
  const theme = segmented({ value: getThemePref(), options: THEME_OPTIONS, ariaLabel: 'Farbschema', onChange: (v) => { setThemePref(v); toast.success(`Darstellung: ${THEME_OPTIONS.find((o) => o.value === v)?.label}.`); } });

  root.append(page({ narrow: true },
    pageHeader({ title: 'Profil', description: 'Ihre Angaben, Ihr Passwort und Ihre Rechte.' }),
    card({ body: head }),
    h('div', { class: 'prf-grid' },
      card({ title: 'Persönliche Angaben', icon: 'user', body: form }),
      h('div', { class: 'stack' },
        card({ title: 'Passwort', icon: 'key', body: h('div', { class: 'stack stack--sm' },
          h('p', { class: 'text-2' }, 'Beim Ändern werden Sie auf anderen Geräten abgemeldet.'),
          h('div', {}, button({ label: 'Passwort ändern', icon: 'key', onClick: () => openPasswordDialog() }))) }),
        card({ title: 'Darstellung', icon: 'sun', body: h('div', { class: 'stack stack--sm' }, theme,
          h('p', { class: 'text-2 text-sm' }, '„Wie System“ folgt der Einstellung des Betriebssystems. Gilt nur in diesem Browser.')) }))),
    card({ title: 'Rolle und Rechte', icon: 'shield', actions: can('roles.manage') ? h('a', { class: 'btn btn--ghost btn--sm', href: '#/roles' }, 'Rollen verwalten') : null, body: permsSlot })));
  loadPerms();
  return undefined;
}
