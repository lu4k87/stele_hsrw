// Übersicht (#/): Begrüßung, Stelen, Hinweise, Freigaben, offene Änderungen, Ablaufende Folien, letzte Aktivität.
// Daten: GET /api/dashboard (Abschnitte ohne Recht = null). Aktualisierung über das Shell-Polling (dashboard:update).
import { h, useStyles, initials, mount as fill } from '../dom.js';
import { api } from '../api.js';
import { bus } from '../bus.js';
import { session, can, canAny } from '../session.js';
import { icon } from '../icons.js';
import { formatRelative, formatDateTime, formatWeekday, plural, formatNumber } from '../format.js';
import { page, pageHeader, card, button } from '../ui/page.js';
import { emptyState, errorState, skeletonGrid } from '../ui/empty.js';
import { steleCard, alertList } from '../ui/stele-ui.js';

function greeting(date = new Date()) {
  const hr = date.getHours();
  if (hr < 5) return 'Guten Abend';
  if (hr < 11) return 'Guten Morgen';
  if (hr < 18) return 'Guten Tag';
  return 'Guten Abend';
}

function firstName(u) {
  const n = (u?.display_name || u?.username || '').trim();
  return n.split(/\s+/)[0] || '';
}

function person(p) {
  return p?.display_name || 'Unbekannt';
}

