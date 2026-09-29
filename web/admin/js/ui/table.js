// Datentabelle mit Sortierung, klickbaren Zeilen und Leerzustand.
//
//   const t = dataTable({
//     caption: 'Benutzer',
//     columns: [
//       { key: 'display_name', label: 'Name', sortable: true, render: (u) => … },
//       { key: 'last_login_at', label: 'Letzte Anmeldung', sortable: true, render: (u) => formatRelative(u.last_login_at) },
//       { key: 'actions', label: 'Aktionen', align: 'actions', headerHidden: true, render: (u) => menuButton(…) },
//     ],
//     rows, onRowClick: (u) => openUser(u), sort: { key: 'display_name', dir: 'asc' },
//     empty: emptyState({ … }),
//   });
//   container.append(t.el);  …  t.update(newRows);
// Ohne onSort sortiert die Tabelle selbst (clientseitig, nach row[key] bzw. column.sortValue(row)).
import { h } from '../dom.js';
import { icon } from '../icons.js';

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

export function dataTable({
  columns,
  rows = [],
  rowKey = 'id',
  onRowClick = null,
  sort = null,
  onSort = null,
  empty = null,
  caption = null,
  rowClass = null,
  className = null,
} = {}) {
  let state = { rows, sort };
  const wrap = h('div', { class: ['table-wrap', className] });

  function sorted() {
    const { sort: s } = state;
    if (!s || onSort) return state.rows;
    const col = columns.find((c) => c.key === s.key);
    const val = (r) => (col?.sortValue ? col.sortValue(r) : r[s.key]);
    const dir = s.dir === 'desc' ? -1 : 1;
    return [...state.rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === vb) return 0;
      if (va === null || va === undefined || va === '') return 1;
      if (vb === null || vb === undefined || vb === '') return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return collator.compare(String(va), String(vb)) * dir;
    });
  }

  function headerCell(col) {
    const s = state.sort;
    const active = s && s.key === col.key;
    const th = h('th', {
      scope: 'col',
      class: [col.align === 'num' && 'is-num', col.align === 'actions' && 'is-actions', col.className],
      style: col.width ? { width: col.width } : null,
      'aria-sort': active ? (s.dir === 'desc' ? 'descending' : 'ascending') : (col.sortable ? 'none' : null),
    });
    const label = col.headerHidden ? h('span', { class: 'visually-hidden' }, col.label) : col.label;
    if (!col.sortable) { th.append(label); return th; }
    const btn = h('button', { type: 'button', class: 'table__sort', title: `Nach „${col.label}“ sortieren` },
      label,
      icon(active ? (s.dir === 'desc' ? 'chevron-down' : 'chevron-up') : 'arrow-up-down', { size: 14 }));
    btn.addEventListener('click', () => {
      const dir = active && s.dir === 'asc' ? 'desc' : 'asc';
      state.sort = { key: col.key, dir };
      if (onSort) onSort(state.sort); else render();
    });
    th.append(btn);
    return th;
  }

  function render() {
    const list = sorted();
    if (!list.length && empty) {
      wrap.replaceChildren(typeof empty === 'function' ? empty() : empty);
      return;
    }
    const tbody = h('tbody');
    for (const row of list) {
      const tr = h('tr', { class: [onRowClick && 'is-clickable', rowClass && rowClass(row)], dataset: { key: row[rowKey] } });
      for (const col of columns) {
        const content = col.render ? col.render(row) : row[col.key];
        tr.append(h(col.rowHeader ? 'th' : 'td', {
          scope: col.rowHeader ? 'row' : null,
          class: [col.align === 'num' && 'is-num', col.align === 'actions' && 'is-actions', col.className],
        }, content ?? '–'));
      }
      if (onRowClick) {
        tr.tabIndex = 0;
        tr.addEventListener('click', (e) => {
          if (e.target.closest('button, a, input, select, textarea, label, [role="menu"]')) return;
          onRowClick(row, e);
        });
        tr.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.target === tr) { e.preventDefault(); onRowClick(row, e); }
        });
      }
      tbody.append(tr);
    }
    const table = h('table', { class: 'table' },
      caption ? h('caption', { class: 'visually-hidden' }, caption) : null,
      h('thead', {}, h('tr', {}, columns.map(headerCell))),
      tbody,
    );
    wrap.replaceChildren(table);
  }

  render();
  return {
    el: wrap,
    update(newRows, opts = {}) {
      state.rows = newRows;
      if (opts.sort) state.sort = opts.sort;
      render();
    },
    setSort(s) { state.sort = s; render(); },
    get rows() { return state.rows; },
  };
}

/** Einfache Seitennavigation: „1–50 von 213“ + Zurück/Weiter. */
export function pager({ offset = 0, limit = 50, total = 0, onChange }) {
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + limit, total);
  return h('div', { class: 'cluster cluster--between', style: { padding: 'var(--sp-3) var(--sp-5)' } },
    h('span', { class: 'text-2 text-sm num' }, `${from}–${to} von ${total}`),
    h('div', { class: 'btn-group' },
      h('button', { type: 'button', class: 'btn btn--secondary btn--sm', disabled: offset <= 0, onClick: () => onChange(Math.max(0, offset - limit)) }, icon('chevron-left', { size: 16 }), 'Zurück'),
      h('button', { type: 'button', class: 'btn btn--secondary btn--sm', disabled: to >= total, onClick: () => onChange(offset + limit) }, 'Weiter', icon('chevron-right', { size: 16 })),
    ),
  );
}
