// Verweis auf einen Inhalt der Mediathek (z. B. Bild einer Info-Folie, Logo, Kachelbild):
// Vorschau + Titel, „Auswählen/Ändern“ (Inhalts-Auswahl) und „Entfernen“.
//
//   const logo = contentRefField({ value: cfg.header.logo_content_id, types: ['image'], pickerTitle: 'Logo wählen',
//                                  onChange: (id, content) => set('logo_content_id', id) });
//   field({ label: 'Logo', control: logo })
import { h, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { can } from '../session.js';
import { contentTypeLabel } from './status.js';
import { contentPreview, contentStyles } from './content-common.js';
import { openContentPicker } from './content-picker.js';

const cache = new Map();   // id → Promise<Content|null>

/** Inhalt laden (gecacht je Sitzung der Ansicht; fehlende Rechte/gelöscht → null). */
export function fetchContent(id, { fresh = false } = {}) {
  if (id === null || id === undefined) return Promise.resolve(null);
  if (!fresh && cache.has(id)) return cache.get(id);
  const p = can('content.view')
    ? api.get(`/api/contents/${id}`).catch((err) => (err?.status === 404 ? null : { id, title: `Inhalt #${id}`, type: null, _error: true }))
    : Promise.resolve({ id, title: `Inhalt #${id}`, type: null });
  cache.set(id, p);
  return p;
}
export function rememberContent(c) { if (c?.id) cache.set(c.id, Promise.resolve(c)); }

export function contentRefField({
  value = null,
  onChange = null,
  types = ['image'],
  pickerTitle = 'Bild wählen',
  emptyLabel = 'Kein Bild gewählt',
  chooseLabel = 'Bild auswählen',
  removable = true,
  disabled = false,
  initial = null,          // bekannter Inhalt (spart eine Anfrage), z. B. { id, title, type, thumb_url }
} = {}) {
  contentStyles();
  let current = value;
  const el = h('div', { class: 'cu-selected' });

  async function paint() {
    const id = current;
    if (id === null || id === undefined) {
      fill(el,
        h('div', { class: 'cu-selected__thumb' }, contentPreview({ type: types[0], status: 'ready' }, { size: 'sm' })),
        h('div', { class: 'cu-selected__text' }, h('span', { class: 'cu-selected__title' }, emptyLabel)),
        disabled ? null : h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick: choose }, icon('images'), chooseLabel));
      return;
    }
    const c = (initial && initial.id === id) ? initial : await fetchContent(id);
    if (current !== id) return;
    if (!c) {
      fill(el,
        h('div', { class: 'cu-selected__thumb' }, contentPreview({ status: 'error' }, { size: 'sm' })),
        h('div', { class: 'cu-selected__text' },
          h('span', { class: 'cu-selected__title' }, 'Inhalt nicht mehr vorhanden'),
          h('span', { class: 'cu-selected__meta' }, 'Bitte einen anderen auswählen.')),
        actions());
      return;
    }
    fill(el,
      h('div', { class: 'cu-selected__thumb' }, contentPreview(c, { size: 'sm' })),
      h('div', { class: 'cu-selected__text' },
        h('span', { class: 'cu-selected__title' }, c.title),
        c.type ? h('span', { class: 'cu-selected__meta' }, contentTypeLabel(c.type)) : null),
      actions());
  }

  function actions() {
    if (disabled) return null;
    return h('div', { class: 'cluster' },
      h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick: choose }, icon('refresh', { size: 16 }), 'Ändern'),
      removable ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => set(null, null) }, icon('x', { size: 16 }), 'Entfernen') : null);
  }

  async function choose() {
    const picked = await openContentPicker({ title: pickerTitle, types, multiple: false });
    if (picked?.[0]) { rememberContent(picked[0]); set(picked[0].id, picked[0]); }
  }

  function set(id, c) {
    current = id;
    paint();
    onChange?.(id, c);
    el.querySelector('button')?.focus();
  }

  paint();
  el.setValue = (id) => { current = id; paint(); };
  el.getValue = () => current;
  return el;
}
