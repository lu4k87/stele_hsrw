// Eigenschaften des Präsentations-Editors: Reiter Folie, Diashow, Rahmen & Touch.
// Zustand bleibt im Editor; env liefert Getter (meta, items, selected …) und Rückrufe (queueSave, renderList …).
import { h, mount as fill } from '../../dom.js';
import { icon } from '../../icons.js';
import { can } from '../../session.js';
import { formatDuration } from '../../format.js';
import { button } from '../../ui/page.js';
import { field, input, numberInput, select, segmented, switchToggle } from '../../ui/form.js';
import { tabs } from '../../ui/tabs.js';
import { contentPreview } from '../../ui/content-common.js';
import { colorChoice } from '../../ui/color-choice.js';
import { contentTypeLabel } from '../../ui/status.js';

export const TRANSITIONS = [
  { value: 'none', label: 'Ohne (harter Schnitt)' },
  { value: 'fade', label: 'Überblenden' },
  { value: 'slide-left', label: 'Schieben nach links' },
  { value: 'slide-up', label: 'Schieben nach oben' },
  { value: 'zoom', label: 'Zoom' },
];
const transitionLabel = (v) => TRANSITIONS.find((t) => t.value === v)?.label || v;
const PAGES_RE = /^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$/;
// Empfehlung der Content-Strategie: Standbild-Folien 5–7 s (Passanten in Bewegung)
export const SLIDE_MAX_S = 7;

/** Meldung direkt an einem Feld zeigen (msg) bzw. entfernen (null) – auch für Dialoge (review-actions.js). */
export function setErr(f, msg) {
  const e = f.querySelector(':scope > .field__error');
  const inp = f.querySelector('input, select, textarea');
  if (!e) return;
  e.hidden = !msg;
  fill(e, ...(msg ? [icon('alert-circle', { size: 16 }), h('span', {}, msg)] : []));
  f.classList.toggle('field--invalid', !!msg);
  if (msg) inp?.setAttribute('aria-invalid', 'true'); else inp?.removeAttribute('aria-invalid');
}

/** Karte „Eigenschaften“ → { el, render() }. */
export function propsPanel(env) {
  const { canEdit, canContentEdit, timezone, designs, menus, designById, menuById, meta, items, selected, selIndex,
    effDuration, queueSave, renderList, renderListTitle, renderPreview, showPreview } = env;
  let tab = 'slide';

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
    if (!it) return h('p', { class: 'text-2' }, items().length ? 'Links eine Folie auswählen, um sie einzustellen.' : 'Noch keine Folien vorhanden.');
    const c = it.content;
    const s = meta().settings;
    const typeRow = h('div', { class: 'pe-props__head' },
      h('span', { class: 'cu-portrait' }, contentPreview(c, { size: 'sm' })),
      h('div', { class: 'pe-props__headtext' },
        h('strong', { class: 'pe-props__title' }, c.title),
        h('span', { class: 'text-2 text-sm' }, `${contentTypeLabel(c.type)} · Folie ${selIndex() + 1} von ${items().length}`),
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
    const s = meta().settings;
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
    const s = meta().settings;
    const d = designById(meta().design_id);
    const m = menuById(meta().touch_menu_id);
    const designSel = select({
      value: meta().design_id === null ? '' : String(meta().design_id), disabled: !canEdit,
      options: [{ value: '', label: 'Ohne Design (kein Header/Footer)' }, ...designs.map((x) => ({ value: String(x.id), label: x.name }))],
      onChange: (v) => { meta().design_id = v ? Number(v) : null; queueSave('meta'); renderProps(); renderPreview(); },
    });
    const menuSel = select({
      value: meta().touch_menu_id === null ? '' : String(meta().touch_menu_id), disabled: !canEdit,
      options: [{ value: '', label: 'Kein Touch-Menü' }, ...menus.map((x) => ({ value: String(x.id), label: x.name }))],
      onChange: (v) => { meta().touch_menu_id = v ? Number(v) : null; queueSave('meta'); renderProps(); },
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

  return { el: propsCard, render: renderProps };
}
