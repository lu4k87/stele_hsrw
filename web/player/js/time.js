// Wanduhr in der eingestellten Zeitzone (Intl), unabhängig von der Zeitzone des Stelen-PCs.
// Optionaler Uhr-Abgleich mit der Serverzeit (Heartbeat), falls die PC-Uhr deutlich abweicht.

import { DEFAULT_TIMEZONE } from './config.js';

const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const partsFormatters = new Map();
const displayFormatters = new Map();

export function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz || DEFAULT_TIMEZONE });
    return tz || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function partsFormatter(tz) {
  let fmt = partsFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsFormatters.set(tz, fmt);
  }
  return fmt;
}

const pad2 = (n) => String(n).padStart(2, '0');

// Wanduhr-Bestandteile zum Zeitpunkt ms in Zeitzone tz.
export function wallParts(ms, tz) {
  const map = {};
  for (const p of partsFormatter(validTimezone(tz)).formatToParts(new Date(ms))) map[p.type] = p.value;
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute);
  const second = Number(map.second);
  const date = `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
  return {
    year, month, day, hour, minute, second,
    weekday: WEEKDAYS[map.weekday] || 1,
    date,
    minutes: hour * 60 + minute,
    stamp: `${date}T${pad2(hour)}:${pad2(minute)}`,
  };
}

// Datum und ISO-Wochentag des Vortags (für Einträge über Mitternacht).
export function previousDay(parts) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1));
  return { date: d.toISOString().slice(0, 10), weekday: parts.weekday === 1 ? 7 : parts.weekday - 1 };
}

// 'HH:MM' → Minuten seit Mitternacht ('24:00' → 1440), ungültig → null.
export function parseHm(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 24 || mm > 59 || (hh === 24 && mm !== 0)) return null;
  return hh * 60 + mm;
}

// Tägliches Fenster [start, end); end < start = über Mitternacht; start == end = nie.
export function inDailyWindow(minutes, start, end) {
  if (start === null || end === null || start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function displayFormatter(tz, key, options) {
  const id = `${tz}|${key}`;
  let fmt = displayFormatters.get(id);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('de-DE', { timeZone: validTimezone(tz), ...options });
    displayFormatters.set(id, fmt);
  }
  return fmt;
}

export function formatTime(ms, tz) {
  return displayFormatter(tz, 'time', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}

// long: „Dienstag, 30. September“ · short: „30.09.2026“
export function formatDate(ms, tz, style = 'long') {
  if (style === 'short') {
    return displayFormatter(tz, 'dshort', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ms));
  }
  return displayFormatter(tz, 'dlong', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(ms));
}

// Referenzuhr des Players: Date.now() plus Abweichung zur Serverzeit (nur wenn > 30 s).
export const clock = {
  offsetMs: 0,
  now() { return Date.now() + this.offsetMs; },
  syncServer(serverIso, rttMs = 0) {
    const server = Date.parse(serverIso || '');
    if (!Number.isFinite(server)) return;
    const diff = server + Math.max(0, rttMs) / 2 - Date.now();
    const next = Math.abs(diff) > 30_000 ? Math.round(diff) : 0;
    if (Math.abs(next - this.offsetMs) > 5_000 || (next === 0 && this.offsetMs !== 0)) {
      this.offsetMs = next;
      refreshMinuteTicker();
    }
  },
};

// Minutentakt: ruft Abonnenten zu jeder vollen Minute auf (ein gemeinsamer Timer).
const minuteSubscribers = new Set();
let minuteTimer = null;

function scheduleMinute() {
  clearTimeout(minuteTimer);
  const now = clock.now();
  minuteTimer = setTimeout(() => {
    const t = clock.now();
    for (const fn of minuteSubscribers) {
      try { fn(t); } catch { /* ein fehlerhafter Abonnent stoppt den Takt nicht */ }
    }
    scheduleMinute();
  }, 60_000 - (now % 60_000) + 40);
}

export function onMinute(fn) {
  minuteSubscribers.add(fn);
  if (minuteTimer === null) scheduleMinute();
  return () => minuteSubscribers.delete(fn);
}

export function refreshMinuteTicker() {
  const t = clock.now();
  for (const fn of minuteSubscribers) {
    try { fn(t); } catch { /* egal */ }
  }
  if (minuteSubscribers.size) scheduleMinute();
}
