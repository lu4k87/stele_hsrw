// Protokoll (#/audit): Filter (Suche, Person, Bereich, Aktion, Zeitraum), Einträge als Sätze mit aufklappbaren
// Details, Seitennavigation, CSV-Export. Filter stehen in der URL (teilbar, Zurück-Taste).
import { h, useStyles, initials, mount as fill } from '../dom.js';
import { api } from '../api.js';
import { can } from '../session.js';
import { icon } from '../icons.js';
import { formatDateTime, formatRelative, formatNumber } from '../format.js';
import { page, pageHeader, card, button } from '../ui/page.js';
import { field, input, select, segmented, searchInput } from '../ui/form.js';
import { pager } from '../ui/table.js';
import { chip } from '../ui/status.js';
import { emptyState, errorState, skeletonLines } from '../ui/empty.js';

const LIMIT = 50;
export const ENTITY_TYPES = {
  session: { label: 'Anmeldung', icon: 'log-in' },
  user: { label: 'Benutzer', icon: 'user' },
  role: { label: 'Rolle', icon: 'shield' },
  content: { label: 'Mediathek', icon: 'images' },
  presentation: { label: 'Präsentation', icon: 'presentation' },
  design: { label: 'Design', icon: 'palette' },
  touch_menu: { label: 'Touch-Menü', icon: 'touch' },
  font: { label: 'Schrift', icon: 'type' },
  stele: { label: 'Stele', icon: 'stele' },
  schedule: { label: 'Zeitplan', icon: 'calendar-clock' },
  settings: { label: 'Einstellungen', icon: 'settings' },
};
const ACTIONS = {
  login: 'Anmeldung', login_failed: 'Fehlgeschlagene Anmeldung', logout: 'Abmeldung',
  create: 'Angelegt', update: 'Geändert', delete: 'Gelöscht', publish: 'Veröffentlicht',
  request_review: 'Freigabe angefragt', reject: 'Freigabe abgelehnt', discard: 'Änderungen verworfen',
  pair: 'Gekoppelt', command: 'Befehl gesendet', password_reset: 'Passwort zurückgesetzt', unlock: 'Sperre aufgehoben',
  settings: 'Einstellungen geändert', backup: 'Sicherung heruntergeladen',
};
const DANGER_ACTIONS = new Set(['delete', 'login_failed']);
const PERIODS = [
  { value: 'today', label: 'Heute' },
  { value: '7', label: '7 Tage' },
  { value: '30', label: '30 Tage' },
  { value: 'all', label: 'Alle' },
  { value: 'custom', label: 'Zeitraum' },
];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function periodRange(p) {
  const now = new Date();
  if (p === 'today') return { from: ymd(now), to: null };
  if (p === '7' || p === '30') { const d = new Date(now); d.setDate(d.getDate() - Number(p) + 1); return { from: ymd(d), to: null }; }
  return { from: null, to: null };
}

