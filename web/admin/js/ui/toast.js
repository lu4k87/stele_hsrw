// Kurzmeldungen unten rechts. Fehler bleiben länger stehen und werden vorgelesen (role=alert).
//
//   toast.success('Gespeichert.');
//   toast.success('Folie entfernt.', { action: { label: 'Rückgängig', onClick: undo } });
//   toast.error(errorMessage(err));
import { h } from '../dom.js';
import { icon } from '../icons.js';

const ICON = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle', info: 'info' };
const DURATION = { success: 4000, info: 5000, warning: 7000, error: 9000 };

function region() {
  let r = document.getElementById('toast-region');
  if (!r) {
    r = h('div', { id: 'toast-region', class: 'toast-region', role: 'region', 'aria-label': 'Benachrichtigungen' });
    document.body.append(r);
  }
  return r;
}

function show({ message, kind = 'info', duration = null, action = null }) {
  const el = h('div', { class: ['toast', `toast--${kind}`], role: kind === 'error' ? 'alert' : 'status' });
  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 200);
  };
  el.append(
    icon(ICON[kind] || 'info'),
    h('div', { class: 'toast__text' }, message),
    h('div', { class: 'toast__actions' },
      action ? h('button', {
        type: 'button', class: 'btn btn--ghost btn--sm',
        onClick: () => { dismiss(); action.onClick(); },
      }, action.label) : null,
      h('button', { type: 'button', class: 'btn btn--ghost btn--icon btn--sm', 'aria-label': 'Meldung schließen', onClick: dismiss }, icon('x', { size: 16 })),
    ),
  );
  const r = region();
  r.append(el);
  while (r.children.length > 4) r.firstElementChild.remove();
  const ms = duration ?? (action ? 8000 : DURATION[kind]);
  const start = () => { timer = setTimeout(dismiss, ms); };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', start);
  el.addEventListener('focusin', () => clearTimeout(timer));
  start();
  return { dismiss };
}

export const toast = {
  show,
  success: (message, opts = {}) => show({ ...opts, message, kind: 'success' }),
  info: (message, opts = {}) => show({ ...opts, message, kind: 'info' }),
  warning: (message, opts = {}) => show({ ...opts, message, kind: 'warning' }),
  error: (message, opts = {}) => show({ ...opts, message, kind: 'error' }),
};
