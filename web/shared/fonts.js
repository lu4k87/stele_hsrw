// Schriften für Player und Admin (SPEC §5.5): mitgelieferte Familien (web/shared/fonts/, OFL) und
// hochgeladene Schriften (Schlüssel `custom-<id>`, Datei-URL aus `fonts` des Manifests bzw. GET /api/fonts).
// Der Server liest die Schlüssel aus BUILTIN_FONTS (schemas.builtin_font_keys) → Schlüssel nur ergänzen, nie umbenennen.

const SANS = '"Segoe UI", "Noto Sans", "Helvetica Neue", Arial, "Liberation Sans", sans-serif';
const SERIF = 'Georgia, "Noto Serif", "Times New Roman", "Liberation Serif", serif';
const NARROW = '"Arial Narrow", "Noto Sans Condensed", "Liberation Sans Narrow", sans-serif';

export const BUILTIN_FONTS = Object.freeze([
  { key: 'sans', label: 'Inter', kind: 'Serifenlos, klar', stack: `"Inter", ${SANS}` },
  { key: 'atkinson', label: 'Atkinson Hyperlegible Next', kind: 'Serifenlos, besonders gut lesbar', stack: `"Atkinson Hyperlegible Next", ${SANS}` },
  { key: 'montserrat', label: 'Montserrat', kind: 'Serifenlos, geometrisch', stack: `"Montserrat", ${SANS}` },
  { key: 'nunito', label: 'Nunito', kind: 'Serifenlos, gerundet', stack: `"Nunito", ${SANS}` },
  { key: 'condensed', label: 'Roboto Condensed', kind: 'Schmal, platzsparend', stack: `"Roboto Condensed", ${NARROW}` },
  { key: 'oswald', label: 'Oswald', kind: 'Schmal, kräftig – für Titel', stack: `"Oswald", ${NARROW}` },
  { key: 'bebas', label: 'Bebas Neue', kind: 'Plakativ, nur Großbuchstaben – für Titel', stack: `"Bebas Neue", "Oswald", ${NARROW}` },
  { key: 'serif', label: 'Source Serif 4', kind: 'Mit Serifen, ruhig', stack: `"Source Serif 4", ${SERIF}` },
  { key: 'lora', label: 'Lora', kind: 'Mit Serifen, weich', stack: `"Lora", ${SERIF}` },
  { key: 'playfair', label: 'Playfair Display', kind: 'Mit Serifen, elegant – für Titel', stack: `"Playfair Display", ${SERIF}` },
]);

const BY_KEY = new Map(BUILTIN_FONTS.map((f) => [f.key, f]));
const CUSTOM_RE = /^custom-(\d{1,9})$/;

export function isCustomFont(key) {
  return CUSTOM_RE.test(String(key || ''));
}

/** CSS-Familie für einen Schlüssel; unbekannt → null (Aufrufer nimmt den Standard). */
export function fontStack(key) {
  if (BY_KEY.has(key)) return BY_KEY.get(key).stack;
  const m = CUSTOM_RE.exec(String(key || ''));
  return m ? `"StelecmsFont${m[1]}", ${SANS}` : null;
}

const registered = new Map();

/**
 * Hochgeladene Schriften anmelden. `fonts`: {key: {url, weight}} (weight null = variable Schrift).
 * Bereits angemeldete Schlüssel mit gleicher URL bleiben unverändert.
 */
export function registerFonts(fonts) {
  if (!fonts || typeof fonts !== 'object' || typeof FontFace === 'undefined' || !document.fonts) return;
  for (const [key, f] of Object.entries(fonts)) {
    const m = CUSTOM_RE.exec(key);
    const url = f && typeof f.url === 'string' ? f.url : '';
    if (!m || !url.startsWith('/media/') || registered.get(key) === url) continue;
    const weight = Number.isInteger(f.weight) ? String(f.weight) : '100 1000';
    try {
      const face = new FontFace(`StelecmsFont${m[1]}`, `url("${encodeURI(url)}")`, { weight, display: 'swap' });
      document.fonts.add(face);
      registered.set(key, url);
    } catch { /* ungültige Datei: Ersatzschrift bleibt */ }
  }
}

/** Wartet (höchstens timeoutMs), bis die Schriften der Schlüssel geladen sind – für korrekte Textmaße. */
export function fontsReady(keys, timeoutMs = 3000) {
  if (!document.fonts) return Promise.resolve();
  const families = [...new Set(keys.map(fontStack).filter(Boolean))].map((s) => s.split(',')[0]);
  if (!families.length) return Promise.resolve();
  const loads = families.flatMap((fam) => ['400', '700'].map((w) => document.fonts.load(`${w} 40px ${fam}`).catch(() => null)));
  return Promise.race([Promise.all(loads), new Promise((resolve) => { setTimeout(resolve, timeoutMs); })]);
}
