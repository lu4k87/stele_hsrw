// Info-Folie: fünf Vorlagen (title_text, image_text, statement, event, list) als HTML/CSS.
// Klare Typohierarchie, Ränder ≥ 72 px, Größenstufe s/m/l, Fit-Text bis zur Mindestgröße.

import { h, clamp, readableTextColor, safeColor } from '../util.js';
import { TEXT_STYLE_DEFAULTS, mergeDefaults } from '../config.js';
import { iconSvg } from '/shared/icons.js';
import { qrSvg } from '/shared/qr.js';
import { fontStack, fontsReady } from '/shared/fonts.js';
import { baseView, durationMs, decodeImage, textParagraphs } from './common.js';
import { fitBox } from './fit.js';

const TEMPLATES = ['title_text', 'image_text', 'statement', 'event', 'list'];
const BODY_PX = { s: 42, m: 48, l: 56 };
const MIN_BODY_PX = 30; // Fit-Text verkleinert Fließtext höchstens bis hierhin
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

// Typografie (Design-Theme und Info-Folie): Feld → CSS-Variable; null/fehlend = erben (Bühne bzw. CSS-Standard)
export const TYPO_VARS = [
  ['heading_weight', '--tx-w-heading', (v) => String(v)],
  ['body_weight', '--tx-w-body', (v) => String(v)],
  ['line_height', '--tx-lh', (v) => String(v)],
  ['heading_tracking', '--tx-track', (v) => `${v}em`],
  ['heading_case', '--tx-case', (v) => (v === 'upper' ? 'uppercase' : 'none')],
];

const isSet = (v) => v !== null && v !== undefined;

// Feingestaltung der Folie als CSS-Variablen; nur gesetzte Werte überschreiben das Design.
function styleVars(style, bg) {
  const vars = {};
  for (const [key, prop, fmt] of TYPO_VARS) if (isSet(style[key])) vars[prop] = fmt(style[key]);
  const heading = fontStack(style.heading_font);
  const body = fontStack(style.body_font);
  if (body) vars['--tx-font'] = body;
  if (heading) vars['--font-heading'] = heading;
  else if (body) vars['--font-heading'] = body;
  if (isSet(style.heading_scale)) vars['--tx-hs'] = String(clamp(Number(style.heading_scale) || 2.15, 1.2, 3.5));
  if (isSet(style.title_color)) vars['--tx-title'] = safeColor(style.title_color, 'inherit');
  if (isSet(style.subtitle_color)) vars['--tx-sub'] = safeColor(style.subtitle_color, 'inherit');
  if (isSet(style.bg_color2)) {
    const angle = clamp(Number.isFinite(Number(style.bg_angle)) && isSet(style.bg_angle) ? Number(style.bg_angle) : 180, 0, 360);
    vars['--tx-grad'] = `linear-gradient(${angle}deg, ${bg}, ${safeColor(style.bg_color2, bg)})`;
  }
  if (isSet(style.box_color)) vars['--tx-box'] = safeColor(style.box_color, bg);
  if (isSet(style.box_radius)) vars['--tx-box-r'] = `${clamp(Number(style.box_radius) || 0, 0, 80)}px`;
  return vars;
}

const dateLong = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const monthShort = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', month: 'short' });

