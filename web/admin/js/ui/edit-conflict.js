// Gleichzeitiges Bearbeiten (SPEC §7.1, 409 edit_conflict): Speichern mit expected_updated_at; schlägt es fehl,
// zeigt die Ansicht einen Hinweis mit „Neu laden“ statt den fremden Stand stillschweigend zu überschreiben.
//
//   if (isEditConflict(err)) fill(conflictBox, editConflictAlert(err, { onReload }))
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { ApiError } from '../api.js';
import { button } from './page.js';

export const isEditConflict = (err) => err instanceof ApiError && err.code === 'edit_conflict';

/** Hinweis „von X geändert – neu laden“ mit Knopf. onReload: Ansicht mit dem Stand des Servers neu aufbauen. */
export function editConflictAlert(err, { onReload }) {
  return h('div', { class: 'alert alert--danger', role: 'alert' }, icon('alert-circle'), h('div', { class: 'alert__body' },
    h('div', { class: 'alert__title' }, 'Nicht gespeichert – inzwischen anderweitig geändert'),
    h('div', { class: 'alert__text' }, err.message),
    h('div', { class: 'alert__text' }, 'Neu laden zeigt den aktuellen Stand; die Änderungen hier gehen dabei verloren.'),
    h('div', { class: 'alert__actions' },
      button({ label: 'Neu laden', icon: 'refresh', variant: 'primary', size: 'sm', onClick: onReload }))));
}
