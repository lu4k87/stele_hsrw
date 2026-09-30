// Gemeinsame Helfer der Vorführseite: Links in neuem Tab, Rechteprüfung, Abschnittskopf.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { can, canAny } from '../session.js';

/** Recht (String) oder Liste (eines genügt); leer = immer erlaubt. */
export function allowed(perm) {
  if (!perm) return true;
  return Array.isArray(perm) ? canAny(...perm) : can(perm);
}

/** Knopf-Link, der in einem neuen Tab öffnet (die Vorführseite bleibt offen). */
export function externalLink({ href, label, icon: iconName = 'external-link', variant = 'secondary', size = null } = {}) {
  return h('a', {
    class: ['btn', `btn--${variant}`, size && `btn--${size}`],
    href, target: '_blank', rel: 'noopener',
  }, iconName ? icon(iconName) : null, label, h('span', { class: 'visually-hidden' }, '(neuer Tab)'));
}

/** Abschnitt mit Sprungmarke, Nummer, Titel und einem Satz Beschreibung. */
export function showSection({ id, nr, title, text, actions = null }, ...children) {
  return h('section', { class: 'show-section', id, 'aria-labelledby': `${id}-title` },
    h('div', { class: 'show-section__head' },
      h('span', { class: 'show-section__nr', 'aria-hidden': 'true' }, String(nr)),
      h('div', { class: 'stack', style: { '--stack-gap': '2px' } },
        h('h2', { class: 'show-section__title', id: `${id}-title` }, title),
        text ? h('p', { class: 'text-2' }, text) : null),
      actions ? h('div', { class: 'cluster show-section__actions' }, actions) : null),
    children);
}
