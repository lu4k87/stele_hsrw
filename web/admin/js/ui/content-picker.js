// Inhalts-Auswahl aus der Mediathek (Dialog): Suche, Typ-Filter, Einzel- oder Mehrfachauswahl, Hochladen im Dialog.
//
//   const picked = await openContentPicker({ title: 'Folien hinzufügen', multiple: true, confirmLabel: 'Hinzufügen' });
//   if (picked) picked.forEach((c) => addSlide(c));          // Reihenfolge = Reihenfolge der Auswahl
//   const img = await openContentPicker({ title: 'Bild wählen', types: ['image'] });   // → [Content] oder null
import { h, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { can } from '../session.js';
import { openDialog } from './dialog.js';
import { searchInput, select } from './form.js';
import { chip, CONTENT_TYPES, contentTypeIcon } from './status.js';
import { emptyState, errorState, skeletonGrid } from './empty.js';
import { contentPreview, contentMeta, contentStyles } from './content-common.js';
import { createUploader, enableDropUpload, pickFiles, UPLOAD_HINT } from './uploader.js';

const FILE_TYPES = ['image', 'video', 'pdf'];

export async function openContentPicker({
  title = 'Inhalt auswählen',
  description = null,
  multiple = false,
  types = null,                 // z. B. ['image'] – null = alle
  confirmLabel = null,
  allowUpload = true,
  excludeIds = [],
  selectedIds = [],
} = {}) {
  await contentStyles();
  const allowed = types && types.length ? types : Object.keys(CONTENT_TYPES);
  const canUpload = allowUpload && can('content.edit') && allowed.some((t) => FILE_TYPES.includes(t));
  const exclude = new Set(excludeIds);
  const selected = new Map();          // id → Content (Einfügereihenfolge = Auswahlreihenfolge)
  let items = [];
  let q = '';
  let type = '';
  let ctrl = null;
  let pollTimer = null;
  let dlg = null;

  const grid = h('div', { class: 'cu-picker__grid', role: 'group', 'aria-label': 'Inhalte' });
  const body = h('div', { 'aria-live': 'polite' });
  const info = h('p', { class: 'cu-picker__foot', role: 'status' });

  const uploader = canUpload ? createUploader({
    onUploaded: (newItems) => {
      for (const c of newItems) if (allowed.includes(c.type) && (multiple || selected.size === 0)) selected.set(c.id, c);
      if (!multiple && newItems[0] && allowed.includes(newItems[0].type)) { selected.clear(); selected.set(newItems[0].id, newItems[0]); }
      load();
    },
  }) : null;

  const typeOptions = [{ value: '', label: allowed.length > 1 ? 'Alle Typen' : CONTENT_TYPES[allowed[0]].plural },
    ...(allowed.length > 1 ? allowed.map((t) => ({ value: t, label: CONTENT_TYPES[t].plural })) : [])];
  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'toolbar__search' }, searchInput({ placeholder: 'Titel oder Schlagwort …', label: 'Inhalte durchsuchen', onInput: (v) => { q = v; load(); } })),
    allowed.length > 1 ? select({ value: '', options: typeOptions, 'aria-label': 'Nach Typ filtern', onChange: (v) => { type = v; load(); } }) : null,
    h('div', { class: 'toolbar__spacer' }),
    canUpload ? h('button', { type: 'button', class: 'btn btn--secondary', onClick: async () => uploader.upload(await pickFiles(accept(allowed))) }, icon('upload'), 'Hochladen') : null,
  );

  function accept(ts) {
    const map = { image: 'image/jpeg,image/png,image/webp,image/gif', video: 'video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv,.mov', pdf: 'application/pdf' };
    return { accept: ts.filter((t) => map[t]).map((t) => map[t]).join(',') };
  }

  function updateFooter() {
    const n = selected.size;
    info.textContent = multiple
      ? (n ? `${n} ausgewählt – Reihenfolge wie ausgewählt.` : 'Mehrere Inhalte können ausgewählt werden.')
      : (n ? `Ausgewählt: ${[...selected.values()][0].title}` : 'Bitte einen Inhalt auswählen.');
    const label = confirmLabel || (multiple ? 'Hinzufügen' : 'Auswählen');
    dlg?.setActions([
      { label: 'Abbrechen', value: null },
      { label: multiple && n ? `${label} (${n})` : label, variant: 'primary', icon: multiple ? 'plus' : 'check', disabled: !n, onClick: () => [...selected.values()] },
    ]);
  }

  function toggle(c) {
    if (selected.has(c.id)) selected.delete(c.id);
    else {
      if (!multiple) selected.clear();
      selected.set(c.id, c);
    }
    renderGrid();
    updateFooter();
  }

  function renderGrid() {
    const list = items.filter((c) => !exclude.has(c.id));
    if (!list.length) {
      fill(body, emptyState({
        icon: q ? 'search' : 'images',
        title: q ? 'Keine Treffer' : 'Noch keine passenden Inhalte',
        text: q ? 'Anderen Suchbegriff versuchen oder Filter zurücksetzen.' : (canUpload ? `Dateien hochladen oder hierher ziehen. ${UPLOAD_HINT}` : 'In der Mediathek gibt es noch nichts Passendes.'),
      }));
      return;
    }
    const focused = document.activeElement?.dataset?.pickId;
    fill(grid, ...list.map((c) => {
      const on = selected.has(c.id);
      const broken = c.status === 'error';
      const b = h('button', {
        type: 'button', class: 'cu-pick', 'aria-pressed': String(on), dataset: { pickId: String(c.id) },
        disabled: broken, title: broken ? 'Verarbeitung fehlgeschlagen – nicht verwendbar' : null,
        onClick: () => toggle(c),
        onDblclick: () => { if (!multiple && !broken) { selected.clear(); selected.set(c.id, c); dlg?.close([c]); } },
      },
      h('span', { class: 'cu-pick__media' }, contentPreview(c)),
      h('span', { class: 'cu-pick__check', 'aria-hidden': 'true' }, icon('check')),
      h('span', { class: 'cu-pick__body' },
        h('span', { class: 'cu-pick__title' }, c.title),
        h('span', { class: 'cu-pick__meta' }, icon(contentTypeIcon(c.type)), h('span', { class: 'truncate' }, contentMeta(c))),
        c.status === 'processing' ? chip('info', 'In Verarbeitung', 'clock', { size: 'sm' }) : null));
      return b;
    }));
    fill(body, grid);
    if (focused) grid.querySelector(`[data-pick-id="${CSS.escape(focused)}"]`)?.focus();
  }

  async function load() {
    ctrl?.abort();
    ctrl = new AbortController();
    if (!items.length) fill(body, skeletonGrid(8, '150px'));
    try {
      const res = await api.get('/api/contents', { query: { q, type: type || allowed.join(','), limit: 300, sort: 'updated_desc' }, signal: ctrl.signal });
      items = res.items || [];
      // Neu Hochgeladene, die noch nicht in der Liste stehen, bleiben ausgewählt
      for (const [id] of selected) { const fresh = items.find((c) => c.id === id); if (fresh) selected.set(id, fresh); }
      renderGrid();
      updateFooter();
      clearTimeout(pollTimer);
      if (items.some((c) => c.status === 'processing')) pollTimer = setTimeout(() => { if (dlg) load(); }, 3000);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      fill(body, errorState({ error: err, onRetry: load }));
    }
  }

  for (const id of selectedIds) selected.set(id, { id, title: `#${id}` });

  let stopDrop = null;
  dlg = openDialog({
    title,
    description: description || (multiple ? 'Inhalte antippen, um sie auszuwählen.' : null),
    size: 'xl',
    className: 'cu-picker-dialog',
    content: h('div', { class: 'cu-picker' }, toolbar, uploader ? uploader.el : null, body, info),
    actions: [{ label: 'Abbrechen', value: null }],
    onClose: () => { ctrl?.abort(); clearTimeout(pollTimer); stopDrop?.(); dlg = null; },
  });
  if (uploader) stopDrop = enableDropUpload((files) => uploader.upload(files), { target: dlg.el, text: 'Dateien hier ablegen, um sie hochzuladen' });
  updateFooter();
  load();
  const r = await dlg.result;
  return Array.isArray(r) && r.length ? r : null;
}
