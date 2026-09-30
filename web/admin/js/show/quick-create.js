// Vorführseite, Abschnitt 2: Info-Folie gestalten (Live-Vorschau), als Folie in eine neue oder bestehende
// Präsentation legen, optional veröffentlichen. Angelegtes wird gemerkt und lässt sich wieder löschen.
import { h, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can, canAll } from '../session.js';
import { card, button } from '../ui/page.js';
import { field, input, textarea, select, segmented, colorInput, numberInput, switchToggle, setFieldErrors, clearFieldErrors } from '../ui/form.js';
import { confirmDialog } from '../ui/dialog.js';
import { presentationStatus } from '../ui/status.js';
import { emptyState } from '../ui/empty.js';
import { toast } from '../ui/toast.js';
import { livePreview } from '../ui/live-preview.js';
import { itemToPayload, newItem } from '../ui/add-to-presentation.js';
import { formatDate, formatDateTime } from '../format.js';
import { externalLink, showSection } from './common.js';
import { openPlayerDialog } from './tour.js';

const STORE_KEY = 'stelecms.show.created';

const TEMPLATES = [
  { value: 'title_text', label: 'Titel + Text', icon: 'type' },
  { value: 'statement', label: 'Aussage', icon: 'megaphone' },
  { value: 'list', label: 'Liste', icon: 'list' },
  { value: 'event', label: 'Termin', icon: 'calendar' },
];
// Welche Felder je Vorlage sichtbar sind
const VISIBLE = {
  title_text: ['title', 'subtitle', 'body'],
  statement: ['title', 'subtitle'],
  list: ['title', 'items'],
  event: ['title', 'date', 'time', 'location', 'body'],
};
const PALETTES = [
  { label: 'Nachtblau', bg: '#0F2747', text: '#FFFFFF', accent: '#F5B400' },
  { label: 'Hell', bg: '#F4F6F9', text: '#12203A', accent: '#1D4ED8' },
  { label: 'Grün', bg: '#0B3D2E', text: '#FFFFFF', accent: '#7DD3A8' },
  { label: 'Rot', bg: '#7A1020', text: '#FFFFFF', accent: '#FFD166' },
];

function readStore() {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}
function writeStore(list) {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* nur Komfort */ }
}

