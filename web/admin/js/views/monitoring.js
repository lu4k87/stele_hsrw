// Monitoring (#/monitoring?stele=&range=24|168): Alarme, Stelen-Überblick, Detail je Stele, Server.
// Auto-Aktualisierung alle 15 s (Hintergrund) mit sichtbarem Stand und Pause-Knopf.
import { h, useStyles, mount as fill } from '../dom.js';
import { api, errorMessage } from '../api.js';
import { can } from '../session.js';
import { icon } from '../icons.js';
import { formatRelative, formatDateTime, formatDuration, formatBytes, formatNumber, formatPercent, plural } from '../format.js';
import { page, pageHeader, card, button, kpi } from '../ui/page.js';
import { select, segmented } from '../ui/form.js';
import { dataTable } from '../ui/table.js';
import { chip, steleStatus, contentTypeLabel } from '../ui/status.js';
import { emptyState, errorState, loadingBlock, skeletonLines } from '../ui/empty.js';
import { sparkline, barList, columnChart, availabilityBand, meter } from '../ui/charts.js';
import { alertList, eventLevelChip, nowPlaying } from '../ui/stele-ui.js';

const POLL_MS = 15000;
const RANGES = [{ value: '24', label: '24 Stunden' }, { value: '168', label: '7 Tage' }];
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default async function mount(root, ctx) {
  await useStyles('/admin/css/views/monitoring.css');
  const state = { paused: false, overview: null, bands: new Map(), steleId: Number(ctx.query.stele) || null, range: RANGES.some((r) => r.value === ctx.query.range) ? ctx.query.range : '24', detail: null };

  const stamp = h('span', { class: 'mon-stamp num', role: 'status', 'aria-live': 'off' }, 'Wird geladen …');
  // Beschriftung wechselt (Pause ↔ Fortsetzen) – daher kein aria-pressed
  const pauseBtn = button({ icon: 'pause', label: 'Pause', size: 'sm', onClick: () => togglePause() });
  const refreshBtn = button({ icon: 'refresh', ariaLabel: 'Jetzt aktualisieren', size: 'sm', variant: 'ghost', onClick: () => refresh() });
  const liveBar = h('div', { class: 'mon-live' }, h('span', { class: 'mon-live__dot', 'aria-hidden': 'true' }), stamp, pauseBtn, refreshBtn);

  const alertsSlot = h('div');
  const stelesSlot = h('div', {}, skeletonLines(4));
  const detailSlot = h('div');
  const serverSlot = h('div');
  root.append(page({ wide: true },
    pageHeader({ title: 'Monitoring', description: 'Zustand, Verfügbarkeit und Nutzung der Stelen sowie des Servers.', actions: [liveBar] }),
    alertsSlot, stelesSlot, detailSlot, serverSlot));

  function togglePause() {
    state.paused = !state.paused;
    fill(pauseBtn, icon(state.paused ? 'play' : 'pause'), state.paused ? 'Fortsetzen' : 'Pause');
    liveBar.classList.toggle('is-paused', state.paused);
    renderStamp();
    if (!state.paused) refresh();
  }
  let lastAt = null;
  function renderStamp() {
    stamp.textContent = lastAt ? `${state.paused ? 'Pausiert · ' : ''}Stand: ${timeFmt.format(lastAt)}` : 'Wird geladen …';
  }

  // ---------- Alarme ----------
  function renderAlerts(alerts) {
    fill(alertsSlot, alerts.length
      ? card({ title: `Hinweise und Störungen (${alerts.length})`, icon: 'bell', body: alertList(alerts) })
      : h('div', { class: 'alert alert--success' }, icon('check-circle'), h('div', { class: 'alert__body' }, h('div', { class: 'alert__title' }, 'Alles in Ordnung'), h('div', { class: 'alert__text' }, 'Keine offenen Hinweise oder Störungen.'))));
  }

  // ---------- Stelen-Überblick ----------
  function bandFor(s) {
    const b = state.bands.get(s.id);
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 3600 * 1000);
    return availabilityBand({ from, to, segments: b?.segments || [], pct: s.availability_24h_pct, since: s.created_at, label: `Verfügbarkeit ${s.name}, 24 Stunden`, compact: true });
  }

  function renderSteles(steles) {
    if (!steles.length) {
      fill(stelesSlot, card({ body: emptyState({ icon: 'stele', title: 'Noch keine Stele', text: 'Sobald eine Stele eingerichtet ist, erscheinen hier Verfügbarkeit, Wiedergaben und Touch-Nutzung.',
        actions: [can('steles.manage') ? button({ label: 'Stele hinzufügen', icon: 'plus', variant: 'primary', href: '#/steles?add=1' }) : null] }) }));
      return;
    }
    const rows = steles.map((s) => {
      const selected = s.id === state.steleId;
      const pct = s.availability_24h_pct;
      const pctKind = pct == null ? 'neutral' : pct >= 99 ? 'success' : pct >= 90 ? 'warning' : 'danger';
      const btn = h('button', { type: 'button', class: 'mon-stele__btn', 'aria-pressed': String(selected), dataset: { id: s.id }, title: 'Details anzeigen' }, s.name);
      btn.addEventListener('click', () => selectStele(s.id));
      const b = h('article', { class: ['mon-stele', selected && 'is-selected'] },
        h('div', { class: 'mon-stele__head' },
          h('h3', { class: 'mon-stele__name' }, btn), steleStatus(s, { size: 'sm' })),
        h('div', { class: 'mon-stele__now' }, nowPlaying(s, { compact: true })),
        h('div', { class: 'mon-stele__avail' },
          h('div', { class: 'mon-stele__avail-row' }, h('span', { class: 'text-2 text-sm' }, 'Verfügbarkeit 24 h'),
            h('span', { class: ['mon-pct', `mon-pct--${pctKind}`, 'num'] }, pct == null ? '–' : formatPercent(pct, 1))),
          bandFor(s)),
        h('dl', { class: 'mon-stele__stats' },
          stat('Wiedergaben heute', formatNumber(s.plays_today ?? 0), 'play'),
          stat('Touch-Sitzungen heute', formatNumber(s.touch_sessions_today ?? 0), 'hand'),
          stat('Fehler 24 h', formatNumber(s.errors_24h ?? 0), 'alert-circle', (s.errors_24h || 0) > 0)),
      );
      return b;
    });
    const focusedId = stelesSlot.contains(document.activeElement) ? document.activeElement.dataset?.id : null;
    fill(stelesSlot, h('section', { class: 'stack', 'aria-labelledby': 'mon-steles-h' },
      h('div', { class: 'section-title' }, h('h2', { id: 'mon-steles-h' }, steles.length === 1 ? 'Stele' : 'Stelen'),
        steles.length > 1 ? h('span', { class: 'text-2 text-sm' }, 'Stele anklicken für Details') : null),
      h('div', { class: 'mon-steles' }, rows)));
    if (focusedId) stelesSlot.querySelector(`.mon-stele__btn[data-id="${focusedId}"]`)?.focus();
  }
  function stat(label, value, iconName, warn = false) {
    return h('div', { class: ['mon-stat', warn && 'is-warn'] }, h('dt', {}, icon(iconName, { size: 16 }), label), h('dd', { class: 'num' }, warn ? h('span', {}, value, h('span', { class: 'visually-hidden' }, ' (Achtung)')) : value));
  }

  // ---------- Detail ----------
  const rangeSeg = segmented({ value: state.range, options: RANGES, ariaLabel: 'Zeitraum', onChange: (v) => { state.range = v; ctx.setQuery({ range: v === '24' ? null : v }); loadDetail(); } });

  function selectStele(id) {
    state.steleId = id;
    ctx.setQuery({ stele: id });
    if (state.overview) renderSteles(state.overview.steles || []);
    loadDetail();
  }

  let detailToken = 0;
  async function loadDetail({ background = false } = {}) {
    if (!state.steleId) return;
    const token = ++detailToken;
    if (!background) fill(detailSlot, card({ body: loadingBlock('Details werden geladen …') }));
    try {
      const d = await api.get(`/api/monitoring/steles/${state.steleId}`, { query: { hours: state.range }, signal: ctx.signal, background });
      if (token !== detailToken) return;
      state.detail = d;
      if (state.range === '24') state.bands.set(state.steleId, d.availability || {});
      // Hintergrund-Aktualisierung nicht unter den Händen der Bedienung austauschen
      if (background && detailSlot.contains(document.activeElement) && document.activeElement !== document.body) return;
      renderDetail(d);
    } catch (err) {
      if (err.name === 'AbortError' || token !== detailToken) return;
      if (!background) fill(detailSlot, card({ body: errorState({ error: err, onRetry: () => loadDetail() }) }));
    }
  }

  function renderDetail(d) {
    const s = d.stele;
    const hours = Number(state.range);
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600 * 1000);
    const steles = state.overview?.steles || [];
    const picker = steles.length > 1
      ? select({ value: state.steleId, options: steles.map((x) => ({ value: x.id, label: x.name })), 'aria-label': 'Stele wählen', onChange: (v) => selectStele(Number(v)) })
      : null;

    const metrics = d.metrics || [];
    const series = (key) => metrics.map((m) => ({ t: m.ts, v: m[key] }));
    const hasMetrics = metrics.some((m) => m.cpu != null || m.ram != null);
    const metricsBody = hasMetrics
      ? h('div', { class: 'mon-sparks' },
        sparkline({ label: 'CPU', unit: '%', points: series('cpu'), min: 0, max: 100, level: (v) => (v >= 90 ? 'danger' : v >= 80 ? 'warning' : null) }),
        sparkline({ label: 'Arbeitsspeicher', unit: '%', points: series('ram'), min: 0, max: 100, level: (v) => (v >= 90 ? 'danger' : v >= 80 ? 'warning' : null) }),
        sparkline({ label: 'Datenträger', unit: '%', points: series('disk'), min: 0, max: 100, level: (v) => (v >= 95 ? 'danger' : v >= 85 ? 'warning' : null) }),
        sparkline({ label: 'Temperatur', unit: '°C', points: series('temp'), level: (v) => (v >= 85 ? 'danger' : v >= 75 ? 'warning' : null) }))
      : h('p', { class: 'text-2' }, s.agent ? 'Im gewählten Zeitraum liegen keine Messwerte vor.' : 'Kein Stelen-Agent verbunden – CPU, Speicher und Temperatur werden erst mit dem Agenten erfasst.',
        !s.agent && can('steles.manage') ? [' ', h('a', { href: `#/steles/${s.id}?tab=connection` }, 'Agent einrichten')] : null);

    const playback = dataTable({
      caption: 'Wiedergabeprotokoll',
      columns: [
        { key: 'started_at', label: 'Beginn', render: (p) => h('time', { datetime: p.started_at, title: formatDateTime(p.started_at) }, formatDateTime(p.started_at)) },
        { key: 'title', label: 'Folie', rowHeader: true, render: (p) => h('div', { class: 'stack', style: { '--stack-gap': '0' } }, h('span', {}, p.title || '–'), p.content_type ? h('span', { class: 'table__secondary' }, contentTypeLabel(p.content_type)) : null) },
        { key: 'presentation_name', label: 'Präsentation', render: (p) => p.presentation_name || '–' },
        { key: 'duration_s', label: 'Dauer', align: 'num', render: (p) => formatDuration(p.duration_s) },
      ],
      rows: (d.playback || []).slice(0, 50),
      empty: h('p', { class: 'mon-pad text-2' }, 'Keine Wiedergaben im gewählten Zeitraum.'),
    });

    const events = d.events || [];
    const eventsBody = events.length
      ? h('ul', { class: 'list mon-events' }, events.slice(0, 50).map((e) => h('li', {}, eventLevelChip(e.level),
        h('div', { class: 'list__main' }, h('span', { class: 'mon-events__msg' }, e.message), h('span', { class: 'list__meta' }, h('time', { datetime: e.ts, title: formatDateTime(e.ts) }, formatRelative(e.ts)))))))
      : h('p', { class: 'mon-pad text-2' }, 'Keine Ereignisse im gewählten Zeitraum.');

    const t = d.touch || {};
    const perHour = Array.from({ length: 24 }, (_, hr) => ({ label: String(hr), value: (t.per_hour || []).find((x) => Number(x.hour) === hr)?.sessions || 0 }));
    const touchBody = (t.sessions || 0) > 0
      ? h('div', { class: 'stack stack--lg' },
        h('div', { class: 'mon-kpis' },
          kpi({ label: 'Sitzungen', value: formatNumber(t.sessions), icon: 'hand' }),
          kpi({ label: 'Ø Dauer', value: formatDuration(t.avg_duration_s), icon: 'clock' })),
        h('div', { class: 'stack stack--sm' }, h('h4', {}, 'Meistgeöffnete Kacheln'), barList({ label: 'Meistgeöffnete Kacheln', items: (t.top_tiles || []).map((x) => ({ label: x.label || 'Ohne Beschriftung', value: x.count })), unit: '×', empty: 'Noch keine Kachel geöffnet.' })),
        h('div', { class: 'stack stack--sm' }, h('h4', {}, 'Sitzungen je Uhrzeit'), columnChart({ label: 'Touch-Sitzungen je Stunde', items: perHour })))
      : h('p', { class: 'text-2' }, s.settings?.touch_enabled === false ? 'Die Touch-Bedienung ist für diese Stele ausgeschaltet.' : 'Im gewählten Zeitraum hat niemand die Stele angetippt.');

    const shot = d.screenshot;
    const shotBody = shot?.url
      ? h('figure', { class: 'mon-shot' }, h('a', { href: shot.url, target: '_blank', rel: 'noopener', title: 'In voller Größe öffnen' },
        h('img', { src: shot.url, alt: `Screenshot der Stele ${s.name} vom ${formatDateTime(shot.taken_at)}`, loading: 'lazy' })),
      h('figcaption', { class: 'text-2 text-sm' }, `Aufgenommen ${formatRelative(shot.taken_at)}`))
      : h('p', { class: 'text-2' }, 'Kein Screenshot vorhanden.', can('steles.control') ? [' Unter ', h('a', { href: `#/steles/${s.id}` }, 'Stele → Screenshot anfordern'), '.'] : null);

    const av = d.availability || {};
    fill(detailSlot, h('section', { class: 'stack', 'aria-labelledby': 'mon-detail-h' },
      h('div', { class: 'section-title mon-detail-title' },
        h('h2', { id: 'mon-detail-h' }, `Details: ${s.name}`),
        h('div', { class: 'cluster' }, picker, rangeSeg, h('a', { class: 'btn btn--ghost btn--sm', href: `#/steles/${s.id}` }, 'Zur Stele', icon('chevron-right', { size: 16 })))),
      card({ title: `Verfügbarkeit · ${av.pct == null ? '–' : formatPercent(av.pct, 1)} online`, icon: 'wifi',
        body: availabilityBand({ from, to, segments: av.segments || [], pct: av.pct, since: s.created_at, label: `Verfügbarkeit ${s.name}` }) }),
      h('div', { class: 'mon-grid' },
        card({ title: 'Stelen-PC', icon: 'cpu', subtitle: s.agent ? `Letzte Meldung ${formatRelative(s.agent.last_at)}` : null, body: metricsBody }),
        card({ title: 'Touch-Nutzung', icon: 'hand', body: touchBody }),
        card({ title: 'Wiedergabeprotokoll', icon: 'play', subtitle: plural((d.playback || []).length, 'Wiedergabe', 'Wiedergaben') + ((d.playback || []).length >= 100 ? ' (die neuesten 100)' : ''), flush: true, body: h('div', { class: 'mon-scroll' }, playback.el) }),
        card({ title: 'Ereignisse', icon: 'activity', flush: true, body: h('div', { class: 'mon-scroll' }, eventsBody) }),
        card({ title: 'Letzter Screenshot', icon: 'camera', body: shotBody }))));
  }

  // ---------- Server ----------
  function renderServer(sv) {
    if (!sv) { fill(serverSlot); return; }
    const used = sv.disk_total_bytes ? 100 - (sv.disk_free_bytes / sv.disk_total_bytes) * 100 : null;
    const jobs = sv.jobs || {};
    fill(serverSlot, card({ title: 'Server', icon: 'server', body: h('div', { class: 'mon-server' },
      h('dl', { class: 'meta-list' },
        h('dt', {}, 'Version'), h('dd', {}, sv.version || '–'),
        h('dt', {}, 'Läuft seit'), h('dd', {}, sv.uptime_s != null ? `${formatDuration(sv.uptime_s)} (Start ${formatDateTime(sv.started_at)})` : '–'),
        h('dt', {}, 'Datenbank'), h('dd', {}, formatBytes(sv.db_size_bytes)),
        h('dt', {}, 'Medien'), h('dd', {}, `${formatBytes(sv.media_size_bytes)}${sv.content_count != null ? ` · ${plural(sv.content_count, 'Inhalt', 'Inhalte')}` : ''}`),
        h('dt', {}, 'Verarbeitung'), h('dd', { class: 'cluster' },
          (jobs.running || 0) > 0 ? chip('info', `${jobs.running} läuft`, 'refresh', { size: 'sm' }) : null,
          (jobs.queued || 0) > 0 ? chip('neutral', `${jobs.queued} wartet`, 'clock', { size: 'sm' }) : null,
          (jobs.failed || 0) > 0 ? chip('danger', `${jobs.failed} fehlgeschlagen`, 'x-circle', { size: 'sm' }) : null,
          !(jobs.running || jobs.queued || jobs.failed) ? chip('success', 'nichts offen', 'check', { size: 'sm' }) : null)),
      h('div', { class: 'mon-disk' }, meter({
        label: 'Speicherplatz belegt', value: used, warnAt: 80, dangerAt: 90,
        text: used == null ? 'unbekannt' : `${formatPercent(used)} belegt · ${formatBytes(sv.disk_free_bytes)} von ${formatBytes(sv.disk_total_bytes)} frei`,
      }))) }));
  }

  // ---------- Laden ----------
  async function loadBands(steles) {
    // Band für die Übersicht (24 h): Detail-Abfrage je Stele, begrenzt auf 12 Stelen
    await Promise.all(steles.slice(0, 12).filter((s) => s.id !== state.steleId || state.range !== '24').map(async (s) => {
      try {
        const d = await api.get(`/api/monitoring/steles/${s.id}`, { query: { hours: 24 }, signal: ctx.signal, background: true });
        state.bands.set(s.id, d.availability || {});
      } catch { /* Band bleibt leer, Prozent steht trotzdem da */ }
    }));
  }

  async function refresh({ background = false } = {}) {
    try {
      const o = await api.get('/api/monitoring/overview', { signal: ctx.signal, background });
      state.overview = o;
      const steles = o.steles || [];
      if (!state.steleId || !steles.some((s) => s.id === state.steleId)) state.steleId = steles[0]?.id || null;
      renderAlerts(o.alerts || []);
      const detailP = state.steleId ? loadDetail({ background: !!state.detail }) : Promise.resolve();
      await Promise.all([loadBands(steles), detailP]);
      renderSteles(steles);
      if (!steles.length) fill(detailSlot);
      renderServer(o.server);
      lastAt = new Date();
      renderStamp();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!state.overview) fill(stelesSlot, card({ body: errorState({ error: err, onRetry: () => refresh() }) }));
      else stamp.textContent = `Aktualisierung fehlgeschlagen (${errorMessage(err)}) · Stand: ${lastAt ? timeFmt.format(lastAt) : '–'}`;
    }
  }

  await refresh();
  const timer = setInterval(() => { if (!state.paused && !document.hidden) refresh({ background: true }); }, POLL_MS);
  return () => clearInterval(timer);
}
