// Aufklappmenüs (z. B. „⋯ Weitere Aktionen“, Benutzer-Menü) mit Tastatursteuerung.
//
//   menuButton({ label: 'Weitere Aktionen', items: [
//     { label: 'Duplizieren', icon: 'copy', onClick: dup },
//     { separator: true },
//     { label: 'Löschen', icon: 'trash', danger: true, onClick: del },
//   ] })
// Einträge: { label, icon, onClick, href, danger, disabled, hint, checked, heading, separator }
// items darf auch eine Funktion sein (wird beim Öffnen ausgewertet).
import { h } from '../dom.js';
import { icon } from '../icons.js';

let openState = null;

export function closeMenu() {
  if (!openState) return;
  const { menu, anchor, cleanup } = openState;
  openState = null;
  cleanup();
  menu.remove();
  anchor.setAttribute('aria-expanded', 'false');
}

export function openMenu(anchor, items, { align = 'end', focusFirst = true } = {}) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu', tabindex: '-1' });
  const list = typeof items === 'function' ? items() : items;
  for (const it of list.filter(Boolean)) {
    if (it.separator) { menu.append(h('div', { class: 'menu__sep', role: 'separator' })); continue; }
    if (it.heading) { menu.append(h('div', { class: 'menu__label' }, it.heading)); continue; }
    const content = [
      it.icon ? icon(it.icon) : null,
      h('span', { class: 'menu__item-text' }, h('span', {}, it.label), it.hint ? h('span', { class: 'menu__item-hint' }, it.hint) : null),
      it.checked ? h('span', { class: 'menu__check' }, icon('check', { size: 18 })) : null,
    ];
    const cls = ['menu__item', it.danger && 'menu__item--danger'];
    const role = it.checked === undefined ? 'menuitem' : 'menuitemradio';
    const el = it.href && !it.disabled
      ? h('a', { class: cls, role, href: it.href, tabindex: '-1', target: it.target || null, rel: it.target ? 'noopener' : null }, content)
      : h('button', { type: 'button', class: cls, role, tabindex: '-1', disabled: it.disabled, 'aria-checked': it.checked === undefined ? null : String(!!it.checked) }, content);
    el.addEventListener('click', () => {
      closeMenu();
      anchor.focus();
      if (it.onClick) it.onClick();
    });
    menu.append(el);
  }
  document.body.append(menu);

  // Position: unter dem Anker, bei Platzmangel darüber
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = align === 'end' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8 && r.top - mh - 6 > 8) top = r.top - mh - 6;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  anchor.setAttribute('aria-expanded', 'true');
  const itemsEls = () => [...menu.querySelectorAll('.menu__item:not(:disabled)')];
  const onKey = (e) => {
    const els = itemsEls();
    const i = els.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); anchor.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === 'Tab') { closeMenu(); }
  };
  const onDown = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onScroll = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  menu.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', onScroll, true);
  openState = {
    menu, anchor,
    cleanup() {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', onScroll, true);
    },
  };
  if (focusFirst) itemsEls()[0]?.focus(); else menu.focus();
  return menu;
}

export function menuButton({ items, label = 'Weitere Aktionen', iconName = 'more-horizontal', text = null, variant = 'ghost', size = null, align = 'end', className = null } = {}) {
  const btn = h('button', {
    type: 'button',
    class: ['btn', `btn--${variant}`, !text && 'btn--icon', size && `btn--${size}`, className],
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-label': text ? null : label,
    title: text ? null : label,
  }, iconName ? icon(iconName) : null, text, text ? icon('chevron-down', { size: 16 }) : null);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openState && openState.anchor === btn) { closeMenu(); return; }
    openMenu(btn, items, { align });
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(btn, items, { align }); }
  });
  return btn;
}
