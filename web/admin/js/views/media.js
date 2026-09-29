// Mediathek (#/media): Inhalte hochladen, finden, ansehen, bearbeiten, löschen und Präsentationen zuordnen.
import { h, useStyles, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can } from '../session.js';
import { formatDateTime, formatRelative, formatBytes, formatDuration, formatNumber, plural } from '../format.js';
import { page, pageHeader, button } from '../ui/page.js';
import { field, input, select, searchInput, segmented, switchToggle, tagsInput, setFieldErrors, clearFieldErrors } from '../ui/form.js';
import { openDialog, openDrawer, confirmDialog } from '../ui/dialog.js';
import { menuButton } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { chip, CONTENT_TYPES, contentTypeIcon, contentTypeLabel, warningList } from '../ui/status.js';
import { emptyState, errorState, skeletonGrid } from '../ui/empty.js';
import { playerFrame, playerUrls } from '../ui/player-frame.js';
import { contentStyles, contentPreview, contentMeta, usageList, showInUse, domainOf, prefs, TEMPLATE_LABELS } from '../ui/content-common.js';
import { createUploader, enableDropUpload, pickFiles, UPLOAD_HINT } from '../ui/uploader.js';
import { addToPresentation } from '../ui/add-to-presentation.js';

const SORTS = [
  { value: 'updated_desc', label: 'Zuletzt geändert' },
  { value: 'created_desc', label: 'Zuletzt hochgeladen' },
  { value: 'title_asc', label: 'Titel A–Z' },
  { value: 'size_desc', label: 'Größte zuerst' },
];
const POLL_MS = 3000;