export default async function mount(root, ctx) {
  await useStyles('/admin/css/views/dashboard.css');
  const user = session.user;
  const header = pageHeader({
    title: `${greeting()}, ${firstName(user)}`,
    description: `${formatWeekday(new Date())} · Hier steht, was auf den Stelen läuft und was ansteht.`,
    actions: quickActions(),
  });
  const body = h('div', { class: 'dash' }, skeletonGrid(3, '300px'));
  root.append(page({}, header, body));

  const cards = new Map(); // Stelen-Karten (Live-Ansichten bleiben bei Aktualisierung erhalten)

  function quickActions() {
    const list = [];
    if (can('schedule.view')) list.push(button({ label: 'Zeitplan', icon: 'calendar-clock', href: '#/schedule' }));
    if (can('presentations.edit')) list.push(button({ label: 'Neue Präsentation', icon: 'plus', href: '#/presentations?new=1' }));
    if (can('content.edit')) list.push(button({ label: 'Hochladen', icon: 'upload', variant: 'primary', href: '#/media?upload=1' }));
    return list;
  }

  // Stelen-Abschnitt bleibt dauerhaft im DOM: Karten werden nur aktualisiert, nie umgehängt
  // (ein umgehängtes iframe würde die Live-Ansicht neu laden).
  const stelesGrid = h('div', { class: 'grid-auto dash__steles', style: { '--grid-min': '300px' } });
  const stelesEmpty = h('div');
  const stelesHeading = h('h2', { id: 'dash-steles' }, 'Stelen');
  const stelesSection = h('section', { class: 'stack', 'aria-labelledby': 'dash-steles' },
    h('div', { class: 'section-title' }, stelesHeading,
      h('a', { class: 'btn btn--ghost btn--sm', href: '#/steles' }, 'Alle Stelen', icon('chevron-right', { size: 16 }))),
    stelesGrid, stelesEmpty);
  const alertsSlot = h('section', { 'aria-label': 'Hinweise' });
  const sideSlot = h('div', { class: 'dash__side' });
  const activitySlot = h('div');
  const footSlot = h('div');

  function renderSteles(steles) {
    if (!Array.isArray(steles)) { stelesSection.hidden = true; return; }
    stelesSection.hidden = false;
    stelesHeading.textContent = steles.length === 1 ? 'Stele' : 'Stelen';
    const seen = new Set();
    for (const s of steles) {
      seen.add(s.id);
      const c = cards.get(s.id);
      if (c) c.update(s);
      else { const n = steleCard(s); cards.set(s.id, n); stelesGrid.append(n.el); }
    }
    for (const [id, c] of cards) if (!seen.has(id)) { c.destroy(); c.el.remove(); cards.delete(id); }
    stelesGrid.hidden = !steles.length;
    fill(stelesEmpty, steles.length ? '' : card({ body: emptyState({
      icon: 'stele', title: 'Noch keine Stele eingerichtet',
      text: 'Sobald eine Stele gekoppelt ist, steht hier, was gerade auf ihr läuft.',
      actions: [can('steles.manage') ? button({ label: 'Stele hinzufügen', icon: 'plus', variant: 'primary', href: '#/steles?add=1' }) : null],
    }) }));
  }

  function listCard({ title, iconName, items, empty, render, more = null, count = true }) {
    const n = items.length;
    return card({
      title: count && n ? `${title} (${formatNumber(n)})` : title,
      icon: iconName,
      flush: true,
      body: n ? h('ul', { class: 'list' }, items.map(render)) : h('div', { class: 'dash__empty' }, icon('check-circle', { size: 18 }), h('span', {}, empty)),
      footer: more,
      className: 'dash__list-card',
    });
  }

  function reviewsCard(reviews) {
    return listCard({
      title: 'Warten auf Freigabe', iconName: 'send', items: reviews,
      empty: 'Keine offenen Freigaben – alles erledigt.',
      render: (r) => h('li', {},
        h('div', { class: 'list__main' },
          h('a', { class: 'list__title', href: `#/presentations/${r.presentation.id}` }, r.presentation.name),
          h('span', { class: 'list__meta' }, `eingereicht von ${person(r.requested_by)} · ${formatRelative(r.requested_at)}`),
          r.note ? h('span', { class: 'list__meta dash__note' }, `„${r.note}“`) : null),
        h('a', { class: 'btn btn--secondary btn--sm', href: `#/presentations/${r.presentation.id}` }, 'Prüfen')),
    });
  }

  function unpublishedCard(items) {
    return listCard({
      title: 'Unveröffentlichte Änderungen', iconName: 'alert-triangle', items,
      empty: 'Alle Präsentationen sind auf dem neuesten Stand.',
      render: (p) => h('li', {},
        h('div', { class: 'list__main' },
          h('a', { class: 'list__title', href: `#/presentations/${p.id}` }, p.name),
          h('span', { class: 'list__meta' }, `geändert ${formatRelative(p.updated_at)}${p.updated_by ? ` von ${person(p.updated_by)}` : ''}`)),
        h('a', { class: 'btn btn--ghost btn--sm', href: `#/presentations/${p.id}`, 'aria-label': `„${p.name}“ öffnen` }, 'Öffnen')),
      more: h('a', { class: 'btn btn--ghost btn--sm', href: '#/presentations' }, 'Alle Präsentationen', icon('chevron-right', { size: 16 })),
    });
  }

  function expiringCard(items) {
    return listCard({
      title: 'Läuft bald ab', iconName: 'clock', items,
      empty: 'In den nächsten 7 Tagen läuft keine Folie ab.',
      render: (x) => h('li', {},
        h('div', { class: 'list__main' },
          h('span', { class: 'list__title' }, x.title || 'Folie'),
          h('span', { class: 'list__meta' }, 'in ', h('a', { href: `#/presentations/${x.presentation.id}` }, x.presentation.name), ` · endet ${formatDateTime(x.valid_until)}`))),
    });
  }

  function activityCard(items) {
    return listCard({
      title: 'Letzte Aktivität', iconName: 'history', items: items.slice(0, 6), count: false,
      empty: 'Noch keine Aktivität protokolliert.',
      more: h('a', { class: 'btn btn--ghost btn--sm', href: '#/audit' }, 'Ganzes Protokoll', icon('chevron-right', { size: 16 })),
      render: (a) => h('li', { class: 'dash__activity' },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(a.user?.display_name || a.user?.username || '?')),
        h('div', { class: 'list__main' },
          h('span', { class: 'dash__sentence' }, h('strong', {}, a.user?.display_name || a.user?.username || 'System'), ` ${a.summary}`),
          h('span', { class: 'list__meta' }, h('time', { datetime: a.ts, title: formatDateTime(a.ts) }, formatRelative(a.ts))))),
    });
  }

  const cols = h('div', { class: 'dash__cols' }, h('div', { class: 'dash__main' }, stelesSection, activitySlot), sideSlot);
  let mounted = false;
  function render(d) {
    const alerts = Array.isArray(d.alerts) ? d.alerts : [];
    const showAlerts = alerts.length > 0 && canAny('monitoring.view', 'steles.view');
    alertsSlot.hidden = !showAlerts;
    fill(alertsSlot, showAlerts ? alertList(alerts, { limit: 4 }) : '');
    renderSteles(d.steles);

    const side = [];
    if (Array.isArray(d.reviews) && can('presentations.publish')) side.push(reviewsCard(d.reviews));
    if (Array.isArray(d.unpublished)) side.push(unpublishedCard(d.unpublished));
    if (Array.isArray(d.expiring)) side.push(expiringCard(d.expiring));
    sideSlot.hidden = !side.length;
    fill(sideSlot, ...side);
    const hasActivity = Array.isArray(d.activity);
    activitySlot.hidden = !hasActivity;
    fill(activitySlot, hasActivity ? activityCard(d.activity) : '');
    cols.classList.toggle('dash__cols--single', !side.length);

    const foot = [];
    if (!side.length && !hasActivity && !Array.isArray(d.steles) && !showAlerts) {
      foot.push(card({ body: emptyState({ icon: 'dashboard', title: 'Willkommen im Stele CMS', text: 'Für Ihre Rolle gibt es hier noch nichts anzuzeigen. Über die Navigation links erreichen Sie die freigegebenen Bereiche.' }) }));
    }
    const c = d.counts || {};
    const counts = [c.contents != null && can('content.view') ? plural(c.contents, 'Inhalt', 'Inhalte') : null,
      c.presentations != null && can('presentations.view') ? plural(c.presentations, 'Präsentation', 'Präsentationen') : null,
      c.steles != null && can('steles.view') ? plural(c.steles, 'Stele', 'Stelen') : null,
      c.users != null && can('users.view') ? plural(c.users, 'Benutzer', 'Benutzer') : null].filter(Boolean);
    if (counts.length) foot.push(h('p', { class: 'dash__counts text-2 text-sm' }, `Im System: ${counts.join(' · ')}`));
    fill(footSlot, ...foot);

    if (!mounted) { mounted = true; fill(body, alertsSlot, cols, footSlot); }
  }

  async function load() {
    try {
      const d = ctx.dashboard || await api.get('/api/dashboard', { signal: ctx.signal });
      render(d);
    } catch (err) {
      if (err.name === 'AbortError') return;
      fill(body, card({ body: errorState({ error: err, onRetry: () => { fill(body, skeletonGrid(3, '300px')); load(); } }) }));
    }
  }
  // Frische Daten beim Öffnen (die Shell-Daten können bis zu 20 s alt sein)
  try {
    render(await api.get('/api/dashboard', { signal: ctx.signal }));
  } catch (err) {
    if (err.name === 'AbortError') return undefined;
    await load();
  }
  const off = bus.on('dashboard:update', (d) => render(d));
  return () => {
    off();
    for (const c of cards.values()) c.destroy();
  };
}
