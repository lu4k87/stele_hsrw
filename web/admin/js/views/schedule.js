// Zeitplan (#/schedule?stele=&week=YYYY-MM-DD): Wochenansicht aus /api/schedule/timeline, Liste der Einträge,
// Eintrag anlegen/bearbeiten im Dialog, Standard-Präsentation direkt änderbar. Ohne schedule.edit nur lesen.
import { h, useStyles, uid, mount as fill } from '../dom.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can, canAny } from '../session.js';
import { icon } from '../icons.js';
import { formatDate, formatDays, WEEKDAYS_SHORT, WEEKDAYS_LONG } from '../format.js';
import { page, pageHeader, card, button } from '../ui/page.js';
import { field, input, select, numberInput, switchToggle, setFieldErrors, clearFieldErrors } from '../ui/form.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { menuButton } from '../ui/menu.js';
import { dataTable } from '../ui/table.js';
import { toast } from '../ui/toast.js';
import { chip, presentationStatus } from '../ui/status.js';
import { emptyState, errorState, loadingBlock } from '../ui/empty.js';
import { fetchPresentations, presentationOptions, defaultPresentationPicker } from '../ui/stele-ui.js';

const PALETTE = 8; // Anzahl Farben in schedule.css (--sch-c0 … --sch-c7)

