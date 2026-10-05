// Touch-Menü-Editor (#/touch-menus/:id): Einstellungen, Kacheln (Drag & Drop), Kachel-Editor, Live-Vorschau.
// Speichern ausdrücklich per Knopf (Strg+S); Schutz vor ungespeicherten Änderungen.
import { h, useStyles, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can } from '../session.js';
import { plural } from '../format.js';
import { page, pageHeader, card, button } from '../ui/page.js';
import { field, input, numberInput, select, segmented, switchToggle, setFieldErrors, clearFieldErrors } from '../ui/form.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { menuButton } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { contentTypeLabel } from '../ui/status.js';
import { errorState, loadingBlock } from '../ui/empty.js';
import { contentStyles, contentPreview, clone, showInUse, announce } from '../ui/content-common.js';
import { contentRefField, fetchContent, rememberContent } from '../ui/content-ref.js';
import { openContentPicker } from '../ui/content-picker.js';
import { iconPickerButton, iconLabel } from '../ui/icon-picker.js';
import { colorChoice } from '../ui/color-choice.js';
import { gripButton, makeSortable, moveItem } from '../ui/sortable.js';
import { livePreview } from '../ui/live-preview.js';
import { affectedPresentations } from '../ui/presentation-actions.js';
import { editorSave } from '../ui/editor-save.js';
import { usedBy } from './touch-menus.js';

const MAX_TILES = 12;
const TILE_COLORS = [
  { value: '#1E5AA8', label: 'Blau' }, { value: '#2F6F4E', label: 'Grün' }, { value: '#5B3E96', label: 'Violett' },
  { value: '#9F1D2D', label: 'Weinrot' }, { value: '#B45309', label: 'Orange' }, { value: '#0F766E', label: 'Petrol' },
  { value: '#0F2747', label: 'Nachtblau' }, { value: '#374151', label: 'Grau' },
];
const ACTION_LABEL = { content: 'Inhalt öffnen', gallery: 'Galerie', submenu: 'Untermenü' };

