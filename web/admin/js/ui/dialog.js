// Dialoge und Schubladen auf Basis von <dialog> (Fokusfalle, Esc, Hintergrund inert).
//
//   const dlg = openDialog({
//     title: 'Präsentation anlegen', description: 'Name und Design wählen.',
//     content: (d) => formNode,            // Node oder Funktion (bekommt das Dialog-Objekt)
//     actions: [
//       { label: 'Abbrechen' },
//       { label: 'Anlegen', variant: 'primary', icon: 'plus', onClick: async (d) => { …; return false /* offen lassen */ } },
//     ],
//   });
//   const ok = await confirmDialog({ title: 'Löschen?', message: '…', confirmLabel: 'Präsentation löschen', danger: true });
import { h, uid, nextFrame } from '../dom.js';
import { icon } from '../icons.js';
import { toast } from './toast.js';
import { errorMessage } from '../api.js';

export function openDialog({
  title,
  description = null,
  content = null,
  actions = [],
  size = 'md',
  dismissible = true,
  closeOnBackdrop = false,
  drawer = false,
  width = null,
  className = null,
  initialFocus = null,
  onClose = null,
} = {}) {
  const titleId = uid('dlg-title');
  const descId = description ? uid('dlg-desc') : null;
  let resolveResult;
  let closed = false;

  const dlg = h('dialog', {
    class: ['dialog', drawer ? 'drawer' : `dialog--${size}`, className],
    'aria-labelledby': titleId,
    'aria-describedby': descId,
    style: drawer && width ? { '--drawer-w': width } : null,
  });
  const body = h('div', { class: 'dialog__body' });
  const footer = h('div', { class: 'dialog__footer' });

  const d = {
    el: dlg,
    body,
    footer,
    result: new Promise((r) => { resolveResult = r; }),
    close(result = null) {
      if (closed) return;
      closed = true;
      try { dlg.close(); } catch { /* bereits geschlossen */ }
      dlg.remove();
      if (onClose) onClose(result);
      resolveResult(result);
    },
    setActions(list) { renderActions(list); },
    setBusy(busy) {
      for (const b of footer.querySelectorAll('button')) b.disabled = busy;
    },
    setTitle(text) { dlg.querySelector(`#${titleId}`).textContent = text; },
  };

  dlg.append(
    h('div', { class: 'dialog__header' },
      h('div', { class: 'dialog__titles' },
        h('h2', { class: 'dialog__title', id: titleId }, title),
        description ? h('p', { class: 'dialog__desc', id: descId }, description) : null,
      ),
      dismissible ? h('button', { type: 'button', class: 'btn btn--ghost btn--icon', 'aria-label': 'Schließen', title: 'Schließen (Esc)', onClick: () => d.close(null) }, icon('x')) : null,
    ),
    body,
  );

  function renderActions(list) {
    footer.replaceChildren();
    if (!list || !list.length) { footer.remove(); return; }
    for (const a of list) {
      const btn = h('button', {
        type: 'button',
        class: ['btn', `btn--${a.variant || 'secondary'}`, a.start && 'dialog__footer-start'],
        disabled: a.disabled,
        dataset: { primary: a.variant === 'primary' || a.variant === 'danger' ? '1' : null },
      }, a.icon ? icon(a.icon) : null, a.label);
      btn.addEventListener('click', async () => {
        if (!a.onClick) { d.close(a.value ?? null); return; }
        btn.setAttribute('aria-busy', 'true');
        d.setBusy(true);
        try {
          const r = await a.onClick(d);
          if (r === false) return;
          if (a.closes !== false) d.close(r === undefined ? (a.value ?? true) : r);
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          btn.removeAttribute('aria-busy');
          if (!closed) d.setBusy(false);
        }
      });
      footer.append(btn);
    }
    if (!footer.isConnected) dlg.append(footer);
  }

  const node = typeof content === 'function' ? content(d) : content;
  if (node) body.append(node);
  renderActions(actions);

  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (dismissible) d.close(null);
  });
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg || !closeOnBackdrop || !dismissible) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) d.close(null);
  });
  // Enter in einfachen Eingabefeldern löst die Hauptaktion aus
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || ['checkbox', 'radio', 'button', 'submit', 'color', 'file'].includes(t.type)) return;
    const primary = footer.querySelector('button[data-primary="1"]:not(:disabled)');
    if (primary) { e.preventDefault(); primary.click(); }
  });

  document.body.append(dlg);
  dlg.showModal();
  nextFrame().then(() => {
    const target = (initialFocus && dlg.querySelector(initialFocus))
      || dlg.querySelector('[autofocus]')
      || body.querySelector('input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      || footer.querySelector('button[data-primary="1"]')
      || dlg.querySelector('.dialog__header button');
    if (target) target.focus();
  });
  return d;
}

export function openDrawer(opts) {
  return openDialog({ closeOnBackdrop: true, ...opts, drawer: true });
}

/** Bestätigung – löst mit true/false auf. */
export function confirmDialog({
  title,
  message = null,
  details = null,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  danger = false,
  icon: iconName = null,
} = {}) {
  const content = h('div', { class: 'stack stack--sm' },
    message ? h('p', { class: 'text-2' }, message) : null,
    details || null,
  );
  const d = openDialog({
    title,
    size: 'sm',
    content,
    actions: [
      { label: cancelLabel, value: false },
      { label: confirmLabel, variant: danger ? 'danger' : 'primary', icon: iconName || (danger ? 'trash' : null), value: true },
    ],
  });
  return d.result.then((r) => r === true);
}

/** Einzeiliges Eingabefeld – löst mit dem Text oder null auf. */
export function promptDialog({
  title,
  label,
  value = '',
  placeholder = '',
  hint = null,
  confirmLabel = 'Übernehmen',
  required = true,
  maxLength = 120,
  multiline = false,
  validate = null,
} = {}) {
  const inputId = uid('prompt');
  const errId = uid('prompt-err');
  const input = multiline
    ? h('textarea', { class: 'textarea', id: inputId, placeholder, maxlength: maxLength, 'aria-describedby': errId })
    : h('input', { class: 'input', id: inputId, type: 'text', placeholder, maxlength: maxLength, autocomplete: 'off', 'aria-describedby': errId });
  input.value = value;
  const err = h('div', { class: 'field__error', id: errId, hidden: true, role: 'alert' });
  const field = h('div', { class: 'field' },
    h('label', { class: 'field__label', for: inputId }, label),
    input,
    hint ? h('div', { class: 'field__hint' }, hint) : null,
    err,
  );
  const d = openDialog({
    title,
    size: 'sm',
    content: field,
    actions: [
      { label: 'Abbrechen', value: null },
      {
        label: confirmLabel,
        variant: 'primary',
        onClick: () => {
          const v = input.value.trim();
          let msg = null;
          if (required && !v) msg = 'Bitte ausfüllen.';
          else if (validate) msg = validate(v);
          if (msg) {
            err.replaceChildren(icon('alert-circle', { size: 16 }), msg);
            err.hidden = false;
            field.classList.add('field--invalid');
            input.focus();
            return false;
          }
          return v;
        },
      },
    ],
  });
  return d.result.then((r) => (typeof r === 'string' ? r : null));
}
