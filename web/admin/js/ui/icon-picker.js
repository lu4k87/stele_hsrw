// Icon-Auswahl für Touch-Kacheln (TILE_ICONS mit deutscher Bezeichnung), Suche + Raster, Pfeiltasten.
//
//   const name = await openIconPicker({ value: tile.icon });   // → 'info' | null (Abbruch)
//   field({ label: 'Icon', control: iconPickerButton({ value, onChange }) })
import { h, mount as fill } from '../dom.js';
import { icon, TILE_ICONS, TILE_ICON_LABELS } from '../icons.js';
import { openDialog } from './dialog.js';
import { searchInput } from './form.js';
import { contentStyles } from './content-common.js';

export const iconLabel = (name) => TILE_ICON_LABELS[name] || name || 'Kein Icon';

export async function openIconPicker({ value = null, title = 'Icon wählen' } = {}) {
  await contentStyles();
  let current = value;
  let q = '';
  const grid = h('div', { class: 'cu-icons', role: 'radiogroup', 'aria-label': 'Icons' });
  const status = h('p', { class: 'text-2 text-sm', role: 'status' });
  let dlg = null;

  function names() {
    const s = q.toLowerCase();
    return TILE_ICONS.filter((n) => !s || n.includes(s) || iconLabel(n).toLowerCase().includes(s));
  }
  function render(focusName = null) {
    const list = names();
    status.textContent = list.length ? `${list.length} Icons` : 'Kein Icon gefunden.';
    const tabTarget = list.includes(current) ? current : list[0];
    fill(grid, ...list.map((n) => h('button', {
      type: 'button', class: 'cu-icon-opt', role: 'radio', 'aria-checked': String(n === current),
      tabindex: n === tabTarget ? '0' : '-1', dataset: { icon: n },
      onClick: () => { current = n; render(n); },
      onDblclick: () => dlg?.close(n),
    }, icon(n), h('span', {}, iconLabel(n)))));
    if (focusName) grid.querySelector(`[data-icon="${CSS.escape(focusName)}"]`)?.focus();
  }
  grid.addEventListener('keydown', (e) => {
    const btns = [...grid.querySelectorAll('.cu-icon-opt')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = Math.max(1, Math.round(grid.clientWidth / (btns[0].offsetWidth + 8)));
    let n = null;
    if (e.key === 'ArrowRight') n = i + 1;
    else if (e.key === 'ArrowLeft') n = i - 1;
    else if (e.key === 'ArrowDown') n = i + cols;
    else if (e.key === 'ArrowUp') n = i - cols;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = btns.length - 1;
    if (n === null) return;
    e.preventDefault();
    n = Math.max(0, Math.min(btns.length - 1, n));
    current = btns[n].dataset.icon;
    render(current);
  });

  dlg = openDialog({
    title,
    size: 'lg',
    content: h('div', { class: 'stack' },
      searchInput({ placeholder: 'z. B. Karte, Café, Termine …', label: 'Icons durchsuchen', onInput: (v) => { q = v; render(); }, delay: 120 }),
      status, grid),
    actions: [
      { label: 'Abbrechen', value: null },
      { label: 'Übernehmen', variant: 'primary', icon: 'check', onClick: () => current || null },
    ],
  });
  render();
  const r = await dlg.result;
  return typeof r === 'string' ? r : null;
}

/** Knopf, der das gewählte Icon zeigt und die Auswahl öffnet. */
export function iconPickerButton({ value = null, onChange = null, disabled = false } = {}) {
  let current = value;
  const btn = h('button', { type: 'button', class: 'btn btn--secondary', disabled, 'aria-haspopup': 'dialog' });
  const paint = () => fill(btn, icon(current || 'help-circle'), h('span', {}, iconLabel(current)), h('span', { class: 'visually-hidden' }, ' – Icon ändern'));
  btn.addEventListener('click', async () => {
    const r = await openIconPicker({ value: current });
    if (r && r !== current) { current = r; paint(); onChange?.(r); }
  });
  paint();
  btn.setValue = (v) => { current = v; paint(); };
  return btn;
}
