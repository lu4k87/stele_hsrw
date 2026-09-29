// Farbwahl mit Vorschlägen und Kontrastprüfung nach WCAG 2.2 (Text ≥ 4,5:1, große Schrift/Grafik ≥ 3:1).
//
//   const bg = colorChoice({ label: 'Hintergrund', value: style.bg_color, onChange: (v) => set('bg_color', v) });
//   const warn = contrastWarning();
//   warn.update([{ fg: style.text_color, bg: style.bg_color, label: 'Text auf Hintergrund' }]);
import { h, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { colorInput } from './form.js';
import { contentStyles } from './content-common.js';

export const COLOR_SUGGESTIONS = [
  { value: '#0F2747', label: 'Nachtblau' },
  { value: '#1E5AA8', label: 'Blau' },
  { value: '#2F6F4E', label: 'Grün' },
  { value: '#5B3E96', label: 'Violett' },
  { value: '#9F1D2D', label: 'Weinrot' },
  { value: '#F5B400', label: 'Gelb' },
  { value: '#F4F1EA', label: 'Creme' },
  { value: '#FFFFFF', label: 'Weiß' },
  { value: '#111827', label: 'Schwarz' },
];

const HEX = /^#([0-9a-f]{6})$/i;

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex) {
  if (!HEX.test(hex || '')) return null;
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** Kontrastverhältnis 1..21 (null bei ungültiger Farbe). */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
/** Mischt eine Farbe mit Schwarz (Abdunklung 0..1) – für Text über abgedunkeltem Bild. */
export function darken(hex, amount) {
  if (!HEX.test(hex || '')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.round(c * (1 - amount)).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`.toUpperCase();
}

export function colorChoice({ value = '#000000', onChange = null, label = 'Farbe', suggestions = COLOR_SUGGESTIONS } = {}) {
  contentStyles();
  let current = (value || '#000000').toUpperCase();
  const input = colorInput({ value: current, label, onChange: (v) => { current = v.toUpperCase(); mark(); onChange?.(current); } });
  const swatches = suggestions.map((s) => h('button', {
    type: 'button', class: 'cu-swatch', style: { '--sw': s.value },
    'aria-label': `${label}: ${s.label} (${s.value})`, title: `${s.label} ${s.value}`, 'aria-pressed': 'false',
    onClick: () => { current = s.value.toUpperCase(); input.setValue(current); mark(); onChange?.(current); },
  }));
  function mark() {
    swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(suggestions[i].value.toUpperCase() === current)));
  }
  mark();
  const el = h('div', { class: 'cu-color' }, input, h('div', { class: 'cu-swatches', role: 'group', 'aria-label': `Vorschläge für ${label}` }, swatches));
  el.input = input.input;
  el.setValue = (v) => { current = (v || '#000000').toUpperCase(); input.setValue(current); mark(); };
  el.getValue = () => current;
  return el;
}

/**
 * Kontrastwarnung (role=status). update(pairs) mit [{ fg, bg, label, min = 4.5 }].
 * Zeigt nur Paare unter dem Mindestwert – sonst nichts (keine Meldungsflut).
 */
export function contrastWarning() {
  const el = h('div', { role: 'status', 'aria-live': 'polite', hidden: true });
  el.update = (pairs = []) => {
    const bad = pairs
      .map((p) => ({ ...p, ratio: contrastRatio(p.fg, p.bg), min: p.min ?? 4.5 }))
      .filter((p) => p.ratio !== null && p.ratio < p.min);
    el.hidden = !bad.length;
    if (!bad.length) { fill(el); return; }
    const fmt = (r) => r.toLocaleString('de-DE', { maximumFractionDigits: 1 });
    fill(el, h('div', { class: 'alert alert--warning' },
      icon('alert-triangle'),
      h('div', { class: 'alert__body' },
        h('div', { class: 'alert__title' }, 'Kontrast zu gering – auf der Stele schlecht lesbar'),
        h('ul', { class: 'alert__text', style: { margin: 0 } }, bad.map((p) => h('li', {},
          `${p.label}: ${fmt(p.ratio)} : 1 (empfohlen mindestens ${fmt(p.min)} : 1)`))),
        h('div', { class: 'alert__text' }, 'Bitte eine hellere bzw. dunklere Farbe wählen.'))));
  };
  return el;
}
