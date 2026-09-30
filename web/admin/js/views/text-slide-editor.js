// Info-Folien-Editor (#/media/text/:id, :id = 'new'): Vorlage wählen, Texte und Gestaltung, Live-Vorschau.
import { h, useStyles, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can } from '../session.js';
import { page, pageHeader, card, button } from '../ui/page.js';
import { field, input, textarea, select, segmented, tagsInput, setFieldErrors, clearFieldErrors } from '../ui/form.js';
import { menuButton } from '../ui/menu.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { errorState, loadingBlock } from '../ui/empty.js';
import { contentStyles, clone, sameJson, usageList, showInUse, TEMPLATE_LABELS } from '../ui/content-common.js';
import { contentRefField } from '../ui/content-ref.js';
import { colorChoice, contrastWarning, darken } from '../ui/color-choice.js';
import { livePreview } from '../ui/live-preview.js';

const DEFAULT_DATA = {
  template: 'title_text',
  fields: { title: '', subtitle: '', body: '', image_content_id: null, date: '', time: '', location: '', items: [], audience: '', admission: '', qr_url: '', qr_label: '' },
  style: { bg_color: '#0F2747', text_color: '#FFFFFF', accent_color: '#F5B400', bg_image_content_id: null, overlay: 0.4, align: 'left', size: 'm' },
};

const TEMPLATES = [
  { id: 'title_text', label: TEMPLATE_LABELS.title_text, desc: 'Überschrift mit Fließtext.' },
  { id: 'image_text', label: TEMPLATE_LABELS.image_text, desc: 'Großes Bild oben, Text darunter.' },
  { id: 'statement', label: TEMPLATE_LABELS.statement, desc: 'Zitat oder Kernbotschaft, groß.' },
  { id: 'event', label: TEMPLATE_LABELS.event, desc: 'Termin mit Datum, Uhrzeit und Ort.' },
  { id: 'list', label: TEMPLATE_LABELS.list, desc: 'Überschrift mit Aufzählung.' },
];

// Felder je Vorlage (Reihenfolge = Anzeige)
const FIELDS = {
  title_text: ['title', 'subtitle', 'body'],
  image_text: ['image_content_id', 'title', 'subtitle', 'body'],
  statement: ['title', 'subtitle', 'body'],
  event: ['title', 'subtitle', 'audience', 'date', 'time', 'location', 'admission', 'body'],
  list: ['title', 'subtitle', 'items', 'body'],
};
const LABELS = {
  title_text: { title: 'Überschrift', subtitle: 'Unterzeile', body: 'Text' },
  image_text: { title: 'Überschrift', subtitle: 'Unterzeile', body: 'Text', image_content_id: 'Bild' },
  statement: { title: 'Aussage oder Zitat', subtitle: 'Quelle / Person', body: 'Ergänzender Text' },
  event: { title: 'Name der Veranstaltung', subtitle: 'Rubrik', body: 'Beschreibung', date: 'Datum', time: 'Uhrzeit', location: 'Ort', audience: 'Für wen?', admission: 'Eintritt' },
  list: { title: 'Überschrift', subtitle: 'Unterzeile', items: 'Aufzählungspunkte', body: 'Text unter der Liste' },
};
const HINTS = {
  statement: { subtitle: 'Wird als „— Quelle“ angezeigt.' },
  event: { subtitle: 'z. B. Vortrag, Führung, Konzert', time: 'z. B. 18:00 oder 18:00–20:00', location: 'z. B. Großer Saal, 2. OG', audience: 'z. B. Studierende, alle Interessierten', admission: 'z. B. Eintritt frei' },
  list: { items: 'Ein Punkt pro Zeile. Kurz halten – max. 8 Punkte sind gut lesbar.' },
  image_text: { image_content_id: 'Am besten ein Bild im Querformat (z. B. 1920 × 1080).' },
};