export default async function mount(root, ctx) {
  await Promise.all([useStyles('/admin/css/views/touch-menus.css'), contentStyles()]);
  const id = Number(ctx.params.id);
  const canEdit = can('touch.edit');
  const ro = !canEdit;

  root.append(loadingBlock('Touch-Menü wird geladen …'));
  let menu; let designs = [];
  try {
    [menu, designs] = await Promise.all([
      api.get(`/api/touch-menus/${id}`, { signal: ctx.signal }),
      api.get('/api/designs', { signal: ctx.signal }).then((r) => r.items || []).catch(() => []),
    ]);
  } catch (err) {
    if (err?.name === 'AbortError') return undefined;
    fill(root, page({}, pageHeader({ title: 'Touch-Menü', back: { href: '#/touch-menus', label: 'Touch-Menüs' } }),
      card({ body: errorState({ title: 'Touch-Menü konnte nicht geladen werden', error: err, onRetry: () => ctx.navigate(`/touch-menus/${id}`, { replace: true }) }) })));
    return undefined;
  }
  ctx.setTitle(menu.name);

  // Ergänzte Anzeigefelder (content, image, contents) merken und aus der Konfiguration entfernen
  const briefs = new Map();
  let name = menu.name;
  let cfg = stripConfig(menu.config, briefs);
  let designId = designs[0]?.id ?? null;
  const formRoot = h('div', { class: 'tm-form' });

  // ---------- Speichern ----------
  // Hauptaktion nur bei Änderungen hervorgehoben (changed() schaltet primary/secondary)
  const ed = editorSave({
    ctx, ro, formRoot, stateClass: 'tm-savestate', dirtyMessage: 'Das Touch-Menü hat ungespeicherte Änderungen.',
    snapshot: () => ({ name, cfg }),
    validate: () => {
      if (name.trim()) return true;
      setFieldErrors(formRoot, { name: 'Bitte einen Namen eingeben.' });
      return false;
    },
    send: () => api.patch(`/api/touch-menus/${id}`, { name: name.trim(), config: clone(cfg), expected_updated_at: menu.updated_at }),
    onSaved: (res, untouched) => {
      menu = res;
      const srvCfg = stripConfig(res.config, briefs);
      ed.markSaved({ name: res.name, cfg: srvCfg });
      if (untouched) {
        name = res.name;
        cfg = srvCfg;
        renderTiles();
      }
      header.titleEl.textContent = res.name;
      ctx.setTitle(res.name);
      ed.changed(untouched);
      showAffected(res.used_by || []);
      toast.success('Touch-Menü gespeichert.');
    },
    fieldMap: (k) => k.replace(/^config\./, ''),
    fieldToast: (rest, err) => {
      const first = Object.entries(rest)[0];
      return first ? `${describeTilePath(first[0], cfg.tiles)}${first[1]}` : err.message;
    },
    onChanged: (preview) => { if (preview) refreshPreview(); },
    onReload: reload,
  });
  const changed = ed.changed;

  // ---------- Kopf ----------
  const header = pageHeader({
    title: menu.name,
    back: { href: '#/touch-menus', label: 'Touch-Menüs' },
    description: 'Kacheln für Besucher. Die Vorschau rechts zeigt das Menü wie auf der Stele.',
    meta: usedBy(menu.used_by || []),
    actions: canEdit ? [
      ed.saveState,
      menuButton({ items: [
        { label: 'Duplizieren', icon: 'copy', onClick: duplicate },
        { separator: true },
        { label: 'Touch-Menü löschen', icon: 'trash', danger: true, onClick: remove },
      ] }),
      ed.saveBtn,
    ] : [],
  });
  const usedHint = (menu.used_by || []).length ? h('div', { class: 'alert' }, icon('info'), h('div', { class: 'alert__body' },
    h('div', { class: 'alert__text' }, 'Änderungen erscheinen auf den Stelen erst, nachdem die betroffenen Präsentationen erneut veröffentlicht wurden.'))) : null;
  const afterSave = h('div', { role: 'status', 'aria-live': 'polite', hidden: true });
  const roAlert = ro ? h('div', { class: 'alert alert--neutral' }, icon('eye'), h('div', { class: 'alert__body' },
    h('div', { class: 'alert__text' }, 'Nur Ansicht – zum Bearbeiten fehlt das Recht „Touch-Menüs bearbeiten“.'))) : null;

  // ---------- Einstellungen ----------
  const nameIn = input({ value: name, maxLength: 80, disabled: ro, onInput: (v) => { name = v; changed(false); } });
  const titleIn = input({ value: cfg.title, maxLength: 80, disabled: ro, onInput: (v) => { cfg.title = v; changed(); } });
  const introIn = input({ value: cfg.intro, maxLength: 160, disabled: ro, onInput: (v) => { cfg.intro = v; changed(); } });
  const colsSeg = segmented({ value: cfg.columns, ariaLabel: 'Spalten', options: [1, 2, 3].map((n) => ({ value: n, label: String(n) })), onChange: (v) => { cfg.columns = v; changed(); } });
  let idleField;
  const idleIn = numberInput({
    value: cfg.idle_timeout_s, min: 15, max: 600, unit: 's', disabled: ro,
    onInput: (v) => {
      const bad = v === null || v < 15 || v > 600;
      setErr(idleField, bad ? 'Bitte 15 bis 600 Sekunden eingeben.' : null);
      if (!bad) { cfg.idle_timeout_s = v; changed(false); }
    },
  });
  idleField = field({ label: 'Rückkehr zur Diashow nach', name: 'idle_timeout_s', control: idleIn, hint: 'Ohne Berührung geht die Stele nach dieser Zeit (plus 10 s Rückfrage) zur Diashow zurück.' });
  const attractText = input({ value: cfg.attract.text, maxLength: 60, disabled: ro || !cfg.attract.enabled, onInput: (v) => { cfg.attract.text = v; changed(); } });
  const attractSw = switchToggle({ label: 'Hinweis in der Diashow anzeigen', hint: 'Dezent pulsierender Hinweis mit Hand-Symbol, damit Besucher wissen, dass sie tippen können.', checked: cfg.attract.enabled, disabled: ro, onChange: (v) => { cfg.attract.enabled = v; attractText.disabled = ro || !v; changed(); } });
  if (ro) colsSeg.querySelectorAll('button').forEach((b) => { b.disabled = true; });

  // ---------- Kacheln ----------
  const tilesTitle = h('span', {});
  const addTileBtn = canEdit ? button({ label: 'Kachel hinzufügen', icon: 'plus', variant: 'secondary', size: 'sm', onClick: () => addTile(cfg.tiles, renderTiles) }) : null;
  const tileList = h('ul', { class: 'tm-tiles', 'aria-label': 'Kacheln in Anzeigereihenfolge' });
  const tilesBody = h('div');
  makeSortable(tileList, {
    disabled: () => ro,
    itemLabel: (i) => cfg.tiles[i]?.label,
    onMove: (from, to) => { moveItem(cfg.tiles, from, to); changed(); renderTiles(); },
  });

  function renderTiles() {
    tilesTitle.textContent = `Kacheln (${cfg.tiles.length} von ${MAX_TILES})`;
    if (addTileBtn) addTileBtn.disabled = cfg.tiles.length >= MAX_TILES;
    if (!cfg.tiles.length) {
      fill(tilesBody, h('div', { class: 'tm-empty' },
        h('p', {}, 'Noch keine Kacheln. Jede Kachel öffnet einen Inhalt, eine Galerie oder ein Untermenü.'),
        canEdit ? button({ label: 'Erste Kachel anlegen', icon: 'plus', variant: 'primary', onClick: () => addTile(cfg.tiles, renderTiles) }) : null));
      return;
    }
    fillTileList(tileList, cfg.tiles, { onChange: () => { changed(); renderTiles(); }, allowSubmenu: true });
    fill(tilesBody, tileList);
  }

  /** Kachelliste (auch für Untermenüs im Kachel-Editor). */
  function fillTileList(listEl, tiles, { onChange, allowSubmenu }) {
    const focusId = document.activeElement?.closest?.('[data-tile]')?.dataset.tile;
    const focusRole = document.activeElement?.dataset?.role;
    fill(listEl, ...tiles.map((t, i) => {
      const grip = canEdit ? gripButton({ label: `Kachel „${t.label}“ verschieben` }) : null;
      if (grip) grip.dataset.role = 'grip';
      const move = (to) => { moveItem(tiles, i, to); onChange(); announce(`„${t.label}“ jetzt an Position ${to + 1} von ${tiles.length}.`); };
      return h('li', { class: 'tm-tile', dataset: { sortItem: '', tile: t.id } },
        grip,
        tileSwatch(t, briefs),
        h('div', { class: 'tm-tile__text' },
          h('span', { class: 'tm-tile__label' }, t.label || '(ohne Beschriftung)'),
          h('span', { class: 'tm-tile__meta' }, actionSummary(t, briefs))),
        canEdit ? h('button', { type: 'button', class: 'btn btn--secondary btn--sm', dataset: { role: 'edit' }, 'aria-label': `Kachel „${t.label}“ bearbeiten`, onClick: async () => {
          const upd = await editTile(t, { allowSubmenu });
          if (upd) { tiles[i] = upd; onChange(); }
        } }, icon('pencil', { size: 16 }), h('span', { class: 'tm-tile__btntext' }, 'Bearbeiten')) : null,
        canEdit ? menuButton({ label: `Weitere Aktionen für „${t.label}“`, size: 'sm', items: () => [
          { label: 'Nach oben', icon: 'chevron-up', disabled: i === 0, onClick: () => move(i - 1) },
          { label: 'Nach unten', icon: 'chevron-down', disabled: i === tiles.length - 1, onClick: () => move(i + 1) },
          { label: 'Duplizieren', icon: 'copy', disabled: tiles.length >= MAX_TILES, onClick: () => { tiles.splice(i + 1, 0, { ...clone(t), id: tileId(), label: `${t.label} (Kopie)`.slice(0, 40) }); onChange(); } },
          { separator: true },
          { label: 'Kachel löschen', icon: 'trash', danger: true, onClick: () => {
            const [removed] = tiles.splice(i, 1);
            onChange();
            toast.success(`Kachel „${removed.label}“ gelöscht.`, { action: { label: 'Rückgängig', onClick: () => { tiles.splice(Math.min(i, tiles.length), 0, removed); onChange(); } } });
          } },
        ] }) : null);
    }));
    if (focusId) listEl.querySelector(`[data-tile="${CSS.escape(focusId)}"] [data-role="${focusRole || 'edit'}"]`)?.focus();
  }

  async function addTile(tiles, rerender, allowSubmenu = true) {
    if (tiles.length >= MAX_TILES) { toast.warning(`Höchstens ${MAX_TILES} Kacheln je Ebene.`); return; }
    const t = await editTile({ id: tileId(), label: '', icon: 'info', color: TILE_COLORS[tiles.length % TILE_COLORS.length].value, image_content_id: null, action: { type: 'content', content_id: null } }, { allowSubmenu, isNew: true });
    if (!t) return;
    tiles.push(t);
    changed();
    rerender();
  }

  // ---------- Kachel-Editor (Dialog) ----------
  function editTile(orig, { allowSubmenu = true, isNew = false } = {}) {
    const t = clone(orig);
    t.action = t.action || { type: 'content', content_id: null };
    const form = h('form', { class: 'form', onSubmit: (e) => e.preventDefault() });
    const preview = h('div', { class: 'tm-edit__preview', 'aria-hidden': 'true' });
    const paintPreview = () => fill(preview, tileSwatch(t, briefs, { big: true }));
    const labelIn = input({ value: t.label, maxLength: 40, placeholder: 'z. B. Lageplan', onInput: (v) => { t.label = v; paintPreview(); } });
    const iconBtn = iconPickerButton({ value: t.icon, onChange: (v) => { t.icon = v; paintPreview(); } });
    const color = colorChoice({ label: 'Kachelfarbe', value: t.color, suggestions: TILE_COLORS, onChange: (v) => { t.color = v; paintPreview(); } });
    const image = contentRefField({ value: t.image_content_id, types: ['image'], pickerTitle: 'Kachelbild wählen', emptyLabel: 'Kein Bild – Farbe wird verwendet', onChange: (cid, c) => { t.image_content_id = cid; if (c) briefs.set(cid, brief(c)); paintPreview(); } });

    const actionBox = h('div', { class: 'stack' });
    const typeOpts = [{ value: 'content', label: 'Inhalt öffnen', icon: 'file-text' }, { value: 'gallery', label: 'Galerie', icon: 'images' }];
    if (allowSubmenu) typeOpts.push({ value: 'submenu', label: 'Untermenü', icon: 'grid' });
    const typeSeg = segmented({ value: t.action.type, ariaLabel: 'Aktion der Kachel', options: typeOpts, onChange: (v) => { setActionType(v); renderAction(); } });

    function setActionType(v) {
      const a = t.action;
      if (v === a.type) return;
      t.action = v === 'content' ? { type: 'content', content_id: a.content_ids?.[0] ?? null }
        : v === 'gallery' ? { type: 'gallery', content_ids: a.content_id ? [a.content_id] : [] }
          : { type: 'submenu', tiles: [] };
    }

    function renderAction() {
      const a = t.action;
      if (a.type === 'content') {
        fill(actionBox, field({ label: 'Inhalt', name: 'content', required: true, hint: 'Bild, Video, PDF, Info-Folie oder Webseite – wird groß geöffnet.', control: contentRefField({
          value: a.content_id, types: ['image', 'video', 'pdf', 'text', 'web'], pickerTitle: 'Inhalt für die Kachel wählen', emptyLabel: 'Noch kein Inhalt gewählt', chooseLabel: 'Inhalt auswählen', removable: false,
          onChange: (cid, c) => { a.content_id = cid; if (c) briefs.set(cid, brief(c)); },
        }) }));
      } else if (a.type === 'gallery') {
        const list = h('ul', { class: 'tm-gallery', 'aria-label': 'Inhalte der Galerie' });
        const paint = () => {
          fill(list, ...a.content_ids.map((cid, i) => {
            const b = briefs.get(cid);
            return h('li', { class: 'tm-gallery__item', dataset: { sortItem: '' } },
              gripButton({ label: `„${b?.title || `#${cid}`}“ verschieben` }),
              h('span', { class: 'tm-gallery__thumb' }, contentPreview(b || { id: cid, type: 'image', status: 'ready' }, { size: 'sm' })),
              h('span', { class: 'tm-gallery__title' }, b?.title || `Inhalt #${cid}`),
              h('button', { type: 'button', class: 'btn btn--ghost btn--icon btn--sm', 'aria-label': `„${b?.title || cid}“ aus der Galerie entfernen`, title: 'Entfernen', onClick: () => { a.content_ids.splice(i, 1); paint(); } }, icon('x', { size: 16 })));
          }));
          if (!a.content_ids.length) fill(list, h('li', { class: 'text-2 text-sm tm-gallery__empty' }, 'Noch keine Inhalte – Besucher blättern später per Wischen oder Pfeilen.'));
        };
        makeSortable(list, { onMove: (from, to) => { moveItem(a.content_ids, from, to); paint(); } });
        paint();
        // fehlende Titel nachladen
        Promise.all(a.content_ids.filter((cid) => !briefs.has(cid)).map((cid) => fetchContent(cid).then((c) => { if (c) briefs.set(cid, brief(c)); }))).then(paint);
        fill(actionBox, field({ label: 'Bilder und Videos der Galerie', name: 'gallery', required: true, control: h('div', { class: 'stack stack--sm' }, list,
          button({ label: 'Inhalte hinzufügen', icon: 'plus', variant: 'secondary', size: 'sm', onClick: async () => {
            const picked = await openContentPicker({ title: 'Bilder und Videos für die Galerie', types: ['image', 'video'], multiple: true, excludeIds: a.content_ids, confirmLabel: 'Hinzufügen' });
            if (picked) { for (const c of picked) { rememberContent(c); briefs.set(c.id, brief(c)); a.content_ids.push(c.id); } paint(); }
          } })) }));
      } else {
        const sub = h('ul', { class: 'tm-tiles tm-tiles--sub', 'aria-label': 'Kacheln des Untermenüs' });
        const paint = () => {
          if (!a.tiles.length) fill(sub, h('li', { class: 'text-2 text-sm tm-gallery__empty' }, 'Noch keine Kacheln im Untermenü.'));
          else fillTileList(sub, a.tiles, { onChange: paint, allowSubmenu: false });
        };
        makeSortable(sub, { onMove: (from, to) => { moveItem(a.tiles, from, to); paint(); } });
        paint();
        fill(actionBox, field({ label: 'Kacheln des Untermenüs', name: 'submenu', required: true, hint: 'Eine Ebene tief; die Kacheln dort öffnen Inhalte oder Galerien.', control: h('div', { class: 'stack stack--sm' }, sub,
          button({ label: 'Kachel hinzufügen', icon: 'plus', variant: 'secondary', size: 'sm', onClick: () => addTile(a.tiles, paint, false) })) }));
      }
    }

    form.append(
      h('div', { class: 'tm-edit' },
        h('div', { class: 'form tm-edit__fields' },
          field({ label: 'Beschriftung', name: 'label', required: true, control: labelIn, hint: 'Kurz und eindeutig, max. 40 Zeichen.' }),
          h('div', { class: 'form-row' },
            field({ label: 'Icon', name: 'icon', control: iconBtn }),
            field({ label: 'Kachelbild', name: 'image', optional: true, control: image })),
          field({ label: 'Farbe', name: 'color', control: color, hint: 'Die Beschriftung wird automatisch hell oder dunkel gesetzt.' })),
        h('div', { class: 'tm-edit__side' }, h('span', { class: 'text-2 text-sm' }, 'So sieht die Kachel aus'), preview)),
      h('div', { class: 'form-section' },
        field({ label: 'Beim Antippen', name: 'action_type', control: typeSeg }),
        actionBox));
    paintPreview();
    renderAction();

    const dlg = openDialog({
      title: isNew ? 'Neue Kachel' : `Kachel „${orig.label}“ bearbeiten`,
      size: 'lg',
      content: form,
      actions: [
        { label: 'Abbrechen', value: null },
        {
          label: isNew ? 'Kachel hinzufügen' : 'Übernehmen', variant: 'primary', icon: 'check',
          onClick: () => {
            clearFieldErrors(form);
            const errs = {};
            t.label = t.label.trim();
            if (!t.label) errs.label = 'Bitte eine Beschriftung eingeben.';
            const a = t.action;
            if (a.type === 'content' && !a.content_id) errs.content = 'Bitte einen Inhalt auswählen.';
            if (a.type === 'gallery' && !a.content_ids.length) errs.gallery = 'Bitte mindestens einen Inhalt hinzufügen.';
            if (a.type === 'submenu' && !a.tiles.length) errs.submenu = 'Bitte mindestens eine Kachel anlegen.';
            if (Object.keys(errs).length) { setFieldErrors(form, errs); return false; }
            return t;
          },
        },
      ],
    });
    return dlg.result.then((r) => (r && typeof r === 'object' ? r : null));
  }

  // ---------- Vorschau ----------
  const pv = livePreview({ title: 'Vorschau des Touch-Menüs' });
  const designSel = select({
    value: designId === null ? '' : String(designId), 'aria-label': 'Rahmen für die Vorschau',
    options: [{ value: '', label: 'Ohne Header und Footer' }, ...designs.map((d) => ({ value: String(d.id), label: d.name }))],
    onChange: (v) => { designId = v ? Number(v) : null; refreshPreview(); },
  });
  function refreshPreview(now = false) {
    const body = { settings: null, design: designs.find((d) => d.id === designId)?.config || null, touch_menu: clone(cfg), items: [] };
    const pick = (res) => ({ slide: res.slides?.[0] || null, design: res.design, settings: res.settings, touch_menu: res.touch_menu, view: 'touch' });
    if (now) pv.now(body, pick); else pv.update(body, pick);
  }

  function showAffected(list) {
    const box = affectedPresentations(list, { what: 'das geänderte Touch-Menü', onPublished: () => ctx.refreshNav() });
    fill(afterSave, box);
    afterSave.hidden = !box;
  }

  function reload() {
    ctx.setDirty(false);
    ctx.navigate(`/touch-menus/${id}`, { replace: true });
  }

  async function duplicate() {
    try {
      const copy = await api.post('/api/touch-menus', { name: `${menu.name} (Kopie)`.slice(0, 80), copy_from: id });
      toast.success(`Kopie „${copy.name}“ angelegt${ed.isDirty() ? ' (vom gespeicherten Stand)' : ''}.`);
      ctx.navigate(`/touch-menus/${copy.id}`);
    } catch (err) { toast.error(errorMessage(err)); }
  }

  async function remove() {
    const used = menu.used_by || [];
    const ok = await confirmDialog({
      title: `„${menu.name}“ löschen?`,
      message: used.length ? `Wird in ${plural(used.length, 'Präsentation', 'Präsentationen')} verwendet und kann erst gelöscht werden, wenn es dort ersetzt wurde.` : 'Das Touch-Menü wird endgültig entfernt.',
      confirmLabel: 'Touch-Menü löschen', danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/touch-menus/${id}`);
      ctx.setDirty(false);
      toast.success('Touch-Menü gelöscht.');
      ctx.navigate('/touch-menus');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await showInUse({ title: 'Touch-Menü kann nicht gelöscht werden', message: err.message, usages: err.details?.usages || [] });
      else toast.error(errorMessage(err));
    }
  }

  function setErr(f, msg) {
    const e = f?.querySelector(':scope > .field__error');
    if (!e) return;
    e.hidden = !msg;
    fill(e, ...(msg ? [icon('alert-circle', { size: 16 }), h('span', {}, msg)] : []));
    f.classList.toggle('field--invalid', !!msg);
  }

  // ---------- Aufbau ----------
  renderTiles();
  formRoot.append(
    card({ title: 'Einstellungen', icon: 'settings', body: h('div', { class: 'form' },
      field({ label: 'Name (nur im CMS)', name: 'name', required: true, control: nameIn }),
      h('div', { class: 'form-row' },
        field({ label: 'Überschrift', name: 'title', control: titleIn }),
        field({ label: 'Einleitung', name: 'intro', optional: true, control: introIn })),
      h('div', { class: 'form-row' },
        field({ label: 'Spalten', name: 'columns', control: colsSeg, hint: '2 Spalten eignen sich für bis zu 8 Kacheln.' }),
        idleField),
      h('div', { class: 'form-section' },
        attractSw,
        field({ label: 'Text des Hinweises', name: 'attract.text', control: attractText }))) }),
    h('section', { class: 'card' },
      h('div', { class: 'card__header' }, h('h2', { class: 'card__title' }, icon('grid'), tilesTitle), addTileBtn),
      h('div', { class: 'card__body tm-tiles-body' }, tilesBody)),
  );

  fill(root, page({ wide: true, className: 'tm-page' },
    header, roAlert, ed.conflictBox, usedHint, afterSave,
    h('div', { class: 'tm-layout' },
      formRoot,
      h('aside', { class: 'tm-side' }, card({
        title: 'Vorschau', icon: 'eye',
        body: h('div', { class: 'stack' },
          designs.length ? field({ label: 'Rahmen für die Vorschau', control: designSel }) : null,
          pv.el,
          h('p', { class: 'text-2 text-sm' }, 'Die Vorschau zeigt die Startebene. In „Präsentation → Vorschau → Touch testen“ lässt sich das Menü durchklicken.')),
      })))));
  changed(false);
  refreshPreview(true);

  return () => {
    ed.destroy();
    pv.destroy();
  };
}

// ---------- Hilfen ----------
function tileId() {
  return `t-${Math.random().toString(16).slice(2, 6)}${Date.now().toString(16).slice(-2)}`;
}

function brief(c) {
  return { id: c.id, type: c.type, title: c.title, status: c.status, thumb_url: c.urls?.thumb || c.thumb_url || null, data: c.data };
}

/** Anzeige-Ergänzungen des Servers entfernen (Form nach SPEC §5.6) und Kurzinfos merken. */
function stripConfig(config, briefs) {
  const cfg = clone(config);
  const clean = (tiles) => (tiles || []).map((t) => {
    if (t.content?.id) briefs.set(t.content.id, t.content);
    if (t.image?.id) briefs.set(t.image.id, t.image);
    const a = { ...(t.action || {}) };
    for (const c of a.contents || []) if (c?.id) briefs.set(c.id, c);
    delete a.contents;
    if (a.type === 'submenu') a.tiles = clean(a.tiles);
    const out = { id: t.id, label: t.label || '', icon: t.icon || 'info', color: t.color || '#1E5AA8', image_content_id: t.image_content_id ?? null, action: a };
    if (a.type === 'content') out.action = { type: 'content', content_id: a.content_id ?? null };
    else if (a.type === 'gallery') out.action = { type: 'gallery', content_ids: [...(a.content_ids || [])] };
    else if (a.type === 'submenu') out.action = { type: 'submenu', tiles: a.tiles };
    return out;
  });
  cfg.tiles = clean(cfg.tiles);
  cfg.attract = { enabled: true, text: '', ...(cfg.attract || {}) };
  return cfg;
}

/** „tiles.4.action.tiles.1.label“ → „Kachel 5 „Mehr“ › Kachel 2 „Karte“: “ (für Fehlermeldungen des Servers). */
function describeTilePath(path, tiles) {
  const parts = [];
  let list = tiles;
  const re = /tiles\.(\d+)/g;
  let m;
  while ((m = re.exec(path))) {
    const t = list?.[Number(m[1])];
    parts.push(`Kachel ${Number(m[1]) + 1}${t?.label ? ` „${t.label}“` : ''}`);
    list = t?.action?.tiles;
  }
  return parts.length ? `${parts.join(' › ')}: ` : '';
}

/** Kurzbeschreibung der Aktion. */
function actionSummary(t, briefs) {
  const a = t.action || {};
  if (a.type === 'content') {
    const b = briefs.get(a.content_id);
    return a.content_id ? `Öffnet ${b ? `${contentTypeLabel(b.type)} „${b.title}“` : `Inhalt #${a.content_id}`}` : 'Kein Inhalt gewählt';
  }
  if (a.type === 'gallery') return `${ACTION_LABEL.gallery} mit ${plural((a.content_ids || []).length, 'Inhalt', 'Inhalten')}`;
  if (a.type === 'submenu') return `${ACTION_LABEL.submenu} mit ${plural((a.tiles || []).length, 'Kachel', 'Kacheln')}`;
  return 'Keine Aktion';
}

/** Kachel-Darstellung (Farbe oder Bild, Icon, ggf. Beschriftung). */
function tileSwatch(t, briefs, { big = false } = {}) {
  const img = t.image_content_id ? briefs.get(t.image_content_id)?.thumb_url : null;
  return h('span', {
    class: ['tm-swatch', big && 'tm-swatch--big', img && 'has-img'],
    style: { '--tile': t.color || '#1E5AA8', '--tile-fg': readable(t.color), backgroundImage: img ? `url("${encodeURI(img)}")` : null },
    title: iconLabel(t.icon),
  }, icon(t.icon || 'info', { size: big ? 40 : 20 }), big ? h('span', { class: 'tm-swatch__label' }, t.label || 'Beschriftung') : null);
}

function readable(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#FFFFFF';
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111827' : '#FFFFFF';
}
