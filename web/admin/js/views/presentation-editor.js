// Präsentations-Editor (#/presentations/:id): Folienliste (Drag & Drop), Live-Vorschau, Eigenschaften (Folie,
// Diashow, Rahmen & Touch). Der Entwurf wird automatisch gespeichert; Veröffentlichen bzw. Freigabe getrennt.
import { h, useStyles, debounce, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can } from '../session.js';
import { formatDuration, formatRelative, plural } from '../format.js';
import { page, pageHeader, card, button } from '../ui/page.js';
import { field, input, numberInput, select, segmented, switchToggle, textarea } from '../ui/form.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { menuButton } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { tabs } from '../ui/tabs.js';
import { chip, presentationStatus, validityChip, contentTypeLabel } from '../ui/status.js';
import { emptyState, errorState, loadingBlock } from '../ui/empty.js';
import { contentStyles, contentPreview, announce, clone } from '../ui/content-common.js';
import { colorChoice } from '../ui/color-choice.js';
import { openContentPicker } from '../ui/content-picker.js';
import { gripButton, makeSortable, moveItem } from '../ui/sortable.js';
import { livePreview } from '../ui/live-preview.js';
import { itemToPayload, newItem } from '../ui/add-to-presentation.js';
import { removePresentation, publishPresentation } from '../ui/presentation-actions.js';
import { isEditConflict, editConflictAlert } from '../ui/edit-conflict.js';
import { openPreview } from './presentations.js';

