// Vorführseite, Abschnitt 1: Kennzahlen, Rundgang durch alle Bereiche, Stele simulieren (Player-Vorschau).
import { h, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, errorMessage } from '../api.js';
import { can } from '../session.js';
import { kpi, card } from '../ui/page.js';
import { field, select, segmented } from '../ui/form.js';
import { openDialog } from '../ui/dialog.js';
import { chip, presentationStatus } from '../ui/status.js';
import { skeletonLines } from '../ui/empty.js';
import { playerFrame, playerUrls } from '../ui/player-frame.js';
import { formatNumber, formatDuration, plural } from '../format.js';
import { allowed, externalLink, showSection } from './common.js';

// Reihenfolge = Vorschlag für die Vorführung. points: Stichpunkte „Was zeigen“.
const STEPS = [
  { title: 'Übersicht', icon: 'dashboard', href: '/admin/#/', perm: null,
    points: ['Zustand aller Stelen auf einen Blick', 'Offene Freigaben und letzte Aktivität', 'Kopfleiste: Zoom 80–150 % und Hell/Dunkel'] },
  { title: 'Mediathek', icon: 'images', href: '/admin/#/media', perm: 'content.view',
    points: ['Bilder, Videos und PDFs per Ziehen und Ablegen hochladen', 'Info-Folien aus Vorlagen, Webseiten einbinden', 'Suche, Filter, Raster- oder Listenansicht'] },
  { title: 'Präsentationen', icon: 'presentation', href: '/admin/#/presentations', perm: 'presentations.view',
    points: ['Folien sortieren, Dauer, Übergang und Gültigkeit', 'Live-Vorschau im Hochformat 1080 × 1920', 'Entwurf und veröffentlichter Stand, Freigabe durch die Redaktion'] },
  { title: 'Designs', icon: 'palette', href: '/admin/#/designs', perm: 'presentations.view',
    points: ['Header mit Logo, Titel und Uhr', 'Footer als Laufband oder Text', 'Akzentfarbe und Schrift – wiederverwendbar'] },
  { title: 'Touch-Menüs', icon: 'touch', href: '/admin/#/touch-menus', perm: 'presentations.view',
    points: ['Kacheln führen zu Inhalt, Galerie oder Untermenü', 'Nach Inaktivität zurück zur Diashow'] },
  { title: 'Stelen', icon: 'stele', href: '/admin/#/steles', perm: 'steles.view',
    points: ['Kopplung per 6-stelligem Code', 'Standard-Präsentation, Lautstärke, Nachtmodus', 'Befehle: neu laden, Screenshot'] },
  { title: 'Zeitplan', icon: 'calendar-clock', href: '/admin/#/schedule', perm: 'schedule.view',
    points: ['Wochenansicht je Stele', 'Priorität und Hinweise auf Konflikte'] },
  { title: 'Monitoring', icon: 'activity', href: '/admin/#/monitoring', perm: 'monitoring.view',
    points: ['Verfügbarkeit, laufende Folie, Touch-Nutzung', 'Mit Stelen-Agent: CPU, RAM, Temperatur, Screenshots'] },
  { title: 'Benutzer und Rollen', icon: 'users', href: '/admin/#/roles', perm: ['users.view', 'roles.manage'],
    points: ['Rollen bündeln Rechte pro Funktion', 'Sperre nach Fehlversuchen, Passwort zurücksetzen'] },
  { title: 'Protokoll', icon: 'scroll', href: '/admin/#/audit', perm: 'audit.view',
    points: ['Jede Änderung und Anmeldung nachvollziehbar', 'Filter nach Person, Bereich und Zeitraum'] },
  { title: 'Einstellungen', icon: 'settings', href: '/admin/#/settings', perm: 'settings.manage',
    points: ['Organisation, Zeitzone, Sicherheit', 'Backup der Datenbank herunterladen'] },
];