export default async function mount(root, ctx) {
  await Promise.all([useStyles('/admin/css/views/media.css'), contentStyles()]);
  const canEdit = can('content.edit');
  const canDelete = can('content.delete');
  const canAddToPres = can('presentations.edit');

  const state = {
    q: ctx.query.q || '',
    type: CONTENT_TYPES[ctx.query.type] ? ctx.query.type : '',
    tag: ctx.query.tag || '',
    sort: SORTS.some((s) => s.value === ctx.query.sort) ? ctx.query.sort : 'updated_desc',
    view: prefs.get('media.view', 'grid') === 'list' ? 'list' : 'grid',
    items: [],
    tags: [],
    total: 0,
    loaded: false,
  };
  const selected = new Map();       // id → Content
  let loadCtrl = null;
  let pollTimer = null;
  let drawer = null;                // offene Detail-Schublade { close, id, refresh }

  // ---------- Kopf ----------
  const uploader = canEdit ? createUploader({
    onUploaded: () => load({ quiet: true }),
    onBusy: (busy) => ctx.setDirty(busy ? 'Es werden noch Dateien hochgeladen. Bitte warten, bis alle Uploads fertig sind – sonst fehlen eventuell Dateien.' : false),
  }) : null;
  const startUpload = async () => { if (uploader) uploader.upload(await pickFiles()); };

  const header = pageHeader({
    title: 'Mediathek',
    description: 'Bilder, Videos, PDFs, Info-Folien und Webseiten für die Präsentationen.',
    actions: canEdit ? [
      menuButton({
        text: 'Neu', iconName: 'plus', variant: 'secondary', label: 'Neuen Inhalt anlegen',
        items: [
          { label: 'Info-Folie', icon: 'text-slide', hint: 'Text nach Vorlage gestalten', href: '#/media/text/new' },
          { label: 'Webseite', icon: 'globe', hint: 'Adresse einer Webseite einbinden', onClick: () => openWebDialog() },
        ],
      }),
      button({ label: 'Hochladen', icon: 'upload', variant: 'primary', onClick: startUpload }),
    ] : [],
  });

  // ---------- Werkzeugleiste ----------
  const search = searchInput({ value: state.q, placeholder: 'Titel, Dateiname oder Schlagwort …', label: 'Mediathek durchsuchen', onInput: (v) => { state.q = v; syncQuery(); load(); } });
  const typeSel = select({
    value: state.type, 'aria-label': 'Nach Typ filtern',
    options: [{ value: '', label: 'Alle Typen' }, ...Object.entries(CONTENT_TYPES).map(([k, t]) => ({ value: k, label: t.plural }))],
    onChange: (v) => { state.type = v; syncQuery(); load(); },
  });
  const tagSel = select({ value: state.tag, 'aria-label': 'Nach Schlagwort filtern', options: [{ value: '', label: 'Alle Schlagworte' }], onChange: (v) => { state.tag = v; syncQuery(); load(); } });
  const sortSel = select({ value: state.sort, 'aria-label': 'Sortierung', options: SORTS, onChange: (v) => { state.sort = v; syncQuery(); load(); } });
  const viewSeg = segmented({
    value: state.view, ariaLabel: 'Darstellung',
    options: [{ value: 'grid', label: 'Raster', icon: 'grid' }, { value: 'list', label: 'Liste', icon: 'list' }],
    onChange: (v) => { state.view = v; prefs.set('media.view', v); render(); },
  });
  const toolbar = h('div', { class: 'toolbar md-toolbar' },
    h('div', { class: 'toolbar__search' }, search), typeSel, tagSel, sortSel, h('div', { class: 'toolbar__spacer' }), viewSeg);

  // ---------- Auswahlleiste ----------
  const selCount = h('span', { class: 'md-selbar__count', role: 'status', 'aria-live': 'polite' });
  const selBar = h('div', { class: 'md-selbar', hidden: true },
    selCount,
    button({ label: 'Alle auf dieser Seite', icon: 'check', variant: 'ghost', size: 'sm', onClick: () => { for (const c of state.items) selected.set(c.id, c); render(); } }),
    button({ label: 'Auswahl aufheben', icon: 'x', variant: 'ghost', size: 'sm', onClick: () => { selected.clear(); render(); } }),
    h('div', { class: 'toolbar__spacer' }),
    canAddToPres ? button({ label: 'Zu Präsentation hinzufügen', icon: 'presentation', variant: 'secondary', size: 'sm', onClick: () => addSelectedToPresentation() }) : null,
    canDelete ? button({ label: 'Löschen', icon: 'trash', variant: 'danger-ghost', size: 'sm', onClick: () => bulkDelete() }) : null,
  );

  const countLine = h('p', { class: 'md-count text-2', role: 'status', 'aria-live': 'polite' });
  const results = h('div', { class: 'md-results' });

  root.append(page({ wide: true, className: 'md-page' },
    header,
    uploader ? uploader.el : null,
    toolbar,
    selBar,
    countLine,
    results,
  ));

  const stopDrop = canEdit ? enableDropUpload((files) => uploader.upload(files), { enabled: () => !document.querySelector('dialog[open]') }) : null;

  function syncQuery() {
    ctx.setQuery({ q: state.q || null, type: state.type || null, tag: state.tag || null, sort: state.sort !== 'updated_desc' ? state.sort : null });
  }

  // ---------- Laden ----------
  async function load({ quiet = false } = {}) {
    loadCtrl?.abort();
    loadCtrl = new AbortController();
    const signal = anySignal(ctx.signal, loadCtrl.signal);
    if (!state.loaded && !quiet) fill(results, skeletonGrid(8, '200px'));
    try {
      const res = await api.get('/api/contents', {
        query: { q: state.q, type: state.type, tag: state.tag, sort: state.sort, limit: 500 },
        signal, background: quiet,
      });
      state.items = res.items || [];
      state.total = res.total ?? state.items.length;
      state.tags = res.tags || [];
      state.loaded = true;
      for (const [id] of selected) {
        const fresh = state.items.find((c) => c.id === id);
        if (fresh) selected.set(id, fresh);
      }
      renderTags();
      render();
      schedulePoll();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (quiet) { schedulePoll(); return; }
      fill(results, errorState({ error: err, onRetry: () => load() }));
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (state.items.some((c) => c.status === 'processing')) pollTimer = setTimeout(() => load({ quiet: true }), POLL_MS);
  }

  function renderTags() {
    const opts = ['', ...state.tags];
    if (state.tag && !state.tags.includes(state.tag)) opts.push(state.tag);
    fill(tagSel, ...opts.map((t) => h('option', { value: t }, t || 'Alle Schlagworte')));
    tagSel.value = state.tag;
    tagSel.disabled = !state.tags.length && !state.tag;
  }

  // ---------- Darstellung ----------
  function render() {
    const n = selected.size;
    selBar.hidden = n === 0;
    selCount.textContent = n ? `${plural(n, 'Inhalt', 'Inhalte')} ausgewählt` : '';
    const filtered = !!(state.q || state.type || state.tag);
    countLine.textContent = state.loaded ? `${plural(state.total, 'Inhalt', 'Inhalte')}${filtered ? ' gefunden' : ''}` : '';

    if (!state.items.length) {
      fill(results, filtered
        ? emptyState({
          icon: 'search', title: 'Keine Treffer', text: 'Mit diesen Filtern wurde nichts gefunden.',
          actions: [button({ label: 'Filter zurücksetzen', icon: 'x', onClick: resetFilters })],
        })
        : emptyState({
          icon: 'images', title: 'Die Mediathek ist noch leer',
          text: canEdit ? `Dateien hochladen oder einfach auf diese Seite ziehen. ${UPLOAD_HINT}` : 'Es wurden noch keine Inhalte angelegt.',
          actions: canEdit ? [
            button({ label: 'Hochladen', icon: 'upload', variant: 'primary', onClick: startUpload }),
            button({ label: 'Info-Folie anlegen', icon: 'text-slide', href: '#/media/text/new' }),
          ] : [],
        }));
      return;
    }
    const focusedId = document.activeElement?.closest?.('[data-content-id]')?.dataset.contentId;
    const focusedRole = document.activeElement?.dataset?.role;
    const list = state.view === 'grid'
      ? h('ul', { class: 'md-grid', 'aria-label': 'Inhalte' }, state.items.map(gridCard))
      : h('ul', { class: 'md-list', 'aria-label': 'Inhalte' }, state.items.map(listRow));
    fill(results, list);
    if (focusedId) results.querySelector(`[data-content-id="${CSS.escape(focusedId)}"] [data-role="${focusedRole || 'open'}"]`)?.focus();
  }

  function resetFilters() {
    state.q = ''; state.type = ''; state.tag = '';
    search.input.value = ''; typeSel.value = ''; tagSel.value = '';
    syncQuery();
    load();
  }

  function selectBox(c) {
    const cb = h('input', { type: 'checkbox', checked: selected.has(c.id), dataset: { role: 'select' }, 'aria-label': `„${c.title}“ auswählen` });
    cb.addEventListener('change', () => { if (cb.checked) selected.set(c.id, c); else selected.delete(c.id); render(); });
    return h('label', { class: 'md-check', title: 'Auswählen' }, cb);
  }

  function badges(c) {
    const out = [];
    if (c.status === 'error') out.push(chip('danger', 'Fehler', 'alert-circle', { size: 'sm', title: c.status_message || 'Verarbeitung fehlgeschlagen' }));
    else if (c.status === 'processing') out.push(chip('info', 'In Verarbeitung', 'clock', { size: 'sm' }));
    if (c.warnings?.length) out.push(chip('warning', c.warnings.length === 1 ? '1 Hinweis' : `${c.warnings.length} Hinweise`, 'alert-triangle', { size: 'sm', title: c.warnings.map((w) => w.message).join('\n') }));
    if (c.usage_count) out.push(chip('success', `${c.usage_count}× verwendet`, 'link', { size: 'sm', title: 'Wird in Präsentationen, Designs oder Touch-Menüs verwendet' }));
    return out;
  }

  function gridCard(c) {
    const isSel = selected.has(c.id);
    return h('li', { class: ['md-card', isSel && 'is-selected'], dataset: { contentId: String(c.id) } },
      h('button', { type: 'button', class: 'md-card__media', tabindex: '-1', 'aria-hidden': 'true', onClick: () => openDetail(c) }, contentPreview(c)),
      h('div', { class: 'md-card__body' },
        h('div', { class: 'md-card__top' },
          (canDelete || canAddToPres) ? selectBox(c) : null,
          h('button', { type: 'button', class: 'md-card__title', dataset: { role: 'open' }, onClick: () => openDetail(c) }, c.title)),
        h('div', { class: 'md-card__meta' }, icon(contentTypeIcon(c.type), { size: 16 }), h('span', { class: 'truncate' }, contentMeta(c))),
        c.status === 'error' && c.status_message ? h('p', { class: 'md-card__error' }, c.status_message) : null,
        badges(c).length ? h('div', { class: 'md-card__chips' }, badges(c)) : null));
  }

  function listRow(c) {
    const isSel = selected.has(c.id);
    return h('li', { class: ['md-row', isSel && 'is-selected'], dataset: { contentId: String(c.id) } },
      (canDelete || canAddToPres) ? selectBox(c) : null,
      h('div', { class: 'md-row__thumb' }, contentPreview(c, { size: 'sm' })),
      h('div', { class: 'md-row__main' },
        h('button', { type: 'button', class: 'md-row__title', dataset: { role: 'open' }, onClick: () => openDetail(c) }, c.title),
        h('span', { class: 'md-row__meta' }, contentMeta(c))),
      h('div', { class: 'md-row__chips' }, badges(c)),
      h('span', { class: 'md-row__date text-2', title: formatDateTime(c.updated_at) }, formatRelative(c.updated_at)));
  }

  // ---------- Mehrfachaktionen ----------
  async function addSelectedToPresentation() {
    const list = [...selected.values()];
    const broken = list.filter((c) => c.status === 'error');
    if (broken.length) toast.warning(`${plural(broken.length, 'Inhalt wird', 'Inhalte werden')} wegen Verarbeitungsfehler übersprungen.`);
    const ok = await addToPresentation(list.filter((c) => c.status !== 'error'));
    if (ok) { selected.clear(); load({ quiet: true }); }
  }

  async function bulkDelete() {
    const list = [...selected.values()];
    const used = list.filter((c) => c.usage_count > 0);
    const ok = await confirmDialog({
      title: `${plural(list.length, 'Inhalt', 'Inhalte')} löschen?`,
      message: 'Gelöschte Inhalte und ihre Dateien können nicht wiederhergestellt werden.',
      details: used.length ? h('div', { class: 'alert alert--warning' }, icon('alert-triangle'),
        h('div', { class: 'alert__body' }, h('div', { class: 'alert__text' },
          `${plural(used.length, 'Inhalt wird', 'Inhalte werden')} noch verwendet und ${used.length === 1 ? 'bleibt' : 'bleiben'} deshalb erhalten.`))) : null,
      confirmLabel: list.length === 1 ? 'Inhalt löschen' : `${formatNumber(list.length)} Inhalte löschen`,
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.post('/api/contents/bulk-delete', { ids: list.map((c) => c.id) });
      const deleted = res.deleted || [];
      const blocked = res.blocked || [];
      for (const id of deleted) selected.delete(id);
      if (deleted.length) toast.success(`${plural(deleted.length, 'Inhalt', 'Inhalte')} gelöscht.`);
      if (blocked.length) {
        openDialog({
          title: `${plural(blocked.length, 'Inhalt wurde', 'Inhalte wurden')} nicht gelöscht`,
          size: 'md',
          content: h('div', { class: 'stack' },
            h('p', {}, 'Diese Inhalte werden noch verwendet. Bitte zuerst dort entfernen oder ersetzen:'),
            ...blocked.map((b) => h('div', { class: 'stack stack--sm' }, h('h3', { class: 'text-lg' }, b.title || `#${b.id}`), usageList(b.usages || [])))),
          actions: [{ label: 'Schließen', variant: 'primary' }],
        });
      }
      load({ quiet: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // ---------- Detail-Schublade ----------
  async function openDetail(summary) {
    drawer?.close();
    let content = summary;
    let pf = null;
    const previewBox = h('div', { class: 'md-detail__preview' });
    const infoBox = h('div', { class: 'stack' });
    const usagesBox = h('div', {}, h('p', { class: 'text-2' }, 'Wird geladen …'));

    const d = openDrawer({
      title: summary.title,
      description: contentTypeLabel(summary.type),
      width: '600px',
      className: 'md-detail',
      content: h('div', { class: 'stack stack--lg' }, previewBox, infoBox,
        h('section', { class: 'stack stack--sm' }, h('h3', {}, 'Verwendung'), usagesBox)),
      actions: [],
      onClose: () => { pf?.destroy(); pf = null; if (drawer?.dlg === d) drawer = null; },
    });
    drawer = { dlg: d, id: summary.id, close: () => d.close() };

    function renderPreview() {
      pf?.destroy(); pf = null;
      const c = content;
      const u = c.urls || {};
      let node;
      if (c.status === 'processing') node = h('div', { class: 'md-detail__frame' }, contentPreview(c));
      else if (c.status === 'error') {
        node = h('div', { class: 'alert alert--danger' }, icon('alert-circle'), h('div', { class: 'alert__body' },
          h('div', { class: 'alert__title' }, 'Verarbeitung fehlgeschlagen'),
          h('div', { class: 'alert__text' }, c.status_message || 'Die Datei konnte nicht verarbeitet werden. Bitte erneut hochladen oder eine andere Datei verwenden.')));
      } else if (c.type === 'image' && u.display) {
        node = h('div', { class: 'md-detail__frame' }, h('img', { src: u.display, alt: `Vorschau: ${c.title}` }));
      } else if (c.type === 'video' && u.display) {
        node = h('div', { class: 'md-detail__frame' }, h('video', { src: u.display, poster: u.poster, controls: true, preload: 'metadata', playsinline: true, 'aria-label': `Video: ${c.title}` }));
      } else if (c.type === 'pdf' && u.pages?.length) {
        const max = 12;
        node = h('div', { class: 'md-detail__pages', tabindex: '0', 'aria-label': 'Seiten des PDFs' },
          u.pages.slice(0, max).map((src, i) => h('figure', {}, h('img', { src, alt: `Seite ${i + 1}`, loading: 'lazy' }), h('figcaption', {}, `Seite ${i + 1}`))),
          u.pages.length > max ? h('p', { class: 'text-2' }, `… und ${u.pages.length - max} weitere Seiten`) : null);
      } else if (c.type === 'text') {
        pf = playerFrame({ src: playerUrls.slide(), title: `Vorschau: ${c.title}` });
        node = h('div', { class: 'md-detail__player' }, pf.el);
        api.post('/api/preview/resolve', { items: [{ id: null, content_id: c.id, content: null, enabled: true, duration_s: null, transition: null, valid_from: null, valid_until: null, caption: '', options: {} }] })
          .then((res) => { if (pf && res?.slides?.[0]) pf.send({ type: 'render', slide: res.slides[0], design: null, settings: res.settings || null, touch_menu: null, view: 'slide' }); })
          .catch((err) => { previewBox.append(h('p', { class: 'text-2 text-sm' }, `Vorschau nicht verfügbar: ${errorMessage(err)}`)); });
      } else if (c.type === 'web') {
        const ec = c.data?.embed_check || {};
        node = h('div', { class: 'stack stack--sm' },
          h('div', { class: 'md-detail__frame md-detail__frame--web' }, contentPreview(c)),
          embedAlert(ec),
          c.data?.url ? h('a', { href: c.data.url, target: '_blank', rel: 'noopener noreferrer', class: 'cluster' }, icon('external-link', { size: 16 }), c.data.url) : null);
      } else {
        node = h('div', { class: 'md-detail__frame' }, contentPreview(c));
      }
      fill(previewBox, node);
    }

    function renderInfo() {
      const c = content;
      const f = c.file || {};
      const titleIn = input({ value: c.title, maxLength: 120, disabled: !canEdit });
      let tags = [...(c.tags || [])];
      const tagsIn = tagsInput({ value: tags, suggestions: state.tags, onChange: (v) => { tags = v; dirtyCheck(); } });
      if (!canEdit) tagsIn.input.disabled = true;
      const saveBtn = button({ label: 'Speichern', icon: 'save', variant: 'primary', size: 'sm', disabled: true, onClick: save });
      const form = h('form', { class: 'stack stack--sm', onSubmit: (e) => { e.preventDefault(); save(); } },
        field({ label: 'Titel', control: titleIn, name: 'title', required: true }),
        field({ label: 'Schlagworte', control: tagsIn, name: 'tags', hint: canEdit ? 'Enter oder Komma fügt ein Schlagwort hinzu.' : null }),
        canEdit ? h('div', { class: 'cluster' }, saveBtn) : null);
      function dirtyCheck() {
        saveBtn.disabled = titleIn.value.trim() === c.title && JSON.stringify(tags) === JSON.stringify(c.tags || []);
      }
      titleIn.addEventListener('input', dirtyCheck);
      async function save() {
        if (saveBtn.disabled) return;
        clearFieldErrors(form);
        if (!titleIn.value.trim()) { setFieldErrors(form, { title: 'Bitte einen Titel eingeben.' }); return; }
        saveBtn.setAttribute('aria-busy', 'true');
        try {
          const upd = await api.patch(`/api/contents/${c.id}`, { title: titleIn.value.trim(), tags });
          content = { ...content, ...upd };
          d.setTitle(content.title);
          toast.success('Gespeichert.');
          renderInfo();
          load({ quiet: true });
        } catch (err) {
          const rest = err instanceof ApiError ? setFieldErrors(form, err.fields) : {};
          toast.error(Object.values(rest)[0] || errorMessage(err));
        } finally { saveBtn.removeAttribute('aria-busy'); }
      }

      const rows = [
        ['Typ', contentTypeLabel(c.type)],
        c.type === 'text' ? ['Vorlage', TEMPLATE_LABELS[c.data?.template] || '–'] : null,
        c.type === 'web' ? ['Adresse', c.data?.url || '–'] : null,
        c.type === 'web' ? ['Darstellung', `Zoom ${Math.round((c.data?.zoom || 1) * 100)} %, ${c.data?.refresh_s ? `neu laden alle ${formatDuration(c.data.refresh_s)}` : 'nicht automatisch neu laden'}, ${c.data?.interactive ? 'im Touch-Modus bedienbar' : 'nicht bedienbar'}`] : null,
        f.name ? ['Datei', f.name] : null,
        f.size_bytes ? ['Größe', formatBytes(f.size_bytes)] : null,
        f.width ? ['Auflösung', `${f.width} × ${f.height} px (${f.height >= f.width ? 'Hochformat' : 'Querformat'})`] : null,
        f.duration_s ? ['Dauer', formatDuration(f.duration_s)] : null,
        f.page_count ? ['Seiten', formatNumber(f.page_count)] : null,
        c.type === 'video' && c.data?.codec ? ['Codec', `${c.data.codec}${c.data.transcoded ? ' (für Browser umgewandelt)' : ''}`] : null,
        ['Angelegt', `${formatDateTime(c.created_at)}${c.created_by ? ` von ${c.created_by.display_name}` : ''}`],
        ['Geändert', `${formatDateTime(c.updated_at)}${c.updated_by ? ` von ${c.updated_by.display_name}` : ''}`],
      ].filter(Boolean);
      fill(infoBox,
        c.warnings?.length ? h('div', { class: 'alert alert--warning' }, icon('alert-triangle'), h('div', { class: 'alert__body' }, h('div', { class: 'alert__title' }, 'Hinweise'), warningList(c.warnings))) : null,
        form,
        h('dl', { class: 'meta-list' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      );
    }

    function renderActions() {
      const c = content;
      const acts = [];
      if (canDelete) acts.push({ label: 'Löschen', icon: 'trash', variant: 'danger-ghost', start: true, closes: false, onClick: () => deleteOne(c) });
      if (c.urls?.original) acts.push({ label: 'Original', icon: 'download', variant: 'ghost', closes: false, onClick: () => { api.download(c.urls.original); return false; } });
      if (canEdit && (c.type === 'text' || c.type === 'web')) acts.push({ label: 'Duplizieren', icon: 'copy', variant: 'secondary', closes: false, onClick: () => duplicate(c) });
      if (canAddToPres && c.status !== 'error') acts.push({ label: 'Zu Präsentation', icon: 'presentation', variant: 'secondary', closes: false, onClick: async () => { await addToPresentation([c]); await refresh(); return false; } });
      if (canEdit && c.type === 'text') acts.push({ label: 'Bearbeiten', icon: 'pencil', variant: 'primary', onClick: () => { ctx.navigate(`/media/text/${c.id}`); } });
      if (canEdit && c.type === 'web') acts.push({ label: 'Bearbeiten', icon: 'pencil', variant: 'primary', closes: false, onClick: async () => { const upd = await openWebDialog(c); if (upd) { content = { ...content, ...upd }; renderAll(); } return false; } });
      d.setActions(acts);
    }

    function renderAll() { renderPreview(); renderInfo(); renderActions(); }

    async function refresh() {
      try {
        const full = await api.get(`/api/contents/${summary.id}`, { signal: ctx.signal });
        content = full;
        if (!drawer || drawer.dlg !== d) return;
        d.setTitle(full.title);
        renderAll();
        fill(usagesBox, usageList(full.usages || [], { onNavigate: () => d.close() }));
      } catch (err) {
        if (err?.name === 'AbortError') return;
        fill(usagesBox, h('p', { class: 'field__error' }, errorMessage(err)));
      }
    }

    renderAll();
    refresh();
  }

  async function deleteOne(c) {
    const ok = await confirmDialog({
      title: `„${c.title}“ löschen?`,
      message: c.usage_count
        ? 'Der Inhalt wird noch verwendet und kann erst gelöscht werden, wenn er dort entfernt wurde.'
        : 'Der Inhalt und seine Dateien werden endgültig entfernt.',
      confirmLabel: `${contentTypeLabel(c.type)} löschen`,
      danger: true,
    });
    if (!ok) return false;
    try {
      await api.del(`/api/contents/${c.id}`);
      toast.success(`„${c.title}“ gelöscht.`);
      selected.delete(c.id);
      drawer?.close();
      load({ quiet: true });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        await showInUse({ title: `„${c.title}“ kann nicht gelöscht werden`, message: err.message, usages: err.details?.usages || [] });
      } else toast.error(errorMessage(err));
      return false;
    }
  }

  async function duplicate(c) {
    try {
      const copy = await api.post(`/api/contents/${c.id}/duplicate`);
      toast.success(`Kopie „${copy.title}“ angelegt.`, copy.type === 'text' ? { action: { label: 'Bearbeiten', onClick: () => ctx.navigate(`/media/text/${copy.id}`) } } : {});
      await load({ quiet: true });
      drawer?.close();
      openDetail(copy);
    } catch (err) { toast.error(errorMessage(err)); }
    return false;
  }

  // ---------- Webseite anlegen/bearbeiten ----------
  async function openWebDialog(existing = null) {
    const data = existing?.data || {};
    let check = data.embed_check && data.embed_check.checked_at ? data.embed_check : null;
    const urlIn = input({ value: data.url || '', type: 'url', placeholder: 'https://www.beispiel.de/seite', inputMode: 'url', autoComplete: 'off', maxLength: 2000 });
    const titleIn = input({ value: existing?.title || '', maxLength: 120, placeholder: 'wird nach dem Prüfen vorgeschlagen' });
    const checkBtn = button({ label: 'Prüfen', icon: 'refresh', variant: 'secondary', onClick: () => runCheck() });
    const checkBox = h('div', { role: 'status', 'aria-live': 'polite' }, check ? embedAlert(check) : null);
    const zoomSel = select({
      value: String(data.zoom ?? 1),
      options: [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map((z) => ({ value: String(z), label: `${Math.round(z * 100)} %${z === 1 ? ' (Standard)' : ''}` })),
    });
    const refreshSel = select({
      value: String(data.refresh_s ?? 0),
      options: [0, 60, 300, 600, 900, 1800, 3600].map((s) => ({ value: String(s), label: s ? `alle ${s / 60} min` : 'Nie' })),
    });
    if (![0, 60, 300, 600, 900, 1800, 3600].includes(data.refresh_s ?? 0)) {
      refreshSel.append(h('option', { value: String(data.refresh_s) }, `alle ${formatDuration(data.refresh_s)}`));
      refreshSel.value = String(data.refresh_s);
    }
    const interactive = switchToggle({ label: 'Im Touch-Modus bedienbar', hint: 'Besucher können die Seite antippen und scrollen. In der Diashow ist sie nie bedienbar.', checked: data.interactive !== false });
    let tags = [...(existing?.tags || [])];
    const tagsIn = tagsInput({ value: tags, suggestions: state.tags, onChange: (v) => { tags = v; } });

    const form = h('form', { class: 'form', onSubmit: (e) => e.preventDefault() },
      field({ label: 'Adresse (URL)', name: 'url', required: true, control: h('div', { class: 'input-group md-urlgroup' }, urlIn, checkBtn), hint: 'Nur http:// und https://. „Prüfen“ zeigt, ob die Seite eingebettet werden darf.' }),
      checkBox,
      field({ label: 'Titel', name: 'title', required: true, control: titleIn }),
      h('div', { class: 'form-row' },
        field({ label: 'Zoom', name: 'zoom', control: zoomSel, hint: 'Vergrößert oder verkleinert die Seite auf der Stele.' }),
        field({ label: 'Automatisch neu laden', name: 'refresh_s', control: refreshSel, hint: 'Für Seiten mit wechselnden Daten.' })),
      interactive,
      field({ label: 'Schlagworte', name: 'tags', optional: true, control: tagsIn }));

    async function runCheck() {
      const url = urlIn.value.trim();
      clearFieldErrors(form);
      if (!/^https?:\/\/.+/i.test(url)) { setFieldErrors(form, { url: 'Bitte eine vollständige Adresse mit http:// oder https:// eingeben.' }); return; }
      checkBtn.setAttribute('aria-busy', 'true');
      fill(checkBox, h('p', { class: 'text-2' }, 'Seite wird geprüft …'));
      try {
        const r = await api.post('/api/contents/check-url', { url });
        check = { embeddable: r.embeddable ?? null, message: r.message || '', checked_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
        fill(checkBox, embedAlert(check));
        if (!titleIn.value.trim()) titleIn.value = r.title || domainOf(url);
      } catch (err) {
        if (err instanceof ApiError && err.fields?.url) setFieldErrors(form, { url: err.fields.url });
        fill(checkBox, h('p', { class: 'field__error' }, errorMessage(err)));
      } finally { checkBtn.removeAttribute('aria-busy'); }
    }
    urlIn.addEventListener('change', () => { check = null; fill(checkBox); });

    const dlg = openDialog({
      title: existing ? 'Webseite bearbeiten' : 'Webseite einbinden',
      description: 'Die Seite wird live auf der Stele angezeigt (Internetverbindung der Stele nötig).',
      size: 'md',
      content: form,
      actions: [
        { label: 'Abbrechen', value: null },
        {
          label: existing ? 'Speichern' : 'Anlegen', variant: 'primary', icon: existing ? 'save' : 'plus',
          onClick: async () => {
            clearFieldErrors(form);
            const url = urlIn.value.trim();
            const title = titleIn.value.trim() || domainOf(url);
            const errs = {};
            if (!/^https?:\/\/.+/i.test(url)) errs.url = 'Bitte eine vollständige Adresse mit http:// oder https:// eingeben.';
            if (!title) errs.title = 'Bitte einen Titel eingeben.';
            if (Object.keys(errs).length) { setFieldErrors(form, errs); return false; }
            const payload = {
              title, tags,
              data: { url, zoom: Number(zoomSel.value), refresh_s: Number(refreshSel.value), interactive: interactive.input.checked, ...(check ? { embed_check: check } : {}) },
            };
            try {
              const res = existing
                ? await api.patch(`/api/contents/${existing.id}`, payload)
                : await api.post('/api/contents', { type: 'web', ...payload });
              toast.success(existing ? 'Webseite gespeichert.' : `Webseite „${res.title}“ angelegt.`);
              load({ quiet: true });
              return res;
            } catch (err) {
              if (err instanceof ApiError && err.fields) {
                const f = {};
                for (const [k, v] of Object.entries(err.fields)) f[k.replace(/^data\./, '')] = v;
                const rest = setFieldErrors(form, f);
                if (Object.keys(rest).length) toast.error(Object.values(rest)[0]);
                else if (!Object.keys(f).length) toast.error(errorMessage(err));
                return false;
              }
              throw err;
            }
          },
        },
      ],
    });
    const r = await dlg.result;
    return r && typeof r === 'object' ? r : null;
  }

  // ---------- Start ----------
  renderTags();
  load();
  if (ctx.query.upload === '1') {
    ctx.setQuery({ upload: null });
    if (canEdit) startUpload();
  }

  return () => {
    clearTimeout(pollTimer);
    loadCtrl?.abort();
    stopDrop?.();
    drawer?.close();
  };
}

/** Hinweis zur Einbettbarkeit einer Webseite. */
function embedAlert(ec = {}) {
  if (ec.embeddable === true) {
    return h('div', { class: 'alert alert--success' }, icon('check-circle'), h('div', { class: 'alert__body' },
      h('div', { class: 'alert__title' }, 'Seite kann eingebettet werden'),
      ec.message ? h('div', { class: 'alert__text' }, ec.message) : null));
  }
  if (ec.embeddable === false) {
    return h('div', { class: 'alert alert--danger' }, icon('x-circle'), h('div', { class: 'alert__body' },
      h('div', { class: 'alert__title' }, 'Seite verbietet das Einbetten'),
      h('div', { class: 'alert__text' }, ec.message || 'Der Betreiber erlaubt keine Anzeige in anderen Seiten. Auf der Stele bliebe die Fläche leer.')));
  }
  return h('div', { class: 'alert alert--neutral' }, icon('help-circle'), h('div', { class: 'alert__body' },
    h('div', { class: 'alert__title' }, ec.checked_at ? 'Einbettung konnte nicht geprüft werden' : 'Noch nicht geprüft'),
    h('div', { class: 'alert__text' }, ec.message || 'Mit „Prüfen“ lässt sich feststellen, ob die Seite angezeigt werden darf.')));
}

/** Kombiniert zwei AbortSignals. */
function anySignal(a, b) {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
  const c = new AbortController();
  const stop = () => c.abort();
  if (a.aborted || b.aborted) c.abort();
  a.addEventListener('abort', stop, { once: true });
  b.addEventListener('abort', stop, { once: true });
  return c.signal;
}