const TRANSITIONS = [
  { value: 'none', label: 'Ohne (harter Schnitt)' },
  { value: 'fade', label: 'Überblenden' },
  { value: 'slide-left', label: 'Schieben nach links' },
  { value: 'slide-up', label: 'Schieben nach oben' },
  { value: 'zoom', label: 'Zoom' },
];
const transitionLabel = (v) => TRANSITIONS.find((t) => t.value === v)?.label || v;
const SAVE_DELAY = 700;
const RETRY_MS = 5000;
const PAGES_RE = /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/;

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
  let tab = 'slide';
  let problems = new Map();          // item_id → Meldung (nach 422 beim Veröffentlichen)
  let conflict = null;               // 409 edit_conflict: jemand anderes hat gespeichert → kein Autosave mehr, „Neu laden“
  const save = { meta: false, items: false, running: null, error: null, retryTimer: null, lastToast: 0 };
  let lastPart = null;               // welcher Teil gerade gesendet wird (für Wiederholen bei Fehler)

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
  // Empfehlung der Content-Strategie: Durchlauf 60–90 s, Standbild-Folien 5–7 s (Passanten in Bewegung)
  const LOOP_MAX_S = 90;
  const SLIDE_MAX_S = 7;
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
  const saveStatus = h('div', { class: 'pe-save', role: 'status', 'aria-live': 'polite' });
  function paintSave(kind) {
    saveStatus.className = `pe-save pe-save--${kind}`;
    if (kind === 'saved') fill(saveStatus, icon('check-circle', { size: 16 }), 'Alle Änderungen gespeichert');
    else if (kind === 'pending' || kind === 'saving') fill(saveStatus, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Wird gespeichert …');
    else if (kind === 'error') {
      fill(saveStatus, icon('alert-circle', { size: 16 }), h('span', {}, 'Speichern fehlgeschlagen – '),
        h('button', { type: 'button', class: 'btn btn--link', onClick: () => flush() }, 'erneut versuchen'));
    } else if (kind === 'conflict') fill(saveStatus, icon('alert-circle', { size: 16 }), 'Nicht gespeichert – inzwischen anderweitig geändert');
    else fill(saveStatus, icon('eye', { size: 16 }), 'Nur Ansicht');
  }
  const debouncedFlush = debounce(() => flush(), SAVE_DELAY);
  function queueSave(kind) {
    if (!canEdit) return;
    save[kind] = true;
    if (conflict) return;            // wartet auf „Neu laden“
    clearTimeout(save.retryTimer);
    ctx.setDirty('Die letzten Änderungen werden noch gespeichert. Beim sofortigen Verlassen können sie verloren gehen.');
    paintSave('pending');
    debouncedFlush();
  }
  function flush() {
    debouncedFlush.cancel();
    clearTimeout(save.retryTimer);
    if (save.running) return save.running;
    if (conflict) return Promise.resolve(false);
    if (!save.meta && !save.items) return Promise.resolve(true);
    save.running = (async () => {
      save.error = null;
      paintSave('saving');
      try {
        while (save.meta || save.items) {
          if (save.meta) {
            save.meta = false;
            lastPart = 'meta';
            const res = await api.patch(`/api/presentations/${id}`, { ...clone(meta), expected_updated_at: pres.updated_at });
            applyServer(res, null);
          }
          if (save.items) {
            save.items = false;
            lastPart = 'items';
            const keys = items.map((it) => it._k);
            const res = await api.put(`/api/presentations/${id}/items`, { items: items.map(itemToPayload), expected_updated_at: pres.updated_at });
            applyServer(res, keys);
          }
        }
        paintSave('saved');
        ctx.setDirty(false);
        return true;
      } catch (err) {
        save.error = err;
        // Nicht gespeicherten Teil wieder vormerken
        save.meta = save.meta || lastPart === 'meta';
        save.items = save.items || lastPart === 'items';
        if (isEditConflict(err)) {
          conflict = err;
          paintSave('conflict');
          ctx.setDirty('Die Änderungen hier wurden nicht gespeichert, weil die Präsentation inzwischen anderweitig geändert wurde.');
          renderBanners();
          return false;
        }
        paintSave('error');
        ctx.setDirty('Einige Änderungen konnten nicht gespeichert werden. Beim Verlassen gehen sie verloren.');
        const now = Date.now();
        if (now - save.lastToast > 8000) {
          save.lastToast = now;
          toast.error(err instanceof ApiError && err.status === 422 ? `Speichern nicht möglich: ${firstFieldMessage(err)}` : `Speichern fehlgeschlagen: ${errorMessage(err)}`);
        }
        // Netz-/Serverfehler: automatisch erneut versuchen; Eingabefehler warten auf Korrektur
        if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500) save.retryTimer = setTimeout(() => flush(), RETRY_MS);
        return false;
      } finally {
        save.running = null;
        lastPart = null;
      }
    })();
    return save.running;
  }

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
      acts.push(isPublished
        ? button({ label: 'Veröffentlicht', icon: 'check-circle', variant: 'secondary', disabled: true, title: 'Der Entwurf entspricht dem veröffentlichten Stand.' })
        : button({ label: 'Veröffentlichen', icon: 'broadcast', variant: 'primary', onClick: () => publish() }));
    } else if (canEdit) {
      acts.push(pres.review_state === 'requested'
        ? button({ label: 'Freigabe angefragt', icon: 'send', variant: 'secondary', disabled: true, title: 'Wartet auf eine Person mit Veröffentlichungsrecht.' })
        : button({ label: 'Zur Freigabe einreichen', icon: 'send', variant: 'primary', disabled: isPublished, title: isPublished ? 'Keine offenen Änderungen.' : null, onClick: requestReview }));
    }
    fill(actionsBox, ...acts);
    renderBanners();
  }

  function reload() {
    debouncedFlush.cancel();
    clearTimeout(save.retryTimer);
    save.meta = false; save.items = false;
    ctx.setDirty(false);
    ctx.navigate(`/presentations/${id}`, { replace: true });
  }

  function renderBanners() {
    const out = [];
    if (conflict) out.push(editConflictAlert(conflict, { onReload: reload }));
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
    meta: canEdit ? saveStatus : null,
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
  const t = tabs({
    ariaLabel: 'Eigenschaften',
    value: tab,
    items: [
      { id: 'slide', label: 'Folie', icon: 'image' },
      { id: 'show', label: 'Diashow', icon: 'sliders' },
      { id: 'frame', label: 'Rahmen & Touch', icon: 'palette' },
    ],
    onChange: (v) => { tab = v; renderProps(); },
  });
  const propsCard = h('section', { class: 'card pe-props', 'aria-label': 'Eigenschaften' }, h('div', { class: 'pe-props__tabs' }, t.el), h('div', { class: 'card__body' }, t.panel));

  function renderProps() {
    const keepFocus = propsCard.contains(document.activeElement) && !t.el.contains(document.activeElement);
    if (tab === 'slide') fill(t.panel, slideProps());
    else if (tab === 'show') fill(t.panel, showProps());
    else fill(t.panel, frameProps());
    if (keepFocus) t.panel.focus();
  }

  /** Zahl mit Prüfung: ungültige Werte werden am Feld gemeldet und nicht übernommen. */
  function numField({ label, value, min, max, step = 1, unit, hint, placeholder, allowEmpty = false, onValid, name = null }) {
    let f;
    const ctl = numberInput({
      value, min, max, step, unit, placeholder, disabled: !canEdit,
      onInput: (v) => {
        const err = v === null ? (allowEmpty ? null : 'Bitte einen Wert eingeben.')
          : (v < min || v > max) ? `Bitte einen Wert von ${min} bis ${max} eingeben.` : null;
        setErr(f, err);
        if (!err) onValid(v);
      },
    });
    f = field({ label, control: ctl, hint, name });
    return f;
  }
  function setErr(f, msg) {
    const e = f.querySelector(':scope > .field__error');
    const inp = f.querySelector('input, select, textarea');
    if (!e) return;
    e.hidden = !msg;
    fill(e, ...(msg ? [icon('alert-circle', { size: 16 }), h('span', {}, msg)] : []));
    f.classList.toggle('field--invalid', !!msg);
    if (msg) inp?.setAttribute('aria-invalid', 'true'); else inp?.removeAttribute('aria-invalid');
  }
  /** Drei Zustände: Standard (undefined) / an / aus. */
  function triSelect({ value, defaultOn, onLabel = 'An', offLabel = 'Aus', onChange }) {
    return select({
      value: value === undefined || value === null ? '' : value ? 'on' : 'off', disabled: !canEdit,
      options: [{ value: '', label: `Standard (${defaultOn ? onLabel : offLabel})` }, { value: 'on', label: onLabel }, { value: 'off', label: offLabel }],
      onChange: (v) => onChange(v === '' ? undefined : v === 'on'),
    });
  }
  function itemChanged(it, { list = true, preview = true } = {}) {
    queueSave('items');
    if (list) renderList();
    if (preview) renderPreview();
  }
  function setOpt(it, key, v) {
    if (v === undefined || v === null || v === '') delete it.options[key]; else it.options[key] = v;
  }

  function slideProps() {
    const it = selected();
    if (!it) return h('p', { class: 'text-2' }, items.length ? 'Links eine Folie auswählen, um sie einzustellen.' : 'Noch keine Folien vorhanden.');
    const c = it.content;
    const s = meta.settings;
    const typeRow = h('div', { class: 'pe-props__head' },
      h('span', { class: 'cu-portrait' }, contentPreview(c, { size: 'sm' })),
      h('div', { class: 'pe-props__headtext' },
        h('strong', { class: 'pe-props__title' }, c.title),
        h('span', { class: 'text-2 text-sm' }, `${contentTypeLabel(c.type)} · Folie ${selIndex() + 1} von ${items.length}`),
        c.type === 'text' && canContentEdit ? h('a', { href: `#/media/text/${c.id}`, class: 'text-sm' }, 'Info-Folie bearbeiten') : null,
        c.type === 'web' ? h('span', { class: 'text-sm text-2' }, 'Adresse, Zoom und Neuladen werden in der Mediathek eingestellt.') : null));

    const active = switchToggle({ label: 'Aktiv', hint: 'Deaktivierte Folien werden übersprungen, bleiben aber in der Liste.', checked: it.enabled, disabled: !canEdit, onChange: (v) => { it.enabled = v; itemChanged(it); } });

    // Dauer (Video: ggf. durch Länge bestimmt; PDF: je Seite)
    const toEnd = it.options.play_to_end ?? s.video_play_to_end;
    let durationField;
    if (c.type === 'pdf') {
      const pages = input({ value: it.options.pages || '', placeholder: `alle (${c.page_count || '?'} Seiten)`, disabled: !canEdit, maxLength: 60 });
      let pf;
      pages.addEventListener('input', () => {
        const v = pages.value.trim();
        const ok = !v || PAGES_RE.test(v);
        setErr(pf, ok ? null : 'Seiten bitte wie „1-3,5“ angeben.');
        if (ok) { setOpt(it, 'pages', v); itemChanged(it); }
      });
      pf = field({ label: 'Seiten', control: pages, hint: 'z. B. „1-3,5“ – leer = alle Seiten.' });
      durationField = h('div', { class: 'form-row' }, pf,
        numField({ label: 'Dauer je Seite', value: it.options.page_duration_s ?? null, min: 1, max: 600, unit: 's', allowEmpty: true, placeholder: String(it.duration_s || s.default_duration_s), hint: `Gesamt: ${formatDuration(effDuration(it))}`, onValid: (v) => { setOpt(it, 'page_duration_s', v); itemChanged(it); } }));
    } else if (c.type === 'video' && toEnd && c.duration_s) {
      durationField = h('div', { class: 'pe-note' }, icon('film', { size: 18 }), h('span', {}, `Das Video bestimmt die Dauer (${formatDuration(c.duration_s)}). Für eine feste Dauer unten „Bis zum Ende abspielen“ ausschalten.`));
    } else {
      durationField = numField({ label: 'Dauer', value: it.duration_s ?? null, min: 1, max: 3600, unit: 's', allowEmpty: true, placeholder: `Standard: ${s.default_duration_s}`, hint: `Leer = Standard der Diashow (${formatDuration(s.default_duration_s)}). Empfohlen: 5–${SLIDE_MAX_S} s.`, onValid: (v) => { it.duration_s = v; itemChanged(it, { preview: false }); } });
    }

    const trans = select({
      value: it.transition || '', disabled: !canEdit,
      options: [{ value: '', label: `Standard (${transitionLabel(s.transition)})` }, ...TRANSITIONS],
      onChange: (v) => { it.transition = v || null; itemChanged(it, { list: false }); },
    });

    // Gültigkeit
    const from = input({ type: 'datetime-local', value: it.valid_from || '', disabled: !canEdit });
    const until = input({ type: 'datetime-local', value: it.valid_until || '', disabled: !canEdit });
    let untilField;
    const onValidity = () => {
      const f = from.value || null;
      const u = until.value || null;
      if (f && u && u <= f) { setErr(untilField, 'Das Ende muss nach dem Beginn liegen.'); return; }
      setErr(untilField, null);
      it.valid_from = f; it.valid_until = u;
      itemChanged(it, { preview: false });
    };
    from.addEventListener('change', onValidity);
    until.addEventListener('change', onValidity);
    const fromField = field({ label: 'Gültig ab', control: from, optional: true });
    untilField = field({ label: 'Gültig bis', control: until, optional: true });

    const caption = input({ value: it.caption || '', maxLength: 300, disabled: !canEdit, placeholder: 'Text unten auf der Folie' });
    caption.addEventListener('input', () => { it.caption = caption.value; itemChanged(it, { list: false }); });
    const fullscreen = switchToggle({ label: 'Vollbild', hint: 'Header und Footer für diese Folie ausblenden.', checked: !!it.options.fullscreen, disabled: !canEdit, onChange: (v) => { setOpt(it, 'fullscreen', v || undefined); itemChanged(it); } });

    // Typabhängig
    let typeSection = null;
    if (c.type === 'image') {
      typeSection = h('div', { class: 'form-row' },
        field({ label: 'Bildanpassung', control: select({
          value: it.options.fit || '', disabled: !canEdit,
          options: [{ value: '', label: `Standard (${s.image_fit === 'contain' ? 'Einpassen' : 'Füllen'})` }, { value: 'cover', label: 'Füllen (Ränder werden beschnitten)' }, { value: 'contain', label: 'Einpassen (ganzes Bild, ggf. Rand)' }],
          onChange: (v) => { setOpt(it, 'fit', v || undefined); itemChanged(it, { list: false }); },
        }) }),
        field({ label: 'Langsamer Zoom (Ken-Burns)', control: triSelect({ value: it.options.ken_burns, defaultOn: s.ken_burns, onChange: (v) => { setOpt(it, 'ken_burns', v); itemChanged(it, { list: false }); } }) }));
    } else if (c.type === 'video') {
      typeSection = h('div', { class: 'form-row' },
        field({ label: 'Ton', control: triSelect({ value: it.options.sound, defaultOn: s.video_sound, onChange: (v) => { setOpt(it, 'sound', v); itemChanged(it, { list: false }); } }), hint: 'Lautstärke stellt die Stele ein.' }),
        field({ label: 'Bis zum Ende abspielen', control: triSelect({ value: it.options.play_to_end, defaultOn: s.video_play_to_end, onLabel: 'Ja', offLabel: 'Nein, feste Dauer', onChange: (v) => { setOpt(it, 'play_to_end', v); itemChanged(it); renderProps(); } }) }));
    }

    return h('div', { class: 'form' },
      typeRow,
      c.warnings?.length ? h('div', { class: 'alert alert--warning' }, icon('alert-triangle'), h('div', { class: 'alert__body' }, c.warnings.map((w) => h('div', { class: 'alert__text' }, w.message)))) : null,
      active,
      h('div', { class: 'form-row' }, durationField, field({ label: 'Übergang', control: trans })),
      typeSection,
      h('div', { class: 'form-section' },
        h('div', { class: 'form-section__title' }, 'Zeitraum'),
        h('p', { class: 'form-section__desc' }, `Außerhalb des Zeitraums wird die Folie übersprungen (Zeitzone ${timezone}).`),
        h('div', { class: 'form-row' }, fromField, untilField)),
      h('div', { class: 'form-section' },
        field({ label: 'Bildunterschrift', control: caption, optional: true }),
        fullscreen));
  }

  function showProps() {
    const s = meta.settings;
    const set = (k, v, { preview = true } = {}) => { s[k] = v; queueSave('meta'); renderListTitle(); if (preview) renderPreview(); };
    const reRenderList = () => { renderList(); };
    return h('div', { class: 'form' },
      h('div', { class: 'form-row' },
        numField({ label: 'Standarddauer je Folie', value: s.default_duration_s, min: 2, max: 600, unit: 's', hint: `Gilt für Folien ohne eigene Dauer. Empfohlen: 5–${SLIDE_MAX_S} s.`, onValid: (v) => { set('default_duration_s', v, { preview: false }); reRenderList(); } }),
        field({ label: 'Reihenfolge', control: segmented({ value: s.order, ariaLabel: 'Reihenfolge', options: [{ value: 'sequential', label: 'Nacheinander' }, { value: 'shuffle', label: 'Zufällig' }], onChange: (v) => set('order', v, { preview: false }) }), hint: 'Zufällig: bei jedem Durchlauf neu gemischt.' })),
      h('div', { class: 'form-row' },
        field({ label: 'Übergang', control: select({ value: s.transition, options: TRANSITIONS, disabled: !canEdit, onChange: (v) => set('transition', v) }), hint: 'Wie eine Folie in die nächste wechselt.' }),
        numField({ label: 'Dauer des Übergangs', value: s.transition_ms, min: 0, max: 3000, step: 100, unit: 'ms', hint: '800 ms wirken ruhig, 0 = sofort.', onValid: (v) => set('transition_ms', v, { preview: false }) })),
      h('div', { class: 'form-section' },
        h('div', { class: 'form-section__title' }, 'Bilder'),
        field({ label: 'Bildanpassung', control: segmented({ value: s.image_fit, ariaLabel: 'Bildanpassung', options: [{ value: 'cover', label: 'Füllen' }, { value: 'contain', label: 'Einpassen' }], onChange: (v) => set('image_fit', v) }), hint: 'Füllen: Fläche ganz bedeckt, Ränder ggf. beschnitten. Einpassen: ganzes Bild mit Rand.' }),
        switchToggle({ label: 'Langsamer Zoom (Ken-Burns)', hint: 'Bringt Bewegung in Fotos.', checked: s.ken_burns, disabled: !canEdit, onChange: (v) => set('ken_burns', v) }),
        field({ label: 'Hintergrundfarbe', control: colorChoice({ label: 'Hintergrundfarbe', value: s.background, onChange: (v) => set('background', v) }), hint: 'Sichtbar hinter eingepassten Bildern, Videos und PDFs.' })),
      h('div', { class: 'form-section' },
        h('div', { class: 'form-section__title' }, 'Videos'),
        switchToggle({ label: 'Ton abspielen', hint: 'Sonst laufen Videos stumm. Lautstärke stellt die Stele ein.', checked: s.video_sound, disabled: !canEdit, onChange: (v) => set('video_sound', v, { preview: false }) }),
        switchToggle({ label: 'Videos bis zum Ende abspielen', hint: 'Sonst gilt die Folien-Dauer (kürzere Videos laufen in Schleife).', checked: s.video_play_to_end, disabled: !canEdit, onChange: (v) => { set('video_play_to_end', v, { preview: false }); reRenderList(); } })),
      h('div', { class: 'form-section' },
        h('div', { class: 'form-section__title' }, 'Anzeige'),
        field({ label: 'Bildunterschriften', control: segmented({ value: s.caption_style, ariaLabel: 'Stil der Bildunterschriften', options: [{ value: 'bar', label: 'Balken' }, { value: 'shadow', label: 'Schatten' }], onChange: (v) => set('caption_style', v) }), hint: 'Balken: gut lesbar auf jedem Bild. Schatten: dezenter.' }),
        switchToggle({ label: 'Fortschrittsbalken', hint: 'Dünne Linie unten zeigt die verbleibende Zeit einer Folie.', checked: s.show_progress, disabled: !canEdit, onChange: (v) => set('show_progress', v) })),
    );
  }

  function frameProps() {
    const s = meta.settings;
    const d = designById(meta.design_id);
    const m = menuById(meta.touch_menu_id);
    const designSel = select({
      value: meta.design_id === null ? '' : String(meta.design_id), disabled: !canEdit,
      options: [{ value: '', label: 'Ohne Design (kein Header/Footer)' }, ...designs.map((x) => ({ value: String(x.id), label: x.name }))],
      onChange: (v) => { meta.design_id = v ? Number(v) : null; queueSave('meta'); renderProps(); renderPreview(); },
    });
    const menuSel = select({
      value: meta.touch_menu_id === null ? '' : String(meta.touch_menu_id), disabled: !canEdit,
      options: [{ value: '', label: 'Kein Touch-Menü' }, ...menus.map((x) => ({ value: String(x.id), label: x.name }))],
      onChange: (v) => { meta.touch_menu_id = v ? Number(v) : null; queueSave('meta'); renderProps(); },
    });
    const setS = (k, v) => { s[k] = v; queueSave('meta'); renderPreview(); };
    return h('div', { class: 'form' },
      h('div', { class: 'form-section' },
        field({ label: 'Design', control: designSel, hint: 'Header (Logo, Titel, Uhr) und Footer (Laufband) um die Folien.' }),
        d ? h('a', { href: `#/designs/${d.id}`, class: 'pe-link' }, icon('palette', { size: 16 }), can('designs.edit') ? `Design „${d.name}“ bearbeiten` : `Design „${d.name}“ ansehen`) : null,
        switchToggle({ label: 'Header anzeigen', checked: s.show_header, disabled: !canEdit || !d, hint: d ? null : 'Erst ein Design wählen.', onChange: (v) => setS('show_header', v) }),
        switchToggle({ label: 'Footer anzeigen', checked: s.show_footer, disabled: !canEdit || !d, onChange: (v) => setS('show_footer', v) }),
        h('p', { class: 'text-2 text-sm' }, 'Einzelne Folien lassen sich unter „Folie → Vollbild“ ohne Rahmen zeigen.')),
      h('div', { class: 'form-section' },
        field({ label: 'Touch-Menü', control: menuSel, hint: 'Was Besucher sehen, wenn sie die Stele antippen. Ohne Touch-Menü läuft nur die Diashow.' }),
        m ? h('a', { href: `#/touch-menus/${m.id}`, class: 'pe-link' }, icon('touch', { size: 16 }), can('touch.edit') ? `Touch-Menü „${m.name}“ bearbeiten` : `Touch-Menü „${m.name}“ ansehen`) : null,
        m ? button({ label: 'Touch in der Vorschau testen', icon: 'hand', variant: 'secondary', size: 'sm', onClick: () => showPreview({ touch: true }) }) : null));
  }

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

  function noteField(label, { required = false, hint = null } = {}) {
    const ta = textarea({ rows: 3, maxLength: 500 });
    const f = field({ label, control: ta, required, optional: !required, hint });
    f.getValue = () => ta.value.trim();
    return f;
  }

  async function publish() {
    if (!(await ensureSaved())) return;
    const used = pres.used_by || [];
    const activeCount = items.filter((it) => it.enabled).length;
    const note = noteField('Notiz fürs Protokoll');
    const dlg = openDialog({
      title: 'Präsentation veröffentlichen?',
      size: 'md',
      content: h('div', { class: 'stack' },
        h('p', {}, `„${meta.name}“ mit ${plural(activeCount, 'aktiven Folie', 'aktiven Folien')} (${formatDuration(totalDuration())} je Durchlauf).`),
        used.length
          ? h('div', { class: 'alert alert--warning' }, icon('stele'), h('div', { class: 'alert__body' },
            h('div', { class: 'alert__title' }, 'Wird sofort auf den Stelen sichtbar'),
            h('ul', { class: 'alert__text', style: { margin: 0 } }, used.map((u) => h('li', {}, `${u.stele_name} (${u.how === 'schedule' ? 'laut Zeitplan' : 'Standard-Präsentation'})`)))))
          : h('div', { class: 'alert alert--neutral' }, icon('info'), h('div', { class: 'alert__body' }, h('div', { class: 'alert__text' },
            'Die Präsentation ist noch keiner Stele zugeordnet. Nach dem Veröffentlichen kann sie im Zeitplan oder als Standard einer Stele gewählt werden.'))),
        note),
      actions: [
        { label: 'Abbrechen', value: null },
        { label: 'Veröffentlichen', variant: 'primary', icon: 'broadcast', onClick: () => doPublish(note.getValue()) },
      ],
    });
    await dlg.result;
  }

  async function doPublish(noteText) {
    try {
      const res = await publishPresentation(id, noteText ? { note: noteText } : {});
      if (!res) return true;
      problems = new Map();
      applyServer(res, null);
      renderHeaderParts();
      renderList();
      ctx.refreshNav();
      toast.success(`„${meta.name}“ veröffentlicht.${(pres.used_by || []).length ? ' Die Stelen übernehmen den neuen Stand in Kürze.' : ''}`);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        problems = new Map((err.details?.items || []).map((b) => [b.item_id, b.status === 'processing' ? 'wird noch verarbeitet' : b.status === 'missing' ? 'Inhalt fehlt' : 'Verarbeitung fehlgeschlagen']));
        renderBanners();
        renderList();
        toast.error(err.message);
        return true;
      }
      throw err;
    }
  }

  async function requestReview() {
    if (!(await ensureSaved())) return;
    const note = noteField('Notiz für die Freigabe', { hint: 'z. B. was geändert wurde oder bis wann es live sein soll.' });
    openDialog({
      title: 'Zur Freigabe einreichen',
      description: 'Eine Person mit Veröffentlichungsrecht prüft den Entwurf und veröffentlicht ihn.',
      size: 'md',
      content: note,
      actions: [
        { label: 'Abbrechen', value: null },
        {
          label: 'Einreichen', variant: 'primary', icon: 'send',
          onClick: async () => {
            const res = await api.post(`/api/presentations/${id}/request-review`, note.getValue() ? { note: note.getValue() } : {});
            applyServer(res, null);
            renderHeaderParts();
            ctx.refreshNav();
            toast.success('Zur Freigabe eingereicht.');
          },
        },
      ],
    });
  }

  async function reject() {
    const note = noteField('Begründung', { required: true, hint: 'Was muss geändert werden? Die Begründung sieht die einreichende Person.' });
    openDialog({
      title: 'Freigabe ablehnen',
      size: 'md',
      content: note,
      actions: [
        { label: 'Abbrechen', value: null },
        {
          label: 'Ablehnen', variant: 'danger', icon: 'x-circle',
          onClick: async () => {
            const v = note.getValue();
            if (!v) { setErr(note, 'Bitte eine Begründung eingeben.'); note.querySelector('textarea').focus(); return false; }
            const res = await api.post(`/api/presentations/${id}/reject`, { note: v });
            applyServer(res, null);
            renderHeaderParts();
            ctx.refreshNav();
            toast.success('Freigabe abgelehnt.');
            return true;
          },
        },
      ],
    });
  }

  async function discard() {
    const ok = await confirmDialog({
      title: 'Änderungen verwerfen?',
      message: 'Folien, Einstellungen, Design und Touch-Menü werden auf den zuletzt veröffentlichten Stand zurückgesetzt. Das lässt sich nicht rückgängig machen.',
      confirmLabel: 'Änderungen verwerfen', danger: true, icon: 'undo',
    });
    if (!ok) return;
    debouncedFlush.cancel();
    clearTimeout(save.retryTimer);
    if (save.running) await save.running;
    save.meta = false; save.items = false;
    try {
      const res = await api.post(`/api/presentations/${id}/discard`);
      pres = res;
      meta = pickMeta(res);
      items = res.items.map(toLocal);
      selKey = items[0]?._k ?? null;
      problems = new Map();
      paintSave('saved');
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
    debouncedFlush.cancel();
    clearTimeout(save.retryTimer);
    save.meta = false; save.items = false;
    ctx.setDirty(false);
    ctx.navigate('/presentations');
  }

  // ---------- Aufbau ----------
  renderName();
  renderHeaderParts();
  paintSave(canEdit ? 'saved' : 'readonly');
  renderList();
  renderProps();
  renderPreview();
  renderPreviewNav();

  fill(root, page({ wide: true, className: 'pe-page' },
    header,
    bannerBox,
    h('div', { class: 'pe-layout' }, listCard, stageCard, propsCard),
  ));

  return () => {
    // Offene Änderungen noch absenden (ohne Abbruchsignal), dann aufräumen
    if (canEdit && (save.meta || save.items) && !save.error) flush();
    debouncedFlush.cancel();
    clearTimeout(save.retryTimer);
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

