// Zoom der Admin-Oberfläche (80–150 %), gespeichert im Browser, Tasten Strg + / Strg – / Strg 0.
//
// Umsetzung mit CSS `zoom` auf <html>. Damit sich das Layout wie beim Browser-Zoom verhält:
//  - Viewport-Einheiten laufen über --vh/--vw (tokens.css), die durch --ui-zoom geteilt werden;
//  - Breiten-Umbruchpunkte (@media … px) werden mit dem Zoom-Faktor umgerechnet, auch für
//    später nachgeladene Ansichts-Styles.
// Position fester Elemente aus getBoundingClientRect() (sichtbare Pixel) mit toCssPx() umrechnen.

const KEY = 'stelecms.zoom';
export const ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

let current = 1;
const listeners = new Set();
const originalMedia = new WeakMap();

export function getZoom() { return current; }

/** Sichtbare Pixel (Rects, Zeigerposition) → CSS-Pixel für style.left/top innerhalb des gezoomten Dokuments. */
export function toCssPx(px) { return px / current; }

export function formatZoom(z = current) { return `${Math.round(z * 100)} %`; }

function readPref() {
  try {
    const z = Number(localStorage.getItem(KEY));
    return ZOOM_LEVELS.includes(z) ? z : 1;
  } catch { return 1; }
}

function writePref(z) {
  try {
    if (z === 1) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(z));
  } catch { /* Speicher nicht verfügbar – gilt nur für diese Sitzung */ }
}

// Breitenangaben in Media Queries (min-/max-width in px) mit dem Faktor multiplizieren.
function scaleMediaText(text, z) {
  return text.replace(/((?:min|max)-width\s*:\s*)(\d+(?:\.\d+)?)px/g, (_, prop, px) => `${prop}${Math.round(Number(px) * z * 100) / 100}px`);
}

function scaleRules(rules, z) {
  for (const rule of rules) {
    if (rule instanceof CSSMediaRule) {
      if (!originalMedia.has(rule)) originalMedia.set(rule, rule.media.mediaText);
      const orig = originalMedia.get(rule);
      if (/(?:min|max)-width/.test(orig)) {
        const next = z === 1 ? orig : scaleMediaText(orig, z);
        if (rule.media.mediaText !== next) rule.media.mediaText = next;
      }
    }
    if (rule.cssRules) scaleRules(rule.cssRules, z);
  }
}

function scaleSheet(sheet, z) {
  let rules;
  try { rules = sheet.cssRules; } catch { return; } // fremde Herkunft – nicht lesbar
  if (rules) scaleRules(rules, z);
}

function scaleAllSheets(z) {
  for (const sheet of document.styleSheets) scaleSheet(sheet, z);
}

function apply(z) {
  current = z;
  const root = document.documentElement;
  if (z === 1) {
    root.style.removeProperty('zoom');
    root.style.removeProperty('--ui-zoom');
  } else {
    root.style.zoom = String(z);
    root.style.setProperty('--ui-zoom', String(z));
  }
  scaleAllSheets(z);
  for (const fn of listeners) fn(z);
}

export function setZoom(z) {
  const level = ZOOM_LEVELS.reduce((best, l) => (Math.abs(l - z) < Math.abs(best - z) ? l : best), 1);
  writePref(level);
  if (level !== current) apply(level);
}

export function stepZoom(dir) {
  const i = ZOOM_LEVELS.indexOf(current);
  const next = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + dir))];
  setZoom(next);
}

export function canZoom(dir) {
  const i = ZOOM_LEVELS.indexOf(current);
  return dir > 0 ? i < ZOOM_LEVELS.length - 1 : i > 0;
}

export function onZoomChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initZoom() {
  apply(readPref());
  // Nachgeladene Ansichts-Styles (useStyles) ebenfalls umrechnen
  document.addEventListener('load', (e) => {
    const el = e.target;
    if (el instanceof HTMLLinkElement && el.rel === 'stylesheet' && el.sheet) scaleSheet(el.sheet, current);
  }, true);
  // Strg/Cmd + Plus, Minus, 0: Oberflächen-Zoom statt Browser-Zoom (sonst würden sich beide addieren)
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { e.preventDefault(); stepZoom(1); }
    else if (e.key === '-' || e.code === 'NumpadSubtract') { e.preventDefault(); stepZoom(-1); }
    else if (e.key === '0' || e.code === 'Numpad0') { e.preventDefault(); setZoom(1); }
  });
}
