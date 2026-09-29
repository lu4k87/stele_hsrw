// Formular-Bausteine mit korrekter Beschriftung (label/for, aria-describedby) und Fehleranzeige.
//
//   const name = input({ value: p.name, maxLength: 80 });
//   form.append(field({ label: 'Name', control: name, required: true, name: 'name', hint: 'Wird nur im CMS angezeigt.' }));
//   …
//   catch (e) { setFieldErrors(form, e.fields) }   // Feldfehler der API (name → Meldung)
import { h, uid, debounce } from '../dom.js';
import { icon } from '../icons.js';

/** Feld mit Label, Hinweis und Fehler. name → data-field (für setFieldErrors). */
export function field({ label, control, hint = null, error = null, required = false, optional = false, name = null, className = null, labelHidden = false } = {}) {
  const id = control.id || uid('f');
  const target = control.matches?.('input, select, textarea') ? control : control.querySelector?.('input, select, textarea');
  if (target && !target.id) target.id = id;
  const forId = target ? target.id : id;
  const hintId = hint ? uid('hint') : null;
  const errId = uid('err');
  const describedBy = [hintId, errId].filter(Boolean).join(' ');
  if (target) target.setAttribute('aria-describedby', describedBy);
  if (target && required) target.setAttribute('aria-required', 'true');

  const err = h('div', { class: 'field__error', id: errId, hidden: !error, role: 'alert' });
  const wrap = h('div', { class: ['field', className, error && 'field--invalid'], dataset: { field: name } },
    h('label', { class: ['field__label', labelHidden && 'visually-hidden'], for: forId },
      label,
      required ? h('span', { class: 'field__req', 'aria-hidden': 'true' }, '*') : null,
      optional ? h('span', { class: 'field__opt' }, '(optional)') : null,
    ),
    control,
    hint ? h('div', { class: 'field__hint', id: hintId }, hint) : null,
    err,
  );
  if (error) setError(wrap, error);
  return wrap;
}

function setError(fieldEl, message) {
  const err = fieldEl.querySelector(':scope > .field__error');
  const target = fieldEl.querySelector('input, select, textarea');
  if (!err) return;
  if (message) {
    err.replaceChildren(icon('alert-circle', { size: 16 }), h('span', {}, message));
    err.hidden = false;
    fieldEl.classList.add('field--invalid');
    target?.setAttribute('aria-invalid', 'true');
  } else {
    err.replaceChildren();
    err.hidden = true;
    fieldEl.classList.remove('field--invalid');
    target?.removeAttribute('aria-invalid');
  }
}

/** Feldfehler setzen: { name: 'Meldung' }. Fokus auf das erste fehlerhafte Feld. Liefert nicht zugeordnete Meldungen. */
export function setFieldErrors(root, fields = {}) {
  clearFieldErrors(root);
  const rest = {};
  let first = null;
  for (const [name, msg] of Object.entries(fields || {})) {
    const el = root.querySelector(`.field[data-field="${CSS.escape(name)}"]`);
    if (el) {
      setError(el, msg);
      if (!first) first = el;
    } else {
      rest[name] = msg;
    }
  }
  first?.querySelector('input, select, textarea')?.focus();
  return rest;
}

export function clearFieldErrors(root) {
  for (const el of root.querySelectorAll('.field.field--invalid')) setError(el, null);
}

export function setFieldError(root, name, message) {
  const el = root.querySelector(`.field[data-field="${CSS.escape(name)}"]`);
  if (el) setError(el, message);
}

export function input({ value = '', type = 'text', size = null, onInput = null, onChange = null, className = null, ...attrs } = {}) {
  const el = h('input', { class: ['input', size && `input--${size}`, className], type, ...mapAttrs(attrs) });
  el.value = value ?? '';
  if (onInput) el.addEventListener('input', () => onInput(el.value, el));
  if (onChange) el.addEventListener('change', () => onChange(el.value, el));
  return el;
}

