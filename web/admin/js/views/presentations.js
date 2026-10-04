// Präsentationen (#/presentations): Liste mit Status, Suche, Filter; anlegen, duplizieren, löschen.
import { h, useStyles, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can } from '../session.js';
import { formatDuration, formatRelative, formatDateTime, plural } from '../format.js';
import { page, pageHeader, button } from '../ui/page.js';
import { field, input, select, searchInput, setFieldErrors, clearFieldErrors } from '../ui/form.js';
import { openDialog } from '../ui/dialog.js';
import { menuButton } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { presentationStatus } from '../ui/status.js';
import { emptyState, errorState, skeletonGrid } from '../ui/empty.js';
import { playerFrame, playerUrls } from '../ui/player-frame.js';
import { contentStyles } from '../ui/content-common.js';
import { removePresentation } from '../ui/presentation-actions.js';

const FILTERS = [
  { value: '', label: 'Alle' },
  { value: 'draft', label: 'Entwurf' },
  { value: 'published', label: 'Veröffentlicht' },
  { value: 'changed', label: 'Änderungen offen' },
  { value: 'requested', label: 'Freigabe angefragt' },
  { value: 'rejected', label: 'Freigabe abgelehnt' },
];

export default async function mount(root, ctx) {
  await Promise.all([useStyles('/admin/css/views/presentations.css'), contentStyles()]);
  const canEdit = can('presentations.edit');
  const canPublish = can('presentations.publish');
  const canDelete = can('presentations.delete');

  const state = { q: ctx.query.q || '', filter: FILTERS.some((f) => f.value === ctx.query.status) ? ctx.query.status : '', items: [], loaded: false };

  const header = pageHeader({
    title: 'Präsentationen',
    description: 'Diashows für die Stelen – Folien, Einstellungen, Rahmen und Touch-Menü.',
    actions: canEdit ? [button({ label: 'Neue Präsentation', icon: 'plus', variant: 'primary', onClick: () => openCreate() })] : [],
  });
  const reviewBox = h('div');
  const search = searchInput({ value: state.q, placeholder: 'Name oder Beschreibung …', label: 'Präsentationen durchsuchen', onInput: (v) => { state.q = v; sync(); render(); } });
  const filterSel = select({ value: state.filter, 'aria-label': 'Nach Status filtern', options: FILTERS.map((f) => ({ value: f.value, label: f.value ? f.label : 'Alle Status' })), onChange: (v) => { state.filter = v; sync(); render(); } });
  const count = h('p', { class: 'text-2 text-sm', role: 'status', 'aria-live': 'polite' });
  const results = h('div');

  root.append(page({ wide: true, className: 'pl-page' },
    header, reviewBox,
    h('div', { class: 'toolbar' }, h('div', { class: 'toolbar__search' }, search), filterSel),
    count, results));

  function sync() { ctx.setQuery({ q: state.q || null, status: state.filter || null }); }

  async function load() {
    if (!state.loaded) fill(results, skeletonGrid(6, '260px'));
    try {
      const res = await api.get('/api/presentations', { signal: ctx.signal });
      state.items = res.items || [];
      state.loaded = true;
      render();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      fill(results, errorState({ error: err, onRetry: load }));
    }
  }

  function matches(p) {
    const q = state.q.toLowerCase();
    if (q && !`${p.name} ${p.description || ''}`.toLowerCase().includes(q)) return false;
    const f = state.filter;
    if (!f) return true;
    if (f === 'requested' || f === 'rejected') return p.review_state === f;
    return p.status === f;
  }

  function render() {
    const requested = state.items.filter((p) => p.review_state === 'requested');
    fill(reviewBox, canPublish && requested.length && state.filter !== 'requested'
      ? h('div', { class: 'alert' }, icon('send'), h('div', { class: 'alert__body' },
        h('div', { class: 'alert__title' }, requested.length === 1 ? '1 Präsentation wartet auf Freigabe' : `${requested.length} Präsentationen warten auf Freigabe`),
        h('div', { class: 'alert__text' }, requested.map((p) => p.name).join(', ')),
        h('div', { class: 'alert__actions' }, button({ label: 'Anzeigen', icon: 'filter', size: 'sm', onClick: () => { state.filter = 'requested'; filterSel.value = 'requested'; sync(); render(); } }))))
      : null);

    const list = state.items.filter(matches);
    const filtered = !!(state.q || state.filter);
    count.textContent = state.loaded ? (filtered ? `${list.length} von ${plural(state.items.length, 'Präsentation', 'Präsentationen')}` : plural(state.items.length, 'Präsentation', 'Präsentationen')) : '';
    if (!list.length) {
      fill(results, filtered
        ? emptyState({ icon: 'search', title: 'Keine Treffer', text: 'Mit diesen Filtern wurde keine Präsentation gefunden.', actions: [button({ label: 'Filter zurücksetzen', icon: 'x', onClick: () => { state.q = ''; state.filter = ''; search.input.value = ''; filterSel.value = ''; sync(); render(); } })] })
        : emptyState({ icon: 'presentation', title: 'Noch keine Präsentation', text: 'Eine Präsentation ist eine Diashow aus Inhalten der Mediathek – mit Rahmen (Design) und optionalem Touch-Menü.', actions: canEdit ? [button({ label: 'Neue Präsentation', icon: 'plus', variant: 'primary', onClick: () => openCreate() })] : [] }));
      return;
    }
    fill(results, h('ul', { class: 'pl-grid', 'aria-label': 'Präsentationen' }, list.map(cardFor)));
  }

  function cardFor(p) {
    const href = `#/presentations/${p.id}`;
    const running = (p.used_by || []);
    return h('li', { class: 'pl-card' },
      h('a', { class: 'pl-card__thumb', href, tabindex: '-1', 'aria-hidden': 'true' },
        p.thumb_url ? h('img', { src: p.thumb_url, alt: '', loading: 'lazy' }) : h('span', { class: 'pl-card__noimg' }, icon('presentation'))),
      h('div', { class: 'pl-card__body' },
        h('div', { class: 'pl-card__head' },
          h('h2', { class: 'pl-card__title' }, h('a', { href }, p.name)),
          menuButton({ label: `Aktionen für „${p.name}“`, items: () => [
            { label: canEdit ? 'Bearbeiten' : 'Ansehen', icon: canEdit ? 'pencil' : 'eye', href },
            { label: 'Vorschau', icon: 'play', onClick: () => openPreview(p) },
            canEdit ? { label: 'Duplizieren', icon: 'copy', onClick: () => duplicate(p) } : null,
            canDelete ? { separator: true } : null,
            canDelete ? { label: 'Löschen', icon: 'trash', danger: true, onClick: () => remove(p) } : null,
          ] })),
        presentationStatus(p, { size: 'sm' }),
        p.description ? h('p', { class: 'pl-card__desc' }, p.description) : null,
        h('dl', { class: 'pl-card__facts' },
          h('dt', {}, icon('layers', { size: 16 }), h('span', { class: 'visually-hidden' }, 'Umfang')),
          h('dd', {}, `${plural(p.active_item_count ?? p.item_count ?? 0, 'Folie', 'Folien')} · ${formatDuration(p.total_duration_s || 0)}`),
          h('dt', {}, icon('palette', { size: 16 }), h('span', { class: 'visually-hidden' }, 'Rahmen')),
          h('dd', {}, [p.design ? `Design „${p.design.name}“` : 'Ohne Design', p.touch_menu ? `Touch-Menü „${p.touch_menu.name}“` : null].filter(Boolean).join(' · ')),
          h('dt', {}, icon('stele', { size: 16 }), h('span', { class: 'visually-hidden' }, 'Verwendung')),
          h('dd', {}, running.length ? `Läuft auf ${running.map((u) => `${u.stele_name}${u.how === 'schedule' ? ' (Zeitplan)' : ''}`).join(', ')}` : 'Auf keiner Stele eingeplant')),
        h('p', { class: 'pl-card__updated', title: formatDateTime(p.updated_at) },
          `Geändert ${formatRelative(p.updated_at)}${p.updated_by ? ` von ${p.updated_by.display_name}` : ''}`)));
  }

  // ---------- Aktionen ----------
  async function openCreate() {
    let designs = []; let menus = [];
    try {
      [designs, menus] = await Promise.all([
        api.get('/api/designs').then((r) => r.items || []),
        api.get('/api/touch-menus').then((r) => r.items || []),
      ]);
    } catch (err) { toast.error(errorMessage(err)); return; }
    const nameIn = input({ maxLength: 80, placeholder: 'z. B. Foyer Standard', autoComplete: 'off' });
    const descIn = input({ maxLength: 200, placeholder: 'Wofür ist die Präsentation gedacht?' });
    const designSel = select({ value: designs[0] ? String(designs[0].id) : '', options: [{ value: '', label: 'Ohne Design (kein Header/Footer)' }, ...designs.map((d) => ({ value: String(d.id), label: d.name }))] });
    const menuSel = select({ value: '', options: [{ value: '', label: 'Kein Touch-Menü' }, ...menus.map((m) => ({ value: String(m.id), label: m.name }))] });
    const copySel = select({ value: '', options: [{ value: '', label: 'Leer beginnen' }, ...state.items.map((p) => ({ value: String(p.id), label: `Kopie von „${p.name}“` }))] });
    const designField = field({ label: 'Design (Header und Footer)', name: 'design_id', control: designSel });
    const menuField = field({ label: 'Touch-Menü', name: 'touch_menu_id', optional: true, control: menuSel, hint: 'Was Besucher beim Antippen der Stele sehen.' });
    copySel.addEventListener('change', () => { designField.hidden = !!copySel.value; menuField.hidden = !!copySel.value; });
    const form = h('form', { class: 'form', onSubmit: (e) => e.preventDefault() },
      field({ label: 'Name', name: 'name', required: true, control: nameIn }),
      field({ label: 'Beschreibung', name: 'description', optional: true, control: descIn }),
      state.items.length ? field({ label: 'Vorlage', name: 'copy_from', control: copySel, hint: 'Eine Kopie übernimmt Folien, Einstellungen, Design und Touch-Menü.' }) : null,
      designField, menuField);
    openDialog({
      title: 'Neue Präsentation',
      size: 'md',
      content: form,
      actions: [
        { label: 'Abbrechen' },
        {
          label: 'Anlegen und bearbeiten', variant: 'primary', icon: 'plus',
          onClick: async () => {
            clearFieldErrors(form);
            const name = nameIn.value.trim();
            if (!name) { setFieldErrors(form, { name: 'Bitte einen Namen eingeben.' }); return false; }
            const body = { name, description: descIn.value.trim() };
            if (copySel.value) body.copy_from = Number(copySel.value);
            else { body.design_id = designSel.value ? Number(designSel.value) : null; body.touch_menu_id = menuSel.value ? Number(menuSel.value) : null; }
            try {
              const p = await api.post('/api/presentations', body);
              toast.success(`Präsentation „${p.name}“ angelegt.`);
              ctx.navigate(`/presentations/${p.id}`);
              return true;
            } catch (err) {
              if (err instanceof ApiError && err.fields) {
                const rest = setFieldErrors(form, err.fields);
                if (Object.keys(rest).length || !Object.keys(err.fields).length) toast.error(Object.values(rest)[0] || err.message);
                return false;
              }
              throw err;
            }
          },
        },
      ],
    });
  }

  async function duplicate(p) {
    try {
      const copy = await api.post('/api/presentations', { name: `${p.name} (Kopie)`.slice(0, 80), copy_from: p.id });
      toast.success(`Kopie „${copy.name}“ angelegt.`, { action: { label: 'Bearbeiten', onClick: () => ctx.navigate(`/presentations/${copy.id}`) } });
      load();
    } catch (err) { toast.error(errorMessage(err)); }
  }

  async function remove(p) {
    if (await removePresentation(p)) load();
  }

  load();
  // Direktlink „Neue Präsentation“ (z. B. aus der Übersicht): #/presentations?new=1
  if (ctx.query.new === '1') {
    ctx.setQuery({ new: null });
    if (canEdit) openCreate();
  }
  return () => {};
}