function stepCard(step, nr) {
  const ok = allowed(step.perm);
  return h('article', { class: ['card', 'show-step', !ok && 'show-step--locked'] },
    h('div', { class: 'show-step__head' },
      h('span', { class: 'show-step__nr', 'aria-hidden': 'true' }, String(nr)),
      h('span', { class: 'show-step__icon', 'aria-hidden': 'true' }, icon(step.icon)),
      h('h3', { class: 'show-step__title' }, step.title)),
    h('ul', { class: 'show-step__points' }, step.points.map((p) => h('li', {}, p))),
    h('div', { class: 'show-step__foot' },
      ok ? externalLink({ href: step.href, label: `${step.title} öffnen`, size: 'sm' })
        : chip('neutral', 'Für diese Rolle ausgeblendet', 'lock', { size: 'sm' })),
  );
}

function kpiRow(signal) {
  const row = h('div', { class: 'grid-auto show-kpis', style: { '--grid-min': '200px' } },
    Array.from({ length: 4 }, () => h('div', { class: 'card kpi' }, skeletonLines(2))));
  const jobs = [
    can('content.view') ? api.get('/api/contents', { query: { limit: 1 }, signal }) : null,
    can('presentations.view') ? api.get('/api/presentations', { signal }) : null,
    can('steles.view') ? api.get('/api/steles', { signal }) : null,
    can('presentations.view') ? api.get('/api/designs', { signal }) : null,
  ];
  Promise.allSettled(jobs.map((j) => j || Promise.resolve(null))).then(([c, p, s, d]) => {
    if (signal.aborted) return;
    const val = (r) => (r.status === 'fulfilled' && r.value ? r.value : null);
    const contents = val(c);
    const pres = val(p);
    const steles = val(s);
    const designs = val(d);
    const published = pres ? pres.items.filter((x) => x.status !== 'draft').length : 0;
    const online = steles ? steles.items.filter((x) => x.status === 'online').length : 0;
    fill(row,
      kpi({ label: 'Inhalte', icon: 'images', value: contents ? formatNumber(contents.total) : '–', meta: contents ? 'in der Mediathek' : 'keine Berechtigung' }),
      kpi({ label: 'Präsentationen', icon: 'presentation', value: pres ? formatNumber(pres.total) : '–', meta: pres ? `${formatNumber(published)} veröffentlicht` : 'keine Berechtigung' }),
      kpi({ label: 'Stelen', icon: 'stele', value: steles ? formatNumber(steles.total) : '–', meta: steles ? `${formatNumber(online)} online` : 'keine Berechtigung' }),
      kpi({ label: 'Designs', icon: 'palette', value: designs ? formatNumber(designs.total) : '–', meta: designs ? 'wiederverwendbare Rahmen' : 'keine Berechtigung' }),
    );
  });
  return row;
}

/** Player-Vorschau einer Präsentation im Dialog (wie auf der Stele). */
export function openPlayerDialog(presentation, { source = 'draft', touch = false } = {}) {
  const pf = playerFrame({
    src: playerUrls.preview(presentation.id, { source, touch }),
    title: `Vorschau von „${presentation.name}“`,
  });
  const d = openDialog({
    title: `Vorschau: ${presentation.name}`,
    description: `${source === 'published' ? 'Veröffentlichter Stand' : 'Entwurf'} · ${touch ? 'Touch-Modus: Kacheln antippen wie an der Stele.' : 'So erscheint die Präsentation auf der Stele (Hochformat 1080 × 1920).'}`,
    size: 'lg',
    className: 'show-player-dialog',
    content: h('div', { class: 'show-player' }, pf.el),
    actions: [
      { label: 'In neuem Tab öffnen', icon: 'external-link', start: true, onClick: () => { window.open(playerUrls.preview(presentation.id, { source, touch }), '_blank', 'noopener'); return false; } },
      { label: 'Schließen', variant: 'primary', value: true },
    ],
    onClose: () => pf.destroy(),
  });
  return d;
}