/** Zahl mit Einheit, z. B. numberInput({ value: 10, min: 2, max: 600, unit: 's' }). onInput liefert Number oder null. */
export function numberInput({ value = null, min = null, max = null, step = 1, unit = null, onInput = null, onChange = null, ...attrs } = {}) {
  const el = h('input', { class: 'input num', type: 'number', inputmode: step % 1 === 0 ? 'numeric' : 'decimal', min, max, step, ...mapAttrs(attrs) });
  el.value = value ?? '';
  const read = () => (el.value === '' ? null : Number(el.value));
  if (onInput) el.addEventListener('input', () => onInput(read(), el));
  if (onChange) el.addEventListener('change', () => onChange(read(), el));
  if (!unit) return el;
  const wrap = h('div', { class: 'input-group' }, el, h('span', { class: 'input-group__addon', 'aria-hidden': 'true' }, unit));
  wrap.input = el;
  return wrap;
}

export function textarea({ value = '', rows = 4, onInput = null, onChange = null, className = null, ...attrs } = {}) {
  const el = h('textarea', { class: ['textarea', className], rows, ...mapAttrs(attrs) });
  el.value = value ?? '';
  if (onInput) el.addEventListener('input', () => onInput(el.value, el));
  if (onChange) el.addEventListener('change', () => onChange(el.value, el));
  return el;
}

/** options: [{ value, label, disabled }] oder [{ group: 'Titel', options: [...] }] */
export function select({ value = '', options = [], onChange = null, size = null, className = null, ...attrs } = {}) {
  const el = h('select', { class: ['select', size && `select--${size}`, className], ...mapAttrs(attrs) });
  const opt = (o) => h('option', { value: String(o.value ?? ''), disabled: o.disabled }, o.label);
  for (const o of options) {
    if (o.group) el.append(h('optgroup', { label: o.group }, o.options.map(opt)));
    else el.append(opt(o));
  }
  el.value = String(value ?? '');
  if (onChange) el.addEventListener('change', () => onChange(el.value, el));
  return el;
}

export function checkbox({ label, checked = false, onChange = null, hint = null, disabled = false, name = null } = {}) {
  const inp = h('input', { type: 'checkbox', checked, disabled, name });
  if (onChange) inp.addEventListener('change', () => onChange(inp.checked, inp));
  const el = h('label', { class: ['check', disabled && 'check--disabled'] },
    inp,
    h('span', { class: 'check__text' }, h('span', {}, label), hint ? h('span', { class: 'check__hint' }, hint) : null),
  );
  el.input = inp;
  return el;
}

export function switchToggle({ label, checked = false, onChange = null, hint = null, disabled = false } = {}) {
  const inp = h('input', { type: 'checkbox', role: 'switch', checked, disabled });
  if (onChange) inp.addEventListener('change', () => onChange(inp.checked, inp));
  const el = h('label', { class: 'switch' },
    inp,
    h('span', { class: 'switch__text' }, h('span', { class: 'switch__label' }, label), hint ? h('span', { class: 'switch__hint' }, hint) : null),
  );
  el.input = inp;
  return el;
}

/** Segment-Auswahl (Radiogruppe): options [{ value, label, icon, title }]. */
export function segmented({ value, options, onChange = null, ariaLabel = null, labelledBy = null } = {}) {
  const el = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': ariaLabel, 'aria-labelledby': labelledBy });
  let current = value;
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === value), tabindex: o.value === value ? '0' : '-1', title: o.title || null, dataset: { value: String(o.value) } },
      o.icon ? icon(o.icon) : null, o.label);
    b.addEventListener('click', () => set(o.value, true));
    return b;
  });
  el.append(...buttons);
  function set(v, fire = false) {
    current = v;
    buttons.forEach((b, i) => {
      const on = options[i].value === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (fire && onChange) onChange(v);
  }
  el.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === current);
    const n = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + options.length) % options.length : (i + 1) % options.length;
    set(options[n].value, true);
    buttons[n].focus();
  });
  el.setValue = (v) => set(v, false);
  el.getValue = () => current;
  return el;
}

