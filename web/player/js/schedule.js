// Zeitplan-Auflösung nach SPEC §7.8 (identisch zum Server), Folien-Gültigkeit und Nachtmodus.

import { wallParts, previousDay, parseHm, inDailyWindow } from './time.js';

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function inDateRange(date, from, until) {
  return (!from || date >= from) && (!until || date <= until);
}

function dayMatches(entry, weekday, date) {
  const days = Array.isArray(entry.days) ? entry.days.map(Number) : ALL_DAYS;
  return days.includes(weekday) && inDateRange(date, entry.date_from || null, entry.date_until || null);
}

// Aktiv zur Wanduhr parts: Uhrzeit in [start, end); über Mitternacht zählt der Tag des Beginns.
export function entryActive(entry, parts, prev = previousDay(parts)) {
  if (entry.enabled === false || entry.enabled === 0) return false;
  const start = parseHm(entry.start ?? entry.start_time);
  const end = parseHm(entry.end ?? entry.end_time);
  if (start === null || end === null || start === end) return false;
  const m = parts.minutes;
  if (start < end) return m >= start && m < end && dayMatches(entry, parts.weekday, parts.date);
  if (m >= start) return dayMatches(entry, parts.weekday, parts.date);
  if (m < end) return dayMatches(entry, prev.weekday, prev.date);
  return false;
}

// Gewinner: höchste Priorität → Eintrag mit Datumsbereich → zuletzt geändert → höhere ID.
function compareEntries(a, b) {
  const pa = Number(a.priority) || 0;
  const pb = Number(b.priority) || 0;
  if (pa !== pb) return pb - pa;
  const ra = a.date_from || a.date_until ? 1 : 0;
  const rb = b.date_from || b.date_until ? 1 : 0;
  if (ra !== rb) return rb - ra;
  const ua = String(a.updated_at || '');
  const ub = String(b.updated_at || '');
  if (ua !== ub) return ua < ub ? 1 : -1;
  return (Number(b.id) || 0) - (Number(a.id) || 0);
}

// → { presentation, source: 'schedule'|'default'|'none', entryId }
// Nur veröffentlichte Präsentationen (im Manifest enthalten) können laufen.
export function resolveActive(manifest, nowMs) {
  const presentations = (manifest && manifest.presentations) || {};
  const has = (id) => id !== null && id !== undefined && Object.prototype.hasOwnProperty.call(presentations, String(id));
  const parts = wallParts(nowMs, manifest && manifest.timezone);
  const prev = previousDay(parts);
  const active = (Array.isArray(manifest && manifest.schedule) ? manifest.schedule : [])
    .filter((e) => e && has(e.presentation_id) && entryActive(e, parts, prev))
    .sort(compareEntries);
  if (active.length) {
    return { presentation: presentations[String(active[0].presentation_id)], source: 'schedule', entryId: active[0].id };
  }
  if (has(manifest && manifest.default_presentation_id)) {
    return { presentation: presentations[String(manifest.default_presentation_id)], source: 'default', entryId: null };
  }
  return { presentation: null, source: 'none', entryId: null };
}

// Gültigkeit 'YYYY-MM-DDTHH:MM' (Wanduhr): valid_from ≤ jetzt < valid_until.
export function slideValidAt(slide, stamp) {
  const from = slide && slide.valid_from ? String(slide.valid_from).slice(0, 16) : '';
  const until = slide && slide.valid_until ? String(slide.valid_until).slice(0, 16) : '';
  return (!from || stamp >= from) && (!until || stamp < until);
}

export function nightModeActive(night, parts) {
  if (!night || !night.enabled) return false;
  return inDailyWindow(parts.minutes, parseHm(night.start), parseHm(night.end));
}
