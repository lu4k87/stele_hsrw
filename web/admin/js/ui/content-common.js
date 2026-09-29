// Gemeinsame Helfer des Bereichs „Inhalte“: Vorschaubilder, Info-Folien-Miniatur, Verwendungen,
// Hinweis „wird noch verwendet“ (409), Screenreader-Ansagen.
//
//   await contentStyles();
//   card.append(contentPreview(content));                 // Bild/Poster/PDF, Info-Folie als Miniatur, Webseite
//   list.append(usageList(content.usages));
//   await showInUse({ title: 'Bild kann nicht gelöscht werden', usages: err.details.usages });
import { h, useStyles } from '../dom.js';
import { icon } from '../icons.js';
import { chip, contentTypeIcon, contentTypeLabel } from './status.js';
import { openDialog } from './dialog.js';
import { formatDuration, formatBytes, plural } from '../format.js';

export const contentStyles = () => useStyles('/admin/css/views/content-ui.css');

/** Vorschaubild-URL eines Inhalts (volles Content-Objekt oder Kurzform {thumb_url}). */
export function thumbUrl(c) {
  return c?.urls?.thumb || c?.thumb_url || null;
}

/** „www.beispiel.de“ aus einer URL (ohne Fehler bei ungültigen Werten). */
export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url || ''); }
}

const HEX = /^#[0-9a-f]{6}$/i;
const safeHex = (v, d) => (HEX.test(v || '') ? v : d);

/** Info-Folie als kleine Darstellung (Farben, Titel, Textzeilen). bgUrl optional (Hintergrundbild). */
export function textMini(data = {}, { title = '', bgUrl = null } = {}) {
  const style = data.style || {};
  const fields = data.fields || {};
  const t = fields.title || title || '';
  const lines = data.template === 'statement' ? 1 : data.template === 'list' ? 4 : 3;
  const el = h('div', {
    class: ['cu-textmini', style.align === 'center' && 'cu-textmini--center'],
    style: {
      '--tm-bg': safeHex(style.bg_color, '#0F2747'),
      '--tm-fg': safeHex(style.text_color, '#FFFFFF'),
      '--tm-accent': safeHex(style.accent_color, '#F5B400'),
      '--tm-overlay': bgUrl ? String(Number(style.overlay ?? 0.4)) : '0',
      backgroundImage: bgUrl ? `url("${encodeURI(bgUrl)}")` : null,
    },
    'aria-hidden': 'true',
  },
  h('span', { class: 'cu-textmini__rule' }),
  t ? h('span', { class: 'cu-textmini__title' }, t) : null,
  Array.from({ length: lines }, () => h('span', { class: 'cu-textmini__line' })));
  return el;
}

/**
 * Vorschau eines Inhalts für Karten/Zeilen. size 'sm' = kleine Listenansicht (ohne Texte).
 * Zeigt Verarbeitung (Fortschritt) und Fehler direkt an.
 */
