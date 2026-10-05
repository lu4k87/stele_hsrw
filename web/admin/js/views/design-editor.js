// Design-Editor (#/designs/:id): Header, Footer, Schriften, Typografie-Standard der Info-Folien, Farben/Paletten
// mit Live-Vorschau (Beispielfolie).
// Speichern ausdrücklich; danach Hinweis auf betroffene Präsentationen (mit Veröffentlichungsrecht: direkt veröffentlichen).
import { h, useStyles, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can } from '../session.js';
import { plural } from '../format.js';
import { page, pageHeader, card, button } from '../ui/page.js';
import { field, input, numberInput, segmented, switchToggle, setFieldErrors } from '../ui/form.js';
import { confirmDialog } from '../ui/dialog.js';
import { menuButton } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { errorState, loadingBlock } from '../ui/empty.js';
import { contentStyles, clone, showInUse } from '../ui/content-common.js';
import { contentRefField } from '../ui/content-ref.js';
import { colorChoice, contrastWarning } from '../ui/color-choice.js';
import { gripButton, makeSortable, moveItem } from '../ui/sortable.js';
import { livePreview } from '../ui/live-preview.js';
import { affectedPresentations } from '../ui/presentation-actions.js';
import { editorSave } from '../ui/editor-save.js';
import { usedBy } from './touch-menus.js';
import { fontPicker, inheritSelect, paletteRow, loadFonts, WEIGHTS, LINE_HEIGHTS, TRACKINGS, CASES } from '../ui/typography.js';
import { fontStack } from '/shared/fonts.js';

const SAMPLE = {
  template: 'title_text',
  fields: { title: 'Beispielfolie', subtitle: 'So wirkt der Rahmen', body: 'Header und Footer erscheinen auf allen Folien der Präsentationen, die dieses Design verwenden.', image_content_id: null, date: '', time: '', location: '', items: [] },
  style: { bg_color: '#F4F1EA', text_color: '#111827', accent_color: '#1E5AA8', bg_image_content_id: null, overlay: 0.4, align: 'left', size: 'm' },
};

