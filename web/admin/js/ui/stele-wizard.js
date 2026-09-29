// Stele hinzufügen (geführter Dialog) und Kopplungs-Bausteine (auch für „Erneut koppeln“ im Stele-Detail).
//
//   openAddSteleWizard({ onCreated(stele), onOpen(stele) })
//   openPairDialog(stele) → Promise<Stele|null>
//   pairingPicker() → { el, getCode(), setError(msg), destroy() }   (wartende Player alle 3 s + Code-Eingabe)
//   resolutionField({ width, height }) → { el, getValue() → {width, height} | null }
import { h, uid, useStyles, mount as fill } from '../dom.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can } from '../session.js';
import { icon } from '../icons.js';
import { formatRelative } from '../format.js';
import { openDialog } from './dialog.js';
import { field, input, select, numberInput, setFieldErrors, clearFieldErrors } from './form.js';
import { toast } from './toast.js';
import { fetchPresentations, presentationOptions, copyField, kioskCommand } from './stele-ui.js';

useStyles('/admin/css/views/stele-wizard.css');

export const RESOLUTIONS = [
  { value: '1080x1920', label: 'Hochformat · 1080 × 1920 (Full HD)', width: 1080, height: 1920 },
  { value: '2160x3840', label: 'Hochformat · 2160 × 3840 (4K)', width: 2160, height: 3840 },
  { value: '1920x1080', label: 'Querformat · 1920 × 1080 (Full HD)', width: 1920, height: 1080 },
  { value: 'custom', label: 'Andere Auflösung …' },
];

const IP_RE = /^[A-Za-z0-9.:-]{1,253}$/;
export function validateIp(v) {
  if (!v) return null;
  return IP_RE.test(v) ? null : 'Bitte eine gültige IP-Adresse (z. B. 192.168.1.50) oder einen Rechnernamen eingeben.';
}

/** Auflösung: Auswahl mit Vorlagen, bei „Andere“ zwei Zahlenfelder. */
export function resolutionField({ width = 1080, height = 1920, disabled = false } = {}) {
  const preset = RESOLUTIONS.find((r) => r.width === width && r.height === height);
  const w = numberInput({ value: width, min: 320, max: 7680, step: 1, unit: 'px', 'aria-label': 'Breite in Pixel', disabled });
  const hgt = numberInput({ value: height, min: 320, max: 7680, step: 1, unit: 'px', 'aria-label': 'Höhe in Pixel', disabled });
  const custom = h('div', { class: 'wiz-res__custom', hidden: !!preset },
    h('span', { class: 'text-sm text-2' }, 'Breite'), w, h('span', { 'aria-hidden': 'true' }, '×'), h('span', { class: 'text-sm text-2' }, 'Höhe'), hgt);
  const sel = select({ value: preset ? preset.value : 'custom', options: RESOLUTIONS, disabled, onChange: (v) => { custom.hidden = v !== 'custom'; } });
  const el = h('div', { class: 'stack stack--sm' }, sel, custom);
  el.select = sel;
  return {
    el,
    control: sel,
    getValue() {
      if (sel.value !== 'custom') { const r = RESOLUTIONS.find((x) => x.value === sel.value); return { width: r.width, height: r.height }; }
      const W = Number(w.input.value);
      const H = Number(hgt.input.value);
      if (!W || !H || W < 320 || H < 320 || W > 7680 || H > 7680) return null;
      return { width: Math.round(W), height: Math.round(H) };
    },
  };
}

function formatCode(code = '') {
  const c = String(code).replace(/\D/g, '');
  return c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}

function deviceText(info = {}) {
  const parts = [];
  if (info.screen?.w) parts.push(`Bildschirm ${info.screen.w} × ${info.screen.h}`);
  const ua = info.user_agent || '';
  const m = ua.match(/(Chrome|Firefox|Edg|Safari)\/(\d+)/);
  if (m) parts.push(`${m[1] === 'Edg' ? 'Edge' : m[1]} ${m[2]}`);
  if (/Windows/.test(ua)) parts.push('Windows'); else if (/Linux/.test(ua)) parts.push('Linux'); else if (/Mac OS/.test(ua)) parts.push('macOS');
  return parts.join(' · ') || 'Unbekanntes Gerät';
}