export default async function mount(root, ctx) {
  await Promise.all([useStyles('/admin/css/views/text-slide-editor.css'), contentStyles()]);
  const isNew = ctx.params.id === 'new';
  const canEdit = can('content.edit');
  const ro = !canEdit;

  root.append(loadingBlock());
  let content = null;
  let designs = [];
  let defaultDesignId = null;
  try {
    const [c, ds, st] = await Promise.all([
      isNew ? Promise.resolve(null) : api.get(`/api/contents/${encodeURIComponent(ctx.params.id)}`, { signal: ctx.signal }),
      can('presentations.view') ? api.get('/api/designs', { signal: ctx.signal }).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      api.get('/api/settings', { signal: ctx.signal }).catch(() => ({})),
    ]);
    content = c;
    designs = ds.items || [];
    defaultDesignId = st.default_design_id ?? null;
  } catch (err) {
    if (err?.name === 'AbortError') return undefined;
    fill(root, page({}, pageHeader({ title: 'Info-Folie', back: { href: '#/media', label: 'Mediathek' } }),
      card({ body: errorState({ title: 'Info-Folie konnte nicht geladen werden', error: err, onRetry: () => ctx.navigate(`/media/text/${ctx.params.id}`, { replace: true }) }) })));
    return undefined;
  }
  if (content && content.type !== 'text') {
    ctx.navigate('/media', { replace: true });
    return undefined;
  }
  if (isNew && !canEdit) {
    fill(root, page({}, pageHeader({ title: 'Neue Info-Folie', back: { href: '#/media', label: 'Mediathek' } }),
      card({ body: h('p', {}, 'Für das Anlegen von Info-Folien fehlt das Recht „Inhalte hochladen, anlegen und bearbeiten“.') })));
    return undefined;
  }

  const data = merge(DEFAULT_DATA, content?.data || {});
  let title = content?.title || '';
  let tags = [...(content?.tags || [])];
  let saved = snapshot();
  let saving = false;
  let designId = designs.some((d) => d.id === defaultDesignId) ? defaultDesignId : (designs[0]?.id ?? null);
  const designConfig = () => designs.find((d) => d.id === designId)?.config || null;

  function snapshot() { return clone({ data, title, tags }); }
  function isDirty() { return !sameJson(snapshot(), saved); }
  ctx.setTitle(isNew ? 'Neue Info-Folie' : (content.title || 'Info-Folie'));

  // ---------- Kopf ----------
  const saveBtn = button({ label: isNew ? 'Anlegen' : 'Speichern', icon: 'save', variant: 'primary', onClick: () => save() });
  const saveState = h('span', { class: 'ts-savestate', role: 'status', 'aria-live': 'polite' });
  const headerTitle = isNew ? 'Neue Info-Folie' : (content.title || 'Info-Folie');
  const header = pageHeader({
    title: headerTitle,
    back: { href: '#/media', label: 'Mediathek' },
    description: 'Text-Folie aus einer Vorlage gestalten – die Vorschau rechts zeigt sie wie auf der Stele.',
    actions: canEdit ? [
      saveState,
      !isNew ? menuButton({ items: [
        { label: 'Duplizieren', icon: 'copy', onClick: duplicate },
        { separator: true },
        can('content.delete') ? { label: 'Löschen', icon: 'trash', danger: true, onClick: remove } : null,
      ] }) : null,
      saveBtn,
    ] : [],
  });

  // Hinweis „wird verwendet“
  const usages = (content?.usages || []).filter((u) => u.type === 'presentation');
  const usedAlert = usages.length ? h('div', { class: 'alert' }, icon('info'), h('div', { class: 'alert__body' },
    h('div', { class: 'alert__title' }, `Wird in ${usages.length === 1 ? 'einer Präsentation' : `${new Set(usages.map((u) => u.id)).size} Präsentationen`} verwendet`),
    h('div', { class: 'alert__text' }, 'Änderungen erscheinen auf den Stelen erst, nachdem die Präsentation erneut veröffentlicht wurde.'),
    h('details', { class: 'ts-usages' }, h('summary', {}, 'Verwendungen anzeigen'), usageList(content.usages)))) : null;
  const roAlert = ro ? h('div', { class: 'alert alert--neutral' }, icon('eye'), h('div', { class: 'alert__body' },
    h('div', { class: 'alert__text' }, 'Nur Ansicht – zum Bearbeiten fehlt das Recht „Inhalte hochladen, anlegen und bearbeiten“.'))) : null;

  // ---------- Vorlage ----------
  const tplGroup = h('div', { class: 'ts-templates', role: 'radiogroup', 'aria-label': 'Vorlage' });
  function renderTemplates(focus = false) {
    fill(tplGroup, ...TEMPLATES.map((t) => {
      const on = data.template === t.id;
      return h('button', {
        type: 'button', class: 'ts-tpl', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1',
        disabled: ro, dataset: { tpl: t.id },
        onClick: () => setTemplate(t.id),
      }, tplIllustration(t.id), h('span', { class: 'ts-tpl__label' }, t.label), h('span', { class: 'ts-tpl__desc' }, t.desc));
    }));
    if (focus) tplGroup.querySelector('[aria-checked="true"]')?.focus();
  }
  tplGroup.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const i = TEMPLATES.findIndex((t) => t.id === data.template);
    const n = (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + TEMPLATES.length) % TEMPLATES.length;
    setTemplate(TEMPLATES[n].id, true);
  });
  function setTemplate(id, focus = false) {
    if (data.template === id) return;
    data.template = id;
    renderTemplates(focus);
    renderFields();
    changed();
  }

  // ---------- Felder ----------
  const fieldsBox = h('div', { class: 'form' });
  const titleIn = input({ value: title, maxLength: 120, disabled: ro, placeholder: 'wie die Überschrift', onInput: (v) => { title = v; changed(false); } });
  const tagsIn = tagsInput({ value: tags, onChange: (v) => { tags = v; changed(false); } });
  if (ro) tagsIn.input.disabled = true;

  function renderFields() {
    const tpl = data.template;
    const f = data.fields;
    const labels = LABELS[tpl];
    const hints = HINTS[tpl] || {};
    const nodes = FIELDS[tpl].map((key) => {
      const label = labels[key];
      if (key === 'image_content_id') {
        return field({ label, name: `fields.${key}`, hint: hints[key], control: contentRefField({
          value: f.image_content_id, types: ['image'], pickerTitle: 'Bild für die Info-Folie wählen', disabled: ro,
          onChange: (id) => { f.image_content_id = id; changed(); },
        }) });
      }
      if (key === 'body') {
        return field({ label, name: `fields.${key}`, optional: true, hint: 'Zeilenumbrüche werden übernommen. Kurze Absätze lesen sich auf der Stele besser.', control: textarea({ value: f.body, rows: 5, maxLength: 2000, disabled: ro, onInput: (v) => { f.body = v; changed(); } }) });
      }
      if (key === 'items') {
        return field({ label, name: `fields.${key}`, hint: hints.items, control: textarea({
          value: (f.items || []).join('\n'), rows: 6, disabled: ro,
          onInput: (v) => { f.items = v.split('\n').map((s) => s.trim()).filter(Boolean); changed(); },
        }) });
      }
      if (key === 'date') {
        return field({ label, name: `fields.${key}`, control: input({ type: 'date', value: /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? f.date : '', disabled: ro, onInput: (v) => { f.date = v; changed(); } }) });
      }
      if (key === 'title' && tpl === 'statement') {
        return field({ label, name: `fields.${key}`, required: true, control: textarea({ value: f.title, rows: 3, maxLength: 300, disabled: ro, onInput: (v) => { f.title = v; changed(); } }) });
      }
      return field({
        label, name: `fields.${key}`, hint: hints[key], required: key === 'title', optional: key !== 'title',
        control: input({ value: f[key] || '', maxLength: key === 'title' ? 200 : (['audience', 'admission'].includes(key) ? 120 : 160), disabled: ro, onInput: (v) => { f[key] = v; changed(); } }),
      });
    });
    const keep = document.activeElement && fieldsBox.contains(document.activeElement);
    fill(fieldsBox, ...nodes);
    if (keep) fieldsBox.querySelector('input, textarea, button')?.focus();
  }

  // ---------- QR-Code (alle Vorlagen) ----------
  const qrUrlIn = input({ type: 'url', value: data.fields.qr_url || '', maxLength: 500, placeholder: 'https://…', disabled: ro, onInput: (v) => { data.fields.qr_url = v.trim(); changed(); } });
  const qrLabelIn = input({ value: data.fields.qr_label || '', maxLength: 80, disabled: ro, onInput: (v) => { data.fields.qr_label = v; changed(); } });

  // ---------- Gestaltung ----------
  const s = data.style;
  const contrast = contrastWarning();
  const bgColor = colorChoice({ label: 'Hintergrundfarbe', value: s.bg_color, onChange: (v) => { s.bg_color = v; changed(); } });
  const textColor = colorChoice({ label: 'Textfarbe', value: s.text_color, onChange: (v) => { s.text_color = v; changed(); } });
  const accentColor = colorChoice({ label: 'Akzentfarbe', value: s.accent_color, onChange: (v) => { s.accent_color = v; changed(); } });
  const overlayOut = h('output', {}, `${Math.round(s.overlay * 100)} %`);
  const overlayIn = h('input', { type: 'range', min: '0', max: '0.8', step: '0.05', value: String(s.overlay), disabled: ro, 'aria-label': 'Abdunklung des Hintergrundbilds' });
  overlayIn.addEventListener('input', () => { s.overlay = Number(overlayIn.value); overlayOut.textContent = `${Math.round(s.overlay * 100)} %`; changed(); });
  const overlayField = field({ label: 'Abdunklung', name: 'style.overlay', hint: 'Macht Text über dem Bild besser lesbar (empfohlen ab 40 %).', control: h('div', { class: 'cu-range' }, overlayIn, overlayOut) });
  overlayField.hidden = !s.bg_image_content_id;
  const bgImage = contentRefField({
    value: s.bg_image_content_id, types: ['image'], pickerTitle: 'Hintergrundbild wählen', emptyLabel: 'Kein Hintergrundbild', disabled: ro,
    onChange: (id) => { s.bg_image_content_id = id; overlayField.hidden = !id; changed(); },
  });
  const alignSeg = segmented({ value: s.align, ariaLabel: 'Ausrichtung', options: [{ value: 'left', label: 'Links' }, { value: 'center', label: 'Zentriert' }], onChange: (v) => { s.align = v; changed(); } });
  const sizeSeg = segmented({ value: s.size, ariaLabel: 'Schriftgröße', options: [{ value: 's', label: 'Klein' }, { value: 'm', label: 'Mittel' }, { value: 'l', label: 'Groß' }], onChange: (v) => { s.size = v; changed(); } });
  if (ro) for (const b of [...alignSeg.querySelectorAll('button'), ...sizeSeg.querySelectorAll('button'), ...bgColor.querySelectorAll('input,button'), ...textColor.querySelectorAll('input,button'), ...accentColor.querySelectorAll('input,button')]) b.disabled = true;

  // ---------- Vorschau ----------
  const pv = livePreview({ title: 'Vorschau der Info-Folie' });
  const designSel = select({
    value: designId === null ? '' : String(designId), 'aria-label': 'Rahmen für die Vorschau',
    options: [{ value: '', label: 'Ohne Header und Footer' }, ...designs.map((d) => ({ value: String(d.id), label: d.name }))],
    onChange: (v) => { designId = v ? Number(v) : null; refreshPreview(); },
  });

  function refreshPreview(now = false) {
    const body = {
      settings: null,
      design: designConfig(),
      touch_menu: null,
      items: [{ id: null, content_id: content?.id ?? null, content: { type: 'text', data: previewData() }, enabled: true, duration_s: null, transition: 'none', valid_from: null, valid_until: null, caption: '', options: {} }],
    };
    const pick = (res) => ({ slide: res.slides?.[0] || null, design: res.design, settings: res.settings, view: 'slide' });
    if (now) pv.now(body, pick); else pv.update(body, pick);
  }

  // Leere Überschrift in der Vorschau als Platzhalter zeigen (nur Vorschau, wird nicht gespeichert)
  function previewData() {
    const d = clone(data);
    if (!String(d.fields.title || '').trim()) d.fields.title = LABELS[d.template].title;
    return d;
  }

  function updateContrast() {
    const pairs = [
      { fg: s.text_color, bg: s.bg_color, label: 'Text auf Hintergrundfarbe' },
      { fg: s.accent_color, bg: s.bg_color, label: 'Akzentfarbe auf Hintergrund (Linien, Symbole)', min: 3 },
    ];
    if (s.bg_image_content_id) pairs.push({ fg: s.text_color, bg: darken('#8A8A8A', s.overlay), label: 'Text auf abgedunkeltem Hintergrundbild (Schätzung)' });
    contrast.update(pairs);
  }

  function changed(preview = true) {
    const dirty = isDirty();
    ctx.setDirty(dirty ? 'Die Info-Folie hat ungespeicherte Änderungen.' : false);
    saveState.textContent = dirty ? 'Ungespeicherte Änderungen' : (isNew ? '' : 'Gespeichert');
    saveState.classList.toggle('is-dirty', dirty);
    updateContrast();
    if (preview) refreshPreview();
  }

  // ---------- Speichern ----------
  const formRoot = h('div', { class: 'ts-form' });
  async function save() {
    if (saving || ro) return;
    clearFieldErrors(formRoot);
    const f = data.fields;
    const errs = {};
    if (!String(f.title || '').trim()) errs['fields.title'] = 'Bitte eine Überschrift eingeben.';
    if (data.template === 'image_text' && !f.image_content_id) errs['fields.image_content_id'] = 'Bitte ein Bild auswählen.';
    if (f.qr_url && !/^https?:\/\/\S+$/i.test(f.qr_url)) errs['fields.qr_url'] = 'Bitte eine Adresse eingeben, die mit http:// oder https:// beginnt.';
    if (Object.keys(errs).length) { setFieldErrors(formRoot, errs); toast.error('Bitte die markierten Felder prüfen.'); return; }
    const payload = { title: (title.trim() || String(f.title).trim().split('\n')[0]).slice(0, 120), tags, data: clone(data) };
    saving = true;
    saveBtn.setAttribute('aria-busy', 'true');
    try {
      const res = isNew ? await api.post('/api/contents', { type: 'text', ...payload }) : await api.patch(`/api/contents/${content.id}`, payload);
      ctx.setDirty(false);
      if (isNew) {
        toast.success(`Info-Folie „${res.title}“ angelegt.`);
        ctx.navigate(`/media/text/${res.id}`, { replace: true });
        return;
      }
      content = { ...content, ...res };
      title = res.title;
      titleIn.value = title;
      saved = snapshot();
      header.titleEl.textContent = res.title;
      ctx.setTitle(res.title);
      changed(false);
      toast.success(usages.length ? 'Gespeichert. Auf den Stelen sichtbar nach erneutem Veröffentlichen der Präsentation.' : 'Info-Folie gespeichert.');
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) {
        const mapped = {};
        for (const [k, v] of Object.entries(err.fields)) mapped[k.replace(/^data\./, '')] = v;
        const rest = setFieldErrors(formRoot, mapped);
        toast.error(Object.values(rest)[0] || err.message);
      } else toast.error(errorMessage(err));
    } finally {
      saving = false;
      saveBtn.removeAttribute('aria-busy');
    }
  }

  async function duplicate() {
    if (isDirty() && !(await confirmDialog({ title: 'Ungespeicherte Änderungen', message: 'Die Kopie wird vom zuletzt gespeicherten Stand erstellt. Trotzdem duplizieren?', confirmLabel: 'Duplizieren', icon: 'copy' }))) return;
    try {
      const copy = await api.post(`/api/contents/${content.id}/duplicate`);
      ctx.setDirty(false);
      toast.success(`Kopie „${copy.title}“ angelegt.`);
      ctx.navigate(`/media/text/${copy.id}`);
    } catch (err) { toast.error(errorMessage(err)); }
  }

  async function remove() {
    const ok = await confirmDialog({ title: `„${content.title}“ löschen?`, message: 'Die Info-Folie wird endgültig entfernt.', confirmLabel: 'Info-Folie löschen', danger: true });
    if (!ok) return;
    try {
      await api.del(`/api/contents/${content.id}`);
      ctx.setDirty(false);
      toast.success('Info-Folie gelöscht.');
      ctx.navigate('/media');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await showInUse({ title: 'Info-Folie kann nicht gelöscht werden', message: err.message, usages: err.details?.usages || [] });
      else toast.error(errorMessage(err));
    }
  }

  // ---------- Aufbau ----------
  renderTemplates();
  renderFields();
  formRoot.append(
    card({ title: 'Vorlage', icon: 'layers', body: tplGroup }),
    card({ title: 'Inhalt', icon: 'type', body: h('div', { class: 'form' },
      fieldsBox,
      h('div', { class: 'form-section' },
        field({ label: 'Titel in der Mediathek', name: 'title', optional: true, hint: 'Leer = Überschrift wird verwendet.', control: titleIn }),
        field({ label: 'Schlagworte', name: 'tags', optional: true, control: tagsIn }))) }),
    card({ title: 'QR-Code', icon: 'qr-code', subtitle: 'Für weiterführende Infos, z. B. Anmeldung oder Lageplan', body: h('div', { class: 'form' },
      field({ label: 'Adresse', name: 'fields.qr_url', optional: true, hint: 'Leer = kein QR-Code. Kurze Adressen ergeben einen gröberen, besser scanbaren Code.', control: qrUrlIn }),
      field({ label: 'Beschriftung', name: 'fields.qr_label', optional: true, hint: 'z. B. „Jetzt anmelden“', control: qrLabelIn })) }),
    card({ title: 'Gestaltung', icon: 'palette', body: h('div', { class: 'form' },
      h('div', { class: 'ts-colors' },
        field({ label: 'Hintergrundfarbe', name: 'style.bg_color', control: bgColor }),
        field({ label: 'Textfarbe', name: 'style.text_color', control: textColor }),
        field({ label: 'Akzentfarbe', name: 'style.accent_color', hint: 'Linie, Symbole und Aufzählungspunkte.', control: accentColor })),
      contrast,
      field({ label: 'Hintergrundbild', name: 'style.bg_image_content_id', optional: true, control: bgImage }),
      overlayField,
      h('div', { class: 'form-row' },
        field({ label: 'Ausrichtung', name: 'style.align', control: alignSeg }),
        field({ label: 'Schriftgröße', name: 'style.size', hint: 'Lange Texte werden automatisch verkleinert.', control: sizeSeg }))) }),
  );

  const previewCard = card({
    title: 'Vorschau', icon: 'eye', className: 'ts-preview',
    body: h('div', { class: 'stack' },
      designs.length ? field({ label: 'Rahmen (Design) für die Vorschau', control: designSel, hint: 'Nur für die Vorschau – auf der Stele gilt das Design der Präsentation.' }) : null,
      pv.el),
  });

  fill(root, page({ wide: true, className: 'ts-page' },
    header,
    roAlert,
    usedAlert,
    h('div', { class: 'ts-layout' }, formRoot, h('aside', { class: 'ts-side' }, previewCard)),
  ));
  changed(false);
  saveState.textContent = isNew ? 'Noch nicht gespeichert' : 'Gespeichert';
  refreshPreview(true);

  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('keydown', onKey);
    pv.destroy();
  };
}

/** Standardwerte tief auffüllen (wie merge_defaults des Servers). */
function merge(defaults, value) {
  const out = clone(defaults);
  for (const [k, v] of Object.entries(value || {})) {
    if (!(k in out)) continue;
    if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) && v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge(out[k], v);
    else if (v !== undefined) out[k] = clone(v);
  }
  return out;
}

/** Kleine Skizze je Vorlage (rein dekorativ). */
function tplIllustration(id) {
  const b = (cls) => h('span', { class: `ts-sk__${cls}` });
  const parts = {
    title_text: [b('rule'), b('title'), b('line'), b('line'), b('line short')],
    image_text: [b('img'), b('title'), b('line'), b('line short')],
    statement: [b('quote'), b('title center'), b('line center short')],
    event: [b('badge'), b('title'), b('fact'), b('fact'), b('fact')],
    list: [b('rule'), b('title'), b('bullet'), b('bullet'), b('bullet')],
  };
  return h('span', { class: `ts-sk ts-sk--${id}`, 'aria-hidden': 'true' }, parts[id]);
}
