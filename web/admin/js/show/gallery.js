// Vorführseite, Abschnitt 3: alle UI-Bausteine der Admin-Oberfläche zum Ausprobieren (ohne Serverdaten zu ändern).
import { h, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { card, kpi, button } from '../ui/page.js';
import { field, input, numberInput, textarea, select, checkbox, switchToggle, segmented, colorInput, tagsInput, searchInput, setFieldError, clearFieldErrors } from '../ui/form.js';
import { openDialog, openDrawer, confirmDialog, promptDialog } from '../ui/dialog.js';
import { menuButton } from '../ui/menu.js';
import { dataTable } from '../ui/table.js';
import { tabs } from '../ui/tabs.js';
import { chip, presentationStatus, steleStatus, validityChip } from '../ui/status.js';
import { emptyState, errorState, loadingBlock, skeletonLines, skeletonGrid } from '../ui/empty.js';
import { toast } from '../ui/toast.js';
import { sparkline, barList, columnChart, availabilityBand, meter } from '../ui/charts.js';
import { formatDuration, formatRelative } from '../format.js';
import { showSection } from './common.js';

const demo = (title, ...children) => h('div', { class: 'show-demo' }, h('h3', { class: 'show-demo__title' }, title), h('div', { class: 'show-demo__body' }, children));

// ---------- Knöpfe und Status ----------
function panelButtons() {
  const variants = ['primary', 'secondary', 'ghost', 'danger', 'danger-ghost', 'link'];
  const labels = { primary: 'Hauptaktion', secondary: 'Nebenaktion', ghost: 'Zurückhaltend', danger: 'Löschen', 'danger-ghost': 'Entfernen', link: 'Als Link' };
  const icons = { primary: 'save', secondary: 'copy', ghost: 'eye', danger: 'trash', 'danger-ghost': 'x', link: null };
  const busyBtn = button({ label: 'Speichern (lädt 2 s)', icon: 'save', variant: 'secondary', onClick: (e) => {
    const b = e.currentTarget;
    b.setAttribute('aria-busy', 'true'); b.disabled = true;
    setTimeout(() => { b.removeAttribute('aria-busy'); b.disabled = false; toast.success('Gespeichert.'); }, 2000);
  } });
  return h('div', { class: 'show-demos' },
    demo('Varianten', h('div', { class: 'btn-group' }, variants.map((v) => button({ label: labels[v], icon: icons[v], variant: v, onClick: () => toast.info(`Knopf „${labels[v]}“ gedrückt.`) })))),
    demo('Größen und Zustände', h('div', { class: 'btn-group' },
      button({ label: 'Klein', size: 'sm' }), button({ label: 'Normal' }), button({ label: 'Groß', size: 'lg' }),
      button({ icon: 'pencil', ariaLabel: 'Bearbeiten' }), button({ label: 'Deaktiviert', disabled: true }), busyBtn)),
    demo('Status-Chips (immer Icon + Text)', h('div', { class: 'cluster' },
      chip('success', 'Läuft', 'check-circle'), chip('info', 'Hinweis', 'info'), chip('warning', 'Offen', 'alert-triangle'),
      chip('danger', 'Fehler', 'x-circle'), chip('neutral', 'Entwurf', 'pencil'), chip('info', 'Klein', 'tag', { size: 'sm' }))),
    demo('Präsentation, Stele, Gültigkeit', h('div', { class: 'cluster' },
      presentationStatus({ status: 'draft' }), presentationStatus({ status: 'published' }),
      presentationStatus({ status: 'changed', review_state: 'requested' }),
      steleStatus({ status: 'online' }), steleStatus({ status: 'offline' }), steleStatus({ status: 'standby' }),
      steleStatus({ status: 'never', paired: false }), validityChip('scheduled'), validityChip('expired'))),
    demo('Zähler, Schlagwörter, Tasten', h('div', { class: 'cluster' },
      h('span', { class: 'badge badge--info' }, '3'), h('span', { class: 'badge badge--warning' }, '1'), h('span', { class: 'badge badge--neutral' }, '12'),
      h('span', { class: 'tag' }, 'Campus'), h('span', { class: 'tag' }, 'Veranstaltung'),
      h('span', {}, h('kbd', { class: 'kbd' }, 'Esc'), ' schließt Dialoge'))),
    demo('Menü', h('div', { class: 'cluster' },
      menuButton({ text: 'Aktionen', variant: 'secondary', align: 'start', items: [
        { heading: 'Präsentation' },
        { label: 'Duplizieren', icon: 'copy', onClick: () => toast.success('Dupliziert (Beispiel).') },
        { label: 'Vorschau', icon: 'eye', hint: 'Entwurf', onClick: () => toast.info('Vorschau (Beispiel).') },
        { label: 'Gesperrt', icon: 'lock', disabled: true },
        { separator: true },
        { label: 'Löschen', icon: 'trash', danger: true, onClick: () => toast.warning('Löschen (Beispiel) – echte Löschungen fragen vorher nach.') },
      ] }),
      menuButton({ label: 'Weitere Aktionen', items: [{ label: 'Umbenennen', icon: 'pencil', onClick: () => toast.info('Umbenennen (Beispiel).') }] }))),
  );
}

// ---------- Formulare ----------
function panelForms() {
  const form = h('form', { class: 'form', novalidate: true });
  const name = input({ value: '', placeholder: 'z. B. Foyer Nord', maxLength: 80 });
  const url = input({ value: 'beispiel', type: 'url' });
  const seg = segmented({ value: 'fade', ariaLabel: 'Übergang', options: [
    { value: 'none', label: 'Ohne' }, { value: 'fade', label: 'Überblenden' }, { value: 'slide-left', label: 'Schieben' }, { value: 'zoom', label: 'Zoom' }] });
  const check = () => {
    clearFieldErrors(form);
    let ok = true;
    if (!name.value.trim()) { setFieldError(form, 'name', 'Bitte einen Namen eingeben.'); ok = false; }
    if (!/^https?:\/\//.test(url.value.trim())) { setFieldError(form, 'url', 'Bitte eine Adresse mit http:// oder https:// eingeben.'); ok = false; }
    if (ok) toast.success('Alle Eingaben sind gültig.'); else toast.error('Bitte die markierten Felder prüfen.');
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); check(); });
  form.append(
    h('div', { class: 'form-row' },
      field({ label: 'Name', name: 'name', required: true, control: name, hint: 'Pflichtfeld – leer lassen und „Prüfen“ drücken.' }),
      field({ label: 'Webseite', name: 'url', control: url, hint: 'Ungültiger Wert zeigt den Feldfehler.' })),
    h('div', { class: 'form-row' },
      field({ label: 'Dauer', control: numberInput({ value: 10, min: 2, max: 600, unit: 's' }) }),
      field({ label: 'Übergang (Auswahlliste)', control: select({ value: 'fade', options: [
        { group: 'Einfach', options: [{ value: 'none', label: 'Ohne' }, { value: 'fade', label: 'Überblenden' }] },
        { group: 'Bewegt', options: [{ value: 'slide-left', label: 'Nach links schieben' }, { value: 'slide-up', label: 'Nach oben schieben' }, { value: 'zoom', label: 'Zoom' }] }] }) }),
      field({ label: 'Akzentfarbe', control: colorInput({ value: '#1D4ED8', label: 'Akzentfarbe' }) })),
    field({ label: 'Beschreibung', optional: true, control: textarea({ rows: 3, placeholder: 'Wird nur im CMS angezeigt.' }) }),
    h('div', { class: 'stack stack--sm' }, h('span', { class: 'field__label' }, 'Übergang (Segmente)'), seg),
    field({ label: 'Schlagwörter', control: tagsInput({ value: ['Campus'], suggestions: ['Veranstaltung', 'Mensa', 'Bibliothek', 'Wegweiser'] }), hint: 'Enter übernimmt, Vorschläge erscheinen beim Tippen.' }),
    field({ label: 'Suche', control: searchInput({ placeholder: 'Inhalte suchen …', onInput: (v) => { if (v) toast.info(`Suche nach „${v}“ (Beispiel).`); } }) }),
    h('div', { class: 'form-row' },
      checkbox({ label: 'Ton bei Videos', hint: 'Nur wenn die Stele Lautsprecher hat.', checked: false }),
      switchToggle({ label: 'Nachtmodus', hint: 'Bildschirm nachts dunkel.', checked: true })),
    h('div', { class: 'cluster' }, button({ label: 'Prüfen', icon: 'check', variant: 'primary', type: 'submit' }), button({ label: 'Fehler zurücksetzen', variant: 'ghost', onClick: () => clearFieldErrors(form) })),
  );
  return form;
}

