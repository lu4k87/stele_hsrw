// Konstanten, Standardwerte (SPEC §5) und Normalisierung der Eingangsdaten.

export const PLAYER_VERSION = '1.0.0';
export const DEFAULT_STAGE = Object.freeze({ width: 1080, height: 1920 });
export const DEFAULT_TIMEZONE = 'Europe/Berlin';

export const TIMING = Object.freeze({
  heartbeatMs: 15_000,
  scheduleCheckMs: 15_000,
  switchMaxWaitMs: 30_000,      // Präsentationswechsel spätestens nach 30 s
  watchdogGraceMs: 30_000,      // Folie hängt: Dauer + 30 s
  prepareTimeoutMs: 20_000,     // Obergrenze für das Vorbereiten einer Folie
  imageTimeoutMs: 15_000,
  videoTimeoutMs: 8_000,
  iframeTimeoutMs: 10_000,
  fatalReloadDelayMs: 10_000,
  fatalReloadMinGapMs: 5 * 60_000,
  identifyMs: 10_000,
  diagnosticsCloseMs: 30_000,
  stillThereCountdownS: 10,
  pairingPollMs: 3_000,
  mirrorPollMs: 30_000,
  prefetchRepeatMs: 10 * 60_000,
  authFailuresBeforePairing: 3,
});

export const SLIDESHOW_DEFAULTS = Object.freeze({
  default_duration_s: 10,
  transition: 'fade',
  transition_ms: 800,
  order: 'sequential',
  image_fit: 'cover',
  ken_burns: false,
  video_sound: false,
  video_play_to_end: true,
  background: '#000000',
  show_header: true,
  show_footer: true,
  show_progress: false,
  caption_style: 'bar',
});

export const STELE_DEFAULTS = Object.freeze({
  volume: 0.8,
  touch_enabled: true,
  night_mode: { enabled: false, start: '22:00', end: '06:00' },
  daily_reload: '03:30',
  show_cursor: false,
});

export const DESIGN_DEFAULTS = Object.freeze({
  header: {
    enabled: true, height: 180, bg_color: '#0F2747', text_color: '#FFFFFF',
    logo_content_id: null, logo_position: 'left', title: 'Willkommen', subtitle: '',
    show_clock: true, show_date: true, date_format: 'long',
  },
  footer: {
    enabled: true, height: 96, bg_color: '#0F2747', text_color: '#FFFFFF',
    mode: 'ticker', text: '', ticker_items: [], ticker_rss_url: '', ticker_speed: 120, ticker_separator: '•',
  },
  theme: { font: 'sans', accent_color: '#F5B400' },
  logo_url: null,
});

export const TOUCH_DEFAULTS = Object.freeze({
  title: 'Informationen',
  intro: 'Bitte ein Thema wählen',
  columns: 2,
  idle_timeout_s: 60,
  attract: { enabled: true, text: 'Tippen für Informationen' },
  tiles: [],
});

export const TEXT_STYLE_DEFAULTS = Object.freeze({
  bg_color: '#0F2747', text_color: '#FFFFFF', accent_color: '#F5B400',
  bg_image_url: null, overlay: 0.4, align: 'left', size: 'm',
});

export const TRANSITIONS = ['none', 'fade', 'slide-left', 'slide-up', 'zoom'];

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}

// Fehlende Schlüssel rekursiv auffüllen; zusätzliche Schlüssel (z. B. logo_url) bleiben erhalten.
export function mergeDefaults(defaults, value) {
  const src = isPlainObject(value) ? value : {};
  const out = {};
  for (const [key, def] of Object.entries(defaults)) {
    const v = src[key];
    if (isPlainObject(def)) out[key] = mergeDefaults(def, v);
    else if (v === undefined || (v === null && def !== null)) out[key] = clone(def);
    else out[key] = clone(v);
  }
  for (const [key, v] of Object.entries(src)) if (!(key in out)) out[key] = clone(v);
  return out;
}

// Design aus Manifest ({…config, logo_url}) oder aus der Admin-API ({id, name, config, logo_url}).
export function normalizeDesign(input) {
  if (!isPlainObject(input)) return null;
  const cfg = isPlainObject(input.config)
    ? { ...input.config, logo_url: input.logo_url ?? input.config.logo_url ?? null }
    : input;
  return mergeDefaults(DESIGN_DEFAULTS, cfg);
}

// Touch-Menü aus Manifest (aufgelöst) oder Admin-API ({id, name, config}).
export function normalizeTouchMenu(input) {
  if (!isPlainObject(input)) return null;
  const cfg = isPlainObject(input.config) ? input.config : input;
  const menu = mergeDefaults(TOUCH_DEFAULTS, cfg);
  menu.tiles = Array.isArray(cfg.tiles) ? cfg.tiles.filter(isPlainObject).slice(0, 12) : [];
  menu.columns = [1, 2, 3].includes(Number(menu.columns)) ? Number(menu.columns) : 2;
  menu.idle_timeout_s = Math.min(600, Math.max(15, Number(menu.idle_timeout_s) || 60));
  return menu;
}

export function normalizeSettings(input) {
  const s = mergeDefaults(SLIDESHOW_DEFAULTS, input);
  s.transition_ms = Math.min(3000, Math.max(0, Number(s.transition_ms) || 0));
  s.default_duration_s = Math.min(600, Math.max(2, Number(s.default_duration_s) || 10));
  if (!TRANSITIONS.includes(s.transition)) s.transition = 'fade';
  return s;
}

export function normalizeSteleSettings(input) {
  const s = mergeDefaults(STELE_DEFAULTS, input);
  s.volume = Math.min(1, Math.max(0, Number(s.volume)));
  if (!Number.isFinite(s.volume)) s.volume = 0.8;
  return s;
}
