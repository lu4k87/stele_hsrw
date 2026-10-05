// Präsentations-Editor (#/presentations/:id): Folienliste (Drag & Drop), Live-Vorschau, Eigenschaften (Folie,
// Diashow, Rahmen & Touch → presentation-editor/props.js). Der Entwurf wird automatisch gespeichert (ui/autosave.js);
// Veröffentlichen bzw. Freigabe getrennt (presentation-editor/review-actions.js).
import { h, useStyles, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, errorMessage } from '../api.js';
import { can } from '../session.js';
import { formatDuration, formatRelative, plural } from '../format.js';
import { page, pageHeader, card, button } from '../ui/page.js';
import { input } from '../ui/form.js';
import { confirmDialog } from '../ui/dialog.js';
import { menuButton } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { chip, presentationStatus, validityChip, contentTypeLabel } from '../ui/status.js';
import { emptyState, errorState, loadingBlock } from '../ui/empty.js';
import { contentStyles, contentPreview, announce, clone } from '../ui/content-common.js';
import { openContentPicker } from '../ui/content-picker.js';
import { gripButton, makeSortable, moveItem } from '../ui/sortable.js';
import { livePreview } from '../ui/live-preview.js';
import { itemToPayload, newItem } from '../ui/add-to-presentation.js';
import { removePresentation } from '../ui/presentation-actions.js';
import { editConflictAlert } from '../ui/edit-conflict.js';
import { autosave } from '../ui/autosave.js';
import { propsPanel, SLIDE_MAX_S } from './presentation-editor/props.js';
import { reviewActions } from './presentation-editor/review-actions.js';
import { openPreview } from './presentations.js';

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