export default async function mount(root, ctx) {
  await useStyles('/admin/css/views/audit.css');
  const q0 = ctx.query;
  const f = {
    q: q0.q || '', user_id: q0.user_id || '', entity_type: q0.entity_type || '', action: q0.action || '',
    period: PERIODS.some((p) => p.value === q0.period) ? q0.period : '7', from: q0.from || '', to: q0.to || '',
    offset: Math.max(0, Number(q0.offset) || 0),
  };

  const search = searchInput({ value: f.q, placeholder: 'Suchen (Person, Objekt, Text) …', label: 'Protokoll durchsuchen', onInput: (v) => { f.q = v; f.offset = 0; apply(); } });
  search.classList.add('toolbar__search');
  const userSlot = h('div', { class: 'aud-filter' });
  const typeSel = select({ value: f.entity_type, 'aria-label': 'Bereich', options: [{ value: '', label: 'Alle Bereiche' }, ...Object.entries(ENTITY_TYPES).map(([k, v]) => ({ value: k, label: v.label }))], onChange: (v) => { f.entity_type = v; f.offset = 0; apply(); } });
  const actSel = select({ value: f.action, 'aria-label': 'Aktion', options: [{ value: '', label: 'Alle Aktionen' }, ...Object.entries(ACTIONS).map(([k, v]) => ({ value: k, label: v }))], onChange: (v) => { f.action = v; f.offset = 0; apply(); } });
  const fromIn = input({ type: 'date', value: f.from });
  const toIn = input({ type: 'date', value: f.to });
  const custom = h('div', { class: 'aud-custom', hidden: f.period !== 'custom' },
    field({ label: 'Von', control: fromIn }), field({ label: 'Bis einschließlich', control: toIn }));
  fromIn.addEventListener('change', () => { f.from = fromIn.value; f.offset = 0; apply(); });
  toIn.addEventListener('change', () => { f.to = toIn.value; f.offset = 0; apply(); });
  const periodSeg = segmented({ value: f.period, options: PERIODS, ariaLabel: 'Zeitraum', onChange: (v) => { f.period = v; custom.hidden = v !== 'custom'; f.offset = 0; apply(); } });
  const resetBtn = button({ label: 'Filter zurücksetzen', icon: 'x', variant: 'ghost', size: 'sm', onClick: () => reset() });
  const exportBtn = button({ label: 'CSV exportieren', icon: 'download', onClick: () => api.download('/api/audit/export.csv', query(false)) });
  const summary = h('p', { class: 'text-2 text-sm', 'aria-live': 'polite' });
  const listSlot = h('div', {}, card({ body: skeletonLines(8) }));

  root.append(page({},
    pageHeader({ title: 'Protokoll', description: 'Wer hat wann was geändert – alle Änderungen und Anmeldungen.', actions: [exportBtn] }),
    h('div', { class: 'stack stack--sm' },
      h('div', { class: 'toolbar' }, search, userSlot, h('div', { class: 'aud-filter' }, typeSel), h('div', { class: 'aud-filter' }, actSel)),
      h('div', { class: 'toolbar' }, h('span', { class: 'text-2 text-sm' }, 'Zeitraum:'), periodSeg, custom, h('span', { class: 'toolbar__spacer' }), resetBtn)),
    summary, listSlot));

  if (can('users.view')) {
    api.get('/api/users', { signal: ctx.signal }).then((r) => {
      const users = (r.items || []).slice().sort((a, b) => a.display_name.localeCompare(b.display_name, 'de'));
      fill(userSlot, select({ value: f.user_id, 'aria-label': 'Person', options: [{ value: '', label: 'Alle Personen' }, ...users.map((u) => ({ value: u.id, label: u.display_name }))], onChange: (v) => { f.user_id = v; f.offset = 0; apply(); } }));
    }).catch(() => userSlot.remove());
  } else userSlot.remove();

  function query(withPaging = true) {
    const { from, to } = f.period === 'custom' ? { from: f.from || null, to: f.to || null } : periodRange(f.period);
    // Server: JJJJ-MM-TT als Wanduhr in der System-Zeitzone, „to“ einschließlich
    const q = { q: f.q, user_id: f.user_id, entity_type: f.entity_type, action: f.action, from, to };
    if (withPaging) Object.assign(q, { limit: LIMIT, offset: f.offset });
    return q;
  }

  function reset() {
    Object.assign(f, { q: '', user_id: '', entity_type: '', action: '', period: '7', from: '', to: '', offset: 0 });
    search.input.value = ''; typeSel.value = ''; actSel.value = ''; periodSeg.setValue('7'); custom.hidden = true; fromIn.value = ''; toIn.value = '';
    const us = userSlot.querySelector('select'); if (us) us.value = '';
    apply();
  }

  function apply() {
    ctx.setQuery({ q: f.q || null, user_id: f.user_id || null, entity_type: f.entity_type || null, action: f.action || null,
      period: f.period === '7' ? null : f.period, from: f.period === 'custom' ? f.from || null : null, to: f.period === 'custom' ? f.to || null : null, offset: f.offset || null });
    load();
  }

  function entry(a) {
    const et = ENTITY_TYPES[a.entity_type] || { label: a.entity_type, icon: 'info' };
    const who = a.user?.display_name || a.user?.username || 'System';
    const details = a.details && typeof a.details === 'object' ? Object.entries(a.details) : [];
    const val = (v) => (v === null || v === undefined ? '–' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    return h('li', {}, h('details', { class: 'aud-entry' },
      h('summary', { class: 'aud-entry__sum' },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(who)),
        h('span', { class: 'aud-entry__main' },
          h('span', { class: 'aud-entry__text' }, h('strong', {}, who), ` ${a.summary}`),
          h('span', { class: 'aud-entry__meta' },
            h('time', { datetime: a.ts, title: formatDateTime(a.ts) }, `${formatDateTime(a.ts)} · ${formatRelative(a.ts)}`),
            a.ip ? h('span', { class: 'mono' }, `IP ${a.ip}`) : null)),
        h('span', { class: 'aud-entry__chips' },
          chip(DANGER_ACTIONS.has(a.action) ? 'danger' : 'neutral', et.label, et.icon, { size: 'sm' })),
        h('span', { class: 'aud-entry__chev', 'aria-hidden': 'true' }, icon('chevron-down', { size: 18 }))),
      h('div', { class: 'aud-entry__details' }, h('dl', { class: 'meta-list' },
        h('dt', {}, 'Aktion'), h('dd', {}, `${ACTIONS[a.action] || a.action} (${a.action})`),
        h('dt', {}, 'Bereich'), h('dd', {}, et.label),
        a.entity_name ? [h('dt', {}, 'Objekt'), h('dd', {}, `${a.entity_name}${a.entity_id ? ` (Nr. ${a.entity_id})` : ''}`)] : null,
        h('dt', {}, 'Person'), h('dd', {}, a.user ? `${who} (@${a.user.username})` : 'System / nicht angemeldet'),
        h('dt', {}, 'Zeitpunkt'), h('dd', {}, formatDateTime(a.ts)),
        h('dt', {}, 'IP-Adresse'), h('dd', { class: 'mono' }, a.ip || '–'),
        details.map(([k, v]) => [h('dt', {}, k), h('dd', { class: 'aud-val' }, val(v))])))));
  }

  let token = 0;
  async function load() {
    const my = ++token;
    try {
      const r = await api.get('/api/audit', { query: query(), signal: ctx.signal });
      if (my !== token) return;
      const items = r.items || [];
      const total = r.total ?? items.length;
      summary.textContent = total ? `${formatNumber(total)} ${total === 1 ? 'Eintrag' : 'Einträge'}` : '';
      if (!items.length) {
        const filtered = f.q || f.user_id || f.entity_type || f.action || f.period !== 'all';
        fill(listSlot, card({ body: emptyState({ icon: 'scroll', title: filtered ? 'Keine Einträge gefunden' : 'Das Protokoll ist leer',
          text: filtered ? 'Im gewählten Zeitraum passt kein Eintrag zu den Filtern.' : 'Hier erscheinen Anmeldungen und Änderungen, sobald jemand im CMS arbeitet.',
          actions: [filtered ? button({ label: 'Filter zurücksetzen', onClick: reset }) : null] }) }));
        return;
      }
      fill(listSlot, card({ flush: true,
        body: [h('ol', { class: 'aud-list', 'aria-label': 'Protokolleinträge, neueste zuerst' }, items.map(entry)),
          total > LIMIT ? h('div', { class: 'aud-pager' }, pager({ offset: f.offset, limit: LIMIT, total, onChange: (o) => { f.offset = o; apply(); window.scrollTo(0, 0); } })) : null] }));
    } catch (err) {
      if (err.name === 'AbortError' || my !== token) return;
      fill(listSlot, card({ body: errorState({ error: err, onRetry: () => load() }) }));
    }
  }

  await load();
  return undefined;
}
