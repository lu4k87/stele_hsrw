// Sortierbare Listen: Ziehen am Griff (Maus, Stift, Touch – Pointer Events) und Tastatur (Pfeiltasten am Griff).
//
//   list.append(...items.map((it, i) => h('li', { dataset: { sortItem: '' } },
//     gripButton({ label: `„${it.title}“ verschieben` }), …)));
//   const stop = makeSortable(list, { onMove: (from, to) => { move(from, to); render(); }, itemLabel: (i) => items[i].title });
//
// Beim Ziehen wird das Element im DOM mitgeführt; onMove(from, to) meldet die neue Position erst beim Loslassen.
// Die Ansicht rendert danach neu; der Fokus springt auf den Griff an der neuen Position.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { announce, contentStyles } from './content-common.js';

const ITEM = '[data-sort-item]';
const HANDLE = '[data-sort-handle]';

/** Griff-Knopf: ziehen oder mit Pfeiltasten verschieben. */
export function gripButton({ label = 'Verschieben', disabled = false } = {}) {
  return h('button', {
    type: 'button', class: 'cu-grip', dataset: { sortHandle: '' }, disabled,
    'aria-label': `${label} (Pfeiltasten nach oben/unten)`, title: 'Ziehen oder Pfeiltasten zum Verschieben',
  }, icon('grip', { size: 18 }));
}

export function makeSortable(container, { onMove, itemLabel = null, disabled = () => false } = {}) {
  contentStyles();
  let drag = null;

  const items = () => [...container.querySelectorAll(`:scope > ${ITEM}`)];
  const indexOf = (el) => items().indexOf(el);

  function focusHandleAt(index) {
    requestAnimationFrame(() => {
      const el = items()[index];
      el?.querySelector(HANDLE)?.focus();
    });
  }

  function say(to, total) {
    const name = itemLabel ? itemLabel(to) : null;
    announce(`${name ? `„${name}“ ` : ''}jetzt an Position ${to + 1} von ${total}.`);
  }

  function onKeyDown(e) {
    const handle = e.target.closest?.(HANDLE);
    if (!handle || disabled()) return;
    const item = handle.closest(ITEM);
    if (!item || item.parentElement !== container) return;
    const from = indexOf(item);
    const total = items().length;
    let to = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = from - 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = from + 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = total - 1;
    if (to === null) return;
    e.preventDefault();
    if (to < 0 || to >= total || to === from) return;
    onMove(from, to);
    say(to, total);
    focusHandleAt(to);
  }

  function onPointerDown(e) {
    const handle = e.target.closest?.(HANDLE);
    if (!handle || handle.disabled || disabled() || e.button > 0) return;
    const item = handle.closest(ITEM);
    if (!item || item.parentElement !== container) return;
    e.preventDefault();
    drag = { item, handle, from: indexOf(item), startY: e.clientY, startX: e.clientX, active: false, pointerId: e.pointerId, lastY: e.clientY };
    // Auf window lauschen: robust, auch wenn der Browser die Zeigererfassung beim Umsortieren verliert
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dy = e.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dy) < 5 && Math.abs(e.clientX - drag.startX) < 5) return;
      drag.active = true;
      drag.item.classList.add('cu-dragging');
      document.documentElement.classList.add('cu-sorting');
    }
    e.preventDefault();
    drag.lastY = e.clientY;
    reorderAt(e.clientY);
    autoScroll(e.clientY);
  }

  // Zielposition = Anzahl der übrigen Einträge, deren Mitte oberhalb des Zeigers liegt.
  // Verschoben werden die Nachbarn – das gezogene Element bleibt im DOM stehen (Fokus/Erfassung bleiben erhalten).
  function reorderAt(y) {
    const others = items().filter((el) => el !== drag.item);
    let target = 0;
    for (const el of others) {
      const r = el.getBoundingClientRect();
      if (y > r.top + r.height / 2) target += 1;
    }
    let cur = indexOf(drag.item);
    while (cur < target) {
      const next = items()[cur + 1];
      if (!next) break;
      container.insertBefore(next, drag.item);
      cur += 1;
    }
    while (cur > target) {
      const prev = items()[cur - 1];
      if (!prev) break;
      drag.item.after(prev);
      cur -= 1;
    }
  }

  let scrollRaf = null;
  function autoScroll(y) {
    cancelAnimationFrame(scrollRaf);
    const edge = 60;
    const speed = y < edge ? -12 : y > window.innerHeight - edge ? 12 : 0;
    if (!speed || !drag) return;
    const step = () => {
      if (!drag) return;
      window.scrollBy(0, speed);
      reorderAt(drag.lastY);
      scrollRaf = requestAnimationFrame(step);
    };
    scrollRaf = requestAnimationFrame(step);
  }

  function endDrag(commit) {
    cancelAnimationFrame(scrollRaf);
    if (!drag) return;
    const { item, from, active } = drag;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    item.classList.remove('cu-dragging');
    document.documentElement.classList.remove('cu-sorting');
    drag = null;
    if (!active) return;
    const to = indexOf(item);
    if (!commit || to === from) {
      // Zurück an die alte Stelle (DOM wie vorher), die Ansicht bleibt maßgeblich
      const list = items().filter((el) => el !== item);
      const ref = list[from] || null;
      if (ref) container.insertBefore(item, ref); else list[list.length - 1]?.after(item);
      return;
    }
    onMove(from, to);
    say(to, items().length);
    focusHandleAt(to);
  }
  const onPointerUp = () => endDrag(true);
  const onPointerCancel = () => endDrag(false);

  container.addEventListener('keydown', onKeyDown);
  container.addEventListener('pointerdown', onPointerDown);
  return () => {
    endDrag(false);
    container.removeEventListener('keydown', onKeyDown);
    container.removeEventListener('pointerdown', onPointerDown);
  };
}

/** Array-Element verschieben (liefert dasselbe Array). */
export function moveItem(arr, from, to) {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return arr;
}
