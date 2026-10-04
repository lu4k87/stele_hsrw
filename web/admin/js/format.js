// Formatierung für die Anzeige (de-DE). Zeitstempel kommen als UTC-ISO vom Server.

const LOCALE = 'de-DE';
const dtDate = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
const dtDateTime = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dtTime = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const dtWeekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
const nf = new Intl.NumberFormat(LOCALE);

export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** „30.09.2026, 14:05“ */
export function formatDateTime(v) {
  const d = toDate(v);
  return d ? dtDateTime.format(d) : '–';
}

/** „30.09.2026“ */
export function formatDate(v) {
  const d = toDate(v);
  return d ? dtDate.format(d) : '–';
}

/** „14:05“ */
export function formatTime(v) {
  const d = toDate(v);
  return d ? dtTime.format(d) : '–';
}

/** „Dienstag, 30. September“ */
export function formatWeekday(v) {
  const d = toDate(v);
  return d ? dtWeekday.format(d) : '–';
}

/** Relativ für jüngere Zeitpunkte: „gerade eben“, „vor 5 Min.“, „vor 3 Std.“, „gestern, 14:05“, sonst Datum. */
export function formatRelative(v, now = new Date()) {
  const d = toDate(v);
  if (!d) return '–';
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 60) return 'in wenigen Sekunden';
    if (ahead < 3600) return `in ${Math.round(ahead / 60)} Min.`;
    if (ahead < 86400 && d.getDate() === now.getDate()) return `heute, ${dtTime.format(d)}`;
    return formatDateTime(d);
  }
  if (diff < 45) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.max(1, Math.round(diff / 60))} Min.`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `vor ${Math.round(diff / 3600)} Std.`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `gestern, ${dtTime.format(d)}`;
  return formatDateTime(d);
}

/** „seit 5 Min.“, „seit gestern, 10:00“ – frisch: „gerade eben“ (nie „seit gerade eben“) */
export function formatSince(v, now = new Date()) {
  const d = toDate(v);
  if (!d) return '–';
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 45) return 'gerade eben';
  if (diff < 3600) return `seit ${Math.max(1, Math.round(diff / 60))} Min.`;
  if (d.toDateString() === now.toDateString()) return `seit ${Math.round(diff / 3600)} Std.`;
  return `seit ${formatRelative(d, now)}`;
}

/** Sekunden → „45 s“, „3:45 min“, „1 h 05 min“ */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '–';
  const s = Math.max(0, Math.round(Number(seconds)));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Bytes → „12,4 MB“ */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)} ${units[i]}`;
}

export function formatNumber(n) {
  return n === null || n === undefined ? '–' : nf.format(n);
}

/** 0.873 oder 87.3 → „87 %“ (Werte > 1 gelten als Prozent) */
export function formatPercent(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  const pct = Number(v) <= 1 ? Number(v) * 100 : Number(v);
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(pct)} %`;
}

/** plural(3, 'Folie', 'Folien') → „3 Folien“ */
export function plural(n, one, many) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

export const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** [1,2,3,4,5] → „Mo–Fr“, [6,7] → „Sa, So“, alle → „täglich“ */
export function formatDays(days = []) {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return 'täglich';
  if (set.join() === '1,2,3,4,5') return 'Mo–Fr';
  if (set.join() === '6,7') return 'Sa, So';
  // zusammenhängende Bereiche verdichten
  const parts = [];
  let start = null;
  let prev = null;
  for (const d of set) {
    if (start === null) { start = d; prev = d; continue; }
    if (d === prev + 1) { prev = d; continue; }
    parts.push(start === prev ? WEEKDAYS_SHORT[start - 1] : `${WEEKDAYS_SHORT[start - 1]}–${WEEKDAYS_SHORT[prev - 1]}`);
    start = d; prev = d;
  }
  if (start !== null) parts.push(start === prev ? WEEKDAYS_SHORT[start - 1] : (prev === start + 1 ? `${WEEKDAYS_SHORT[start - 1]}, ${WEEKDAYS_SHORT[prev - 1]}` : `${WEEKDAYS_SHORT[start - 1]}–${WEEKDAYS_SHORT[prev - 1]}`));
  return parts.join(', ') || '–';
}