function simulateCard(signal) {
  const body = h('div', {}, skeletonLines(3));
  const el = card({
    title: 'Stele simulieren',
    icon: 'stele',
    subtitle: 'Eine Präsentation im Player abspielen – ohne echte Stele.',
    body,
  });
  if (!can('presentations.view')) {
    fill(body, h('p', { class: 'text-2' }, 'Für diese Rolle nicht verfügbar.'));
    return el;
  }
  api.get('/api/presentations', { signal }).then((res) => {
    const items = res.items || [];
    if (!items.length) { fill(body, h('p', { class: 'text-2' }, 'Noch keine Präsentation vorhanden – unten eine anlegen.')); return; }
    const first = items.find((p) => p.status !== 'draft') || items[0];
    const sel = select({ value: String(first.id), options: items.map((p) => ({ value: String(p.id), label: p.name })) });
    let source = first.status === 'draft' ? 'draft' : 'published';
    const src = segmented({
      value: source, ariaLabel: 'Stand',
      options: [{ value: 'published', label: 'Veröffentlicht', icon: 'check-circle' }, { value: 'draft', label: 'Entwurf', icon: 'pencil' }],
      onChange: (v) => { source = v; },
    });
    let touch = false;
    const mode = segmented({
      value: 'show', ariaLabel: 'Modus',
      options: [{ value: 'show', label: 'Diashow', icon: 'play' }, { value: 'touch', label: 'Touch-Menü', icon: 'touch' }],
      onChange: (v) => { touch = v === 'touch'; },
    });
    const info = h('div', { class: 'cluster' });
    const current = () => items.find((p) => String(p.id) === sel.value);
    const showInfo = () => {
      const p = current();
      fill(info, presentationStatus(p, { size: 'sm' }),
        h('span', { class: 'text-sm text-2' }, `${plural(p.active_item_count, 'aktive Folie', 'aktive Folien')} · ${formatDuration(p.total_duration_s)}`));
    };
    sel.addEventListener('change', showInfo);
    showInfo();
    fill(body, h('div', { class: 'stack' },
      field({ label: 'Präsentation', control: sel }),
      info,
      h('div', { class: 'cluster cluster--lg' },
        h('div', { class: 'stack stack--sm' }, h('span', { class: 'field__label' }, 'Stand'), src),
        h('div', { class: 'stack stack--sm' }, h('span', { class: 'field__label' }, 'Modus'), mode)),
      h('div', { class: 'cluster' },
        h('button', {
          type: 'button', class: 'btn btn--secondary',
          onClick: () => {
            const p = current();
            if (source === 'published' && p.status === 'draft') { src.setValue('draft'); source = 'draft'; }
            openPlayerDialog(p, { source, touch });
          },
        }, icon('play'), 'Abspielen'))));
  }).catch((err) => {
    if (err?.name !== 'AbortError') fill(body, h('p', { class: 'field__error' }, icon('alert-circle'), errorMessage(err)));
  });
  return el;
}

export function renderTour({ signal }) {
  return showSection({
    id: 'rundgang', nr: 1, title: 'Rundgang durch das Backend',
    text: 'Vorschlag für die Reihenfolge. Jede Karte nennt, was sich zeigen lässt.',
  },
  kpiRow(signal),
  h('div', { class: 'show-tour' },
    h('div', { class: 'grid-auto show-steps', style: { '--grid-min': '250px' } }, STEPS.map((s, i) => stepCard(s, i + 1))),
    h('div', { class: 'stack show-tour__side' },
      simulateCard(signal),
      card({
        title: 'Tipps für die Vorführung', icon: 'lightbulb',
        body: h('ul', { class: 'show-tips' },
          h('li', {}, 'Rollen vergleichen: abmelden und als „Autor“ oder „Betrachter“ anmelden – fehlende Rechte blenden Aktionen aus.'),
          h('li', {}, 'Freigabe zeigen: als Autor einreichen, als Redaktion veröffentlichen.'),
          h('li', {}, 'Hell/Dunkel und Zoom oben rechts umschalten.'),
          h('li', {}, 'Der Player spielt nur veröffentlichte Stände – Entwürfe sieht nur die Vorschau.')),
      }))),
  );
}