// „2026-10-17“ oder „17.10.2026“ → Date (UTC); sonst null (Freitext bleibt unverändert).
function parseEventDate(value) {
  const s = String(value || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let y; let mo; let d;
  if (m) { [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]; } else {
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

// „18:00“ → „18:00 Uhr“, „18:00-20:00“ → „18:00 – 20:00 Uhr“; Freitext unverändert.
function formatEventTime(value) {
  const s = String(value || '').trim();
  const m = /^(\d{1,2}[:.]\d{2})(?:\s*[-–]\s*(\d{1,2}[:.]\d{2}))?$/.exec(s);
  if (!m) return s;
  return m[2] ? `${m[1]} – ${m[2]} Uhr` : `${m[1]} Uhr`;
}

function el(tag, cls, text) {
  return text ? h(tag, { class: cls, text }) : null;
}

function bodyBlock(text, cls = 'tx-body') {
  const nodes = textParagraphs(text);
  return nodes.length ? h('div', { class: cls }, nodes) : null;
}

function buildTitleText(f) {
  return [
    h('div', { class: 'tx-rule', 'aria-hidden': 'true' }),
    el('h1', 'tx-title', f.title),
    el('p', 'tx-subtitle', f.subtitle),
    bodyBlock(f.body),
  ];
}

function buildStatement(f) {
  return [
    h('div', { class: 'tx-quote', 'aria-hidden': 'true', text: '\u201C' }),
    el('h1', 'tx-title', f.title),
    f.subtitle ? h('p', { class: 'tx-attrib', text: `— ${f.subtitle}` }) : null,
    bodyBlock(f.body),
  ];
}

function buildEvent(f) {
  const date = parseEventDate(f.date);
  const badge = date ? h('div', { class: 'tx-datebadge', 'aria-hidden': 'true' },
    h('span', { class: 'tx-badge-day', text: String(date.getUTCDate()) }),
    h('span', { class: 'tx-badge-month', text: monthShort.format(date).replace('.', '') })) : null;
  const top = badge || f.subtitle ? h('div', { class: 'tx-event-top' }, badge, el('p', 'tx-kicker', f.subtitle)) : null;
  const facts = [
    ['users', String(f.audience || '').trim()],
    ['calendar', date ? dateLong.format(date) : String(f.date || '').trim()],
    ['clock', formatEventTime(f.time)],
    ['map-pin', String(f.location || '').trim()],
    ['ticket', String(f.admission || '').trim()],
  ].filter(([, text]) => text);
  const list = facts.length ? h('ul', { class: 'tx-facts' }, facts.map(([icon, text]) => h('li', null,
    iconSvg(icon, { size: 48 }), h('span', { text })))) : null;
  return [top, el('h1', 'tx-title', f.title), list, bodyBlock(f.body)];
}

// QR-Code (alle Vorlagen): dunkel auf weiß mit Ruhezone, darunter optional eine Beschriftung.
function buildQr(f) {
  const url = String(f.qr_url || '').trim();
  const svg = url ? qrSvg(url, { title: f.qr_label || 'QR-Code' }) : null;
  if (!svg) return null;
  return h('div', { class: 'tx-qr' },
    h('div', { class: 'tx-qr-code' }, svg),
    el('p', 'tx-qr-label', String(f.qr_label || '').trim()));
}

function buildList(f) {
  let items = Array.isArray(f.items) ? f.items.map((s) => String(s || '').trim()).filter(Boolean) : [];
  let body = f.body;
  if (!items.length && body) { // ohne Punkte: Zeilen des Textes als Liste
    items = String(body).split(/\n+/).map((s) => s.trim()).filter(Boolean);
    body = '';
  }
  const list = items.length ? h('ul', { class: 'tx-list-items' }, items.map((text) => h('li', null,
    h('span', { class: 'tx-bullet', 'aria-hidden': 'true' }), h('span', { class: 'tx-item-text', text })))) : null;
  return [
    h('div', { class: 'tx-rule', 'aria-hidden': 'true' }),
    el('h1', 'tx-title', f.title),
    el('p', 'tx-subtitle', f.subtitle),
    list,
    bodyBlock(body),
  ];
}

// Baut die DOM-Struktur einer Info-Folie (auch für Touch-Inhalte und die Einzelfolien-Vorschau).
export function buildTextSlide(slide) {
  const f = slide.fields || {};
  const style = mergeDefaults(TEXT_STYLE_DEFAULTS, slide.style);
  const template = TEMPLATES.includes(slide.template) ? slide.template : 'title_text';
  const hasImage = template === 'image_text' && Boolean(f.image_url);
  const layout = template === 'image_text' && !hasImage ? 'title_text' : template;
  const size = ['s', 'm', 'l'].includes(style.size) ? style.size : 'm';
  const align = style.align === 'center' ? 'center' : 'left';
  const bg = safeColor(style.bg_color, TEXT_STYLE_DEFAULTS.bg_color);
  const fg = safeColor(style.text_color, TEXT_STYLE_DEFAULTS.text_color);
  const accent = safeColor(style.accent_color, TEXT_STYLE_DEFAULTS.accent_color);
  const bodyPx = isSet(style.body_px) ? clamp(Number(style.body_px) || BODY_PX[size], 28, 96) : BODY_PX[size];
  const cls = [`sv sv-text tx tx-${layout} tx-size-${size} tx-align-${align}`];
  if (['s', 'l'].includes(style.padding)) cls.push(`tx-pad-${style.padding}`);
  if (['top', 'bottom'].includes(style.valign)) cls.push(`tx-valign-${style.valign}`);
  if (['solid', 'glass'].includes(style.box)) cls.push(`tx-box tx-box-${style.box}`);
  if (style.rule === false) cls.push('tx-norule');
  const root = h('div', {
    class: cls.join(' '),
    lang: 'de',
    style: { '--tx-bg': bg, '--tx-fg': fg, '--tx-accent': accent, '--tx-on-accent': readableTextColor(accent), '--body': String(bodyPx), ...styleVars(style, bg) },
  });
  const images = [];
  if (style.bg_image_url) {
    const bgImg = h('img', { class: 'tx-bgimg', alt: '', decoding: 'async', draggable: 'false', src: style.bg_image_url });
    images.push(bgImg);
    root.append(bgImg, h('div', { class: 'tx-shade', style: { '--tx-shade': clamp(Number(style.overlay) || 0, 0, 0.8) } }));
  }
  if (hasImage) {
    const img = h('img', { alt: '', decoding: 'async', draggable: 'false', src: f.image_url });
    images.push(img);
    root.appendChild(h('div', { class: 'tx-media' }, img));
  }
  let children;
  if (layout === 'statement') children = buildStatement(f);
  else if (layout === 'event') children = buildEvent(f);
  else if (layout === 'list') children = buildList(f);
  else children = buildTitleText(f);
  const content = h('div', { class: 'tx-content' }, children, buildQr(f));
  root.appendChild(content);
  // Logo des Designs in einer Ecke (Bild kommt per --logo-url von der Bühne; ohne Logo bleibt die Ecke leer)
  if (CORNERS.includes(style.logo_corner)) root.appendChild(h('div', { class: `tx-logo tx-logo--${style.logo_corner}`, 'aria-hidden': 'true' }));
  const minK = clamp(MIN_BODY_PX / bodyPx, 0.5, 1);
  return { root, content, images, minK, bodyPx, fonts: [style.heading_font, style.body_font].filter(isSet) };
}

// Fit-Ergebnis als DOM-Ereignis melden (Einzelfolien-Vorschau reicht es an den Editor weiter)
function fit(root, content, minK, bodyPx) {
  const k = fitBox(root, content, { min: minK });
  root.dispatchEvent(new CustomEvent('tx:fit', { bubbles: true, detail: { body_px: Math.round(bodyPx * k), clipped: content.classList.contains('is-clipped') } }));
}

export function createTextSlide(slide, ctx) {
  const { root, content, images, minK, bodyPx, fonts } = buildTextSlide(slide);
  const view = baseView(root);
  view.plannedMs = durationMs(slide, ctx.settings);
  view.load = async () => {
    // Fehlende Bilder blenden nur das Bild aus – die Folie bleibt lesbar.
    await Promise.all(images.map((img) => decodeImage(img, 10_000).catch(() => img.classList.add('is-missing'))));
    await fontsReady(fonts); // Textmaße erst mit der echten Schrift (sonst passt Fit-Text nicht)
    fit(root, content, minK, bodyPx);
  };
  view.refit = () => fit(root, content, minK, bodyPx);
  view.destroy = () => {
    images.forEach((img) => img.removeAttribute('src'));
    root.remove();
  };
  return view;
}
