// Stelen (#/steles): Karten oder Tabelle, Live-Aktualisierung, Assistent „Stele hinzufügen“ (?add=1).
import { h, useStyles, mount as fill } from '../dom.js';
import { api } from '../api.js';
import { can } from '../session.js';
import { formatRelative, formatDateTime } from '../format.js';
import { page, pageHeader, card, button } from '../ui/page.js';
import { segmented, searchInput } from '../ui/form.js';
import { dataTable } from '../ui/table.js';
import { emptyState, errorState, skeletonGrid } from '../ui/empty.js';
import { steleStatus } from '../ui/status.js';
import { steleCard, nowPlaying } from '../ui/stele-ui.js';
import { openAddSteleWizard } from '../ui/stele-wizard.js';

const VIEW_KEY = 'stelecms.steles.view';
const POLL_MS = 10000;

function readView() { try { return localStorage.getItem(VIEW_KEY) || 'cards'; } catch { return 'cards'; } }
function writeView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch { /* nur Komfort */ } }

export default async function mount(root, ctx) {
  await useStyles('/admin/css/views/steles.css');
  let view = readView();
  let q = ctx.query.q || '';
  let steles = null;
  const cards = new Map();

  const addBtn = can('steles.manage') ? button({ label: 'Stele hinzufügen', icon: 'plus', variant: 'primary', onClick: () => openWizard() }) : null;
  const search = searchInput({ value: q, placeholder: 'Name, Standort oder IP …', label: 'Stelen durchsuchen', onInput: (v) => { q = v; ctx.setQuery({ q: v || null }); render(); } });
  search.classList.add('toolbar__search');
  const viewToggle = segmented({
    value: view, ariaLabel: 'Darstellung',
    options: [{ value: 'cards', label: 'Karten', icon: 'grid' }, { value: 'table', label: 'Tabelle', icon: 'list' }],
    onChange: (v) => { view = v; writeView(v); render(); },
  });
  const status = h('p', { class: 'steles__status text-2 text-sm', 'aria-live': 'polite' });
  const content = h('div', {}, skeletonGrid(2, '320px'));
  const cardsGrid = h('div', { class: 'grid-auto steles__grid', style: { '--grid-min': '320px' } });
  const table = dataTable({
    caption: 'Stelen',
    sort: { key: 'name', dir: 'asc' },
    onRowClick: (s) => ctx.navigate(`/steles/${s.id}`),
    columns: [
      { key: 'name', label: 'Stele', sortable: true, rowHeader: true, render: (s) => h('div', { class: 'stack', style: { '--stack-gap': '0' } },
        h('a', { class: 'table__primary', href: `#/steles/${s.id}` }, s.name), h('span', { class: 'table__secondary' }, s.location || '–')) },
      { key: 'status', label: 'Status', sortable: true, render: (s) => steleStatus(s, { size: 'sm' }) },
      { key: 'now', label: 'Läuft jetzt', render: (s) => nowPlaying(s, { compact: true }) },
      { key: 'default', label: 'Standard-Präsentation', sortable: true, sortValue: (s) => s.default_presentation?.name || '', render: (s) => s.default_presentation?.name || h('span', { class: 'text-2' }, 'nicht festgelegt') },
      { key: 'ip_address', label: 'IP-Adresse', sortable: true, render: (s) => (s.ip_address ? h('span', { class: 'mono' }, s.ip_address) : '–') },
      { key: 'version', label: 'Player', render: (s) => (s.player?.version ? `Version ${s.player.version}` : '–') },
      { key: 'last_seen_at', label: 'Zuletzt gemeldet', sortable: true, render: (s) => (s.last_seen_at ? h('time', { datetime: s.last_seen_at, title: formatDateTime(s.last_seen_at) }, formatRelative(s.last_seen_at)) : 'noch nie') },
    ],
  });

  root.append(page({},
    pageHeader({ title: 'Stelen', description: 'Geräte, auf denen Präsentationen laufen: Zustand, aktuelle Wiedergabe und Einstellungen.', actions: [addBtn] }),
    h('div', { class: 'toolbar' }, search, h('span', { class: 'toolbar__spacer' }), viewToggle),
    status,
    content,
  ));

  function filtered() {
    if (!steles) return [];
    const needle = q.toLowerCase();
    return needle ? steles.filter((s) => [s.name, s.location, s.ip_address].some((v) => (v || '').toLowerCase().includes(needle))) : steles;
  }

  function render() {
    if (!steles) return;
    const list = filtered();
    const online = steles.filter((s) => s.status === 'online').length;
    status.textContent = steles.length ? `${steles.length} ${steles.length === 1 ? 'Stele' : 'Stelen'}, davon ${online} online.` : '';
    if (!steles.length) {
      fill(content, card({ body: emptyState({
        icon: 'stele', title: 'Noch keine Stele eingerichtet',
        text: can('steles.manage') ? 'Eine Stele wird in drei Schritten hinzugefügt: Angaben eintragen, mit dem Player auf dem Stelen-PC koppeln, Standard-Präsentation wählen.' : 'Eine Administratorin oder ein Administrator kann Stelen hinzufügen.',
        actions: [can('steles.manage') ? button({ label: 'Stele hinzufügen', icon: 'plus', variant: 'primary', onClick: () => openWizard() }) : null],
      }) }));
      return;
    }
    if (!list.length) {
      fill(content, card({ body: emptyState({ icon: 'search', title: 'Keine Stele gefunden', text: `Keine Stele passt zu „${q}“.`, actions: [button({ label: 'Suche zurücksetzen', onClick: () => { search.input.value = ''; q = ''; ctx.setQuery({ q: null }); render(); } })] }) }));
      return;
    }
    if (view === 'table') {
      table.update(list);
      if (content.firstChild !== table.el) fill(content, table.el);
      return;
    }
    const ids = new Set(list.map((s) => s.id));
    for (const s of list) {
      const c = cards.get(s.id);
      if (c) c.update(s);
      else { const n = steleCard(s, { showMeta: true }); cards.set(s.id, n); cardsGrid.append(n.el); }
    }
    for (const [id, c] of cards) c.el.hidden = !ids.has(id);
    for (const [id, c] of cards) if (!steles.some((s) => s.id === id)) { c.destroy(); c.el.remove(); cards.delete(id); }
    if (content.firstChild !== cardsGrid) fill(content, cardsGrid);
  }

  let loading = false;
  async function load({ background = false } = {}) {
    if (loading && background) return;   // Polling: kein zweiter Abruf, solange einer läuft
    loading = true;
    try {
      const r = await api.get('/api/steles', { signal: ctx.signal, background });
      steles = r.items || [];
      render();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!background || !steles) fill(content, card({ body: errorState({ error: err, onRetry: () => load() }) }));
    } finally {
      loading = false;
    }
  }

  function openWizard() {
    openAddSteleWizard({
      onCreated: (s) => { load(); ctx.refreshNav(); return s; },
      onOpen: (s) => ctx.navigate(`/steles/${s.id}`),
    });
  }

  await load();
  if (ctx.query.add === '1' && can('steles.manage')) {
    ctx.setQuery({ add: null });
    openWizard();
  }
  const timer = setInterval(() => { if (!document.hidden) load({ background: true }); }, POLL_MS);
  return () => {
    clearInterval(timer);
    for (const c of cards.values()) c.destroy();
  };
}

