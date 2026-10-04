// Kleine Diagramme ohne Bibliothek (SVG/HTML), hell + dunkel über Tokens, immer mit Textalternative.
//
//   sparkline({ label: 'CPU', unit: '%', points: [{ t: '2026-09-30T08:00:00Z', v: 23 }, …], max: 100 })
//   barList({ label: 'Top-Kacheln', items: [{ label: 'Anfahrt', value: 12 }, …] })
//   columnChart({ label: 'Sitzungen je Stunde', items: [{ label: '8', value: 3 }, …] })
//   availabilityBand({ from, to, segments: [{ start, end }], label: 'Verfügbarkeit 24 h' })
//   meter({ label: 'Speicher', value: 72, warnAt: 80, dangerAt: 90 })
import { h, useStyles } from '../dom.js';
import { formatNumber, formatTime, formatDateTime, formatPercent, toDate } from '../format.js';

useStyles('/admin/css/views/charts.css');

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const fmt = (v, unit = '') => (v === null || v === undefined || Number.isNaN(Number(v)) ? '–' : `${nf1.format(v)}${unit ? ` ${unit}` : ''}`);

/**
 * Verlaufslinie (Sparkline) mit aktuellem Wert, Min/Max als Text.
 * points: [{ t, v }] (beliebige Reihenfolge, wird nach Zeit sortiert) oder Zahlen.
 * level(v) → 'warning' | 'danger' | null färbt den aktuellen Wert (zusätzlich zum Text).
 */
