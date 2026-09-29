// Kleine DOM-, Zeit- und Farb-Helfer ohne Abhängigkeiten.

// Element erzeugen: h('div', { class, text, style: {'--x': 1}, onclick }, ...kinder)
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = String(value);
      else if (key === 'style') {
        for (const [prop, v] of Object.entries(value)) {
          if (v !== null && v !== undefined) el.style.setProperty(prop, String(v));
        }
      } else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function withTimeout(promise, ms, message = 'Zeitüberschreitung') {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Wartet auf eines der okEvents; errorEvents oder Zeitüberschreitung → Fehler.
export function waitForEvent(target, okEvents, errorEvents = ['error'], ms = 0, message = 'Zeitüberschreitung') {
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      okEvents.forEach((e) => target.removeEventListener(e, onOk));
      errorEvents.forEach((e) => target.removeEventListener(e, onErr));
      if (timer) clearTimeout(timer);
    };
    const onOk = (ev) => { cleanup(); resolve(ev); };
    const onErr = (ev) => { cleanup(); reject(ev instanceof Error ? ev : new Error(`Ereignis „${ev?.type}“`)); };
    okEvents.forEach((e) => target.addEventListener(e, onOk, { once: true }));
    errorEvents.forEach((e) => target.addEventListener(e, onErr, { once: true }));
    if (ms > 0) timer = setTimeout(() => { cleanup(); reject(new Error(message)); }, ms);
  });
}

// UTC-Zeitstempel ohne Millisekunden: 2026-09-30T08:15:00Z
export function isoUtc(ms = Date.now()) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function randomId(prefix = '') {
  const bytes = new Uint8Array(8);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let v = m[1];
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relLuminance({ r, g, b }) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Gut lesbare Schriftfarbe (weiß oder fast schwarz) auf einer Hintergrundfarbe.
export function readableTextColor(bg) {
  const rgb = hexToRgb(bg);
  if (!rgb) return '#FFFFFF';
  const l = relLuminance(rgb);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastDark = (l + 0.05) / 0.0625; // gegen #111 (L ≈ 0.0125)
  return contrastWhite >= contrastDark ? '#FFFFFF' : '#111111';
}

export function safeColor(value, fallback) {
  return hexToRgb(value) ? String(value).trim() : fallback;
}

// Pausierbarer Einmal-Timer (für Foliendauern, PDF-Seiten, Countdown).
export class PausableTimer {
  constructor(fn, ms) {
    this.fn = fn;
    this.remainingMs = Math.max(0, ms);
    this.id = null;
    this.startedAt = 0;
    this.done = false;
  }

  start() {
    if (this.done || this.id !== null) return;
    this.startedAt = performance.now();
    this.id = setTimeout(() => { this.id = null; this.done = true; this.fn(); }, this.remainingMs);
  }

  pause() {
    if (this.id === null) return;
    clearTimeout(this.id);
    this.id = null;
    this.remainingMs = Math.max(0, this.remainingMs - (performance.now() - this.startedAt));
  }

  resume() { this.start(); }

  get remaining() {
    if (this.done) return 0;
    return this.id === null ? this.remainingMs : Math.max(0, this.remainingMs - (performance.now() - this.startedAt));
  }

  clear() {
    if (this.id !== null) clearTimeout(this.id);
    this.id = null;
    this.done = true;
  }
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60);
  if (d) return `${d} T ${hh} h`;
  if (hh) return `${hh} h ${mm} min`;
  if (mm) return `${mm} min ${s % 60} s`;
  return `${s} s`;
}

export function formatClockTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