export function renderQuickCreate({ signal, onCleanup }) {
  const mayCreate = canAll('content.edit', 'presentations.edit');
  const section = (...children) => showSection({
    id: 'anlegen', nr: 2, title: 'Info-Folie und Präsentation anlegen',
    text: 'Folie gestalten, in eine Präsentation legen und im Player ansehen – in einem Schritt.',
  }, ...children);

  if (!mayCreate) {
    return section(card({ body: emptyState({
      icon: 'lock', title: 'Mit dieser Rolle nicht möglich',
      text: 'Zum Anlegen braucht die Rolle die Rechte „Inhalte bearbeiten“ und „Präsentationen bearbeiten“, z. B. Autor, Redaktion oder Administrator.',
    }) }));
  }

  const mayPublish = can('presentations.publish');
  const data = {
    template: 'title_text',
    fields: { title: 'Willkommen', subtitle: 'Digitale Stele im Foyer', body: 'Aktuelle Informationen, Termine und Wegweiser – gepflegt im Stele CMS.', image_content_id: null, date: '', time: '', location: '', items: [] },
    style: { bg_color: '#0F2747', text_color: '#FFFFFF', accent_color: '#F5B400', bg_image_content_id: null, overlay: 0.4, align: 'left', size: 'm' },
  };
  let designs = [];
  let presentations = [];
  let target = 'new';
  let publish = mayPublish;
  let busy = false;

  // ---------- Live-Vorschau ----------
  const pv = livePreview({ title: 'Vorschau der Info-Folie', height: '560px' });
  onCleanup(() => pv.destroy());
  const designSel = select({ value: '', options: [{ value: '', label: 'Ohne Header und Footer' }], onChange: () => refresh() });

  function previewBody() {
    const d = designs.find((x) => String(x.id) === designSel.value);
    return {
      settings: null, design: d ? d.config : null, touch_menu: null,
      items: [{ ...newItem(null), content: { type: 'text', data: cleanData() }, transition: 'none' }],
    };
  }
  const pick = (res) => ({ slide: res.slides?.[0] || null, design: res.design, settings: res.settings, view: 'slide' });
  const refresh = (now = false) => (now ? pv.now(previewBody(), pick) : pv.update(previewBody(), pick));

  // Nur die Felder der gewählten Vorlage übernehmen
  function cleanData() {
    const f = data.fields;
    const vis = VISIBLE[data.template];
    const out = { template: data.template, style: { ...data.style }, fields: { title: '', subtitle: '', body: '', image_content_id: null, date: '', time: '', location: '', items: [] } };
    for (const k of vis) out.fields[k] = k === 'items' ? f.items.filter(Boolean) : f[k];
    return out;
  }

  // ---------- Formular ----------
  const form = h('form', { class: 'form show-create__form', novalidate: true, onSubmit: (e) => { e.preventDefault(); submit(); } });
  const set = (k) => (v) => { data.fields[k] = v; refresh(); };
  const controls = {
    title: field({ label: 'Überschrift', name: 'title', required: true, control: input({ value: data.fields.title, maxLength: 120, onInput: set('title') }) }),
    subtitle: field({ label: 'Unterzeile', name: 'subtitle', optional: true, control: input({ value: data.fields.subtitle, maxLength: 160, onInput: set('subtitle') }) }),
    body: field({ label: 'Text', name: 'body', optional: true, hint: 'Zeilenumbrüche werden übernommen.', control: textarea({ value: data.fields.body, rows: 4, maxLength: 1200, onInput: set('body') }) }),
    items: field({ label: 'Listenpunkte', name: 'items', hint: 'Ein Punkt pro Zeile, höchstens 20.', control: textarea({ value: 'Bibliothek – Gebäude 3\nMensa – Gebäude 1\nStudierendenservice – Gebäude 2', rows: 5, onInput: (v) => set('items')(v.split('\n').map((s) => s.trim()).slice(0, 20)) }) }),
    date: field({ label: 'Datum', name: 'date', control: input({ value: '', placeholder: 'z. B. 15. Oktober 2026', maxLength: 60, onInput: set('date') }) }),
    time: field({ label: 'Uhrzeit', name: 'time', control: input({ value: '', placeholder: 'z. B. 10–16 Uhr', maxLength: 60, onInput: set('time') }) }),
    location: field({ label: 'Ort', name: 'location', control: input({ value: '', placeholder: 'z. B. Hörsaal 1', maxLength: 120, onInput: set('location') }) }),
  };
  data.fields.items = controls.items.querySelector('textarea').value.split('\n');

  const whenRow = h('div', { class: 'form-row' }, controls.date, controls.time);
  const showFields = () => {
    for (const [k, el] of Object.entries(controls)) el.hidden = !VISIBLE[data.template].includes(k);
    whenRow.hidden = data.template !== 'event';
  };

  const tpl = segmented({ value: data.template, ariaLabel: 'Vorlage', options: TEMPLATES, onChange: (v) => {
    data.template = v;
    if (v === 'event' && !data.fields.date) {
      Object.assign(data.fields, { title: 'Tag der offenen Tür', date: '15. Oktober 2026', time: '10–16 Uhr', location: 'Campus, Foyer' });
      for (const k of ['title', 'date', 'time', 'location']) controls[k].querySelector('input').value = data.fields[k];
    }
    showFields();
    refresh();
  } });

  const colors = {
    bg: colorInput({ value: data.style.bg_color, label: 'Hintergrund', onChange: (v) => { data.style.bg_color = v; refresh(); } }),
    text: colorInput({ value: data.style.text_color, label: 'Schrift', onChange: (v) => { data.style.text_color = v; refresh(); } }),
    accent: colorInput({ value: data.style.accent_color, label: 'Akzent', onChange: (v) => { data.style.accent_color = v; refresh(); } }),
  };
  const palettes = h('div', { class: 'cluster', role: 'group', 'aria-label': 'Farbvorschläge' }, PALETTES.map((p) => h('button', {
    type: 'button', class: 'btn btn--secondary btn--sm show-swatch',
    onClick: () => {
      Object.assign(data.style, { bg_color: p.bg, text_color: p.text, accent_color: p.accent });
      colors.bg.setValue(p.bg); colors.text.setValue(p.text); colors.accent.setValue(p.accent);
      refresh();
    },
  }, h('span', { class: 'show-swatch__chip', style: { background: p.bg, borderColor: p.accent }, 'aria-hidden': 'true' }), p.label)));

  const align = segmented({ value: 'left', ariaLabel: 'Ausrichtung', options: [{ value: 'left', label: 'Links' }, { value: 'center', label: 'Mittig' }], onChange: (v) => { data.style.align = v; refresh(); } });
  const size = segmented({ value: 'm', ariaLabel: 'Schriftgröße', options: [{ value: 's', label: 'Klein' }, { value: 'm', label: 'Mittel' }, { value: 'l', label: 'Groß' }], onChange: (v) => { data.style.size = v; refresh(); } });

  // Ziel: neue oder bestehende Präsentation
  const presName = input({ value: `Vorführung ${formatDate(new Date())}`, maxLength: 80 });
  const presSel = select({ value: '', options: [] });
  const duration = numberInput({ value: 10, min: 2, max: 600, unit: 's' });
  const nameField = field({ label: 'Name der Präsentation', name: 'name', required: true, control: presName });
  const existingField = field({ label: 'Präsentation', name: 'presentation', control: presSel, hint: 'Die Folie wird am Ende angehängt.' });
  existingField.hidden = true;
  const targetSeg = segmented({
    value: 'new', ariaLabel: 'Ziel',
    options: [{ value: 'new', label: 'Neue Präsentation', icon: 'plus' }, { value: 'existing', label: 'Bestehende', icon: 'presentation' }],
    onChange: (v) => { target = v; nameField.hidden = v !== 'new'; existingField.hidden = v !== 'existing'; },
  });
  const publishSwitch = mayPublish
    ? switchToggle({ label: 'Direkt veröffentlichen', checked: true, hint: 'Ohne Veröffentlichung bleibt alles ein Entwurf – nur in der Vorschau sichtbar.', onChange: (v) => { publish = v; } })
    : h('div', { class: 'alert alert--neutral' }, icon('info'), h('div', { class: 'alert__body' },
      h('div', { class: 'alert__text' }, 'Diese Rolle darf nicht veröffentlichen. Die Präsentation bleibt ein Entwurf und kann im Editor zur Freigabe eingereicht werden.')));

  const submitBtn = button({ label: 'Folie anlegen', icon: 'plus', variant: 'primary', type: 'submit' });
  const steps = h('ol', { class: 'show-steps-run', 'aria-live': 'polite' });
  steps.hidden = true;

  form.append(
    h('div', { class: 'form-section' },
      h('h3', { class: 'form-section__title' }, 'Inhalt der Folie'),
      h('div', { class: 'stack stack--sm' }, h('span', { class: 'field__label', id: 'show-tpl-label' }, 'Vorlage'), tpl),
      controls.title, controls.subtitle, controls.items,
      whenRow, controls.location, controls.body),
    h('div', { class: 'form-section' },
      h('h3', { class: 'form-section__title' }, 'Gestaltung'),
      palettes,
      h('div', { class: 'form-row' },
        field({ label: 'Hintergrund', control: colors.bg }),
        field({ label: 'Schrift', control: colors.text }),
        field({ label: 'Akzent', control: colors.accent })),
      h('div', { class: 'cluster cluster--lg' },
        h('div', { class: 'stack stack--sm' }, h('span', { class: 'field__label' }, 'Ausrichtung'), align),
        h('div', { class: 'stack stack--sm' }, h('span', { class: 'field__label' }, 'Schriftgröße'), size))),
    h('div', { class: 'form-section' },
      h('h3', { class: 'form-section__title' }, 'Präsentation'),
      targetSeg, nameField, existingField,
      h('div', { class: 'form-row' },
        field({ label: 'Design (Rahmen)', control: designSel, hint: 'Header und Footer um die Folie.' }),
        field({ label: 'Anzeigedauer', control: duration, hint: '2 bis 600 Sekunden.' })),
      publishSwitch),
    h('div', { class: 'cluster show-create__submit' }, submitBtn, h('span', { class: 'text-sm text-2' }, 'Legt Info-Folie und Präsentation wie in der Admin-Oberfläche an.')),
    steps,
  );
  showFields();

  const result = h('div', { class: 'stack' });
  const createdCard = card({ title: 'In dieser Vorführung angelegt', icon: 'history', body: h('div') });

  // ---------- Anlegen ----------
  function stepRow(label) {
    const li = h('li', { class: 'show-run is-pending' }, h('span', { class: 'show-run__icon' }, icon('clock')), h('span', {}, label));
    steps.append(li);
    return {
      run() { li.className = 'show-run is-running'; li.firstChild.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' })); },
      done() { li.className = 'show-run is-done'; li.firstChild.replaceChildren(icon('check-circle')); },
      fail(msg) { li.className = 'show-run is-error'; li.firstChild.replaceChildren(icon('x-circle')); li.append(h('span', { class: 'show-run__msg' }, `– ${msg}`)); },
    };
  }

  async function submit() {
    if (busy) return;
    clearFieldErrors(form);
    const errs = {};
    if (!String(data.fields.title).trim()) errs.title = 'Bitte eine Überschrift eingeben.';
    if (target === 'new' && !presName.value.trim()) errs.name = 'Bitte einen Namen eingeben.';
    if (target === 'existing' && !presSel.value) errs.presentation = 'Bitte eine Präsentation wählen.';
    if (Object.keys(errs).length) { setFieldErrors(form, errs); toast.error('Bitte die markierten Felder prüfen.'); return; }

    busy = true;
    submitBtn.setAttribute('aria-busy', 'true');
    submitBtn.disabled = true;
    steps.replaceChildren();
    steps.hidden = false;
    const sContent = stepRow('Info-Folie in der Mediathek anlegen');
    const sPres = stepRow(target === 'new' ? 'Präsentation anlegen' : 'Präsentation laden');
    const sItem = stepRow('Folie hinzufügen');
    const sPub = publish ? stepRow('Veröffentlichen') : null;
    let current = sContent;
    const record = { at: new Date().toISOString() };
    try {
      sContent.run();
      const title = String(data.fields.title).trim().split('\n')[0].slice(0, 120);
      const content = await api.post('/api/contents', { type: 'text', title, tags: ['Vorführung'], data: cleanData() });
      Object.assign(record, { content_id: content.id, content_title: content.title });
      sContent.done();

      current = sPres; sPres.run();
      let pres;
      if (target === 'new') {
        pres = await api.post('/api/presentations', { name: presName.value.trim(), description: 'Angelegt in der Vorführung.', ...(designSel.value ? { design_id: Number(designSel.value) } : {}) });
        record.presentation_created = true;
      } else {
        pres = await api.get(`/api/presentations/${Number(presSel.value)}`);
        record.presentation_created = false;
      }
      Object.assign(record, { presentation_id: pres.id, presentation_name: pres.name });
      remember(record);
      sPres.done();

      current = sItem; sItem.run();
      const items = (pres.items || []).map(itemToPayload);
      const dur = Number(duration.querySelector('input').value);
      items.push({ ...newItem(content.id), duration_s: Number.isFinite(dur) && dur >= 2 ? Math.min(600, dur) : null });
      pres = await api.put(`/api/presentations/${pres.id}/items`, { items });
      sItem.done();

      if (sPub) {
        current = sPub; sPub.run();
        pres = await api.post(`/api/presentations/${pres.id}/publish`, { note: 'Vorführung' });
        sPub.done();
      }
      toast.success(`Folie „${content.title}“ in „${pres.name}“ angelegt${sPub ? ' und veröffentlicht' : ''}.`);
      showResult(pres, content);
      loadPresentations();
    } catch (err) {
      current.fail(errorMessage(err));
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) {
        const mapped = {};
        for (const [k, v] of Object.entries(err.fields)) mapped[k.replace(/^data\.(fields\.)?/, '')] = v;
        setFieldErrors(form, mapped);
      }
      toast.error(errorMessage(err));
    } finally {
      busy = false;
      submitBtn.removeAttribute('aria-busy');
      submitBtn.disabled = false;
    }
  }

  function showResult(pres, content) {
    fill(result, h('div', { class: 'alert alert--success', role: 'status' }, icon('check-circle'),
      h('div', { class: 'alert__body' },
        h('div', { class: 'alert__title' }, `Fertig: „${pres.name}“`),
        h('div', { class: 'cluster' }, presentationStatus(pres, { size: 'sm' })),
        h('div', { class: 'alert__actions' },
          button({ label: 'Im Player abspielen', icon: 'play', variant: 'secondary', size: 'sm', onClick: () => openPlayerDialog(pres, { source: pres.status === 'draft' ? 'draft' : 'published' }) }),
          externalLink({ href: `/admin/#/presentations/${pres.id}`, label: 'Präsentation bearbeiten', icon: 'pencil', size: 'sm' }),
          externalLink({ href: `/admin/#/media/text/${content.id}`, label: 'Info-Folie bearbeiten', icon: 'text-slide', size: 'sm' })))));
  }

  // ---------- Gemerktes (sessionStorage) ----------
  function remember(rec) {
    const list = readStore();
    list.unshift(rec);
    writeStore(list.slice(0, 20));
    renderCreated();
  }

  function renderCreated() {
    const list = readStore();
    createdCard.hidden = !list.length;
    const mayDelete = can('content.delete');
    fill(createdCard.body, h('ul', { class: 'list show-created' }, list.map((r, i) => h('li', {},
      h('span', { class: 'show-created__icon', 'aria-hidden': 'true' }, icon('text-slide')),
      h('div', { class: 'list__main' },
        h('span', { class: 'list__title' }, r.content_title || 'Info-Folie'),
        h('span', { class: 'list__meta' }, `${r.presentation_created ? 'Neue Präsentation' : 'In'} „${r.presentation_name || '–'}“ · ${formatDateTime(r.at)}`)),
      externalLink({ href: `/admin/#/presentations/${r.presentation_id}`, label: 'Öffnen', size: 'sm', variant: 'ghost' }),
      mayDelete ? button({ label: 'Löschen', icon: 'trash', variant: 'danger-ghost', size: 'sm', onClick: () => removeRecord(r, i) }) : null))));
  }

  async function removeRecord(rec, index) {
    const dropPres = rec.presentation_created && can('presentations.delete');
    const ok = await confirmDialog({
      title: 'Angelegtes löschen?',
      message: dropPres
        ? `Die Info-Folie „${rec.content_title}“ und die Präsentation „${rec.presentation_name}“ werden gelöscht – auch von Stelen, falls sie dort laufen.`
        : `Die Info-Folie „${rec.content_title}“ wird aus „${rec.presentation_name}“ entfernt und gelöscht.`,
      confirmLabel: dropPres ? 'Folie und Präsentation löschen' : 'Folie löschen',
      danger: true,
    });
    if (!ok) return;
    const gone = (e) => e instanceof ApiError && e.status === 404;
    try {
      if (dropPres) {
        await api.del(`/api/presentations/${rec.presentation_id}`).catch((e) => { if (!gone(e)) throw e; });
      } else if (rec.presentation_id) {
        try {
          const p = await api.get(`/api/presentations/${rec.presentation_id}`);
          const items = (p.items || []).filter((it) => it.content?.id !== rec.content_id).map(itemToPayload);
          if (items.length !== (p.items || []).length) await api.put(`/api/presentations/${p.id}/items`, { items });
        } catch (e) { if (!gone(e)) throw e; }
      }
      await api.del(`/api/contents/${rec.content_id}`).catch((e) => { if (!gone(e)) throw e; });
      const list = readStore();
      list.splice(index, 1);
      writeStore(list);
      renderCreated();
      loadPresentations();
      toast.success('Gelöscht.');
    } catch (err) {
      const usages = err?.details?.usages;
      toast.error(usages?.length ? `${errorMessage(err)} Verwendet in: ${usages.map((u) => u.name || u.stele_name).join(', ')}.` : errorMessage(err));
    }
  }

  // ---------- Daten laden ----------
  async function loadPresentations() {
    try {
      const res = await api.get('/api/presentations', { signal });
      presentations = res.items || [];
      const keep = presSel.value;
      fill(presSel, presentations.map((p) => h('option', { value: String(p.id) }, p.name)));
      if (keep && presentations.some((p) => String(p.id) === keep)) presSel.value = keep;
    } catch (err) { if (err?.name !== 'AbortError') toast.error(errorMessage(err)); }
  }
  (async () => {
    try {
      const res = await api.get('/api/designs', { signal });
      designs = res.items || [];
      fill(designSel, h('option', { value: '' }, 'Ohne Header und Footer'), designs.map((d) => h('option', { value: String(d.id) }, d.name)));
      if (designs[0]) designSel.value = String(designs[0].id);
    } catch (err) { if (err?.name !== 'AbortError') toast.error(errorMessage(err)); }
    refresh(true);
  })();
  loadPresentations();
  renderCreated();

  return section(
    h('div', { class: 'split show-create', style: { '--split-side': '420px' } },
      card({ body: form }),
      h('div', { class: 'stack show-create__side' },
        card({ title: 'Live-Vorschau', icon: 'eye', subtitle: 'Änderungen erscheinen sofort – so sieht die Folie auf der Stele aus.', body: pv.el }),
        result,
        createdCard)),
  );
}