// ---------- Rückmeldung und Dialoge ----------
function panelFeedback() {
  let progress = 35;
  const bar = h('div', { class: 'progress__bar', style: { width: `${progress}%` } });
  const barText = h('span', { class: 'text-sm num' }, `${progress} %`);
  const stepProgress = () => { progress = progress >= 100 ? 0 : progress + 15; bar.style.width = `${Math.min(progress, 100)}%`; barText.textContent = `${Math.min(progress, 100)} %`; };

  return h('div', { class: 'show-demos' },
    demo('Kurzmeldungen (Toasts)', h('div', { class: 'btn-group' },
      button({ label: 'Erfolg', icon: 'check-circle', onClick: () => toast.success('Präsentation veröffentlicht.') }),
      button({ label: 'Info', icon: 'info', onClick: () => toast.info('Die Stele lädt den neuen Stand in wenigen Sekunden.') }),
      button({ label: 'Warnung', icon: 'alert-triangle', onClick: () => toast.warning('Querformat: wird auf der Hochformat-Stele angepasst.') }),
      button({ label: 'Fehler', icon: 'alert-circle', onClick: () => toast.error('Keine Verbindung zum Server. Bitte erneut versuchen.') }),
      button({ label: 'Mit „Rückgängig“', icon: 'undo', onClick: () => toast.success('Folie entfernt.', { action: { label: 'Rückgängig', onClick: () => toast.info('Folie wiederhergestellt.') } }) }))),
    demo('Dialoge', h('div', { class: 'btn-group' },
      button({ label: 'Dialog', icon: 'maximize', onClick: () => openDialog({
        title: 'Präsentation anlegen', description: 'Beispieldialog mit Formular – Esc oder „Abbrechen“ schließt ihn.',
        content: h('div', { class: 'stack' }, field({ label: 'Name', required: true, control: input({ value: 'Foyer Herbst' }) }), field({ label: 'Beschreibung', optional: true, control: textarea({ rows: 3 }) })),
        actions: [{ label: 'Abbrechen', value: null }, { label: 'Anlegen', variant: 'primary', icon: 'plus', onClick: () => { toast.success('Angelegt (Beispiel).'); return true; } }],
      }) }),
      button({ label: 'Bestätigung (zerstörend)', icon: 'trash', onClick: async () => {
        const ok = await confirmDialog({ title: 'Präsentation löschen?', message: '„Foyer Herbst“ wird gelöscht und läuft danach auf keiner Stele mehr. Das lässt sich nicht rückgängig machen.', confirmLabel: 'Präsentation löschen', danger: true });
        toast[ok ? 'success' : 'info'](ok ? 'Gelöscht (Beispiel – nichts wurde wirklich gelöscht).' : 'Abgebrochen.');
      } }),
      button({ label: 'Eingabe', icon: 'pencil', onClick: async () => {
        const v = await promptDialog({ title: 'Umbenennen', label: 'Neuer Name', value: 'Foyer Herbst', hint: '3 bis 80 Zeichen.', validate: (s) => (s.length < 3 ? 'Bitte mindestens 3 Zeichen eingeben.' : null) });
        if (v) toast.success(`Neuer Name: „${v}“ (Beispiel).`);
      } }),
      button({ label: 'Seitenleiste', icon: 'panel-left', onClick: () => openDrawer({
        title: 'Details', width: '420px',
        content: h('dl', { class: 'meta-list' }, h('dt', {}, 'Typ'), h('dd', {}, 'Info-Folie'), h('dt', {}, 'Größe'), h('dd', {}, '1080 × 1920'), h('dt', {}, 'Geändert'), h('dd', {}, formatRelative(new Date(Date.now() - 3600e3)))),
        actions: [{ label: 'Schließen', variant: 'primary', value: true }],
      }) }))),
    demo('Hinweise', h('div', { class: 'stack stack--sm' },
      ...[['success', 'check-circle', 'Veröffentlicht', 'Alle Stelen haben den neuen Stand.'],
        ['warning', 'alert-triangle', 'Änderungen offen', 'Der Entwurf weicht vom veröffentlichten Stand ab.'],
        ['danger', 'alert-circle', 'Stele offline', 'Seit 12 Minuten keine Meldung von „Foyer Nord“.'],
        ['neutral', 'info', 'Hinweis', 'Neutraler Hinweis ohne Wertung.']]
        .map(([k, ic, t, x]) => h('div', { class: `alert alert--${k}` }, icon(ic), h('div', { class: 'alert__body' }, h('div', { class: 'alert__title' }, t), h('div', { class: 'alert__text' }, x)))))),
    demo('Fortschritt und Laden', h('div', { class: 'stack' },
      h('div', { class: 'cluster' }, h('div', { class: 'progress grow', role: 'progressbar', 'aria-label': 'Upload', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(progress) }, bar), barText,
        button({ label: 'Weiter', size: 'sm', onClick: stepProgress })),
      loadingBlock('Inhalte werden geladen …'),
      skeletonLines(3),
      skeletonGrid(3, '160px'))),
    demo('Leer- und Fehlerzustand', h('div', { class: 'show-demo__grid' },
      h('div', { class: 'card' }, emptyState({ icon: 'images', title: 'Noch keine Inhalte', text: 'Bilder, Videos oder PDFs hochladen, um loszulegen.', actions: [button({ label: 'Datei hochladen', icon: 'upload', variant: 'primary', onClick: () => toast.info('Upload (Beispiel).') })] })),
      h('div', { class: 'card' }, errorState({ title: 'Laden fehlgeschlagen', error: new Error('Keine Verbindung zum Server.'), onRetry: () => toast.info('Erneut versuchen (Beispiel).') })))),
  );
}