/** Wartende Player (alle 3 s) zum Anklicken + 6-stelliger Code. */
export function pairingPicker() {
  const codeInput = input({ inputmode: 'numeric', autocomplete: 'off', maxLength: 7, placeholder: '123 456', className: 'wiz-code', name: 'pairing_code' });
  const codeField = field({ label: 'Kopplungscode', control: codeInput, name: 'pairing_code', hint: 'Der sechsstellige Code steht groß auf dem Bildschirm der Stele.' });
  const listLabelId = uid('pend');
  const list = h('div', { class: 'wiz-pending', role: 'radiogroup', 'aria-labelledby': listLabelId });
  const liveNote = h('p', { class: 'wiz-pending__note text-sm text-2', 'aria-live': 'polite' });
  let pending = [];
  let timer = null;
  let stopped = false;

  codeInput.addEventListener('input', () => {
    const digits = codeInput.value.replace(/\D/g, '').slice(0, 6);
    codeInput.value = formatCode(digits);
    renderList();
  });

  function renderList() {
    const current = codeInput.value.replace(/\D/g, '');
    if (!pending.length) {
      fill(list, h('div', { class: 'wiz-pending__empty' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        h('span', {}, 'Warte auf einen Player … Sobald auf dem Stelen-PC die Kopplungsseite geöffnet ist, erscheint er hier.')));
      return;
    }
    fill(list, ...pending.map((p) => {
      const on = p.code === current;
      const b = h('button', { type: 'button', role: 'radio', class: 'wiz-pending__item', 'aria-checked': String(on) },
        icon(on ? 'check-circle' : 'stele', { size: 22 }),
        h('span', { class: 'wiz-pending__text' },
          h('span', { class: 'wiz-pending__code mono' }, formatCode(p.code)),
          h('span', { class: 'text-sm text-2' }, `${deviceText(p.device_info)} · wartet seit ${formatRelative(p.created_at).replace(/^vor /, '')}`)));
      b.addEventListener('click', () => { codeInput.value = formatCode(p.code); clearFieldErrors(el); renderList(); });
      return b;
    }));
  }

  async function poll() {
    if (stopped) return;
    try {
      const r = await api.get('/api/pairing/pending', { background: true });
      pending = r?.items || [];
      liveNote.textContent = pending.length ? `${pending.length} ${pending.length === 1 ? 'Player wartet' : 'Player warten'} auf die Kopplung.` : '';
      renderList();
    } catch (err) {
      liveNote.textContent = `Wartende Player können gerade nicht abgefragt werden: ${errorMessage(err)}`;
    }
    if (!stopped) timer = setTimeout(poll, 3000);
  }
  renderList();
  poll();

  const el = h('div', { class: 'stack' },
    h('div', { class: 'stack stack--sm' }, h('div', { class: 'field__label', id: listLabelId }, 'Wartende Player'), list, liveNote),
    h('div', { class: 'divider-text' }, 'oder Code eingeben'),
    codeField);
  return {
    el,
    getCode: () => codeInput.value.replace(/\D/g, ''),
    setError: (msg) => setFieldErrors(el, { pairing_code: msg }),
    destroy() { stopped = true; clearTimeout(timer); },
  };
}

function pairErrorText(err) {
  if (err instanceof ApiError && err.status === 404) return 'Dieser Code ist unbekannt. Bitte den Code auf der Stele prüfen.';
  if (err instanceof ApiError && err.status === 410) return 'Der Code ist abgelaufen. Die Stele zeigt gleich einen neuen Code an.';
  return errorMessage(err);
}

function instructions() {
  const url = `${location.origin}/player/`;
  return h('ol', { class: 'wiz-steps-help' },
    h('li', {}, 'Auf dem Stelen-PC Chrome öffnen und diese Adresse aufrufen: ', h('code', {}, url)),
    h('li', {}, 'Der Player zeigt einen sechsstelligen Code und erscheint unten als „wartender Player“.'),
    h('li', {}, 'Player anklicken (oder den Code eintippen) – die Stele startet danach von selbst.'));
}

/** Erneut koppeln (Stele-Detail). */
export function openPairDialog(stele) {
  let picker = null;
  const d = openDialog({
    title: `„${stele.name}“ koppeln`,
    description: 'Verbindet einen Player (Chrome auf dem Stelen-PC) mit dieser Stele.',
    size: 'md',
    content: () => { picker = pairingPicker(); return h('div', { class: 'stack' }, instructions(), picker.el); },
    onClose: () => picker?.destroy(),
    actions: [
      { label: 'Abbrechen', value: null },
      {
        label: 'Koppeln', variant: 'primary', icon: 'link',
        onClick: async () => {
          const code = picker.getCode();
          if (code.length !== 6) { picker.setError('Bitte einen wartenden Player wählen oder den sechsstelligen Code eingeben.'); return false; }
          try {
            const s = await api.post(`/api/steles/${stele.id}/pair`, { code });
            toast.success(`„${s.name}“ ist gekoppelt. Die Stele startet in wenigen Sekunden.`);
            return s;
          } catch (err) {
            picker.setError(pairErrorText(err));
            return false;
          }
        },
      },
    ],
  });
  return d.result;
}

/** Geführter Dialog: 1 Angaben · 2 Koppeln · 3 Standard-Präsentation · Fertig. */
export function openAddSteleWizard({ onCreated = null, onOpen = null } = {}) {
  const state = { step: 1, name: '', location: '', ip: '', method: 'code', code: '', presentation: '', created: null };
  let picker = null;
  let presentations = null;

  // Schritt 1
  const nameIn = input({ maxLength: 80, autocomplete: 'off', placeholder: 'z. B. Stele Foyer' });
  const locIn = input({ maxLength: 120, autocomplete: 'off', placeholder: 'z. B. Eingangshalle, links neben dem Empfang' });
  const ipIn = input({ maxLength: 253, autocomplete: 'off', inputmode: 'decimal', placeholder: 'z. B. 192.168.1.50', className: 'mono' });
  const res = resolutionField();
  const step1 = h('div', { class: 'form' },
    field({ label: 'Name', control: nameIn, required: true, name: 'name', hint: 'So erscheint die Stele im CMS und beim Identifizieren.' }),
    field({ label: 'Standort', control: locIn, optional: true, name: 'location' }),
    h('div', { class: 'form-row' },
      field({ label: 'IP-Adresse', control: ipIn, optional: true, name: 'ip_address', hint: 'Für die Erreichbarkeitsprüfung (Ping).' }),
      field({ label: 'Auflösung', control: res.el, name: 'resolution', hint: 'Die Stele ist üblicherweise ein Hochformat-Bildschirm.' })));

  // Schritt 2
  const methodCode = h('input', { type: 'radio', name: uid('m'), value: 'code', checked: true });
  const methodLink = h('input', { type: 'radio', name: methodCode.name, value: 'link' });
  const pickerSlot = h('div');
  const linkNote = h('div', { class: 'alert alert--neutral', hidden: true }, icon('link'),
    h('div', { class: 'alert__body' }, h('div', { class: 'alert__title' }, 'Player-Link nach dem Anlegen'),
      h('div', { class: 'alert__text' }, 'Nach dem Anlegen wird ein persönlicher Player-Link angezeigt. Er wird auf dem Stelen-PC im Chrome-Kiosk geöffnet – ein Code ist dann nicht nötig.')));
  const onMethod = () => {
    state.method = methodLink.checked ? 'link' : 'code';
    pickerSlot.hidden = state.method !== 'code';
    linkNote.hidden = state.method !== 'link';
  };
  methodCode.addEventListener('change', onMethod);
  methodLink.addEventListener('change', onMethod);
  const step2 = h('div', { class: 'stack' },
    h('fieldset', { class: 'wiz-methods' },
      h('legend', { class: 'field__label' }, 'Wie soll die Stele verbunden werden?'),
      h('label', { class: 'wiz-method' }, methodCode, h('span', {}, h('strong', {}, 'Mit Code vom Bildschirm der Stele'), h('span', { class: 'text-sm text-2' }, 'Empfohlen: Player auf dem Stelen-PC öffnen, Code hier wählen.'))),
      h('label', { class: 'wiz-method' }, methodLink, h('span', {}, h('strong', {}, 'Player-Link kopieren'), h('span', { class: 'text-sm text-2' }, 'Link mit Schlüssel direkt im Chrome-Kiosk des Stelen-PCs öffnen.')))),
    pickerSlot, linkNote);

  // Schritt 3
  const presSlot = h('div', {}, h('div', { class: 'loading-block' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Präsentationen werden geladen …'));

  const stepper = h('ol', { class: 'wiz-stepper', 'aria-label': 'Schritte' });
  const stepBody = h('div', { class: 'wiz-body' });
  const STEPS = ['Angaben', 'Koppeln', 'Standard-Präsentation'];

  const d = openDialog({
    title: 'Stele hinzufügen',
    description: 'In drei Schritten zur laufenden Stele.',
    size: 'lg',
    content: h('div', { class: 'stack' }, stepper, stepBody),
    onClose: () => picker?.destroy(),
    actions: [],
  });

  function renderStepper() {
    fill(stepper, ...STEPS.map((label, i) => {
      const n = i + 1;
      const done = state.created || n < state.step;
      const cur = !state.created && n === state.step;
      return h('li', { class: ['wiz-stepper__item', done && 'is-done', cur && 'is-current'], 'aria-current': cur ? 'step' : null },
        h('span', { class: 'wiz-stepper__num', 'aria-hidden': 'true' }, done ? icon('check', { size: 16 }) : String(n)),
        h('span', {}, label, done ? h('span', { class: 'visually-hidden' }, ' (erledigt)') : null));
    }));
  }

  async function loadPresentations() {
    if (presentations) return;
    if (!can('presentations.view')) {
      fill(presSlot, h('div', { class: 'alert alert--neutral' }, icon('info'), h('div', { class: 'alert__body' }, h('div', { class: 'alert__text' }, 'Für die Auswahl fehlt das Recht „Präsentationen ansehen“. Die Standard-Präsentation kann später im Zeitplan festgelegt werden.'))));
      presentations = [];
      return;
    }
    try {
      presentations = await fetchPresentations();
      const sel = select({ value: state.presentation, options: presentationOptions(presentations), onChange: (v) => { state.presentation = v; warn(); } });
      const warnSlot = h('div');
      const warn = () => {
        const p = presentations.find((x) => String(x.id) === String(state.presentation));
        fill(warnSlot, p && p.status === 'draft' ? h('div', { class: 'alert alert--warning' }, icon('alert-triangle'), h('div', { class: 'alert__body' },
          h('div', { class: 'alert__title' }, 'Noch nicht veröffentlicht'),
          h('div', { class: 'alert__text' }, 'Diese Präsentation läuft erst, wenn sie veröffentlicht ist. Bis dahin zeigt die Stele ein Standbild.'))) : '');
      };
      fill(presSlot, h('div', { class: 'form' },
        field({ label: 'Standard-Präsentation', control: sel, optional: true, hint: 'Läuft immer dann, wenn im Zeitplan nichts anderes eingetragen ist.' }),
        warnSlot,
        presentations.length ? null : h('p', { class: 'text-2' }, 'Es gibt noch keine Präsentation. Die Stele zeigt so lange ein Standbild mit Uhrzeit.')));
      warn();
    } catch (err) {
      presentations = null;
      fill(presSlot, h('div', { class: 'alert alert--danger' }, icon('alert-circle'), h('div', { class: 'alert__body' }, h('div', { class: 'alert__text' }, `Präsentationen konnten nicht geladen werden: ${errorMessage(err)}`))));
    }
  }

  function go(step) {
    state.step = step;
    renderStepper();
    if (step === 1) {
      fill(stepBody, step1);
      d.setActions([{ label: 'Abbrechen', value: null }, { label: 'Weiter', variant: 'primary', onClick: () => { if (validate1()) go(2); return false; } }]);
      nameIn.focus();
    } else if (step === 2) {
      if (!picker) { picker = pairingPicker(); fill(pickerSlot, h('div', { class: 'stack' }, instructions(), picker.el)); }
      fill(stepBody, step2);
      d.setActions([
        { label: 'Zurück', icon: 'arrow-left', start: true, onClick: () => { go(1); return false; } },
        { label: 'Weiter', variant: 'primary', onClick: () => {
          if (state.method === 'code') {
            const code = picker.getCode();
            if (code.length !== 6) { picker.setError('Bitte einen wartenden Player wählen oder den sechsstelligen Code eingeben – oder „Player-Link kopieren“ wählen.'); return false; }
            state.code = code;
          } else state.code = '';
          go(3);
          return false;
        } },
      ]);
    } else if (step === 3) {
      fill(stepBody, presSlot);
      loadPresentations();
      d.setActions([
        { label: 'Zurück', icon: 'arrow-left', start: true, onClick: () => { go(2); return false; } },
        { label: 'Stele anlegen', variant: 'primary', icon: 'check', onClick: () => create() },
      ]);
    }
  }

  function validate1() {
    const errors = {};
    state.name = nameIn.value.trim();
    state.location = locIn.value.trim();
    state.ip = ipIn.value.trim();
    if (!state.name) errors.name = 'Bitte einen Namen eingeben.';
    const ipErr = validateIp(state.ip);
    if (ipErr) errors.ip_address = ipErr;
    if (!res.getValue()) errors.resolution = 'Bitte Breite und Höhe zwischen 320 und 7680 Pixel angeben.';
    if (Object.keys(errors).length) { setFieldErrors(step1, errors); return false; }
    clearFieldErrors(step1);
    return true;
  }

  async function create() {
    const r = res.getValue();
    const body = { name: state.name, location: state.location, ip_address: state.ip, width: r.width, height: r.height };
    if (state.presentation) body.default_presentation_id = Number(state.presentation);
    if (state.code) body.pairing_code = state.code;
    let stele;
    try {
      stele = await api.post('/api/steles', body);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410 || err.fields?.pairing_code)) {
        go(2);
        picker.setError(err.fields?.pairing_code || pairErrorText(err));
        return false;
      }
      if (err instanceof ApiError && Object.keys(err.fields || {}).length) {
        const f = err.fields;
        if (f.name || f.location || f.ip_address || f.width || f.height) { go(1); setFieldErrors(step1, { ...f, resolution: f.width || f.height }); return false; }
      }
      throw err;
    }
    picker?.destroy();
    state.created = stele;
    onCreated?.(stele);
    await finish(stele);
    return false;
  }

  async function finish(stele) {
    renderStepper();
    d.setTitle('Stele angelegt');
    let full = stele;
    if (!full.player_url) {
      try { full = await api.get(`/api/steles/${stele.id}`); } catch { /* Link fehlt dann nur */ }
    }
    const paired = full.paired;
    const parts = [
      h('div', { class: ['alert', paired && 'alert--success'] }, icon(paired ? 'check-circle' : 'info'), h('div', { class: 'alert__body' },
        h('div', { class: 'alert__title' }, paired ? `„${full.name}“ ist gekoppelt` : `„${full.name}“ wurde angelegt`),
        h('div', { class: 'alert__text' }, paired
          ? 'Der Player hat seinen Schlüssel erhalten und startet in wenigen Sekunden mit der Wiedergabe.'
          : 'Jetzt noch den Player-Link auf dem Stelen-PC öffnen. Am einfachsten Chrome im Kiosk-Modus mit dem folgenden Aufruf starten.'))),
    ];
    if (!paired && full.player_url) {
      parts.push(copyField({ label: 'Player-Link', value: full.player_url, hint: 'Enthält den geheimen Schlüssel der Stele – nicht öffentlich weitergeben.' }));
      parts.push(copyField({ label: 'Chrome-Kiosk-Aufruf (Linux)', value: kioskCommand(full.player_url), multiline: true, hint: 'Unter Windows „chrome.exe“ statt „google-chrome“ verwenden.' }));
    }
    fill(stepBody, h('div', { class: 'stack' }, parts));
    d.setActions([
      { label: 'Schließen', value: full },
      { label: 'Stele öffnen', variant: 'primary', icon: 'arrow-right', onClick: () => { onOpen?.(full); return full; } },
    ]);
  }

  go(1);
  return d.result;
}
