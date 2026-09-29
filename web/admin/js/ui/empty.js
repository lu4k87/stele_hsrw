// Leer-, Lade- und Fehlerzustände.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { errorMessage } from '../api.js';

/** Leerer Zustand mit Erklärung und nächster Aktion. */
export function emptyState({ icon: iconName = 'info', title, text = null, actions = [] } = {}) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty__icon' }, icon(iconName)),
    h('div', { class: 'empty__title' }, title),
    text ? h('p', { class: 'empty__text' }, text) : null,
    actions.filter(Boolean).length ? h('div', { class: 'empty__actions' }, actions.filter(Boolean)) : null,
  );
}

export function loadingBlock(text = 'Wird geladen …') {
  return h('div', { class: 'loading-block', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

/** Fehler beim Laden mit „Erneut versuchen“. */
export function errorState({ title = 'Laden fehlgeschlagen', error = null, onRetry = null } = {}) {
  return h('div', { class: 'empty', role: 'alert' },
    h('div', { class: 'empty__icon', style: { background: 'var(--danger-soft)', color: 'var(--danger)' } }, icon('alert-circle')),
    h('div', { class: 'empty__title' }, title),
    error ? h('p', { class: 'empty__text' }, errorMessage(error)) : null,
    onRetry ? h('div', { class: 'empty__actions' }, h('button', { type: 'button', class: 'btn btn--secondary', onClick: onRetry }, icon('refresh'), 'Erneut versuchen')) : null,
  );
}

export function skeletonLines(n = 3) {
  return h('div', { class: 'stack stack--sm', 'aria-hidden': 'true' },
    Array.from({ length: n }, (_, i) => h('span', { class: 'skeleton', style: { width: `${90 - (i % 3) * 18}%`, height: '16px' } })));
}

export function skeletonGrid(n = 6, min = '220px') {
  return h('div', { class: 'grid-auto', style: { '--grid-min': min }, 'aria-hidden': 'true' },
    Array.from({ length: n }, () => h('span', { class: 'skeleton skeleton-card' })));
}