export default async function mount(root, ctx) {
  await Promise.all([useStyles('/admin/css/views/designs.css'), useStyles('/admin/css/views/touch-menus.css'), contentStyles()]);
  const id = Number(ctx.params.id);
  const canEdit = can('designs.edit');
  const canPublish = can('presentations.publish');
  const ro = !canEdit;

  root.append(loadingBlock('Design wird geladen …'));
  let design;
  try {
    [design] = await Promise.all([api.get(`/api/designs/${id}`, { signal: ctx.signal }), loadFonts(ctx.signal)]);
  } catch (err) {
    if (err?.name === 'AbortError') return undefined;
    fill(root, page({}, pageHeader({ title: 'Design', back: { href: '#/designs', label: 'Designs' } }),
      card({ body: errorState({ title: 'Design konnte nicht geladen werden', error: err, onRetry: () => ctx.navigate(`/designs/${id}`, { replace: true }) }) })));
    return undefined;
  }
  ctx.setTitle(design.name);

  let name = design.name;
  let cfg = clone(design.config);
  cfg.footer.ticker_items = [...(cfg.footer.ticker_items || [])];
  const hd = () => cfg.header;
  const ft = () => cfg.footer;
  const formRoot = h('div', { class: 'de-form' });

  // ---------- Speichern ----------
  // Hauptaktion nur bei Änderungen hervorgehoben (changed() schaltet primary/secondary)
  const ed = editorSave({
    ctx, ro, formRoot, stateClass: 'tm-savestate', dirtyMessage: 'Das Design hat ungespeicherte Änderungen.',
    snapshot: () => ({ name, cfg }),
    validate: () => {
      if (!name.trim()) { setFieldErrors(formRoot, { name: 'Bitte einen Namen eingeben.' }); return false; }
      const url = ft().ticker_rss_url.trim();
      if (url && !/^https?:\/\/.+/i.test(url)) { toast.error('Die RSS-Adresse muss mit http:// oder https:// beginnen.'); return false; }
      return true;
    },
    send: () => {
      const payload = clone(cfg);
      payload.footer.ticker_items = payload.footer.ticker_items.map((s) => s.trim()).filter(Boolean);
      payload.footer.ticker_rss_url = ft().ticker_rss_url.trim();
      return api.patch(`/api/designs/${id}`, { name: name.trim(), config: payload, expected_updated_at: design.updated_at });
    },
    onSaved: (res, untouched) => {
      design = res;
      const srvCfg = clone(res.config);
      srvCfg.footer.ticker_items = [...(srvCfg.footer.ticker_items || [])];
      ed.markSaved({ name: res.name, cfg: srvCfg });
      if (untouched) {
        name = res.name;
        cfg = srvCfg;
        renderTicker();
      }
      header.titleEl.textContent = res.name;
      ctx.setTitle(res.name);
      fill(usedBox, usedBy(res.used_by || []));
      ed.changed(false);
      showAffected(res.used_by || []);
      toast.success('Design gespeichert.');
    },
    fieldMap: null,
    fieldToast: (rest, err) => `${err.message} ${Object.values(rest)[0]}`,
    onChanged: (preview) => { updateContrast(); if (preview) refreshPreview(); },
    onReload: reload,
  });
  const changed = ed.changed;

  // ---------- Kopf ----------
  const usedBox = h('div', {}, usedBy(design.used_by || []));
  const header = pageHeader({
    title: design.name,
    back: { href: '#/designs', label: 'Designs' },
    description: 'Rahmen um die Folien. Änderungen gelten für alle Präsentationen mit diesem Design – nach dem Veröffentlichen.',
    meta: usedBox,
    actions: canEdit ? [
      ed.saveState,
      menuButton({ items: [
        { label: 'Duplizieren', icon: 'copy', onClick: duplicate },
        { separator: true },
        { label: 'Design löschen', icon: 'trash', danger: true, onClick: remove },
      ] }),
      ed.saveBtn,
    ] : [],
  });
  const afterSave = h('div', { role: 'status', 'aria-live': 'polite', hidden: true });
  const roAlert = ro ? h('div', { class: 'alert alert--neutral' }, icon('eye'), h('div', { class: 'alert__body' },
    h('div', { class: 'alert__text' }, 'Nur Ansicht – zum Bearbeiten fehlt das Recht „Designs bearbeiten“.'))) : null;

  const contrast = contrastWarning();

  // Helfer
  function numField({ label, value, min, max, unit, hint, name: fname, onValid }) {
    let f;
    const ctl = numberInput({
      value, min, max, unit, disabled: ro,
      onInput: (v) => {
        const bad = v === null || v < min || v > max;
        setErr(f, bad ? `Bitte ${min} bis ${max} eingeben.` : null);
        if (!bad) onValid(v);
      },
    });
    f = field({ label, control: ctl, hint, name: fname });
    return f;
  }
  function textField(label, obj, key, { maxLength = 80, hint = null, optional = false, placeholder = null, fname = null } = {}) {
    return field({ label, hint, optional, name: fname, control: input({ value: obj()[key] || '', maxLength, placeholder, disabled: ro, onInput: (v) => { obj()[key] = v; changed(); } }) });
  }
  function sw(label, obj, key, hint, after = null) {
    return switchToggle({ label, hint, checked: !!obj()[key], disabled: ro, onChange: (v) => { obj()[key] = v; after?.(); changed(); } });
  }
  const colorEls = []; // für Paletten: Farbfelder nachziehen
  function color(label, obj, key) {
    const el = colorChoice({ label, value: obj()[key], onChange: (v) => { obj()[key] = v; changed(); } });
    colorEls.push({ obj, key, el });
    return field({ label, control: el });
  }
  function seg(label, obj, key, options, hint = null) {
    const s = segmented({ value: obj()[key], ariaLabel: label, options, onChange: (v) => { obj()[key] = v; changed(); } });
    if (ro) s.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    return field({ label, control: s, hint });
  }

  // ---------- Header ----------
  const headerDetails = h('fieldset', { class: 'de-fieldset', disabled: ro, hidden: !hd().enabled },
    h('legend', { class: 'visually-hidden' }, 'Header-Einstellungen'),
    h('div', { class: 'form-row' },
      textField('Titel', hd, 'title', { placeholder: 'z. B. Willkommen im Rathaus' }),
      textField('Untertitel', hd, 'subtitle', { optional: true })),
    h('div', { class: 'form-row' },
      field({ label: 'Logo', optional: true, control: contentRefField({ value: hd().logo_content_id, types: ['image'], pickerTitle: 'Logo wählen', emptyLabel: 'Kein Logo', disabled: ro, onChange: (cid) => { hd().logo_content_id = cid; changed(); } }), hint: 'PNG mit transparentem Hintergrund wirkt am besten.' }),
      seg('Position von Logo und Titel', hd, 'logo_position', [{ value: 'left', label: 'Links' }, { value: 'center', label: 'Mittig' }])),
    h('div', { class: 'form-row' },
      color('Hintergrund', hd, 'bg_color'),
      color('Textfarbe', hd, 'text_color')),
    h('div', { class: 'form-row' },
      numField({ label: 'Höhe', value: hd().height, min: 100, max: 400, unit: 'px', hint: 'Auf der 1920 px hohen Stele; 180 px ≈ 9 %.', onValid: (v) => { hd().height = v; changed(); } }),
      h('div', { class: 'stack stack--sm' },
        sw('Uhrzeit anzeigen', hd, 'show_clock'),
        sw('Datum anzeigen', hd, 'show_date', null, () => { dateFmt.hidden = !hd().show_date; }))),
  );
  const dateFmt = seg('Datumsformat', hd, 'date_format', [{ value: 'long', label: 'Dienstag, 30. September' }, { value: 'short', label: '30.09.2026' }]);
  dateFmt.hidden = !hd().show_date;
  headerDetails.append(dateFmt);
  const headerSw = switchToggle({ label: 'Header anzeigen', hint: 'Ausgeschaltet: Folien nutzen die volle Höhe oben.', checked: hd().enabled, disabled: ro, onChange: (v) => { hd().enabled = v; headerDetails.hidden = !v; changed(); } });

  // ---------- Footer ----------
  const tickerList = h('ul', { class: 'de-ticker', 'aria-label': 'Meldungen des Laufbands' });
  makeSortable(tickerList, { disabled: () => ro, itemLabel: (i) => ft().ticker_items[i], onMove: (from, to) => { moveItem(ft().ticker_items, from, to); renderTicker(); changed(); } });
  function renderTicker() {
    const items = ft().ticker_items;
    if (!items.length) { fill(tickerList, h('li', { class: 'text-2 text-sm' }, 'Noch keine Meldungen.')); return; }
    const focusIdx = [...tickerList.querySelectorAll('input')].indexOf(document.activeElement);
    fill(tickerList, ...items.map((txt, i) => {
      const inp = input({ value: txt, maxLength: 200, disabled: ro, 'aria-label': `Meldung ${i + 1}`, onInput: (v) => { items[i] = v; changed(); } });
      return h('li', { class: 'cu-inline-row', dataset: { sortItem: '' } },
        ro ? null : gripButton({ label: `Meldung ${i + 1} verschieben` }),
        inp,
        ro ? null : h('button', { type: 'button', class: 'btn btn--ghost btn--icon btn--sm', 'aria-label': `Meldung ${i + 1} entfernen`, title: 'Entfernen', onClick: () => { items.splice(i, 1); renderTicker(); changed(); } }, icon('x', { size: 16 })));
    }));
    if (focusIdx >= 0) tickerList.querySelectorAll('input')[Math.min(focusIdx, items.length - 1)]?.focus();
  }
  const addTicker = ro ? null : button({ label: 'Meldung hinzufügen', icon: 'plus', variant: 'secondary', size: 'sm', onClick: () => {
    ft().ticker_items.push('');
    renderTicker();
    changed();
    const all = tickerList.querySelectorAll('input');
    all[all.length - 1]?.focus();
  } });
  const speedOut = h('output', {}, `${ft().ticker_speed} px/s`);
  const speedIn = h('input', { type: 'range', min: '40', max: '400', step: '10', value: String(ft().ticker_speed), disabled: ro, 'aria-label': 'Geschwindigkeit des Laufbands' });
  speedIn.addEventListener('input', () => { ft().ticker_speed = Number(speedIn.value); speedOut.textContent = `${speedIn.value} px/s`; changed(); });
  const tickerBox = h('div', { class: 'form' },
    field({ label: 'Meldungen', control: h('div', { class: 'stack stack--sm' }, tickerList, addTicker), hint: 'Laufen nacheinander von rechts nach links. Reihenfolge per Ziehen oder Pfeiltasten am Griff.' }),
    textField('RSS-Feed (optional)', ft, 'ticker_rss_url', { maxLength: 500, optional: true, placeholder: 'https://…/feed.xml', hint: 'Überschriften aus dem Feed werden an die Meldungen angehängt und regelmäßig aktualisiert.' }),
    h('div', { class: 'form-row' },
      field({ label: 'Geschwindigkeit', control: h('div', { class: 'cu-range' }, speedIn, speedOut), hint: '120 px/s ist gut lesbar.' }),
      textField('Trennzeichen', ft, 'ticker_separator', { maxLength: 3, hint: 'Zwischen den Meldungen, z. B. • oder +++' })));
  const textBox = h('div', { class: 'form' }, textField('Text', ft, 'text', { maxLength: 200, placeholder: 'z. B. www.beispiel.de · Tel. 0123 456789' }));
  const modeSeg = segmented({ value: ft().mode, ariaLabel: 'Inhalt des Footers', options: [{ value: 'ticker', label: 'Laufband', icon: 'megaphone' }, { value: 'text', label: 'Fester Text', icon: 'type' }], onChange: (v) => { ft().mode = v; paintMode(); changed(); } });
  if (ro) modeSeg.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  const paintMode = () => { tickerBox.hidden = ft().mode !== 'ticker'; textBox.hidden = ft().mode !== 'text'; };
  paintMode();
  renderTicker();
  const footerDetails = h('fieldset', { class: 'de-fieldset', disabled: ro, hidden: !ft().enabled },
    h('legend', { class: 'visually-hidden' }, 'Footer-Einstellungen'),
    field({ label: 'Inhalt', control: modeSeg }),
    tickerBox, textBox,
    h('div', { class: 'form-row' }, color('Hintergrund', ft, 'bg_color'), color('Textfarbe', ft, 'text_color')),
    numField({ label: 'Höhe', value: ft().height, min: 60, max: 240, unit: 'px', hint: '96 px ≈ 5 % der Stelenhöhe.', onValid: (v) => { ft().height = v; changed(); } }));
  const footerSw = switchToggle({ label: 'Footer anzeigen', hint: 'Ausgeschaltet: kein Laufband und kein Text unten.', checked: ft().enabled, disabled: ro, onChange: (v) => { ft().enabled = v; footerDetails.hidden = !v; changed(); } });

  // ---------- Allgemein: Farben ----------
  const th = () => cfg.theme;
  const accentEl = colorChoice({ label: 'Akzentfarbe', value: th().accent_color, onChange: (v) => { th().accent_color = v; changed(); } });
  const palettes = paletteRow({ disabled: ro, label: 'Farbpaletten für Header, Footer und Akzent', onPick: (p) => {
    for (const part of [hd(), ft()]) { part.bg_color = p.bg; part.text_color = p.text; }
    th().accent_color = p.accent;
    colorEls.forEach(({ obj, key, el }) => el.setValue(obj()[key]));
    accentEl.setValue(th().accent_color);
    changed();
  } });

  // ---------- Schrift ----------
  const themeSet = (key) => (v) => { th()[key] = v; changed(); };
  const bodyFont = fontPicker({ label: 'Schrift für Text', value: th().font, disabled: ro, hint: 'Fließtext der Info-Folien, Footer und Uhr.',
    onChange: (v) => { th().font = v || 'sans'; headingFont.refreshSample(); changed(); } });
  const headingFont = fontPicker({ label: 'Schrift für Überschriften', value: th().heading_font, inheritLabel: 'Wie Text', inheritStack: () => fontStack(th().font), disabled: ro,
    hint: 'Titel der Info-Folien und des Headers.', onChange: themeSet('heading_font') });
  const typoGrid = h('div', { class: 'ty-grid' },
    inheritSelect({ label: 'Stärke der Überschriften', value: th().heading_weight, options: WEIGHTS, inheritLabel: 'Standard (Extrafett)', disabled: ro, onChange: themeSet('heading_weight') }),
    inheritSelect({ label: 'Stärke des Texts', value: th().body_weight, options: WEIGHTS, inheritLabel: 'Standard (Normal)', disabled: ro, onChange: themeSet('body_weight') }),
    inheritSelect({ label: 'Zeilenabstand', value: th().line_height, options: LINE_HEIGHTS, inheritLabel: 'Standard (1,4)', disabled: ro, onChange: themeSet('line_height') }),
    inheritSelect({ label: 'Laufweite der Überschriften', value: th().heading_tracking, options: TRACKINGS, inheritLabel: 'Standard (leicht eng)', disabled: ro, onChange: themeSet('heading_tracking') }),
    inheritSelect({ label: 'Schreibweise der Überschriften', value: th().heading_case, options: CASES, inheritLabel: 'Standard (wie eingegeben)', disabled: ro, onChange: themeSet('heading_case') }));

  // ---------- Vorschau ----------
  const pv = livePreview({ title: 'Vorschau des Designs' });
  function refreshPreview(now = false) {
    const body = { settings: null, design: clone(cfg), touch_menu: null, items: [{ id: null, content_id: null, content: { type: 'text', data: SAMPLE }, enabled: true, duration_s: null, transition: 'none', valid_from: null, valid_until: null, caption: '', options: {} }] };
    const pick = (res) => ({ slide: res.slides?.[0] || null, design: res.design, settings: res.settings, view: 'slide' });
    if (now) pv.now(body, pick); else pv.update(body, pick);
  }

  function updateContrast() {
    const pairs = [];
    if (hd().enabled) pairs.push({ fg: hd().text_color, bg: hd().bg_color, label: 'Header: Text auf Hintergrund' });
    if (ft().enabled) pairs.push({ fg: ft().text_color, bg: ft().bg_color, label: 'Footer: Text auf Hintergrund' });
    if (hd().enabled) pairs.push({ fg: cfg.theme.accent_color, bg: hd().bg_color, label: 'Akzentfarbe auf Header', min: 3 });
    contrast.update(pairs);
  }

  function showAffected(list) {
    const box = affectedPresentations(list, { what: 'das neue Design', onPublished: () => ctx.refreshNav() });
    fill(afterSave, box);
    afterSave.hidden = !box;
  }

  function reload() {
    ctx.setDirty(false);
    ctx.navigate(`/designs/${id}`, { replace: true });
  }

  async function duplicate() {
    try {
      const copy = await api.post('/api/designs', { name: `${design.name} (Kopie)`.slice(0, 80), copy_from: id });
      toast.success(`Kopie „${copy.name}“ angelegt${ed.isDirty() ? ' (vom gespeicherten Stand)' : ''}.`);
      ctx.navigate(`/designs/${copy.id}`);
    } catch (err) { toast.error(errorMessage(err)); }
  }

  async function remove() {
    const used = design.used_by || [];
    const ok = await confirmDialog({
      title: `„${design.name}“ löschen?`,
      message: used.length ? `Wird in ${plural(used.length, 'Präsentation', 'Präsentationen')} verwendet und kann erst gelöscht werden, wenn dort ein anderes Design gewählt wurde.` : 'Das Design wird endgültig entfernt.',
      confirmLabel: 'Design löschen', danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/designs/${id}`);
      ctx.setDirty(false);
      toast.success('Design gelöscht.');
      ctx.navigate('/designs');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await showInUse({ title: 'Design kann nicht gelöscht werden', message: err.message, usages: err.details?.usages || [] });
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
  const nameIn = input({ value: name, maxLength: 80, disabled: ro, onInput: (v) => { name = v; changed(false); } });
  formRoot.append(
    card({ title: 'Allgemein', icon: 'settings', body: h('div', { class: 'form' },
      field({ label: 'Name (nur im CMS)', name: 'name', required: true, control: nameIn }),
      field({ label: 'Farbpalette', control: palettes, hint: 'Setzt Hintergrund und Text von Header und Footer sowie die Akzentfarbe – danach frei anpassbar.' }),
      field({ label: 'Akzentfarbe', control: accentEl, hint: 'Für Fortschrittsbalken, Hervorhebungen und Touch-Menü.' })) }),
    card({ title: 'Schrift', icon: 'type', subtitle: 'Standard für alle Info-Folien – einzelne Folien können abweichen', body: h('div', { class: 'form' },
      h('div', { class: 'form-row' }, bodyFont, headingFont),
      typoGrid) }),
    card({ title: 'Header', icon: 'panel-left', body: h('div', { class: 'form' }, headerSw, headerDetails) }),
    card({ title: 'Footer', icon: 'megaphone', body: h('div', { class: 'form' }, footerSw, footerDetails) }),
  );
  if (ro) for (const el of formRoot.querySelectorAll('.cu-color input, .cu-color button')) el.disabled = true;

  fill(root, page({ wide: true, className: 'de-page' },
    header, roAlert, ed.conflictBox, afterSave,
    h('div', { class: 'de-layout' },
      h('div', { class: 'stack' }, contrast, formRoot),
      h('aside', { class: 'de-side' }, card({ title: 'Vorschau', icon: 'eye', body: h('div', { class: 'stack' }, pv.el, h('p', { class: 'text-2 text-sm' }, 'Mit einer Beispielfolie. Uhr und Laufband laufen wie auf der Stele.')) })))));
  changed(false);
  refreshPreview(true);

  return () => {
    ed.destroy();
    pv.destroy();
    bodyFont.destroy();
    headingFont.destroy();
  };
}