// ---------- Daten und Diagramme ----------
function panelData() {
  const rows = [
    { id: 1, name: 'Foyer Herbst', slides: 8, duration: 420, status: 'published', updated: Date.now() - 2 * 3600e3 },
    { id: 2, name: 'Tag der offenen Tür', slides: 5, duration: 150, status: 'changed', updated: Date.now() - 26 * 3600e3 },
    { id: 3, name: 'Mensa-Wochenplan', slides: 3, duration: 90, status: 'draft', updated: Date.now() - 5 * 60e3 },
    { id: 4, name: 'Wegweiser Campus', slides: 12, duration: 600, status: 'published', updated: Date.now() - 7 * 86400e3 },
  ];
  const table = dataTable({
    caption: 'Beispiel-Präsentationen (sortierbar, Zeile anklickbar)',
    columns: [
      { key: 'name', label: 'Name', sortable: true, rowHeader: true, render: (r) => h('span', { class: 'table__primary' }, r.name) },
      { key: 'status', label: 'Status', sortable: true, render: (r) => presentationStatus(r, { size: 'sm' }) },
      { key: 'slides', label: 'Folien', sortable: true, align: 'num' },
      { key: 'duration', label: 'Dauer', sortable: true, align: 'num', render: (r) => formatDuration(r.duration) },
      { key: 'updated', label: 'Geändert', sortable: true, render: (r) => formatRelative(new Date(r.updated)) },
    ],
    rows,
    sort: { key: 'name', dir: 'asc' },
    onRowClick: (r) => toast.info(`„${r.name}“ angeklickt (Beispiel).`),
  });
  const now = Date.now();
  const hours = Array.from({ length: 24 }, (_, i) => ({ t: new Date(now - (23 - i) * 3600e3).toISOString(), v: Math.round(20 + 15 * Math.sin(i / 3) + (i % 5) * 3) }));
  const from = new Date(now - 24 * 3600e3);
  return h('div', { class: 'show-demos' },
    demo('Kennzahlen', h('div', { class: 'grid-auto', style: { '--grid-min': '180px' } },
      kpi({ label: 'Stelen online', icon: 'wifi', value: '3 / 4', meta: '1 offline seit 12 min' }),
      kpi({ label: 'Folien aktiv', icon: 'presentation', value: '28', meta: 'in 4 Präsentationen' }),
      kpi({ label: 'Touch heute', icon: 'touch', value: '143', meta: '+18 % zu gestern' }))),
    demo('Tabelle', table.el),
    demo('Diagramme', h('div', { class: 'show-demo__grid' },
      h('div', { class: 'card show-chart' }, sparkline({ label: 'CPU-Auslastung', unit: '%', points: hours, min: 0, max: 100, level: (v) => (v > 80 ? 'danger' : v > 60 ? 'warning' : null) })),
      h('div', { class: 'card show-chart' }, meter({ label: 'Speicher belegt', value: 72 }), meter({ label: 'Temperatur', value: 84, unit: '°C', warnAt: 75, dangerAt: 85, max: 100 })),
      h('div', { class: 'card show-chart' }, barList({ label: 'Meistgenutzte Kacheln', items: [{ label: 'Lageplan', value: 54 }, { label: 'Mensa', value: 38 }, { label: 'Termine', value: 21 }, { label: 'Kontakt', value: 9 }] })),
      h('div', { class: 'card show-chart' }, columnChart({ label: 'Touch-Sitzungen je Stunde', items: Array.from({ length: 12 }, (_, i) => ({ label: String(8 + i), value: Math.round(4 + 6 * Math.sin(i / 2) ** 2) })) })),
      h('div', { class: 'card show-chart show-chart--wide' }, availabilityBand({ from, to: new Date(now), label: 'Verfügbarkeit 24 h', segments: [
        { start: from.toISOString(), end: new Date(now - 14 * 3600e3).toISOString() },
        { start: new Date(now - 13.5 * 3600e3).toISOString(), end: new Date(now - 2 * 3600e3).toISOString() },
        { start: new Date(now - 1.8 * 3600e3).toISOString(), end: new Date(now).toISOString() }] })))),
  );
}

const PANELS = { buttons: panelButtons, forms: panelForms, feedback: panelFeedback, data: panelData };

export function renderGallery() {
  const holder = h('div');
  const t = tabs({
    ariaLabel: 'UI-Bausteine',
    items: [
      { id: 'buttons', label: 'Knöpfe und Status', icon: 'sliders' },
      { id: 'forms', label: 'Formulare', icon: 'pencil' },
      { id: 'feedback', label: 'Rückmeldung und Dialoge', icon: 'bell' },
      { id: 'data', label: 'Daten und Diagramme', icon: 'activity' },
    ],
    value: 'buttons',
    onChange: (id) => fill(t.panel, PANELS[id]()),
  });
  fill(t.panel, PANELS.buttons());
  holder.append(t.el, t.panel);
  return showSection({
    id: 'bausteine', nr: 3, title: 'UI-Bausteine ausprobieren',
    text: 'Alle Bedienelemente der Admin-Oberfläche mit Beispieldaten. Hier wird nichts gespeichert.',
  }, card({ body: holder }));
}
