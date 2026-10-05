// Gestaltungs-Bausteine für Design- und Info-Folien-Editor (SPEC §5.4, §5.5):
// Schriftwahl (mitgeliefert + hochgeladen) mit Schriftprobe, Auswahl mit „erben“, Farbpaletten, Schrift hochladen.
//
//   await loadFonts(ctx.signal);
//   const pick = fontPicker({ label: 'Schrift Überschriften', value: s.heading_font, inheritLabel: 'Wie Design', onChange: (v) => { s.heading_font = v; changed(); } });
//   const w = inheritSelect({ label: 'Stärke', value: s.heading_weight, options: WEIGHTS, inheritLabel: 'Wie Design', onChange: … });
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api, errorMessage } from '../api.js';
import { can } from '../session.js';
import { field, input, select } from './form.js';
import { button } from './page.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { contentStyles } from './content-common.js';
import { BUILTIN_FONTS, fontStack, registerFonts } from '/shared/fonts.js';

export const WEIGHTS = [
  { value: 300, label: 'Leicht (300)' }, { value: 400, label: 'Normal (400)' }, { value: 500, label: 'Mittel (500)' },
  { value: 600, label: 'Halbfett (600)' }, { value: 700, label: 'Fett (700)' }, { value: 800, label: 'Extrafett (800)' },
  { value: 900, label: 'Schwarz (900)' },
];
export const LINE_HEIGHTS = [
  { value: 1.2, label: 'Eng (1,2)' }, { value: 1.3, label: 'Kompakt (1,3)' }, { value: 1.4, label: 'Normal (1,4)' },
  { value: 1.55, label: 'Luftig (1,55)' }, { value: 1.7, label: 'Weit (1,7)' },
];
export const TRACKINGS = [
  { value: -0.03, label: 'Eng' }, { value: 0, label: 'Normal' }, { value: 0.04, label: 'Weit' }, { value: 0.1, label: 'Sehr weit' },
];
export const CASES = [{ value: 'none', label: 'Wie eingegeben' }, { value: 'upper', label: 'GROSSBUCHSTABEN' }];

// Farbpaletten: Hintergrund, Text, Akzent (+ optional Verlaufsfarbe); Kontrast Text/Hintergrund ≥ 4,5:1
export const PALETTES = [
  { id: 'night', label: 'Nachtblau und Gold', bg: '#0F2747', text: '#FFFFFF', accent: '#F5B400' },
  { id: 'night-grad', label: 'Blauer Verlauf', bg: '#0F2747', bg2: '#1E5AA8', text: '#FFFFFF', accent: '#F5B400' },
  { id: 'cream', label: 'Hell (Creme)', bg: '#F4F1EA', text: '#111827', accent: '#1E5AA8' },
  { id: 'white', label: 'Weiß', bg: '#FFFFFF', text: '#111827', accent: '#9F1D2D' },
  { id: 'dark', label: 'Dunkel', bg: '#111827', text: '#FFFFFF', accent: '#F5B400' },
  { id: 'contrast', label: 'Hoher Kontrast', bg: '#000000', text: '#FFFFFF', accent: '#FFD400' },
  { id: 'forest', label: 'Waldgrün', bg: '#2F6F4E', bg2: '#1F4A34', text: '#FFFFFF', accent: '#F5D06F' },
  { id: 'violet', label: 'Violett', bg: '#5B3E96', bg2: '#3B2766', text: '#FFFFFF', accent: '#F5B400' },
  { id: 'wine', label: 'Weinrot', bg: '#9F1D2D', text: '#FFFFFF', accent: '#F4F1EA' },
];

let customFonts = [];
const listeners = new Set();

/** Hochgeladene Schriften laden und im Admin-Dokument anmelden (für Schriftproben). */
export async function loadFonts(signal) {
  try {
    const res = await api.get('/api/fonts', { signal });
    setCustomFonts(res.items || []);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    customFonts = []; // ohne Liste bleiben die mitgelieferten Schriften wählbar
  }
  return customFonts;
}

function setCustomFonts(items) {
  customFonts = items;
  registerFonts(Object.fromEntries(items.map((f) => [f.key, { url: f.url, weight: f.weight }])));
  listeners.forEach((fn) => fn());
}

export function fontLabel(key) {
  const b = BUILTIN_FONTS.find((f) => f.key === key);
  if (b) return b.label;
  return customFonts.find((f) => f.key === key)?.name || 'Unbekannte Schrift';
}

function fontOptions(inheritLabel) {
  const opts = [];
  if (inheritLabel) opts.push({ value: '', label: inheritLabel });
  opts.push({ group: 'Mitgeliefert', options: BUILTIN_FONTS.map((f) => ({ value: f.key, label: `${f.label} – ${f.kind}` })) });
  if (customFonts.length) opts.push({ group: 'Hochgeladen', options: customFonts.map((f) => ({ value: f.key, label: f.name })) });
  return opts;
}

/**
 * Schriftwahl mit Probe in der gewählten Schrift. value: Schlüssel oder null (= inheritLabel).
 * Mit Recht „Designs bearbeiten“ zusätzlich „Schrift hochladen …“ (neue Schrift wird direkt gewählt).
 */