const HEX = /^#([0-9a-f]{6})$/i;
/** Farbwahl: Farbfeld + Hex-Eingabe. onChange('#RRGGBB'). */
export function colorInput({ value = '#000000', onChange = null, label = 'Farbe' } = {}) {
  const picker = h('input', { type: 'color', 'aria-label': `${label} auswählen` });
  const text = h('input', { class: 'input', type: 'text', maxlength: 7, spellcheck: 'false', autocomplete: 'off', 'aria-label': `${label} als Hex-Wert` });
  const set = (v) => {
    const val = HEX.test(v) ? v.toUpperCase() : '#000000';
    picker.value = val.toLowerCase();
    text.value = val;
  };
  set(value);
  picker.addEventListener('input', () => { text.value = picker.value.toUpperCase(); onChange?.(text.value); });
  text.addEventListener('input', () => {
    let v = text.value.trim();
    if (v && !v.startsWith('#')) v = `#${v}`;
    if (HEX.test(v)) { picker.value = v.toLowerCase(); onChange?.(v.toUpperCase()); }
  });
  text.addEventListener('blur', () => set(picker.value));
  const el = h('div', { class: 'color-field' }, picker, text);
  el.input = text;
  el.setValue = set;
  return el;
}

/** Schlagworte: Enter/Komma fügt hinzu, Rücktaste entfernt das letzte. */
export function tagsInput({ value = [], suggestions = [], onChange = null, placeholder = 'Schlagwort eingeben …', max = 10 } = {}) {
  let tags = [...value];
  const listId = uid('tags');
  const inp = h('input', { type: 'text', placeholder, list: listId, maxlength: 30, 'aria-label': 'Schlagwort hinzufügen' });
  const datalist = h('datalist', { id: listId }, suggestions.map((s) => h('option', { value: s })));
  const el = h('div', { class: 'tags-input' });
  const render = () => {
    el.replaceChildren(
      ...tags.map((t, i) => h('span', { class: 'tag' }, t,
        h('button', { type: 'button', 'aria-label': `Schlagwort „${t}“ entfernen`, onClick: () => { tags.splice(i, 1); render(); onChange?.([...tags]); inp.focus(); } }, icon('x', { size: 14 })))),
      inp, datalist,
    );
    inp.disabled = tags.length >= max;
    inp.placeholder = tags.length >= max ? `Maximal ${max}` : placeholder;
  };
  const add = () => {
    const v = inp.value.trim().replace(/,$/, '');
    inp.value = '';
    if (!v || tags.some((t) => t.toLowerCase() === v.toLowerCase()) || tags.length >= max) return;
    tags.push(v);
    render();
    onChange?.([...tags]);
    inp.focus();
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && !inp.value && tags.length) { tags.pop(); render(); onChange?.([...tags]); }
  });
  inp.addEventListener('change', () => { if (suggestions.includes(inp.value)) add(); });
  inp.addEventListener('blur', () => { if (inp.value.trim()) add(); });
  el.addEventListener('click', (e) => { if (e.target === el) inp.focus(); });
  render();
  el.input = inp;
  el.getValue = () => [...tags];
  return el;
}

/** Suchfeld mit Lupe; onInput wird entprellt (250 ms). */
export function searchInput({ value = '', placeholder = 'Suchen …', label = 'Suchen', onInput = null, delay = 250 } = {}) {
  const inp = h('input', { class: 'input', type: 'search', placeholder, 'aria-label': label, autocomplete: 'off' });
  inp.value = value;
  if (onInput) {
    const fire = debounce(() => onInput(inp.value.trim()), delay);
    inp.addEventListener('input', fire);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fire.flush(); });
  }
  const el = h('div', { class: 'input-icon' }, icon('search'), inp);
  el.input = inp;
  return el;
}

function mapAttrs(attrs) {
  // camelCase-Kurzformen → HTML-Attribute
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'maxLength') out.maxlength = v;
    else if (k === 'minLength') out.minlength = v;
    else if (k === 'readOnly') out.readonly = v;
    else if (k === 'autoComplete') out.autocomplete = v;
    else if (k === 'inputMode') out.inputmode = v;
    else out[k] = v;
  }
  return out;
}