// ---------- Datum/Zeit (Wanduhr in der Zeitzone der Einstellungen) ----------
function todayIn(tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); }
}
function nowMinutesIn(tz) {
  try {
    const parts = new Intl.DateTimeFormat('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const g = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
    return g('hour') * 60 + g('minute');
  } catch { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
}
const parseDay = (s) => new Date(`${s}T00:00:00Z`);
const fmtDay = (d) => d.toISOString().slice(0, 10);
function addDays(s, n) { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return fmtDay(d); }
function mondayOf(s) { const d = parseDay(s); const wd = (d.getUTCDay() + 6) % 7; return addDays(s, -wd); }
const isoWeekday = (s) => ((parseDay(s).getUTCDay() + 6) % 7) + 1;
const toMin = (hhmm) => { const [a, b] = String(hhmm || '0:0').split(':').map(Number); return (a || 0) * 60 + (b || 0); };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const shortDate = (s) => { const [, m, d] = s.split('-'); return `${d}.${m}.`; };

function timeRange(e) {
  const over = toMin(e.end_time) <= toMin(e.start_time) && e.end_time !== '24:00';
  return `${e.start_time}–${e.end_time}${over ? ' (bis Folgetag)' : ''}`;
}
function dateRange(e) {
  if (e.date_from && e.date_until) return `${formatDate(e.date_from)} – ${formatDate(e.date_until)}`;
  if (e.date_from) return `ab ${formatDate(e.date_from)}`;
  if (e.date_until) return `bis ${formatDate(e.date_until)}`;
  return 'dauerhaft';
}

export default async function mount(root, ctx) {
  await useStyles('/admin/css/views/schedule.css');
  const editable = can('schedule.edit');
  const state = {
    tz: 'Europe/Berlin', steles: [], steleId: null, week: null,
    entries: [], defaultPres: null, timeline: null, presentations: null, colors: new Map(),
  };

  const addBtn = editable ? button({ label: 'Eintrag hinzufügen', icon: 'plus', variant: 'primary', onClick: () => openEntry(null) }) : null;
  const steleSel = h('div');
  const weekLabel = h('span', { class: 'sch-weeklabel num', 'aria-live': 'polite' });
  const weekNav = h('div', { class: 'sch-weeknav', role: 'group', 'aria-label': 'Woche wählen' },
    button({ icon: 'chevron-left', ariaLabel: 'Vorherige Woche', onClick: () => setWeek(addDays(state.week, -7)) }),
    button({ label: 'Heute', onClick: () => setWeek(mondayOf(todayIn(state.tz))) }),
    button({ icon: 'chevron-right', ariaLabel: 'Nächste Woche', onClick: () => setWeek(addDays(state.week, 7)) }),
    weekLabel);
  const defaultSlot = h('div', { class: 'sch-default' });
  const weekSlot = h('div', {}, loadingBlock('Zeitplan wird geladen …'));
  const legendSlot = h('div', { class: 'sch-legend' });
  const conflictSlot = h('div');
  const listSlot = h('div');
  const body = h('div', { class: 'stack stack--lg' },
    h('div', { class: 'toolbar' }, steleSel, weekNav),
    card({ title: 'Wochenansicht', icon: 'calendar', subtitle: editable ? 'Auf einen Eintrag klicken, um ihn zu bearbeiten – auf eine freie Stelle, um dort einen neuen anzulegen.' : 'Nur Ansicht – Änderungen erfordern das Recht „Zeitplan und Standard-Präsentation bearbeiten“.', body: h('div', { class: 'stack' }, defaultSlot, conflictSlot, weekSlot, legendSlot) }),
    listSlot);
  root.append(page({ wide: true },
    pageHeader({ title: 'Zeitplan', description: 'Wann welche Präsentation läuft. Ohne passenden Eintrag läuft die Standard-Präsentation der Stele.', actions: [addBtn] }),
    body));

  // ---------- Laden ----------
  try {
    const [settings, steles] = await Promise.all([
      api.get('/api/settings', { signal: ctx.signal }).catch(() => null),
      api.get('/api/steles', { signal: ctx.signal }).then((r) => r.items || []).catch((err) => { if (err.status === 403) return null; throw err; }),
    ]);
    if (settings?.timezone) state.tz = settings.timezone;
    if (steles === null) {
      fill(body, card({ body: emptyState({ icon: 'lock', title: 'Stelen nicht sichtbar', text: 'Um den Zeitplan anzuzeigen, wird zusätzlich das Recht „Stelen ansehen“ benötigt.' }) }));
      return undefined;
    }
    state.steles = steles;
  } catch (err) {
    if (err.name === 'AbortError') return undefined;
    fill(body, card({ body: errorState({ error: err, onRetry: () => ctx.navigate('/schedule', { replace: true, query: ctx.query }) }) }));
    return undefined;
  }
  if (!state.steles.length) {
    fill(body, card({ body: emptyState({ icon: 'stele', title: 'Noch keine Stele', text: 'Ein Zeitplan gehört immer zu einer Stele. Sobald eine Stele eingerichtet ist, lässt sich hier planen, was wann läuft.',
      actions: [can('steles.manage') ? button({ label: 'Stele hinzufügen', icon: 'plus', variant: 'primary', href: '#/steles?add=1' }) : null] }) }));
    if (addBtn) addBtn.hidden = true;
    return undefined;
  }
  const qStele = Number(ctx.query.stele);
  state.steleId = state.steles.some((s) => s.id === qStele) ? qStele : state.steles[0].id;
  state.week = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.week || '') ? mondayOf(ctx.query.week) : mondayOf(todayIn(state.tz));

  if (state.steles.length > 1) {
    const sel = select({ value: state.steleId, options: state.steles.map((s) => ({ value: s.id, label: s.name })), onChange: (v) => { state.steleId = Number(v); ctx.setQuery({ stele: v }); loadAll(); } });
    fill(steleSel, field({ label: 'Stele', control: sel, labelHidden: true }));
    steleSel.className = 'sch-stelesel';
  } else steleSel.remove();

  if (editable || canAny('presentations.view')) {
    fetchPresentations({ signal: ctx.signal }).then((p) => { state.presentations = p; renderDefault(); }).catch(() => { state.presentations = []; });
  }

  function setWeek(w) {
    state.week = w;
    ctx.setQuery({ week: w === mondayOf(todayIn(state.tz)) ? null : w });
    loadTimeline();
  }

  async function loadAll() {
    await Promise.all([loadEntries(), loadTimeline()]);
  }

  async function loadEntries() {
    try {
      const r = await api.get('/api/schedule', { query: { stele_id: state.steleId }, signal: ctx.signal });
      state.entries = r.items || [];
      state.defaultPres = r.default_presentation || null;
      assignColors();
      renderDefault();
      renderList();
      if (state.timeline) renderWeek();
    } catch (err) {
      if (err.name === 'AbortError') return;
      fill(listSlot, card({ body: errorState({ error: err, onRetry: () => loadEntries() }) }));
    }
  }

  let tlToken = 0;
  async function loadTimeline() {
    const token = ++tlToken;
    weekLabel.textContent = `${shortDate(state.week)} – ${formatDate(addDays(state.week, 6))}`;
    try {
      const tl = await api.get('/api/schedule/timeline', { query: { stele_id: state.steleId, from: state.week, days: 7 }, signal: ctx.signal });
      if (token !== tlToken) return;
      state.timeline = tl;
      if (tl.timezone) state.tz = tl.timezone;
      renderWeek();
    } catch (err) {
      if (err.name === 'AbortError' || token !== tlToken) return;
      fill(weekSlot, errorState({ error: err, onRetry: () => loadTimeline() }));
    }
  }

  function assignColors() {
    const ids = [...new Set(state.entries.map((e) => e.presentation?.id).filter(Boolean))].sort((a, b) => a - b);
    for (const pid of ids) if (!state.colors.has(pid)) state.colors.set(pid, state.colors.size % PALETTE);
  }
  const colorOf = (pid) => (state.colors.has(pid) ? state.colors.get(pid) : (state.colors.set(pid, state.colors.size % PALETTE), state.colors.get(pid)));
  const entryById = (id) => state.entries.find((e) => e.id === id);

  // ---------- Standard-Präsentation ----------
  function renderDefault() {
    const cur = state.defaultPres;
    const status = cur ? presentationStatus(cur, { size: 'sm' }) : chip('warning', 'nicht festgelegt', 'alert-triangle', { size: 'sm' });
    const canChange = editable && state.presentations;
    const label = h('span', { class: 'sch-default__label' }, icon('home', { size: 18 }), 'Standard-Präsentation:');
    if (!canChange) {
      fill(defaultSlot, label, h('strong', {}, cur?.name || '–'), status);
      return;
    }
    const picker = defaultPresentationPicker({
      steleId: state.steleId, current: cur, presentations: state.presentations, 'aria-label': 'Standard-Präsentation',
      onSaved: async () => { await loadAll(); ctx.refreshNav(); },
    });
    fill(defaultSlot, label, h('div', { class: 'sch-default__sel' }, picker.select), picker.saveBtn, cur && cur.status === 'draft' ? chip('warning', 'Entwurf – läuft erst nach Veröffentlichung', 'alert-triangle', { size: 'sm' }) : null);
  }

  // ---------- Wochenansicht ----------
  function renderWeek() {
    const tl = state.timeline;
    if (!tl) return;
    const today = todayIn(state.tz);
    const nowMin = nowMinutesIn(state.tz);
    state.nowLine = null;
    state.renderedDay = today;
    const conflictIds = new Set();
    const conflictDays = new Map();
    for (const c of tl.conflicts || []) {
      c.entry_ids.forEach((x) => conflictIds.add(`${c.date}:${x}`));
      conflictDays.set(c.date, [...(conflictDays.get(c.date) || []), c]);
    }
    const axis = h('div', { class: 'sch-axis', 'aria-hidden': 'true' }, h('span', { class: 'sch-axis__spacer' }),
      h('div', { class: 'sch-axis__ticks' }, [0, 3, 6, 9, 12, 15, 18, 21, 24].map((hr) => h('span', { style: { left: `${(hr / 24) * 100}%` } }, `${hr}`))));
    const rows = tl.days.map((day) => {
      const isToday = day.date === today;
      const wd = day.weekday || isoWeekday(day.date);
      const segs = day.segments.map((sg) => segment(day, sg, conflictIds));
      const track = h('div', { class: 'sch-track' }, h('div', { class: 'sch-grid', 'aria-hidden': 'true' }), segs,
        isToday ? (state.nowLine = h('div', { class: 'sch-now', style: { left: `${(nowMin / 1440) * 100}%` }, title: `Jetzt (${toHHMM(nowMin)})` }, h('span', { class: 'visually-hidden' }, `Jetzt, ${toHHMM(nowMin)} Uhr`))) : null);
      if (editable) {
        track.addEventListener('click', (e) => {
          if (e.target !== track && !e.target.classList.contains('sch-grid')) return;
          const r = track.getBoundingClientRect();
          newAt(day.date, Math.floor(((e.clientX - r.left) / r.width) * 24) * 60);
        });
      }
      const conflicts = conflictDays.get(day.date);
      return h('li', { class: ['sch-day', isToday && 'is-today'] },
        h('div', { class: 'sch-day__label' },
          h('span', { class: 'sch-day__wd' }, WEEKDAYS_SHORT[wd - 1]),
          h('span', { class: 'sch-day__date num' }, shortDate(day.date)),
          isToday ? h('span', { class: 'visually-hidden' }, ' (heute)') : null,
          conflicts ? h('span', { class: 'sch-day__warn', title: conflicts.map((c) => c.message).join('\n') }, icon('alert-triangle', { size: 16 }), h('span', { class: 'visually-hidden' }, ' Konflikt')) : null),
        track);
    });
    fill(weekSlot, h('div', { class: 'sch-week' }, axis, h('ol', { class: 'sch-days', 'aria-label': `Woche ${shortDate(state.week)} bis ${shortDate(addDays(state.week, 6))}, Zeitzone ${state.tz}` }, rows)));

    const conflicts = tl.conflicts || [];
    const uniq = [...new Map(conflicts.map((c) => [c.entry_ids.join('-'), c])).values()];
    conflictSlot.hidden = !uniq.length;
    fill(conflictSlot, uniq.length ? h('div', { class: 'alert alert--warning' }, icon('alert-triangle'), h('div', { class: 'alert__body' },
      h('div', { class: 'alert__title' }, uniq.length === 1 ? 'Überschneidung mit gleicher Priorität' : `${uniq.length} Überschneidungen mit gleicher Priorität`),
      h('ul', { class: 'alert__text sch-conflicts' }, uniq.slice(0, 5).map((c) => h('li', {}, c.message))),
      h('div', { class: 'alert__text' }, 'Tipp: einem der Einträge eine höhere Priorität geben, damit eindeutig ist, was läuft.'))) : '');

    // Legende: sichtbare Präsentationen
    const seen = new Map();
    for (const d of tl.days) for (const sg of d.segments) if (sg.source === 'schedule' && sg.presentation) seen.set(sg.presentation.id, sg.presentation.name);
    fill(legendSlot, 
      ...[...seen].map(([pid, name]) => h('span', { class: 'sch-key' }, h('span', { class: 'sch-key__sw', style: { '--sch-c': `var(--sch-c${colorOf(pid)})` } }), name)),
      h('span', { class: 'sch-key' }, h('span', { class: 'sch-key__sw sch-key__sw--default' }), 'Standard-Präsentation'),
      h('span', { class: 'sch-key' }, h('span', { class: 'sch-key__sw sch-key__sw--none' }), 'Standbild (nichts geplant)'),
      h('span', { class: 'sch-key' }, icon('alert-triangle', { size: 16 }), 'Konflikt / nicht veröffentlicht'),
      h('span', { class: 'sch-key text-2' }, `Zeitzone: ${state.tz}`));
  }

  function segment(day, sg, conflictIds) {
    const a = toMin(sg.start);
    const b = sg.end === '24:00' ? 1440 : toMin(sg.end) || 1440;
    const style = { left: `${(a / 1440) * 100}%`, width: `${((b - a) / 1440) * 100}%` };
    const unpublished = (sg.unpublished_entry_ids || []).length > 0;
    const conflict = sg.entry_id && conflictIds.has(`${day.date}:${sg.entry_id}`);
    const entry = sg.entry_id ? entryById(sg.entry_id) : null;
    let cls = 'sch-seg';
    let text;
    if (sg.source === 'schedule') {
      cls += ' sch-seg--entry';
      style['--sch-c'] = `var(--sch-c${colorOf(sg.presentation?.id)})`;
      const pname = sg.presentation?.name || 'Präsentation';
      text = entry?.label && entry.label !== pname ? `${entry.label} · ${pname}` : pname;
    } else if (sg.source === 'default') {
      cls += ' sch-seg--default';
      text = sg.presentation?.name || 'Standard';
    } else {
      cls += ' sch-seg--none';
      text = 'Standbild';
    }
    if (conflict || unpublished) cls += ' is-warn';
    const kind = sg.source === 'schedule' ? 'Zeitplan' : sg.source === 'default' ? 'Standard-Präsentation' : 'nichts geplant, Standbild';
    const extra = [conflict ? 'Konflikt mit gleicher Priorität' : null, unpublished ? 'ein Eintrag hier ist nicht veröffentlicht und wird übersprungen' : null].filter(Boolean).join(', ');
    const label = `${WEEKDAYS_LONG[(day.weekday || isoWeekday(day.date)) - 1]} ${shortDate(day.date)}, ${sg.start}–${sg.end}: ${sg.source === 'none' ? 'Standbild' : text} (${kind}${extra ? `; ${extra}` : ''})`;
    const content = [(conflict || unpublished) ? icon('alert-triangle', { size: 14 }) : null, h('span', { class: 'sch-seg__text' }, text)];
    if (!editable) return h('div', { class: cls, style, title: label, role: 'img', 'aria-label': label }, content);
    const btn = h('button', { type: 'button', class: cls, style, title: label, 'aria-label': sg.source === 'schedule' ? `${label}. Bearbeiten` : `${label}. Neuen Eintrag anlegen` }, content);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sg.source === 'schedule' && entry) { openEntry(entry); return; }
      // Freie Stelle: Stunde unter dem Mauszeiger (Tastatur: Beginn des Abschnitts)
      let start = a;
      if (e.detail > 0) {
        const r = btn.parentElement.getBoundingClientRect();
        start = Math.max(a, Math.floor(((e.clientX - r.left) / r.width) * 24) * 60);
      }
      newAt(day.date, start, b);
    });
    return btn;
  }

  function newAt(date, startMin, limit = 1440) {
    const s = Math.max(0, Math.min(1380, startMin));
    const e = Math.min(limit > s ? limit : 1440, s + 120);
    openEntry(null, { days: [isoWeekday(date)], start_time: toHHMM(s), end_time: e >= 1440 ? '24:00' : toHHMM(e) });
  }

  // ---------- Liste ----------
  const table = dataTable({
    caption: 'Zeitplan-Einträge',
    sort: { key: 'start_time', dir: 'asc' },
    onRowClick: editable ? (e) => openEntry(e) : null,
    rowClass: (e) => (e.enabled ? null : 'sch-row--off'),
    columns: [
      { key: 'label', label: 'Eintrag', sortable: true, rowHeader: true, sortValue: (e) => e.label || e.presentation?.name, render: (e) => h('div', { class: 'sch-entry' },
        h('span', { class: 'sch-key__sw', style: { '--sch-c': `var(--sch-c${colorOf(e.presentation?.id)})` }, 'aria-hidden': 'true' }),
        h('div', { class: 'stack', style: { '--stack-gap': '2px' } },
          h('span', { class: 'table__primary' }, e.label || e.presentation?.name || '–'),
          h('span', { class: 'cluster', style: { '--cluster-gap': '6px' } }, e.label && e.label !== e.presentation?.name ? h('span', { class: 'table__secondary' }, e.presentation?.name) : null,
            e.presentation?.status && e.presentation.status !== 'published' ? presentationStatus(e.presentation, { size: 'sm' }) : null))) },
      { key: 'days', label: 'Tage', render: (e) => formatDays(e.days) },
      { key: 'start_time', label: 'Uhrzeit', sortable: true, render: (e) => h('span', { class: 'num nowrap' }, timeRange(e)) },
      { key: 'date_from', label: 'Zeitraum', sortable: true, render: (e) => dateRange(e) },
      { key: 'priority', label: 'Priorität', sortable: true, align: 'num' },
      { key: 'enabled', label: 'Aktiv', render: (e) => (editable ? enabledSwitch(e) : (e.enabled ? chip('success', 'aktiv', 'check', { size: 'sm' }) : chip('neutral', 'pausiert', 'pause', { size: 'sm' }))) },
      editable ? { key: 'actions', label: 'Aktionen', align: 'actions', headerHidden: true, render: (e) => menuButton({ label: `Aktionen für „${e.label || e.presentation?.name}“`, items: [
        { label: 'Bearbeiten', icon: 'pencil', onClick: () => openEntry(e) },
        { label: 'Duplizieren', icon: 'copy', onClick: () => openEntry(null, { ...e, id: undefined, label: e.label ? `${e.label} (Kopie)` : '' }) },
        { separator: true },
        { label: 'Löschen', icon: 'trash', danger: true, onClick: () => removeEntry(e) },
      ] }) } : null,
    ].filter(Boolean),
    empty: () => emptyState({ icon: 'calendar-clock', title: 'Noch keine Einträge',
      text: `Ohne Einträge läuft immer die Standard-Präsentation${state.defaultPres ? ` „${state.defaultPres.name}“` : ''}. Einträge legen fest, wann etwas anderes läuft – z. B. werktags morgens ein Begrüßungsprogramm.`,
      actions: [editable ? button({ label: 'Eintrag hinzufügen', icon: 'plus', variant: 'primary', onClick: () => openEntry(null) }) : null] }),
  });

  function enabledSwitch(e) {
    const inp = h('input', { type: 'checkbox', role: 'switch', checked: !!e.enabled, 'aria-label': `„${e.label || e.presentation?.name}“ aktiv` });
    inp.addEventListener('change', async () => {
      inp.disabled = true;
      try {
        await api.patch(`/api/schedule/${e.id}`, { enabled: inp.checked });
        toast.success(inp.checked ? 'Eintrag aktiviert.' : 'Eintrag pausiert – er wird nicht mehr berücksichtigt.');
        await loadAll();
      } catch (err) { inp.checked = !inp.checked; toast.error(errorMessage(err)); } finally { inp.disabled = false; }
    });
    return h('label', { class: 'switch' }, inp, h('span', { class: 'visually-hidden' }, 'aktiv'));
  }

  function renderList() {
    table.update(state.entries);
    if (!listSlot.firstChild) {
      fill(listSlot, card({ title: 'Einträge', icon: 'list', subtitle: 'Bei Überschneidungen gewinnt die höhere Priorität.', flush: true, body: table.el }));
    }
  }

  // ---------- Eintrag-Dialog ----------
  async function openEntry(entry, preset = null) {
    if (!editable) return;
    if (!state.presentations) {
      try { state.presentations = await fetchPresentations({ signal: ctx.signal }); } catch (err) { toast.error(errorMessage(err)); return; }
    }
    if (!state.presentations.length) {
      toast.warning('Es gibt noch keine Präsentation. Bitte zuerst eine Präsentation anlegen.');
      return;
    }
    const src = entry || preset || {};
    const isEdit = !!entry;
    let days = new Set(src.days || [1, 2, 3, 4, 5]);
    const presSel = select({ value: src.presentation?.id ?? src.presentation_id ?? '', options: [{ value: '', label: 'Bitte wählen …' }, ...presentationOptions(state.presentations, { none: null, current: src.presentation })] });
    const labelIn = input({ value: src.label || '', maxLength: 80, placeholder: 'z. B. Werktags morgens' });
    const dayBtns = WEEKDAYS_SHORT.map((d, i) => {
      const b = h('button', { type: 'button', class: 'sch-daybtn', 'aria-pressed': 'false', title: WEEKDAYS_LONG[i] }, d, h('span', { class: 'visually-hidden' }, ` (${WEEKDAYS_LONG[i]})`));
      b.addEventListener('click', () => { if (days.has(i + 1)) days.delete(i + 1); else days.add(i + 1); syncDays(); });
      return b;
    });
    const quick = (label, list) => h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onClick: () => { days = new Set(list); syncDays(); } }, label);
    const daysLabelId = uid('days');
    const daysCtl = h('div', { class: 'stack stack--sm' },
      h('div', { class: 'sch-daybtns', role: 'group', 'aria-labelledby': daysLabelId }, dayBtns),
      h('div', { class: 'cluster' }, h('span', { class: 'text-sm text-2' }, 'Schnellwahl:'), quick('Mo–Fr', [1, 2, 3, 4, 5]), quick('Wochenende', [6, 7]), quick('Täglich', [1, 2, 3, 4, 5, 6, 7])));
    const daysField = h('div', { class: 'field', dataset: { field: 'days' } },
      h('span', { class: 'field__label', id: daysLabelId }, 'Wochentage', h('span', { class: 'field__req', 'aria-hidden': 'true' }, '*')), daysCtl,
      h('div', { class: 'field__error', hidden: true, role: 'alert' }));
    function syncDays() { dayBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(days.has(i + 1)))); }
    syncDays();

    const allDay = switchToggle({ label: 'Ganztägig', checked: src.start_time === '00:00' && src.end_time === '24:00' });
    const startIn = input({ type: 'time', value: src.start_time || '08:00', step: 300 });
    const endIn = input({ type: 'time', value: src.end_time === '24:00' ? '00:00' : (src.end_time || '18:00'), step: 300 });
    const overnightNote = h('p', { class: 'sch-note', role: 'status' });
    const timesRow = h('div', { class: 'form-row' }, field({ label: 'Von', control: startIn, required: true, name: 'start_time' }), field({ label: 'Bis', control: endIn, required: true, name: 'end_time', hint: '00:00 = bis Mitternacht' }));
    function syncTimes() {
      timesRow.hidden = allDay.input.checked;
      const a = toMin(startIn.value);
      const b = toMin(endIn.value);
      if (allDay.input.checked) fill(overnightNote, icon('info', { size: 16 }), 'Gilt an den gewählten Tagen von 00:00 bis 24:00 Uhr.');
      else if (endIn.value === '00:00' && a > 0) fill(overnightNote, icon('info', { size: 16 }), `Läuft von ${startIn.value} bis Mitternacht.`);
      else if (b < a) fill(overnightNote, icon('moon', { size: 16 }), `Über Mitternacht: beginnt an den gewählten Tagen um ${startIn.value} und endet am Folgetag um ${endIn.value} Uhr.`);
      else fill(overnightNote);
    }
    allDay.input.addEventListener('change', syncTimes);
    startIn.addEventListener('input', syncTimes);
    endIn.addEventListener('input', syncTimes);
    syncTimes();

    const fromIn = input({ type: 'date', value: src.date_from || '' });
    const untilIn = input({ type: 'date', value: src.date_until || '' });
    const prioIn = numberInput({ value: src.priority ?? 0, min: 0, max: 100, step: 1 });
    const enabledSw = switchToggle({ label: 'Aktiv', hint: 'Pausierte Einträge bleiben erhalten, werden aber nicht berücksichtigt.', checked: src.enabled !== false });
    const warnSlot = h('div');
    function syncWarn() {
      const p = state.presentations.find((x) => String(x.id) === String(presSel.value));
      fill(warnSlot, p && p.status === 'draft' ? h('div', { class: 'alert alert--warning' }, icon('alert-triangle'), h('div', { class: 'alert__body' },
        h('div', { class: 'alert__title' }, 'Diese Präsentation ist noch nicht veröffentlicht'),
        h('div', { class: 'alert__text' }, 'Der Eintrag wird gespeichert, aber übersprungen, bis die Präsentation veröffentlicht ist. Bis dahin läuft die Standard-Präsentation.'))) : '');
    }
    presSel.addEventListener('change', syncWarn);
    syncWarn();

    const form = h('div', { class: 'form' },
      field({ label: 'Präsentation', control: presSel, required: true, name: 'presentation_id' }),
      warnSlot,
      field({ label: 'Bezeichnung', control: labelIn, optional: true, name: 'label', hint: 'Hilft, den Eintrag in der Liste wiederzufinden.' }),
      daysField,
      h('div', { class: 'stack stack--sm' }, allDay, timesRow, overnightNote),
      h('fieldset', { class: 'sch-fieldset' }, h('legend', { class: 'field__label' }, 'Zeitraum ', h('span', { class: 'field__opt' }, '(optional)')),
        h('div', { class: 'form-row' }, field({ label: 'Ab', control: fromIn, name: 'date_from' }), field({ label: 'Bis einschließlich', control: untilIn, name: 'date_until' })),
        h('p', { class: 'field__hint' }, 'Leer lassen, wenn der Eintrag dauerhaft gelten soll – z. B. für Veranstaltungen nur einen Zeitraum setzen.')),
      field({ label: 'Priorität', control: prioIn, name: 'priority', hint: 'Überschneiden sich Einträge, läuft der mit der höheren Zahl. Bei gleicher Zahl gewinnt der Eintrag mit Zeitraum, danach der zuletzt geänderte.' }),
      enabledSw);

    const d = openDialog({
      title: isEdit ? 'Eintrag bearbeiten' : 'Eintrag hinzufügen',
      description: state.steles.length > 1 ? `Stele: ${state.steles.find((s) => s.id === state.steleId)?.name}` : null,
      size: 'md',
      content: form,
      actions: [
        isEdit ? { label: 'Löschen', variant: 'danger-ghost', icon: 'trash', start: true, onClick: async (dd) => { dd.close(null); await removeEntry(entry); return false; } } : null,
        { label: 'Abbrechen', value: null },
        { label: isEdit ? 'Speichern' : 'Eintrag anlegen', variant: 'primary', icon: 'save', onClick: async () => {
          const errors = {};
          if (!presSel.value) errors.presentation_id = 'Bitte eine Präsentation wählen.';
          if (!days.size) errors.days = 'Bitte mindestens einen Wochentag wählen.';
          const whole = allDay.input.checked;
          const start = whole ? '00:00' : startIn.value;
          let end = whole ? '24:00' : endIn.value;
          if (!start) errors.start_time = 'Bitte eine Startzeit angeben.';
          if (!end) errors.end_time = 'Bitte eine Endzeit angeben.';
          if (!whole && end === '00:00') end = start === '00:00' ? '24:00' : '00:00';
          if (!whole && start && end && start === end) errors.end_time = 'Beginn und Ende dürfen nicht gleich sein.';
          if (fromIn.value && untilIn.value && untilIn.value < fromIn.value) errors.date_until = 'Das Ende liegt vor dem Beginn.';
          if (Object.keys(errors).length) {
            setFieldErrors(form, errors);
            const err = daysField.querySelector('.field__error');
            err.hidden = !errors.days;
            fill(err, errors.days ? h('span', {}, errors.days) : '');
            return false;
          }
          clearFieldErrors(form);
          daysField.querySelector('.field__error').hidden = true;
          const payload = {
            stele_id: state.steleId, presentation_id: Number(presSel.value), label: labelIn.value.trim(),
            days: [...days].sort((x, y) => x - y), start_time: start, end_time: end,
            date_from: fromIn.value || null, date_until: untilIn.value || null,
            priority: Number((prioIn.input || prioIn).value || 0), enabled: enabledSw.input.checked,
          };
          try {
            if (isEdit) await api.patch(`/api/schedule/${entry.id}`, payload);
            else await api.post('/api/schedule', payload);
          } catch (err) {
            if (err instanceof ApiError && Object.keys(err.fields || {}).length) {
              const rest = setFieldErrors(form, err.fields);
              if (rest.days) { const e2 = daysField.querySelector('.field__error'); e2.hidden = false; fill(e2, h('span', {}, rest.days)); }
              return false;
            }
            throw err;
          }
          toast.success(isEdit ? 'Eintrag gespeichert.' : 'Eintrag angelegt.');
          loadAll();
          ctx.refreshNav();
          return true;
        } },
      ].filter(Boolean),
    });
    return d.result;
  }

  async function removeEntry(e) {
    const ok = await confirmDialog({
      title: 'Eintrag löschen?',
      message: `„${e.label || e.presentation?.name}“ (${formatDays(e.days)}, ${timeRange(e)}) wird aus dem Zeitplan entfernt. In diesem Zeitraum läuft dann die Standard-Präsentation.`,
      confirmLabel: 'Eintrag löschen', danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/schedule/${e.id}`);
      toast.success('Eintrag gelöscht.');
      loadAll();
    } catch (err) { toast.error(errorMessage(err)); }
  }

  await loadAll();
  // Jetzt-Linie und „läuft jetzt“ jede Minute nachziehen (ohne Netz)
  const timer = setInterval(() => {
    if (document.hidden || !state.timeline) return;
    if (todayIn(state.tz) !== state.renderedDay) { renderWeek(); return; }
    if (state.nowLine) {
      const m = nowMinutesIn(state.tz);
      state.nowLine.style.left = `${(m / 1440) * 100}%`;
      state.nowLine.title = `Jetzt (${toHHMM(m)})`;
    }
  }, 60000);
  return () => clearInterval(timer);
}