export default async function mount(root, ctx) {
  await Promise.all([useStyles('/admin/css/views/presentation-editor.css'), useStyles('/admin/css/views/presentations.css'), contentStyles()]);
  const id = Number(ctx.params.id);
  const canEdit = can('presentations.edit');
  const canPublish = can('presentations.publish');
  const canDelete = can('presentations.delete');
  const canContentEdit = can('content.edit');

  root.append(loadingBlock('Präsentation wird geladen …'));
  let pres; let designs = []; let menus = []; let appSettings = {};
  try {
    [pres, designs, menus, appSettings] = await Promise.all([
      api.get(`/api/presentations/${id}`, { signal: ctx.signal }),
      api.get('/api/designs', { signal: ctx.signal }).then((r) => r.items || []).catch(() => []),
      api.get('/api/touch-menus', { signal: ctx.signal }).then((r) => r.items || []).catch(() => []),
      api.get('/api/settings', { signal: ctx.signal }).catch(() => ({})),
    ]);
  } catch (err) {
    if (err?.name === 'AbortError') return undefined;
    fill(root, page({}, pageHeader({ title: 'Präsentation', back: { href: '#/presentations', label: 'Präsentationen' } }),
      card({ body: errorState({ title: 'Präsentation konnte nicht geladen werden', error: err, onRetry: () => ctx.navigate(`/presentations/${id}`, { replace: true }) }) })));
    return undefined;
  }
  const timezone = appSettings.timezone || 'Europe/Berlin';
  // Info-Folien/Webseiten haben kein Vorschaubild – Daten für die Miniatur nachladen (nur Anzeige)
  const contentData = new Map();
  if (can('content.view')) {
    try {
      const res = await api.get('/api/contents', { query: { type: 'text,web', limit: 1000 }, signal: ctx.signal });
      for (const c of res.items || []) contentData.set(c.id, c.data);
    } catch { /* Miniaturen sind optional */ }
  }
  ctx.setTitle(pres.name);

  // ---------- Zustand ----------
  let meta = pickMeta(pres);
  let items = pres.items.map(toLocal);
  let selKey = items[0]?._k ?? null;
  let problems = new Map();          // item_id → Meldung (nach 422 beim Veröffentlichen)

  function pickMeta(p) {
    return { name: p.name, description: p.description || '', settings: clone(p.settings), design_id: p.design_id ?? null, touch_menu_id: p.touch_menu_id ?? null };
  }
  function toLocal(it) {
    const content = it.content ? { ...it.content } : { id: it.content_id, type: 'missing', title: 'Inhalt fehlt' };
    if ((content.type === 'text' || content.type === 'web') && !content.data && contentData.has(content.id)) content.data = contentData.get(content.id);
    return { ...clone(it), _k: nextKey(), options: clone(it.options || {}), content };
  }
  const selected = () => items.find((it) => it._k === selKey) || null;
  const selIndex = () => items.findIndex((it) => it._k === selKey);
  const designById = (did) => designs.find((d) => d.id === did) || null;
  const menuById = (mid) => menus.find((m) => m.id === mid) || null;

  // ---------- Dauer & Gültigkeit (lokal, damit Änderungen sofort sichtbar sind) ----------
  function effDuration(it) {
    const c = it.content || {};
    const s = meta.settings;
    const base = it.duration_s || s.default_duration_s;
    if (c.type === 'video') {
      const toEnd = it.options.play_to_end ?? s.video_play_to_end;
      if (toEnd && c.duration_s) return c.duration_s;
      return base;
    }
    if (c.type === 'pdf') return Math.max(1, countPages(it.options.pages, c.page_count || 0)) * (it.options.page_duration_s || base);
    return base;
  }
  const totalDuration = () => items.filter((it) => it.enabled).reduce((a, it) => a + effDuration(it), 0);
  // Empfehlung der Content-Strategie: Durchlauf 60–90 s (Passanten in Bewegung)
  const LOOP_MAX_S = 90;
  const tooLong = (it) => ['image', 'text'].includes(it.content?.type) && effDuration(it) > SLIDE_MAX_S;
  function nowLocal() {
    try {
      return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(' ', 'T');
    } catch { return new Date().toISOString().slice(0, 16); }
  }
  function validity(it) {
    const now = nowLocal();
    if (it.valid_from && now < it.valid_from) return 'scheduled';
    if (it.valid_until && now >= it.valid_until) return 'expired';
    return 'active';
  }

  // ---------- Autosave ----------
  // 409 edit_conflict: jemand anderes hat gespeichert → kein Autosave mehr, Hinweis mit „Neu laden“
  const draft = autosave({
    ctx, enabled: canEdit, className: 'pe-save',
    parts: {
      meta: async () => applyServer(await api.patch(`/api/presentations/${id}`, { ...clone(meta), expected_updated_at: pres.updated_at }), null),
      items: async () => {
        const keys = items.map((it) => it._k);
        applyServer(await api.put(`/api/presentations/${id}/items`, { items: items.map(itemToPayload), expected_updated_at: pres.updated_at }), keys);
      },
    },
    fieldMessage: firstFieldMessage,
    onConflict: () => renderBanners(),
    conflictMessage: 'Die Änderungen hier wurden nicht gespeichert, weil die Präsentation inzwischen anderweitig geändert wurde.',
  });
  const queueSave = draft.queue;
  const flush = draft.flush;

  function firstFieldMessage(err) {
    const f = err.fields || {};
    const first = Object.entries(f)[0];
    if (!first) return err.message;
    const m = /^items\.(\d+)\./.exec(first[0]);
    if (m && items[Number(m[1])]) return `Folie ${Number(m[1]) + 1} („${items[Number(m[1])].content.title}“): ${first[1]}`;
    return first[1];
  }

  function applyServer(res, keys) {
    if (!res) return;
    const prevStatus = pres.status;
    const prevReview = pres.review_state;
    const prevChanged = pres.review_changed;
    pres = { ...pres, ...res };
    if (keys && Array.isArray(res.items)) {
      res.items.forEach((srv, i) => {
        const it = items.find((x) => x._k === keys[i]);
        if (!it) return;
        it.id = srv.id;
        if (srv.content) it.content = { ...srv.content, data: it.content?.data ?? contentData.get(srv.content.id) };
        it.effective_duration_s = srv.effective_duration_s;
      });
    }
    if (prevStatus !== pres.status || prevReview !== pres.review_state || prevChanged !== pres.review_changed) renderHeaderParts();
    else paintStatus();
  }


  // ---------- Kopf ----------
  const nameBox = h('span', { class: 'pe-name' });
  function renderName(editing = false) {
    if (!editing || !canEdit) {
      fill(nameBox, canEdit
        ? h('button', { type: 'button', class: 'pe-name__btn', title: 'Namen ändern', onClick: () => renderName(true) },
          h('span', {}, meta.name), icon('pencil', { size: 18 }), h('span', { class: 'visually-hidden' }, ' – Namen ändern'))
        : h('span', {}, meta.name));
      return;
    }
    const inp = input({ value: meta.name, maxLength: 80, 'aria-label': 'Name der Präsentation', className: 'pe-name__input' });
    let done = false;
    const commit = (keep) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      if (keep && v && v !== meta.name) {
        meta.name = v;
        ctx.setTitle(v);
        queueSave('meta');
      } else if (keep && !v) toast.warning('Der Name darf nicht leer sein – der bisherige Name bleibt.');
      renderName(false);
      nameBox.querySelector('button')?.focus();
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(false); }
    });
    inp.addEventListener('blur', () => commit(true));
    fill(nameBox, inp);
    inp.focus();
    inp.select();
  }

  const statusBox = h('span', { class: 'pe-status' });
  const actionsBox = h('div', { class: 'page-header__actions' });
  const bannerBox = h('div', { class: 'stack stack--sm' });
  function paintStatus() { fill(statusBox, presentationStatus(pres)); }

  function renderHeaderParts() {
    paintStatus();
    const isPublished = pres.status === 'published';
    const acts = [
      button({ label: 'Vorschau', icon: 'play', variant: 'secondary', onClick: showPreview }),
      menuButton({ label: 'Weitere Aktionen', items: () => [
        canEdit ? { label: 'Duplizieren', icon: 'copy', onClick: duplicate } : null,
        canEdit && pres.status === 'changed' ? { label: 'Änderungen verwerfen', icon: 'undo', hint: 'Zurück zum veröffentlichten Stand', onClick: discard } : null,
        { label: 'Veröffentlichten Stand ansehen', icon: 'eye', disabled: pres.status === 'draft', onClick: () => openPreview(pres, { source: 'published', hasTouch: !!pres.touch_menu }) },
        canDelete ? { separator: true } : null,
        canDelete ? { label: 'Präsentation löschen', icon: 'trash', danger: true, onClick: remove } : null,
      ] }),
    ];
    if (canPublish) {
      // Veröffentlicht → kein gesperrter Knopf, der Status-Chip im Kopf zeigt den Stand
      if (!isPublished) acts.push(button({ label: 'Veröffentlichen', icon: 'broadcast', variant: 'primary', onClick: () => publish() }));
    } else if (canEdit) {
      // angefragt oder ohne Änderungen → ausblenden; Status-Chip und Freigabe-Hinweis zeigen den Stand
      if (pres.review_state !== 'requested' && !isPublished) acts.push(button({ label: 'Zur Freigabe einreichen', icon: 'send', variant: 'primary', onClick: requestReview }));
    }
    fill(actionsBox, ...acts);
    renderBanners();
  }

  function reload() {
    draft.drop();
    ctx.setDirty(false);
    ctx.navigate(`/presentations/${id}`, { replace: true });
  }

  function renderBanners() {
    const out = [];
    if (draft.conflict) out.push(editConflictAlert(draft.conflict, { onReload: reload }));
    const by = pres.review_by?.display_name;
    if (pres.review_state === 'requested') {
      out.push(h('div', { class: 'alert' }, icon('send'), h('div', { class: 'alert__body' },
        h('div', { class: 'alert__title' }, `Freigabe angefragt${by ? ` von ${by}` : ''}${pres.review_at ? ` (${formatRelative(pres.review_at)})` : ''}`),
        pres.review_note ? h('div', { class: 'alert__text' }, `Notiz: ${pres.review_note}`) : null,
        pres.review_changed ? h('div', { class: 'alert__text' }, h('strong', {}, 'Seit dem Einreichen geändert'), ' (Design, Touch-Menü oder Inhalte) – bitte den aktuellen Stand in der Vorschau prüfen.') : null,
        h('div', { class: 'alert__text' }, canPublish ? 'Bitte prüfen und veröffentlichen oder mit Begründung ablehnen.' : 'Eine Person mit Veröffentlichungsrecht prüft den Entwurf.'),
        canPublish ? h('div', { class: 'alert__actions' },
          button({ label: 'Veröffentlichen', icon: 'broadcast', variant: 'primary', size: 'sm', onClick: () => publish() }),
          button({ label: 'Ablehnen', icon: 'x-circle', variant: 'secondary', size: 'sm', onClick: reject })) : null)));
    } else if (pres.review_state === 'rejected') {
      out.push(h('div', { class: 'alert alert--danger' }, icon('x-circle'), h('div', { class: 'alert__body' },
        h('div', { class: 'alert__title' }, `Freigabe abgelehnt${by ? ` von ${by}` : ''}${pres.review_at ? ` (${formatRelative(pres.review_at)})` : ''}`),
        h('div', { class: 'alert__text' }, `Begründung: ${pres.review_note || '–'}`),
        canEdit && !canPublish ? h('div', { class: 'alert__text' }, 'Nach der Überarbeitung bitte erneut zur Freigabe einreichen.') : null)));
    }
    if (problems.size) {
      out.push(h('div', { class: 'alert alert--danger' }, icon('alert-circle'), h('div', { class: 'alert__body' },
        h('div', { class: 'alert__title' }, 'Veröffentlichen nicht möglich'),
        h('ul', { class: 'alert__text', style: { margin: 0 } }, [...problems.entries()].map(([iid, msg]) => {
          const idx = items.findIndex((it) => it.id === iid);
          return h('li', {}, idx >= 0
            ? h('button', { type: 'button', class: 'btn btn--link', onClick: () => selectItem(items[idx]._k, true) }, `Folie ${idx + 1}: ${items[idx].content.title}`)
            : `Folie #${iid}`, ` – ${msg}`);
        })),
        h('div', { class: 'alert__text' }, 'Bitte warten, bis die Verarbeitung fertig ist, oder die Folien deaktivieren.'))));
    }
    if (!canEdit) {
      out.push(h('div', { class: 'alert alert--neutral' }, icon('eye'), h('div', { class: 'alert__body' },
        h('div', { class: 'alert__text' }, 'Nur Ansicht – zum Bearbeiten fehlt das Recht „Präsentationen bearbeiten“.'))));
    }
    fill(bannerBox, ...out);
    bannerBox.hidden = !out.length;
  }

  const header = pageHeader({
    title: nameBox,
    back: { href: '#/presentations', label: 'Präsentationen' },
    status: statusBox,
    description: canEdit ? 'Änderungen werden automatisch als Entwurf gespeichert. Auf den Stelen erscheint erst der veröffentlichte Stand.' : null,
    meta: canEdit ? draft.el : null,
  });
  header.append(actionsBox);

  // ---------- Folienliste ----------
  const listTitle = h('h2', { class: 'card__title' }, icon('layers'), h('span', {}));
  const listEl = h('ol', { class: 'pe-items', 'aria-label': 'Folien in Abspielreihenfolge' });
  const listBody = h('div', { class: 'pe-list__body' });
  const addBtn = canEdit ? button({ label: 'Folien hinzufügen', icon: 'plus', variant: 'secondary', size: 'sm', onClick: addSlides }) : null;
  const loopWarn = h('div', { class: 'alert alert--warning pe-loop-warn', role: 'status', hidden: true });
  const listCard = h('section', { class: 'card pe-list' },
    h('div', { class: 'card__header' }, listTitle, addBtn),
    loopWarn,
    listBody);
  makeSortable(listEl, {
    disabled: () => !canEdit,
    itemLabel: (i) => items[i]?.content.title,
    onMove: (from, to) => { moveItem(items, from, to); queueSave('items'); renderList(); renderPreviewNav(); },
  });

  function renderListTitle() {
    const active = items.filter((it) => it.enabled).length;
    listTitle.lastChild.textContent = `Folien (${items.length}) · ${formatDuration(totalDuration())}`;
    listTitle.title = `${plural(active, 'aktive Folie', 'aktive Folien')}, Gesamtdauer eines Durchlaufs`;
    const total = totalDuration();
    loopWarn.hidden = total <= LOOP_MAX_S;
    if (!loopWarn.hidden) {
      fill(loopWarn, icon('alert-triangle'), h('div', { class: 'alert__body' },
        h('div', { class: 'alert__title' }, `Durchlauf dauert ${formatDuration(total)} – empfohlen sind höchstens ${LOOP_MAX_S} s`),
        h('div', { class: 'alert__text' }, 'Wer vorbeigeht, sieht sonst nur einen Teil. Folien kürzen oder nicht benötigte deaktivieren.')));
    }
  }

  function itemChips(it) {
    const c = it.content;
    const out = [];
    if (!it.enabled) out.push(chip('neutral', 'Deaktiviert', 'eye-off', { size: 'sm' }));
    const v = validityChip(validity(it));
    if (v) out.push(v);
    if (it.options.fullscreen) out.push(chip('info', 'Vollbild', 'maximize', { size: 'sm' }));
    if (it.enabled && tooLong(it)) out.push(chip('warning', `Über ${SLIDE_MAX_S} s`, 'clock', { size: 'sm', title: `Empfohlen: 5–${SLIDE_MAX_S} s je Folie` }));
    if (c.status === 'processing') out.push(chip('info', 'In Verarbeitung', 'clock', { size: 'sm' }));
    if (c.status === 'error' || c.type === 'missing') out.push(chip('danger', c.type === 'missing' ? 'Inhalt fehlt' : 'Fehler', 'alert-circle', { size: 'sm' }));
    if (it.id && problems.has(it.id)) out.push(chip('danger', 'Nicht bereit', 'alert-circle', { size: 'sm' }));
    return out;
  }

  function renderList() {
    renderListTitle();
    if (!items.length) {
      fill(listBody, emptyState({
        icon: 'layers', title: 'Noch keine Folien',
        text: canEdit ? 'Inhalte aus der Mediathek als Folien hinzufügen – Bilder, Videos, PDFs, Info-Folien oder Webseiten.' : 'Diese Präsentation enthält noch keine Folien.',
        actions: canEdit ? [button({ label: 'Folien hinzufügen', icon: 'plus', variant: 'primary', onClick: addSlides })] : [],
      }));
      return;
    }
    const active = document.activeElement;
    const focusK = active?.closest?.('[data-k]')?.dataset.k;
    const focusRole = active?.dataset?.role || (active?.matches?.('[data-sort-handle]') ? 'grip' : null);
    fill(listEl, ...items.map((it, i) => {
      const c = it.content;
      const isSel = it._k === selKey;
      const sw = h('input', { type: 'checkbox', role: 'switch', checked: it.enabled, disabled: !canEdit, dataset: { role: 'toggle' }, 'aria-label': `Folie ${i + 1} „${c.title}“ aktiv` });
      sw.addEventListener('change', () => { it.enabled = sw.checked; queueSave('items'); renderList(); if (isSel) renderProps(); announce(sw.checked ? 'Folie aktiviert' : 'Folie deaktiviert'); });
      const grip = canEdit ? gripButton({ label: `Folie ${i + 1} „${c.title}“ verschieben` }) : null;
      if (grip) grip.dataset.role = 'grip';
      return h('li', { class: ['pe-item', isSel && 'is-selected', !it.enabled && 'is-off'], dataset: { sortItem: '', k: it._k } },
        grip,
        h('button', { type: 'button', class: 'pe-item__main', 'aria-pressed': String(isSel), dataset: { role: 'select' }, onClick: () => selectItem(it._k) },
          h('span', { class: 'pe-item__num num', 'aria-hidden': 'true' }, String(i + 1)),
          h('span', { class: 'cu-portrait' }, contentPreview(c, { size: 'sm' })),
          h('span', { class: 'pe-item__text' },
            h('span', { class: 'pe-item__title' }, h('span', { class: 'visually-hidden' }, `Folie ${i + 1}: `), c.title),
            h('span', { class: 'pe-item__meta' }, `${contentTypeLabel(c.type === 'missing' ? 'Inhalt fehlt' : c.type)} · ${formatDuration(effDuration(it))}`),
            itemChips(it).length ? h('span', { class: 'pe-item__chips' }, itemChips(it)) : null)),
        h('label', { class: 'switch pe-item__switch', title: it.enabled ? 'Aktiv – wird abgespielt' : 'Deaktiviert – wird übersprungen' }, sw),
        canEdit ? menuButton({ label: `Aktionen für Folie ${i + 1}`, size: 'sm', items: () => itemMenu(it) }) : null);
    }));
    fill(listBody, listEl);
    if (focusK) {
      const li = listEl.querySelector(`[data-k="${CSS.escape(focusK)}"]`);
      const target = focusRole === 'grip' ? li?.querySelector('[data-sort-handle]') : li?.querySelector(`[data-role="${focusRole || 'select'}"]`);
      if (target && listEl.contains(active) === false) target.focus();
    }
  }

  function itemMenu(it) {
    const i = items.indexOf(it);
    const last = items.length - 1;
    const mv = (to) => { moveItem(items, i, to); queueSave('items'); renderList(); renderPreviewNav(); announce(`„${it.content.title}“ jetzt an Position ${to + 1} von ${items.length}.`); focusItem(it._k); };
    const c = it.content;
    return [
      { label: 'Nach oben', icon: 'chevron-up', disabled: i === 0, onClick: () => mv(i - 1) },
      { label: 'Nach unten', icon: 'chevron-down', disabled: i === last, onClick: () => mv(i + 1) },
      { label: 'An den Anfang', icon: 'chevrons-left', disabled: i === 0, onClick: () => mv(0) },
      { label: 'Ans Ende', icon: 'chevrons-right', disabled: i === last, onClick: () => mv(last) },
      { separator: true },
      c.type === 'text' && canContentEdit ? { label: 'Info-Folie bearbeiten', icon: 'pencil', href: `#/media/text/${c.id}` } : null,
      c.type !== 'text' && c.type !== 'missing' ? { label: 'In der Mediathek anzeigen', icon: 'images', href: `#/media?q=${encodeURIComponent(c.title)}` } : null,
      { label: 'Folie entfernen', icon: 'trash', danger: true, onClick: () => removeItem(it) },
    ];
  }

  function focusItem(k) {
    requestAnimationFrame(() => listEl.querySelector(`[data-k="${CSS.escape(k)}"] [data-role="select"]`)?.focus());
  }

  function selectItem(k, scroll = false) {
    selKey = k;
    renderList();
    renderProps();
    renderPreview();
    renderPreviewNav();
    if (scroll) {
      const li = listEl.querySelector(`[data-k="${CSS.escape(k)}"]`);
      li?.scrollIntoView({ block: 'nearest' });
      li?.querySelector('[data-role="select"]')?.focus();
    }
  }

  async function addSlides() {
    const picked = await openContentPicker({ title: 'Folien hinzufügen', description: 'Inhalte antippen – sie werden in der Reihenfolge der Auswahl am Ende angefügt.', multiple: true, confirmLabel: 'Hinzufügen' });
    if (!picked) return;
    const added = picked.map((c) => ({ ...toLocal({ ...newItem(c.id), content: { id: c.id, type: c.type, title: c.title, status: c.status, thumb_url: c.urls?.thumb || null, duration_s: c.file?.duration_s ?? null, page_count: c.file?.page_count ?? null, warnings: c.warnings || [], data: c.data } }) }));
    items.push(...added);
    queueSave('items');
    toast.success(`${plural(added.length, 'Folie', 'Folien')} hinzugefügt.`);
    selectItem(added[0]._k, true);
  }

  function removeItem(it) {
    const idx = items.indexOf(it);
    if (idx < 0) return;
    items.splice(idx, 1);
    if (selKey === it._k) selKey = items[Math.min(idx, items.length - 1)]?._k ?? null;
    queueSave('items');
    renderList(); renderProps(); renderPreview(); renderPreviewNav();
    if (selKey) focusItem(selKey); else addBtn?.focus();
    toast.success(`Folie „${it.content.title}“ entfernt.`, {
      action: { label: 'Rückgängig', onClick: () => { items.splice(Math.min(idx, items.length), 0, it); queueSave('items'); selectItem(it._k, true); } },
    });
  }

  // ---------- Vorschau ----------
  const pv = livePreview({ title: 'Vorschau der gewählten Folie' });
  const posLabel = h('span', { class: 'pe-stage__pos num', role: 'status', 'aria-live': 'polite' });
  const prevBtn = h('button', { type: 'button', class: 'btn btn--secondary btn--icon', 'aria-label': 'Vorherige Folie', title: 'Vorherige Folie', onClick: () => step(-1) }, icon('chevron-left'));
  const nextBtn = h('button', { type: 'button', class: 'btn btn--secondary btn--icon', 'aria-label': 'Nächste Folie', title: 'Nächste Folie', onClick: () => step(1) }, icon('chevron-right'));
  const stageEmpty = h('p', { class: 'text-2 pe-stage__empty', hidden: true }, 'Keine Folie ausgewählt.');
  const stageCard = card({
    title: 'Vorschau', icon: 'eye', className: 'pe-stage',
    actions: [button({ label: 'Ganze Präsentation', icon: 'play', variant: 'ghost', size: 'sm', onClick: showPreview })],
    body: h('div', { class: 'stack' }, pv.el, stageEmpty, h('div', { class: 'pe-stage__nav' }, prevBtn, posLabel, nextBtn)),
  });
  function step(d) {
    const i = selIndex();
    const n = i + d;
    if (n >= 0 && n < items.length) selectItem(items[n]._k);
  }
  function renderPreviewNav() {
    const i = selIndex();
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i < 0 || i >= items.length - 1;
    posLabel.textContent = i >= 0 ? `Folie ${i + 1} von ${items.length}` : '–';
  }
  function renderPreview() {
    const it = selected();
    pv.el.hidden = !it;
    stageEmpty.hidden = !!it;
    if (!it) return;
    const d = designById(meta.design_id);
    pv.update({
      settings: meta.settings,
      design: d ? d.config : null,
      touch_menu: null,
      items: [{ ...itemToPayload(it), enabled: true, content: null }],
    }, (res) => ({ slide: res.slides?.[0] || null, design: res.design, settings: res.settings, view: 'slide' }));
  }

  // ---------- Eigenschaften ----------
  const props = propsPanel({
    canEdit, canContentEdit, timezone, designs, menus, designById, menuById, meta: () => meta, items: () => items,
    selected, selIndex, effDuration, queueSave, renderList, renderListTitle, renderPreview, showPreview,
  });
  const renderProps = props.render;

  // ---------- Aktionen ----------
  async function ensureSaved() {
    if (!canEdit) return true;
    const ok = await flush();
    if (!ok) toast.error('Bitte zuerst die Speicherfehler beheben.');
    return ok;
  }

  async function showPreview({ touch = false } = {}) {
    if (!(await ensureSaved())) return;
    openPreview({ ...pres, name: meta.name }, { source: 'draft', hasTouch: !!meta.touch_menu_id, startTouch: touch });
  }

  const { publish, requestReview, reject } = reviewActions({
    id, ctx, pres: () => pres, meta: () => meta, items: () => items, totalDuration, ensureSaved, applyServer,
    setProblems: (m) => { problems = m; }, renderHeaderParts, renderBanners, renderList,
  });

  async function discard() {
    const ok = await confirmDialog({
      title: 'Änderungen verwerfen?',
      message: 'Folien, Einstellungen, Design und Touch-Menü werden auf den zuletzt veröffentlichten Stand zurückgesetzt. Das lässt sich nicht rückgängig machen.',
      confirmLabel: 'Änderungen verwerfen', danger: true, icon: 'undo',
    });
    if (!ok) return;
    await draft.settle();
    try {
      const res = await api.post(`/api/presentations/${id}/discard`);
      pres = res;
      meta = pickMeta(res);
      items = res.items.map(toLocal);
      selKey = items[0]?._k ?? null;
      problems = new Map();
      draft.paint('saved');
      ctx.setDirty(false);
      ctx.setTitle(meta.name);
      renderName();
      renderHeaderParts(); renderList(); renderProps(); renderPreview(); renderPreviewNav();
      toast.success('Änderungen verworfen.');
    } catch (err) { toast.error(errorMessage(err)); }
  }

  async function duplicate() {
    if (!(await ensureSaved())) return;
    try {
      const copy = await api.post('/api/presentations', { name: `${meta.name} (Kopie)`.slice(0, 80), copy_from: id });
      toast.success(`Kopie „${copy.name}“ angelegt.`);
      ctx.navigate(`/presentations/${copy.id}`);
    } catch (err) { toast.error(errorMessage(err)); }
  }

  async function remove() {
    // Offene Änderungen zuerst speichern; Speicher-Flags erst nach erfolgreichem Löschen verwerfen
    const ok = await removePresentation({ ...pres, name: meta.name }, { beforeDelete: () => flush() });
    if (!ok) return;
    draft.drop();
    ctx.setDirty(false);
    ctx.navigate('/presentations');
  }

  // ---------- Aufbau ----------
  renderName();
  renderHeaderParts();
  draft.paint(canEdit ? 'saved' : 'readonly');
  renderList();
  renderProps();
  renderPreview();
  renderPreviewNav();

  fill(root, page({ wide: true, className: 'pe-page' },
    header,
    bannerBox,
    h('div', { class: 'pe-layout' }, listCard, stageCard, props.el),
  ));

  return () => {
    // Offene Änderungen noch absenden (ohne Abbruchsignal), dann aufräumen
    draft.destroy();
    pv.destroy();
  };
}

function countPages(spec, total) {
  if (!spec || !String(spec).trim()) return total;
  const set = new Set();
  for (const part of String(spec).split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i <= (total || 9999); i += 1) if (i >= 1) set.add(i);
  }
  return set.size;
}

