// Status-Chips (immer Icon + Text, nie Farbe allein) und Typ-Bezeichnungen.
import { h } from '../dom.js';
import { icon } from '../icons.js';

/** kind: success | warning | danger | info | neutral */
export function chip(kind, label, iconName = null, { size = null, title = null } = {}) {
  return h('span', { class: ['chip', kind !== 'neutral' && `chip--${kind}`, size && `chip--${size}`], title },
    iconName ? icon(iconName, { size: 15 }) : null, label);
}

export const CONTENT_TYPES = {
  image: { label: 'Bild', plural: 'Bilder', icon: 'image' },
  video: { label: 'Video', plural: 'Videos', icon: 'film' },
  pdf: { label: 'PDF', plural: 'PDFs', icon: 'file-text' },
  text: { label: 'Info-Folie', plural: 'Info-Folien', icon: 'text-slide' },
  web: { label: 'Webseite', plural: 'Webseiten', icon: 'globe' },
};

export function contentTypeLabel(type) { return CONTENT_TYPES[type]?.label || type; }
export function contentTypeIcon(type) { return CONTENT_TYPES[type]?.icon || 'file-text'; }

export const PRESENTATION_STATUS = {
  draft: { kind: 'neutral', label: 'Entwurf', icon: 'pencil', hint: 'Noch nie veröffentlicht – läuft auf keiner Stele.' },
  published: { kind: 'success', label: 'Veröffentlicht', icon: 'check-circle', hint: 'Der veröffentlichte Stand entspricht dem Entwurf.' },
  changed: { kind: 'warning', label: 'Änderungen offen', icon: 'alert-triangle', hint: 'Veröffentlicht, aber es gibt neuere Änderungen, die noch nicht auf der Stele sind.' },
};
export const REVIEW_STATUS = {
  requested: { kind: 'info', label: 'Freigabe angefragt', icon: 'send' },
  rejected: { kind: 'danger', label: 'Freigabe abgelehnt', icon: 'x-circle' },
};

/** Status einer Präsentation: 1–2 Chips (Veröffentlichung + ggf. Freigabe). */
export function presentationStatus(p, { size = null } = {}) {
  const s = PRESENTATION_STATUS[p.status] || PRESENTATION_STATUS.draft;
  const chips = [chip(s.kind, s.label, s.icon, { size, title: s.hint })];
  const r = REVIEW_STATUS[p.review_state];
  if (r) chips.push(chip(r.kind, r.label, r.icon, { size }));
  return h('span', { class: 'cluster', style: { '--cluster-gap': '6px' } }, chips);
}

export const STELE_STATUS = {
  online: { kind: 'success', label: 'Online', icon: 'wifi' },
  offline: { kind: 'danger', label: 'Offline', icon: 'wifi-off' },
  standby: { kind: 'neutral', label: 'Nachtmodus', icon: 'moon' },
  never: { kind: 'neutral', label: 'Noch nie verbunden', icon: 'power' },
};

export function steleStatus(stele, { size = null } = {}) {
  if (stele && stele.paired === false && stele.status === 'never') return chip('warning', 'Nicht gekoppelt', 'link', { size });
  const s = STELE_STATUS[stele?.status] || STELE_STATUS.never;
  return chip(s.kind, s.label, s.icon, { size });
}

export const VALIDITY = {
  active: null,
  scheduled: { kind: 'info', label: 'Geplant', icon: 'calendar' },
  expired: { kind: 'neutral', label: 'Abgelaufen', icon: 'clock' },
};

export function validityChip(validity, { size = 'sm' } = {}) {
  const v = VALIDITY[validity];
  return v ? chip(v.kind, v.label, v.icon, { size }) : null;
}

/** Warnungen eines Inhalts als kleine Liste (für Details/Tooltips). */
export function warningList(warnings = []) {
  if (!warnings.length) return null;
  return h('ul', { class: 'stack stack--sm', style: { listStyle: 'none', padding: 0 } },
    warnings.map((w) => h('li', { class: 'cluster', style: { alignItems: 'flex-start', flexWrap: 'nowrap', color: 'var(--warning)' } },
      icon('alert-triangle', { size: 16 }), h('span', { style: { color: 'var(--text)' } }, w.message))));
}