export function sparkline({ label, points = [], unit = '', min = null, max = null, level = null, height = 44 } = {}) {
  const pts = points
    .map((p, i) => (typeof p === 'number' ? { t: i, v: p } : { t: toDate(p.t)?.getTime() ?? i, v: p.v }))
    .filter((p) => p.v !== null && p.v !== undefined && !Number.isNaN(Number(p.v)))
    .sort((a, b) => a.t - b.t);
  const last = pts.length ? pts[pts.length - 1].v : null;
  const lvl = last !== null && level ? level(last) : null;
  const vals = pts.map((p) => Number(p.v));
  const lo = min ?? (vals.length ? Math.min(...vals) : 0);
  const hi = max ?? (vals.length ? Math.max(...vals) : 1);
  const span = hi - lo || 1;
  const W = 200;
  const H = height;
  const pad = 3;
  const summary = pts.length
    ? `${label}: aktuell ${fmt(last, unit)}, Minimum ${fmt(Math.min(...vals), unit)}, Maximum ${fmt(Math.max(...vals), unit)} (${pts.length} Messwerte)`
    : `${label}: keine Messwerte`;

  let graphic;
  if (pts.length >= 2) {
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    const x = (t) => (t1 === t0 ? W : ((t - t0) / (t1 - t0)) * W);
    const y = (v) => H - pad - ((Math.min(hi, Math.max(lo, v)) - lo) / span) * (H - pad * 2);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${d} L${W},${H} L0,${H} Z`;
    graphic = s('svg', { class: 'chart-spark__svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' },
      s('path', { class: 'chart-spark__area', d: area }),
      s('path', { class: 'chart-spark__line', d, 'vector-effect': 'non-scaling-stroke' }));
  } else {
    graphic = h('div', { class: 'chart-spark__none', 'aria-hidden': 'true' }, pts.length ? 'Zu wenige Messwerte für einen Verlauf' : 'Keine Messwerte');
  }
  return h('figure', { class: ['chart-spark', lvl && `is-${lvl}`], role: 'img', 'aria-label': summary },
    h('figcaption', { class: 'chart-spark__head', 'aria-hidden': 'true' },
      h('span', { class: 'chart-spark__label' }, label),
      h('span', { class: 'chart-spark__value num' }, fmt(last, unit))),
    graphic,
    pts.length ? h('div', { class: 'chart-spark__range num', 'aria-hidden': 'true' },
      h('span', {}, `min ${fmt(Math.min(...vals), unit)}`), h('span', {}, `max ${fmt(Math.max(...vals), unit)}`)) : null,
  );
}

/** Waagrechte Balkenliste (Rangfolge): Beschriftung links, Wert rechts, Balken darunter. Echte Liste (Screenreader). */
export function barList({ label, items = [], unit = '', max = null, empty = 'Keine Daten' } = {}) {
  if (!items.length) return h('p', { class: 'text-2' }, empty);
  const top = max ?? Math.max(...items.map((i) => Number(i.value) || 0), 1);
  return h('ul', { class: 'chart-bars', 'aria-label': label },
    items.map((it) => {
      const pct = Math.max(0, Math.min(100, ((Number(it.value) || 0) / top) * 100));
      return h('li', { class: 'chart-bars__item' },
        h('div', { class: 'chart-bars__row' },
          h('span', { class: 'chart-bars__label truncate', title: it.label }, it.label),
          h('span', { class: 'chart-bars__value num' }, `${formatNumber(it.value)}${unit ? ` ${unit}` : ''}`)),
        h('div', { class: 'chart-bars__track', 'aria-hidden': 'true' }, h('div', { class: 'chart-bars__fill', style: { width: `${pct}%` } })));
    }));
}

/** Säulendiagramm (z. B. 24 Stunden). Beschriftung jeder n-ten Säule; Tabelle als Textalternative. */
export function columnChart({ label, items = [], unit = '', labelEvery = 3, height = 96 } = {}) {
  const top = Math.max(...items.map((i) => Number(i.value) || 0), 1);
  const total = items.reduce((a, i) => a + (Number(i.value) || 0), 0);
  const peak = items.reduce((a, i) => ((Number(i.value) || 0) > (Number(a?.value) || 0) ? i : a), null);
  const summary = `${label}: insgesamt ${formatNumber(total)}${peak && peak.value ? `, am meisten um ${peak.label} (${formatNumber(peak.value)})` : ''}`;
  return h('figure', { class: 'chart-cols', role: 'img', 'aria-label': summary },
    h('div', { class: 'chart-cols__plot', style: { '--chart-h': `${height}px` }, 'aria-hidden': 'true' },
      items.map((it) => h('div', { class: 'chart-cols__col', title: `${it.label}: ${formatNumber(it.value)}${unit ? ` ${unit}` : ''}` },
        h('div', { class: 'chart-cols__bar', style: { height: `${((Number(it.value) || 0) / top) * 100}%` } })))),
    h('div', { class: 'chart-cols__axis', 'aria-hidden': 'true' },
      items.map((it, i) => h('span', {}, i % labelEvery === 0 ? it.label : ''))),
  );
}

/**
 * Verfügbarkeitsband: online-Segmente (grün, Muster) auf offline-Hintergrund (rot/neutral), Achse mit Uhrzeiten.
 * from/to: Zeitraum (Date/ISO). segments: [{ start, end }] (ISO). pct optional (sonst berechnet).
 */
export function availabilityBand({ from, to, segments = [], pct = null, label = 'Verfügbarkeit', compact = false, since = null } = {}) {
  const t0 = toDate(from)?.getTime();
  const t1 = toDate(to)?.getTime();
  const span = t1 - t0;
  // since: Beginn der Messung (z. B. Anlage der Stele) – davor weder online noch offline
  const ts = toDate(since)?.getTime();
  const prePct = span > 0 && ts && ts > t0 ? Math.min(100, ((ts - t0) / span) * 100) : 0;
  const parts = [];
  let onlineMs = 0;
  if (span > 0) {
    for (const seg of segments) {
      const a = Math.max(t0, toDate(seg.start)?.getTime() ?? t0);
      const b = Math.min(t1, toDate(seg.end)?.getTime() ?? t0);
      if (b <= a) continue;
      onlineMs += b - a;
      parts.push({ left: ((a - t0) / span) * 100, width: Math.max(0.4, ((b - a) / span) * 100), a, b });
    }
  }
  const value = pct ?? (span > 0 ? (onlineMs / span) * 100 : null);
  const multiDay = span > 36 * 3600 * 1000;
  const tick = (t) => (multiDay ? new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit' }).format(new Date(t)) : formatTime(new Date(t)));
  const measuredFrom = prePct ? ts : t0;
  const summary = `${label}: ${value === null ? 'unbekannt' : `${formatPercent(value, 1)} online`} (${formatDateTime(new Date(measuredFrom))} bis ${formatDateTime(new Date(t1))}, ${parts.length} ${parts.length === 1 ? 'Online-Abschnitt' : 'Online-Abschnitte'})`;
  const ticks = span > 0 ? [0, 0.25, 0.5, 0.75, 1].map((f) => tick(t0 + span * f)) : [];
  return h('figure', { class: ['chart-avail', compact && 'chart-avail--compact'], role: 'img', 'aria-label': summary },
    h('div', { class: 'chart-avail__track', 'aria-hidden': 'true' },
      prePct ? h('span', { class: 'chart-avail__pre', style: { width: `${prePct}%` }, title: `vor ${formatDateTime(new Date(ts))}: noch nicht eingerichtet` }) : null,
      parts.map((p) => h('span', {
        class: 'chart-avail__on',
        style: { left: `${p.left}%`, width: `${p.width}%` },
        title: `online ${formatDateTime(new Date(p.a))} – ${formatTime(new Date(p.b))}`,
      }))),
    compact && prePct ? h('div', { class: 'chart-avail__since text-sm' }, `gemessen seit ${formatDateTime(new Date(ts))}`) : null,
    compact ? null : h('div', { class: 'chart-avail__axis num', 'aria-hidden': 'true' }, ticks.map((t) => h('span', {}, t))),
    compact ? null : h('div', { class: 'chart-avail__legend', 'aria-hidden': 'true' },
      h('span', { class: 'chart-avail__key chart-avail__key--on' }, 'online'),
      h('span', { class: 'chart-avail__key chart-avail__key--off' }, 'offline / keine Meldung'),
      prePct ? h('span', { class: 'chart-avail__key chart-avail__key--pre' }, 'noch nicht eingerichtet') : null),
  );
}

/** Füllstand (0–100) mit Text: Warnstufe färbt den Balken, Text nennt den Wert. */
export function meter({ label, value, unit = '%', warnAt = 80, dangerAt = 90, text = null, max = 100 } = {}) {
  const v = value === null || value === undefined ? null : Number(value);
  const pct = v === null ? 0 : Math.max(0, Math.min(100, (v / max) * 100));
  const lvl = v === null ? null : (v >= dangerAt ? 'danger' : v >= warnAt ? 'warning' : 'success');
  const valueText = text ?? (v === null ? 'keine Angabe' : `${nf1.format(v)} ${unit}`.trim());
  return h('div', { class: 'chart-meter' },
    h('div', { class: 'chart-meter__row' }, h('span', { class: 'chart-meter__label' }, label), h('span', { class: 'chart-meter__value num' }, valueText)),
    h('div', {
      class: ['progress', lvl && `progress--${lvl}`], role: 'meter', 'aria-label': label,
      'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': v === null ? null : String(v), 'aria-valuetext': valueText,
    }, h('div', { class: 'progress__bar', style: { width: `${pct}%` } })),
  );
}