export function contentPreview(c, { size = null, contain = false } = {}) {
  const cls = ['cu-thumb', size === 'sm' && 'cu-thumb--sm', contain && 'cu-thumb--contain'];
  if (!c) return h('div', { class: cls }, icon('help-circle'));
  if (c.status === 'processing') {
    const p = Number.isFinite(c.progress) ? Math.max(0, Math.min(100, c.progress)) : null;
    return h('div', { class: cls },
      h('div', { class: 'cu-thumb__state' },
        h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        h('span', {}, p !== null ? `Wird verarbeitet … ${p} %` : 'Wird verarbeitet …'),
        p !== null ? h('div', { class: 'progress', 'aria-hidden': 'true' }, h('div', { class: 'progress__bar', style: { width: `${p}%` } })) : null));
  }
  if (c.status === 'error') {
    return h('div', { class: cls },
      h('div', { class: ['cu-thumb__state', 'cu-thumb__state--error'] }, icon('alert-circle'), h('span', {}, 'Verarbeitung fehlgeschlagen')));
  }
  const url = thumbUrl(c);
  if (url) return h('div', { class: cls }, h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
  if (c.type === 'text' && c.data) return h('div', { class: cls }, textMini(c.data, { title: c.title }));
  if (c.type === 'web') {
    return h('div', { class: cls }, h('div', { class: 'cu-web' }, icon('globe'), c.data?.url ? h('span', { class: 'cu-web__domain' }, domainOf(c.data.url)) : null));
  }
  return h('div', { class: cls }, icon(contentTypeIcon(c.type)));
}

/** Kurze Metadaten-Zeile: „Bild · 1080 × 1920 · 2,4 MB“. */
export function contentMeta(c) {
  const parts = [contentTypeLabel(c.type)];
  const f = c.file || {};
  if (c.type === 'image' && f.width) parts.push(`${f.width} × ${f.height}`);
  if (c.type === 'video' && f.duration_s) parts.push(formatDuration(f.duration_s));
  if (c.type === 'pdf' && f.page_count) parts.push(plural(f.page_count, 'Seite', 'Seiten'));
  if (c.type === 'web' && c.data?.url) parts.push(domainOf(c.data.url));
  if (c.type === 'text') parts.push(TEMPLATE_LABELS[c.data?.template] || 'Vorlage');
  if (f.size_bytes) parts.push(formatBytes(f.size_bytes));
  return parts.join(' · ');
}

export const TEMPLATE_LABELS = {
  title_text: 'Titel und Text',
  image_text: 'Bild und Text',
  statement: 'Aussage',
  event: 'Veranstaltung',
  list: 'Liste',
};

const USAGE = {
  presentation: { label: 'Präsentation', icon: 'presentation', href: (id) => `#/presentations/${id}` },
  design: { label: 'Design', icon: 'palette', href: (id) => `#/designs/${id}` },
  touch_menu: { label: 'Touch-Menü', icon: 'touch', href: (id) => `#/touch-menus/${id}` },
  content: { label: 'Info-Folie', icon: 'text-slide', href: (id) => `#/media/text/${id}` },
  stele: { label: 'Standard der Stele', icon: 'stele', href: (id) => `#/steles/${id}` },
  schedule: { label: 'Zeitplan', icon: 'calendar-clock', href: (id, u) => (u.stele_id ? `#/schedule?stele=${u.stele_id}` : '#/schedule') },
};

/** Verwendungen als Liste mit Links. Gleiche Präsentation (Entwurf + veröffentlicht) wird zusammengefasst. */
export function usageList(usages = [], { onNavigate = null } = {}) {
  const merged = new Map();
  for (const u of usages) {
    const key = `${u.type}:${u.id}`;
    const prev = merged.get(key);
    merged.set(key, { ...u, published: !!(u.published || prev?.published) });
  }
  if (!merged.size) return h('p', { class: 'text-2' }, 'Wird derzeit nirgends verwendet.');
  return h('ul', { class: 'cu-usages' }, [...merged.values()].map((u) => {
    const t = USAGE[u.type] || { label: u.type, icon: 'link', href: () => null };
    const href = t.href(u.id, u);
    return h('li', {},
      icon(t.icon),
      h('span', { class: 'text-2' }, `${t.label}:`),
      href ? h('a', { href, onClick: () => onNavigate?.() }, u.name || `#${u.id}`) : h('span', {}, u.name || `#${u.id}`),
      u.published ? chip('success', 'veröffentlicht', 'check-circle', { size: 'sm' }) : null);
  }));
}

/** Dialog „kann nicht gelöscht werden – wird verwendet“ (409 in_use). */
export function showInUse({ title, message = null, usages = [] }) {
  let dlg = null;
  dlg = openDialog({
    title,
    size: 'sm',
    content: h('div', { class: 'stack stack--sm' },
      h('p', {}, message || 'Der Eintrag wird noch verwendet. Bitte zuerst dort entfernen oder ersetzen:'),
      usageList(usages, { onNavigate: () => dlg?.close() })),
    actions: [{ label: 'Schließen', variant: 'primary' }],
  });
  return dlg.result;
}

// ---------- Screenreader-Ansagen (z. B. „Folie nach Position 3 verschoben“) ----------
let liveEl = null;
export function announce(text) {
  if (!liveEl || !liveEl.isConnected) {
    liveEl = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
    document.body.append(liveEl);
  }
  liveEl.textContent = '';
  setTimeout(() => { liveEl.textContent = text; }, 30);
}

/** Speichert kleine UI-Vorlieben (Raster/Liste …) – Fehler (privater Modus) werden ignoriert. */
export const prefs = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(`stelecms.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`stelecms.${key}`, JSON.stringify(value)); } catch { /* ignorieren */ }
  },
};

/** Tiefe Kopie für JSON-Daten. */
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Vergleich zweier JSON-Stände (für „ungespeichert“). */
export const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