/** Vorschau-Dialog (Entwurf) – auch vom Editor genutzt. */
export function openPreview(p, { source = 'draft', hasTouch = null, startTouch = false } = {}) {
  const pf = playerFrame({ src: playerUrls.preview(p.id, { source, autoplay: true }), title: `Vorschau: ${p.name}` });
  const pos = h('span', { class: 'pl-prev__pos num', role: 'status', 'aria-live': 'polite' }, '–');
  let playing = true;
  const playBtn = h('button', { type: 'button', class: 'btn btn--secondary', onClick: () => { pf.send({ type: playing ? 'pause' : 'play' }); playing = !playing; paintPlay(); } });
  const paintPlay = () => fill(playBtn, icon(playing ? 'pause' : 'play'), playing ? 'Pause' : 'Abspielen');
  paintPlay();
  const touchAvailable = hasTouch ?? !!p.touch_menu;
  let touchOpen = false;
  const touchBtn = touchAvailable ? h('button', { type: 'button', class: 'btn btn--secondary', onClick: () => { touchOpen = !touchOpen; pf.send({ type: touchOpen ? 'openTouch' : 'closeTouch' }); paintTouch(); } }) : null;
  const paintTouch = () => touchBtn?.replaceChildren(icon('touch'), touchOpen ? 'Zurück zur Diashow' : 'Touch testen');
  paintTouch();
  pf.on('player:state', (s) => {
    if (Number.isFinite(s.index) && s.total) pos.textContent = `Folie ${s.index + 1} von ${s.total}`;
    else if (s.total === 0) pos.textContent = 'Keine aktive Folie';
    if (typeof s.playing === 'boolean') { playing = s.playing; paintPlay(); }
    if (s.mode) { touchOpen = s.mode === 'touch'; paintTouch(); }
  });
  pf.on('player:ready', (s) => {
    if (s.total === 0) pos.textContent = 'Keine aktive Folie';
    if (startTouch && touchAvailable) { touchOpen = true; pf.send({ type: 'openTouch' }); paintTouch(); }
  });
  openDialog({
    title: `Vorschau: ${p.name}`,
    description: source === 'draft' ? 'Aktueller Entwurf – so würde die Präsentation nach dem Veröffentlichen laufen.' : 'Veröffentlichter Stand.',
    size: 'lg',
    className: 'pl-prev',
    content: h('div', { class: 'pl-prev__body' },
      pf.el,
      h('div', { class: 'pl-prev__controls' },
        h('button', { type: 'button', class: 'btn btn--secondary btn--icon', 'aria-label': 'Vorherige Folie', title: 'Vorherige Folie', onClick: () => pf.send({ type: 'prev' }) }, icon('skip-back')),
        playBtn,
        h('button', { type: 'button', class: 'btn btn--secondary btn--icon', 'aria-label': 'Nächste Folie', title: 'Nächste Folie', onClick: () => pf.send({ type: 'next' }) }, icon('skip-forward')),
        pos,
        touchBtn)),
    actions: [],
    onClose: () => pf.destroy(),
  });
}
