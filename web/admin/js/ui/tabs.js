// Registerkarten (WAI-ARIA Tabs, Pfeiltasten). Den Inhalt rendert die Ansicht selbst in onChange.
//
//   const t = tabs({ ariaLabel: 'Stele', items: [{ id: 'overview', label: 'Übersicht', icon: 'activity' }, …],
//                    value: 'overview', onChange: (id) => renderPanel(id) });
//   root.append(t.el, t.panel);   // t.panel ist das zugehörige Tabpanel
import { h, uid } from '../dom.js';
import { icon } from '../icons.js';

export function tabs({ items, value, onChange = null, ariaLabel = null } = {}) {
  const base = uid('tabs');
  let current = value ?? items[0]?.id;
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': ariaLabel });
  const panel = h('div', { class: 'tabs__panel', role: 'tabpanel', tabindex: '0' });
  const buttons = items.map((it) => {
    const b = h('button', {
      type: 'button', role: 'tab', class: 'tabs__tab', id: `${base}-${it.id}`,
      'aria-controls': `${base}-panel`, 'aria-selected': 'false', tabindex: '-1',
    }, it.icon ? icon(it.icon) : null, it.label, it.badge ? h('span', { class: 'badge badge--neutral' }, String(it.badge)) : null);
    b.addEventListener('click', () => select(it.id, true));
    return b;
  });
  panel.id = `${base}-panel`;
  list.append(...buttons);

  function select(id, fire) {
    current = id;
    buttons.forEach((b, i) => {
      const on = items[i].id === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) panel.setAttribute('aria-labelledby', b.id);
    });
    if (fire && onChange) onChange(id);
  }
  list.addEventListener('keydown', (e) => {
    const i = items.findIndex((it) => it.id === current);
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = items.length - 1;
    if (n === null) return;
    e.preventDefault();
    select(items[n].id, true);
    buttons[n].focus();
  });
  select(current, false);
  return { el: list, panel, set: (id) => select(id, false), get value() { return current; } };
}