export function fontPicker({ label, value = null, inheritLabel = null, inheritStack = null, hint = null, disabled = false, onChange }) {
  contentStyles();
  let current = value;
  const sample = h('p', { class: 'ty-sample', 'aria-hidden': 'true' }, 'Aa Ää Öö Üü ß – 0123 10:30 Uhr');
  let sel;
  const build = () => {
    const next = select({ value: current ?? '', options: fontOptions(inheritLabel), disabled, 'aria-label': label, onChange: (v) => set(v || null, true) });
    if (sel) sel.replaceWith(next);
    sel = next;
  };
  function set(v, fire) {
    current = v;
    if (sel.value !== (v ?? '')) sel.value = v ?? '';
    sample.style.fontFamily = fontStack(v) || (typeof inheritStack === 'function' ? inheritStack() : inheritStack) || '';
    if (fire) onChange?.(v);
  }
  build();
  const onList = () => { build(); set(current, false); };
  listeners.add(onList);
  const upload = !disabled && can('designs.edit')
    ? button({ label: 'Schrift hochladen …', icon: 'upload', variant: 'ghost', size: 'sm', onClick: async () => {
      const font = await uploadFontDialog();
      if (font) set(font.key, true);
    } })
    : null;
  const el = field({ label, hint, control: h('div', { class: 'ty-font' }, h('div', { class: 'ty-font__row' }, sel, upload), sample) });
  el.setValue = (v) => set(v, false);
  el.refreshSample = () => set(current, false);
  el.destroy = () => listeners.delete(onList);
  set(current, false);
  return el;
}

/** Auswahl aus festen Stufen mit „erben“ (null). options: [{value, label}] mit Zahlen oder Texten. */
export function inheritSelect({ label, value = null, options, inheritLabel, hint = null, disabled = false, onChange }) {
  const opts = [{ value: '', label: inheritLabel }, ...options.map((o) => ({ value: String(o.value), label: o.label }))];
  // Gespeicherter Wert außerhalb der Stufen (z. B. per API gesetzt) bleibt als eigene Option erhalten
  if (value !== null && !options.some((o) => o.value === value)) opts.push({ value: String(value), label: `Eigener Wert (${value})` });
  const toValue = (s) => (s === '' ? null : (options.find((o) => String(o.value) === s)?.value ?? value));
  const sel = select({ value: value === null ? '' : String(value), options: opts, disabled, 'aria-label': label, onChange: (s) => onChange?.(toValue(s)) });
  return field({ label, hint, control: sel });
}

/** Palettenleiste: Klick übernimmt die Farben (Aufrufer setzt sie und aktualisiert die Farbfelder). */
export function paletteRow({ onPick, disabled = false, label = 'Farbpaletten' }) {
  contentStyles();
  return h('div', { class: 'ty-palettes', role: 'group', 'aria-label': label }, PALETTES.map((p) => h('button', {
    type: 'button', class: 'ty-palette', disabled, title: p.label,
    'aria-label': `Palette „${p.label}“ übernehmen`,
    style: { '--pal-bg': p.bg, '--pal-bg2': p.bg2 || p.bg, '--pal-fg': p.text, '--pal-accent': p.accent },
    onClick: () => onPick(p),
  }, h('span', { class: 'ty-palette__sample', 'aria-hidden': 'true' }, h('span', { class: 'ty-palette__aa' }, 'Aa'), h('span', { class: 'ty-palette__dot' })),
  h('span', { class: 'ty-palette__label' }, p.label))));
}

/** Dialog „Schrift hochladen“: Datei, Name, Stärke. Ergebnis: Schrift der API oder null. */
export function uploadFontDialog() {
  const fileIn = h('input', { type: 'file', class: 'input', accept: '.woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf', 'aria-label': 'Schriftdatei' });
  const nameIn = input({ value: '', maxLength: 80, placeholder: 'z. B. Hausschrift Fett' });
  const weightSel = select({ value: 'variable', options: [{ value: 'variable', label: 'Variable Schrift (alle Stärken in einer Datei)' }, ...WEIGHTS.map((w) => ({ value: String(w.value), label: w.label }))] });
  const err = h('div', { class: 'field__error', role: 'alert', hidden: true });
  fileIn.addEventListener('change', () => {
    const f = fileIn.files?.[0];
    if (f && !nameIn.value.trim()) nameIn.value = f.name.replace(/\.[^.]+$/, '').slice(0, 80);
    const m = f && /(thin|extralight|light|regular|medium|semibold|bold|extrabold|black)/i.exec(f.name);
    const guess = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
    if (m && !/variable|\[wght\]|-vf/i.test(f.name)) weightSel.value = String(guess[m[1].toLowerCase()]);
  });
  const content = h('div', { class: 'form' },
    field({ label: 'Datei', required: true, control: fileIn, hint: 'WOFF2, WOFF, TTF oder OTF, höchstens 8 MB. Nur Schriften verwenden, deren Lizenz die Nutzung auf Bildschirmen erlaubt.' }),
    field({ label: 'Name', optional: true, control: nameIn, hint: 'Leer = Dateiname.' }),
    field({ label: 'Schriftstärke der Datei', control: weightSel, hint: 'Mehrere Stärken (z. B. Normal und Fett) einzeln hochladen – je Datei eine Schrift.' }),
    err);
  const d = openDialog({
    title: 'Schrift hochladen', size: 'sm', content,
    actions: [
      { label: 'Abbrechen', value: null },
      { label: 'Hochladen', variant: 'primary', onClick: async () => {
        const f = fileIn.files?.[0];
        const fail = (msg) => { err.replaceChildren(icon('alert-circle', { size: 16 }), msg); err.hidden = false; return false; };
        if (!f) return fail('Bitte eine Schriftdatei auswählen.');
        const fd = new FormData();
        fd.append('file', f);
        fd.append('name', nameIn.value.trim());
        fd.append('weight', weightSel.value);
        try {
          const font = await api.upload('/api/fonts', fd);
          setCustomFonts([...customFonts, font].sort((a, b) => a.name.localeCompare(b.name, 'de')));
          toast.success(`Schrift „${font.name}“ hochgeladen.`);
          return font;
        } catch (e) { return fail(errorMessage(e)); }
      } },
    ],
  });
  return d.result.then((r) => (r && typeof r === 'object' ? r : null));
}

