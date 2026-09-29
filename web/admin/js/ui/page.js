// Seitenbausteine: Seitenkopf, Karten, Abschnitte.
//
//   root.append(page({},
//     pageHeader({ title: 'Mediathek', description: 'Bilder, Videos, PDFs, Info-Folien und Webseiten.',
//                  actions: [uploadButton] }),
//     card({ title: 'Zuletzt geändert', icon: 'history', body: list }),
//   ));
import { h } from '../dom.js';
import { icon } from '../icons.js';

export function page({ wide = false, narrow = false, className = null } = {}, ...children) {
  return h('div', { class: ['page', wide && 'page--wide', narrow && 'page--narrow', className] }, children);
}

/**
 * back: { href, label } – Link zurück zur Liste (oberhalb des Titels)
 * status: Node neben dem Titel (z. B. Status-Chip)
 * actions: Array von Nodes (Hauptaktion zuletzt = ganz rechts)
 */
export function pageHeader({ title, description = null, actions = [], back = null, status = null, meta = null } = {}) {
  const titleEl = h('h1', { class: 'page-header__title' }, title);
  const el = h('header', { class: 'page-header' },
    h('div', { class: 'page-header__main' },
      back ? h('a', { class: 'page-header__back', href: back.href }, icon('arrow-left'), back.label) : null,
      h('div', { class: 'page-header__title-row' }, titleEl, status),
      description ? h('p', { class: 'page-header__desc' }, description) : null,
      meta,
    ),
    actions && actions.filter(Boolean).length ? h('div', { class: 'page-header__actions' }, actions.filter(Boolean)) : null,
  );
  el.titleEl = titleEl;
  return el;
}

export function card({ title = null, subtitle = null, icon: iconName = null, actions = null, body = null, footer = null, flush = false, className = null, headingLevel = 2 } = {}) {
  const header = title
    ? h('div', { class: 'card__header' },
      h('div', { class: 'stack stack--sm', style: { '--stack-gap': '2px' } },
        h(`h${headingLevel}`, { class: 'card__title' }, iconName ? icon(iconName) : null, title),
        subtitle ? h('p', { class: 'card__subtitle' }, subtitle) : null,
      ),
      actions ? h('div', { class: 'cluster' }, actions) : null,
    )
    : null;
  const bodyEl = h('div', { class: ['card__body', flush && 'card__body--flush'] }, body);
  const el = h('section', { class: ['card', className] }, header, bodyEl, footer ? h('div', { class: 'card__footer' }, footer) : null);
  el.body = bodyEl;
  return el;
}

/** Überschrift mit Aktionen für einen Seitenabschnitt. */
export function sectionTitle(title, ...actions) {
  return h('div', { class: 'section-title' }, h('h2', {}, title), actions.length ? h('div', { class: 'cluster' }, actions) : null);
}

/** Kennzahl-Kachel. */
export function kpi({ label, value, meta = null, icon: iconName = null, className = null }) {
  return h('div', { class: ['card', 'kpi', className] },
    h('div', { class: 'kpi__label' }, iconName ? icon(iconName) : null, label),
    h('div', { class: 'kpi__value' }, value),
    meta ? h('div', { class: 'kpi__meta' }, meta) : null,
  );
}

/** Knopf-Kurzform: button({ label: 'Speichern', icon: 'save', variant: 'primary', onClick }). */
export function button({ label = null, icon: iconName = null, variant = 'secondary', size = null, onClick = null, title = null, ariaLabel = null, disabled = false, type = 'button', href = null, className = null, iconAfter = null } = {}) {
  const cls = ['btn', `btn--${variant}`, size && `btn--${size}`, !label && 'btn--icon', className];
  const content = [iconName ? icon(iconName) : null, label, iconAfter ? icon(iconAfter) : null];
  if (href) return h('a', { class: cls, href, title, 'aria-label': ariaLabel }, content);
  return h('button', { type, class: cls, onClick, title: title || (!label ? ariaLabel : null), 'aria-label': ariaLabel || null, disabled }, content);
}
