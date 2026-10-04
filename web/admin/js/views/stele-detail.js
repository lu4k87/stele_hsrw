// Stele-Detail (#/steles/:id): Kopf mit Status und Befehlen; Tabs Übersicht, Einstellungen, Verbindung, Befehle & Ereignisse.
// Live-Aktualisierung alle 10 s (Hintergrund). Alle Tab-Inhalte bleiben im DOM (Live-Ansicht wird nicht neu geladen).
import { h, useStyles, mount as fill } from '../dom.js';
import { api, ApiError, errorMessage } from '../api.js';
import { can, canAny } from '../session.js';
import { icon } from '../icons.js';
import { formatRelative, formatDateTime, formatDuration, formatTime } from '../format.js';
import { page, pageHeader, card, button } from '../ui/page.js';
import { field, input, select, switchToggle, setFieldErrors, clearFieldErrors } from '../ui/form.js';
import { tabs } from '../ui/tabs.js';
import { menuButton } from '../ui/menu.js';
import { confirmDialog } from '../ui/dialog.js';
import { dataTable } from '../ui/table.js';
import { toast } from '../ui/toast.js';
import { chip, steleStatus } from '../ui/status.js';
import { emptyState, errorState, loadingBlock } from '../ui/empty.js';
import { playerFrame, playerUrls } from '../ui/player-frame.js';
import { meter } from '../ui/charts.js';
import {
  COMMANDS, sendCommand, commandBlocked, commandHint, nowPlaying, nextChangeText, eventLevelChip, copyField, kioskCommand, agentCommand,
  fetchPresentations, presentationOptions, playerSummary,
} from '../ui/stele-ui.js';
import { resolutionField, validateIp, openPairDialog } from '../ui/stele-wizard.js';

const POLL_MS = 10000;
function dl(rows) {
  return h('dl', { class: 'meta-list' }, rows.filter(Boolean).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? '–')]));
}

export default async function mount(root, ctx) {
  await useStyles('/admin/css/views/stele-detail.css');
  const id = Number(ctx.params.id);
  let stele;
  try {
    stele = await api.get(`/api/steles/${id}`, { signal: ctx.signal });
  } catch (err) {
    if (err.name === 'AbortError') return undefined;
    root.append(page({}, pageHeader({ title: 'Stele', back: { href: '#/steles', label: 'Alle Stelen' } }),
      card({ body: err.status === 404
        ? emptyState({ icon: 'stele', title: 'Stele nicht gefunden', text: 'Die Stele wurde vermutlich entfernt.', actions: [button({ label: 'Zur Stelen-Liste', href: '#/steles' })] })
        : errorState({ error: err, onRetry: () => ctx.navigate(`/steles/${id}`, { replace: true }) }) })));
    return undefined;
  }
  ctx.setTitle(stele.name);

  const cleanups = [];
  const canManage = can('steles.manage');
  const canControl = can('steles.control');

  // ---------- Kopf ----------
  const statusSlot = h('span', { class: 'cluster' });
  const metaSlot = h('p', { class: 'sd-meta text-2' });
  const headActions = [];
  const cmdButtons = new Map();   // Befehl → Knopf (gesperrt, solange sich die Stele nie gemeldet hat)
  const cmdHintSlot = h('div');
  if (canControl) {
    for (const cmd of ['reload', 'identify', 'screenshot']) {
      const c = COMMANDS[cmd];
      const b = button({ label: c.label, icon: c.icon, onClick: async () => { b.setAttribute('aria-busy', 'true'); await sendCommand(stele, cmd); b.removeAttribute('aria-busy'); refreshLog(); } });
      if (cmd === 'screenshot') b.classList.add('sd-hide-sm');
      cmdButtons.set(cmd, b);
      headActions.push(b);
    }
  }
  const moreItems = () => [
    canControl ? { label: COMMANDS.screenshot.label, icon: 'camera', onClick: () => sendCommand(stele, 'screenshot').then(refreshLog) } : null,
    canControl ? { label: COMMANDS.clear_cache.label, icon: 'trash', hint: commandBlocked(stele, 'clear_cache') ? 'Erst nach der ersten Meldung der Stele' : 'Player lädt alle Dateien neu', disabled: !!commandBlocked(stele, 'clear_cache'), onClick: () => sendCommand(stele, 'clear_cache').then(refreshLog) } : null,
    canManage ? { separator: true } : null,
    canManage ? { label: 'Erneut koppeln …', icon: 'link', onClick: () => repair() } : null,
    canManage ? { label: 'Schlüssel erneuern …', icon: 'key', hint: 'Alter Player-Link wird ungültig', onClick: () => rotateKey() } : null,
    canManage ? { separator: true } : null,
    canManage ? { label: 'Stele entfernen …', icon: 'trash', danger: true, onClick: () => remove() } : null,
  ].filter(Boolean);
  if (canControl || canManage) headActions.push(menuButton({ label: 'Weitere Aktionen', items: moreItems }));

  const header = pageHeader({ title: stele.name, back: { href: '#/steles', label: 'Alle Stelen' }, status: statusSlot, meta: metaSlot, actions: headActions });

  function renderHead() {
    header.titleEl.textContent = stele.name;
    fill(statusSlot, steleStatus(stele));
    for (const [cmd, b] of cmdButtons) {
      const blocked = commandBlocked(stele, cmd);
      b.disabled = !!blocked;
      if (blocked) b.title = blocked; else b.removeAttribute('title');
    }
    const hint = commandHint(stele);
    fill(cmdHintSlot, hint);
    cmdHintSlot.hidden = !hint;
    fill(metaSlot, ...[stele.location, stele.ip_address ? h('span', { class: 'mono' }, stele.ip_address) : null,
      stele.last_seen_at ? `zuletzt gemeldet ${formatRelative(stele.last_seen_at)}` : 'noch nie gemeldet']
      .filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x])));
  }

  // ---------- Tabs ----------
  const TAB_IDS = ['overview', 'settings', canManage ? 'connection' : null, 'log'].filter(Boolean);
  const initial = TAB_IDS.includes(ctx.query.tab) ? ctx.query.tab : 'overview';
  const panels = {};
  const t = tabs({
    ariaLabel: 'Bereiche der Stele',
    value: initial,
    items: [
      { id: 'overview', label: 'Übersicht', icon: 'activity' },
      { id: 'settings', label: 'Einstellungen', icon: 'sliders' },
      canManage ? { id: 'connection', label: 'Verbindung', icon: 'link' } : null,
      { id: 'log', label: 'Befehle & Ereignisse', icon: 'history' },
    ].filter(Boolean),
    onChange: (tab) => showTab(tab),
  });

  function showTab(tab) {
    for (const [k, el] of Object.entries(panels)) el.hidden = k !== tab;
    ctx.setQuery({ tab: tab === 'overview' ? null : tab });
    if (tab === 'log') refreshLog();
  }

  // ---------- Übersicht ----------
  const frame = playerFrame({ src: playerUrls.mirror(id), title: `Live-Ansicht von ${stele.name} (nachgebildet)`, width: stele.width, height: stele.height });
  cleanups.push(() => frame.destroy());
  const nowSlot = h('div');
  const nextSlot = h('div');
  const defaultSlot = h('div');
  const netSlot = h('div');
  const agentSlot = h('div');
  const shotSlot = h('div');
  let presentations = null;
  let defaultDirty = false;

  const canChangeDefault = canAny('schedule.edit', 'steles.manage');
  let lastDefaultKey = null;
  async function renderDefault(force = false) {
    const cur = stele.default_presentation;
    const key = `${cur?.id ?? ''}|${cur?.status ?? ''}`;
    if (!force && (defaultDirty || key === lastDefaultKey || defaultSlot.contains(document.activeElement))) return;
    lastDefaultKey = key;
    if (!canChangeDefault) {
      fill(defaultSlot, dl([['Standard-Präsentation', cur ? h('a', { href: `#/presentations/${cur.id}` }, cur.name) : 'nicht festgelegt']]));
      return;
    }
    if (!presentations) {
      try { presentations = await fetchPresentations({ signal: ctx.signal }); } catch (err) { if (err.name === 'AbortError') return; presentations = []; }
    }
    const sel = select({ value: cur?.id ?? '', options: presentationOptions(presentations, { current: cur }), onChange: () => { defaultDirty = String(sel.value) !== String(cur?.id ?? ''); saveBtn.hidden = !defaultDirty; } });
    const saveBtn = button({ label: 'Übernehmen', icon: 'save', size: 'sm', variant: 'primary', onClick: async () => {
      saveBtn.setAttribute('aria-busy', 'true');
      try {
        stele = await api.patch(`/api/steles/${id}`, { default_presentation_id: sel.value ? Number(sel.value) : null });
        defaultDirty = false;
        toast.success('Standard-Präsentation geändert. Die Stele übernimmt sie innerhalb von 15 Sekunden.');
        renderAll();
        renderDefault(true);
      } catch (err) { toast.error(errorMessage(err)); } finally { saveBtn.removeAttribute('aria-busy'); }
    } });
    saveBtn.hidden = true;
    const p = presentations.find((x) => x.id === cur?.id);
    fill(defaultSlot, h('div', { class: 'stack stack--sm' },
      field({ label: 'Standard-Präsentation', control: sel, hint: 'Läuft, wenn im Zeitplan nichts anderes eingetragen ist.' }),
      p && p.status === 'draft' ? h('p', { class: 'sd-warn' }, icon('alert-triangle', { size: 16 }), 'Noch nicht veröffentlicht – läuft erst nach dem Veröffentlichen.') : null,
      h('div', { class: 'cluster' }, saveBtn, can('schedule.view') ? h('a', { class: 'btn btn--ghost btn--sm', href: `#/schedule?stele=${id}` }, icon('calendar-clock', { size: 16 }), 'Zeitplan') : null)));
  }

  function renderOverviewParts() {
    fill(nowSlot, nowPlaying(stele));
    const nc = nextChangeText(stele);
    fill(nextSlot, h('div', { class: 'stele-now' }, icon('clock', { size: 18 }), h('span', {}, h('span', { class: 'text-2' }, 'Als Nächstes: '), nc || 'kein Wechsel in den nächsten Tagen')));

    const n = stele.network || {};
    const ping = n.ping_ok === null || n.ping_ok === undefined
      ? h('span', { class: 'text-2' }, stele.ip_address ? 'noch nicht geprüft' : 'keine IP-Adresse hinterlegt')
      : h('span', { class: 'cluster' }, n.ping_ok ? chip('success', 'erreichbar', 'check-circle', { size: 'sm' }) : chip('danger', 'nicht erreichbar', 'x-circle', { size: 'sm' }),
        h('span', { class: 'text-2 text-sm' }, [n.ping_ok && n.ping_ms != null ? `${Math.round(n.ping_ms)} ms` : null, n.checked_at ? `geprüft ${formatRelative(n.checked_at)}` : null].filter(Boolean).join(' · ')));
    const p = stele.player;
    fill(netSlot, dl([
      ['IP-Adresse', stele.ip_address ? h('span', { class: 'mono' }, stele.ip_address) : 'nicht angegeben'],
      ['Ping', ping],
      ['Player', playerSummary(p)],
      ['Bildschirm', p?.screen ? `${p.screen.w} × ${p.screen.h} px${p.screen.w !== stele.width || p.screen.h !== stele.height ? ` (eingestellt: ${stele.width} × ${stele.height})` : ''}` : `${stele.width} × ${stele.height} px (eingestellt)`],
      ['Stand', !p ? '–' : p.manifest_current
        ? chip('success', 'aktuell', 'check-circle', { size: 'sm' })
        : chip('warning', 'veraltet – „Neu laden“ senden', 'alert-triangle', { size: 'sm' })],
      ['Verbindung', connectionText()],
    ]));

    const a = stele.agent;
    if (!a) {
      fill(agentSlot, h('p', { class: 'text-2' }, 'Kein Stelen-Agent verbunden. Der Agent meldet CPU, Speicher und Temperatur und ermöglicht Screenshots.'),
        canManage ? h('button', { type: 'button', class: 'btn btn--link', onClick: () => { t.set('connection'); showTab('connection'); } }, 'Agent einrichten') : null);
    } else {
      fill(agentSlot, h('div', { class: 'stack' },
        h('div', { class: 'sd-meters' },
          meter({ label: 'CPU', value: a.cpu }),
          meter({ label: 'Arbeitsspeicher', value: a.ram }),
          meter({ label: 'Datenträger', value: a.disk, warnAt: 85, dangerAt: 95 }),
          meter({ label: 'Temperatur', value: a.temp, unit: '°C', max: 100, warnAt: 75, dangerAt: 85 })),
        h('p', { class: 'text-2 text-sm' }, [a.hostname, a.os, a.uptime_s ? `läuft seit ${formatDuration(a.uptime_s)}` : null, `Meldung ${formatRelative(a.last_at)}`].filter(Boolean).join(' · '))));
    }
    renderShot();
  }

  function connectionText() {
    if (stele.paired) return `per Code gekoppelt am ${formatDateTime(stele.paired_at)}`;
    if (stele.last_seen_at) return 'über den Player-Link verbunden';
    return chip('warning', 'noch nicht verbunden', 'link', { size: 'sm' });
  }

  // Live-Ansicht folgt der aktuellen Folie der Stele (SPEC §9.2 showItem)
  let lastItem = null;
  function followItem() {
    const itemId = stele.status === 'online' ? stele.now?.item?.id : null;
    if (itemId && itemId !== lastItem) frame.send({ type: 'showItem', item_id: itemId });
    lastItem = itemId || null;
  }

  let lastShotKey = null;
  function renderShot() {
    if (!can('monitoring.view')) { fill(shotSlot, h('p', { class: 'text-2' }, 'Für Screenshots fehlt das Recht „Monitoring ansehen“.')); return; }
    const at = stele.agent?.screenshot_at;
    const key = at || 'none';
    if (key === lastShotKey) return;
    lastShotKey = key;
    if (!at) {
      fill(shotSlot, h('p', { class: 'text-2' }, stele.agent ? 'Noch kein Screenshot vorhanden.' : 'Screenshots benötigen den Stelen-Agenten.'));
      return;
    }
    const img = h('img', { class: 'sd-shot', src: `/api/steles/${id}/screenshot?t=${encodeURIComponent(at)}`, alt: `Screenshot der Stele vom ${formatDateTime(at)}`, loading: 'lazy' });
    img.addEventListener('error', () => fill(shotSlot, h('p', { class: 'text-2' }, 'Der Screenshot konnte nicht geladen werden.')));
    fill(shotSlot, h('figure', { class: 'sd-shot-fig' },
      h('a', { href: img.src, target: '_blank', rel: 'noopener', title: 'In voller Größe öffnen' }, img),
      h('figcaption', { class: 'text-2 text-sm' }, `Aufgenommen ${formatRelative(at)}`)));
  }

  panels.overview = h('div', { class: 'sd-overview' },
    h('section', { class: 'sd-live', 'aria-label': 'Live-Ansicht' },
      frame.el,
      h('p', { class: 'text-2 text-sm sd-live__note' }, icon('info', { size: 16 }), 'Nachgebildete Live-Ansicht aus dem veröffentlichten Stand (ohne Ton).')),
    h('div', { class: 'sd-side' },
      card({ title: 'Wiedergabe', icon: 'play', body: h('div', { class: 'stack' }, nowSlot, nextSlot, defaultSlot) }),
      card({ title: 'Netzwerk & Player', icon: 'wifi', body: netSlot }),
      card({ title: 'Stelen-PC', icon: 'cpu', body: agentSlot }),
      card({ title: 'Letzter Screenshot', icon: 'camera', body: h('div', { class: 'stack stack--sm' }, shotSlot,
        canControl ? h('div', {}, button({ label: 'Screenshot anfordern', icon: 'camera', size: 'sm', onClick: () => sendCommand(stele, 'screenshot').then(refreshLog) })) : null) })));

  // ---------- Einstellungen ----------
  panels.settings = buildSettings();

  function buildSettings() {
    const ro = !canManage;
    const s = stele.settings || {};
    const nameIn = input({ value: stele.name, maxLength: 80, disabled: ro });
    const locIn = input({ value: stele.location, maxLength: 120, disabled: ro });
    const ipIn = input({ value: stele.ip_address, maxLength: 253, className: 'mono', disabled: ro, inputmode: 'decimal' });
    const res = resolutionField({ width: stele.width, height: stele.height, disabled: ro });
    const vol = h('input', { type: 'range', min: 0, max: 100, step: 5, class: 'sd-range', disabled: ro, value: String(Math.round((s.volume ?? 0.8) * 100)) });
    vol.value = String(Math.round((s.volume ?? 0.8) * 100));
    const volOut = h('output', { class: 'num sd-range__out' });
    const syncVol = () => { volOut.textContent = `${vol.value} %`; vol.setAttribute('aria-valuetext', `${vol.value} Prozent`); };
    vol.addEventListener('input', syncVol); syncVol();
    const touch = switchToggle({ label: 'Touch-Bedienung für Besucher', hint: 'Besucher können durch Antippen das Touch-Menü der Präsentation öffnen.', checked: !!s.touch_enabled, disabled: ro });
    const cursor = switchToggle({ label: 'Mauszeiger anzeigen', hint: 'Nur für Wartung sinnvoll; im Betrieb ausgeblendet lassen.', checked: !!s.show_cursor, disabled: ro });
    const night = switchToggle({ label: 'Nachtmodus', hint: 'Bildschirm ist in diesem Zeitraum schwarz, Videos stoppen.', checked: !!s.night_mode?.enabled, disabled: ro });
    const nStart = input({ type: 'time', value: s.night_mode?.start || '22:00', disabled: ro });
    const nEnd = input({ type: 'time', value: s.night_mode?.end || '06:00', disabled: ro });
    const nightTimes = h('div', { class: 'form-row sd-sub' }, field({ label: 'Aus ab', control: nStart, name: 'night_start' }), field({ label: 'Wieder an um', control: nEnd, name: 'night_end' }));
    const reload = switchToggle({ label: 'Täglicher Neustart des Players', hint: 'Hält den Player frisch. Nicht während einer Touch-Sitzung.', checked: !!s.daily_reload, disabled: ro });
    const rTime = input({ type: 'time', value: s.daily_reload || '03:30', disabled: ro });
    const reloadTime = h('div', { class: 'form-row sd-sub' }, field({ label: 'Uhrzeit', control: rTime, name: 'daily_reload' }));
    const syncSubs = () => {
      for (const el of [nStart, nEnd]) el.disabled = ro || !night.input.checked;
      rTime.disabled = ro || !reload.input.checked;
    };
    night.input.addEventListener('change', syncSubs);
    reload.input.addEventListener('change', syncSubs);
    syncSubs();

    const saveState = h('span', { class: 'text-2 text-sm', role: 'status' });
    const form = h('form', { class: 'form', novalidate: true },
      ro ? h('div', { class: 'alert alert--neutral' }, icon('lock'), h('div', { class: 'alert__body' }, h('div', { class: 'alert__text' }, 'Nur Ansicht – Änderungen erfordern das Recht „Stelen hinzufügen, koppeln, einstellen und entfernen“.'))) : null,
      h('div', { class: 'form-section' },
        h('h3', { class: 'form-section__title' }, 'Gerät'),
        h('div', { class: 'form-row' },
          field({ label: 'Name', control: nameIn, required: true, name: 'name' }),
          field({ label: 'Standort', control: locIn, optional: true, name: 'location' })),
        h('div', { class: 'form-row' },
          field({ label: 'IP-Adresse', control: ipIn, optional: true, name: 'ip_address', hint: 'Für die Erreichbarkeitsprüfung (Ping).' }),
          field({ label: 'Auflösung', control: res.el, name: 'resolution' }))),
      h('div', { class: 'form-section' },
        h('h3', { class: 'form-section__title' }, 'Wiedergabe'),
        field({ label: 'Lautstärke', control: h('div', { class: 'sd-range-wrap' }, vol, volOut), hint: 'Für Videos mit Ton und Videos im Touch-Menü.' }),
        touch, cursor),
      h('div', { class: 'form-section' },
        h('h3', { class: 'form-section__title' }, 'Zeiten'),
        night, nightTimes, reload, reloadTime,
        h('p', { class: 'text-2 text-sm' }, 'Alle Uhrzeiten gelten in der Zeitzone aus den Systemeinstellungen.')),
      ro ? null : h('div', { class: 'sd-save' }, saveState, button({ label: 'Einstellungen speichern', icon: 'save', variant: 'primary', type: 'submit' })));

    const markDirty = () => { if (ro) return; ctx.setDirty('Die Einstellungen der Stele sind noch nicht gespeichert.'); saveState.textContent = 'Ungespeicherte Änderungen'; };
    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (ro) return;
      const errors = {};
      if (!nameIn.value.trim()) errors.name = 'Bitte einen Namen eingeben.';
      const ipErr = validateIp(ipIn.value.trim());
      if (ipErr) errors.ip_address = ipErr;
      const r = res.getValue();
      if (!r) errors.resolution = 'Bitte Breite und Höhe zwischen 320 und 7680 Pixel angeben.';
      if (night.input.checked && nStart.value === nEnd.value) errors.night_end = 'Beginn und Ende dürfen nicht gleich sein.';
      if (Object.keys(errors).length) { setFieldErrors(form, errors); return; }
      clearFieldErrors(form);
      const submit = form.querySelector('button[type=submit]');
      submit.setAttribute('aria-busy', 'true');
      try {
        stele = await api.patch(`/api/steles/${id}`, {
          name: nameIn.value.trim(), location: locIn.value.trim(), ip_address: ipIn.value.trim(), width: r.width, height: r.height,
          settings: {
            volume: Number(vol.value) / 100,
            touch_enabled: touch.input.checked,
            show_cursor: cursor.input.checked,
            night_mode: { enabled: night.input.checked, start: nStart.value || '22:00', end: nEnd.value || '06:00' },
            daily_reload: reload.input.checked ? (rTime.value || '03:30') : '',
          },
        });
        ctx.setDirty(false);
        saveState.textContent = `Gespeichert um ${formatTime(new Date())}`;
        toast.success('Einstellungen gespeichert. Die Stele übernimmt sie beim nächsten Kontakt.');
        ctx.setTitle(stele.name);
        renderAll();
      } catch (err) {
        if (err instanceof ApiError && Object.keys(err.fields || {}).length) {
          const f = { ...err.fields };
          if (f.width || f.height) f.resolution = f.width || f.height;
          if (f['settings.night_mode.start'] || f['settings.night_mode']) f.night_start = f['settings.night_mode.start'] || f['settings.night_mode'];
          if (f['settings.night_mode.end']) f.night_end = f['settings.night_mode.end'];
          if (f['settings.daily_reload']) f.daily_reload = f['settings.daily_reload'];
          const rest = setFieldErrors(form, f);
          if (Object.keys(rest).length) toast.error(Object.values(rest)[0]);
        } else toast.error(errorMessage(err));
      } finally { submit.removeAttribute('aria-busy'); }
    });
    return h('div', { class: 'sd-settings' }, card({ body: form }));
  }

  // ---------- Verbindung ----------
  const connSlot = h('div', { class: 'stack' });
  if (canManage) panels.connection = h('div', { class: 'sd-conn' }, connSlot);
  let lastConnKey = null;
  function renderConnection() {
    if (!canManage) return;
    const url = stele.player_url;
    const key = [url, stele.paired_at, stele.last_seen_at ? 's' : '', stele.agent?.last_at ? 'a' : ''].join('|');
    if (key === lastConnKey) return;
    lastConnKey = key;
    fill(connSlot, 
      card({ title: 'Kopplung', icon: 'link', body: h('div', { class: 'stack' },
        h('p', {}, stele.paired ? `Per Code gekoppelt seit ${formatDateTime(stele.paired_at)}.`
          : stele.last_seen_at ? 'Der Player ist über den Player-Link verbunden. Ein anderes Gerät lässt sich per Code koppeln.'
            : 'Noch kein Player verbunden: Player-Link auf dem Stelen-PC öffnen oder per Code koppeln.'),
        h('div', { class: 'cluster' },
          button({ label: stele.last_seen_at ? 'Erneut koppeln' : 'Per Code koppeln', icon: 'link', variant: stele.last_seen_at ? 'secondary' : 'primary', onClick: () => repair() }),
          button({ label: 'Schlüssel erneuern', icon: 'key', variant: 'ghost', onClick: () => rotateKey() }))) }),
      card({ title: 'Player-Link', icon: 'globe', subtitle: 'Wird auf dem Stelen-PC im Chrome-Kiosk geöffnet. Enthält den geheimen Schlüssel – nicht weitergeben.', body: url
        ? h('div', { class: 'stack' },
          copyField({ label: 'Player-Link', value: url, secret: true }),
          copyField({ label: 'Chrome-Kiosk-Aufruf (Linux)', value: kioskCommand(url), multiline: true, hint: 'Unter Windows „chrome.exe“ statt „google-chrome“ verwenden. Für den Autostart siehe Anleitung des Stelen-Agenten.' }))
        : h('p', { class: 'text-2' }, 'Der Player-Link ist nicht verfügbar.') }),
      card({ title: 'Stelen-Agent (optional)', icon: 'cpu', subtitle: 'Kleines Programm auf dem Stelen-PC: meldet CPU, Speicher und Temperatur und nimmt Screenshots auf.', body: url
        ? h('div', { class: 'stack' },
          copyField({ label: 'Aufruf des Agenten', value: agentCommand(url), multiline: true, hint: 'Ohne „--allow-screenshots“ sind Screenshots abgeschaltet. Benötigt Python 3 auf dem Stelen-PC.' }),
          h('p', { class: 'text-2 text-sm' }, stele.agent ? `Letzte Meldung des Agenten: ${formatRelative(stele.agent.last_at)}.` : 'Der Agent hat sich noch nicht gemeldet.'))
        : h('p', { class: 'text-2' }, '–') }),
    );
  }

  async function repair() {
    const s = await openPairDialog(stele);
    if (s) { stele = { ...stele, ...s }; renderAll(); }
  }

  async function rotateKey() {
    const ok = await confirmDialog({
      title: 'Schlüssel erneuern?',
      message: 'Der bisherige Player-Link wird sofort ungültig. Die Stele zeigt danach den Kopplungsbildschirm, bis sie neu gekoppelt oder der neue Player-Link geöffnet wird.',
      confirmLabel: 'Schlüssel erneuern', danger: true, icon: 'key',
    });
    if (!ok) return;
    try {
      stele = await api.post(`/api/steles/${id}/rotate-key`);
      toast.success('Neuer Schlüssel erzeugt. Jetzt die Stele neu koppeln oder den neuen Player-Link öffnen.');
      renderAll();
      t.set('connection'); showTab('connection');
    } catch (err) { toast.error(errorMessage(err)); }
  }

  async function remove() {
    const ok = await confirmDialog({
      title: `„${stele.name}“ entfernen?`,
      message: 'Die Stele wird aus dem CMS entfernt – mit ihren Zeitplan-Einträgen, Ereignissen und Statistiken. Der Player auf dem Gerät zeigt danach wieder den Kopplungsbildschirm.',
      confirmLabel: 'Stele entfernen', danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/steles/${id}`);
      toast.success(`„${stele.name}“ wurde entfernt.`);
      ctx.refreshNav();
      ctx.navigate('/steles');
    } catch (err) { toast.error(errorMessage(err)); }
  }

  // ---------- Befehle & Ereignisse ----------
  const cmdTable = dataTable({
    caption: 'Befehlsverlauf',
    columns: [
      { key: 'command', label: 'Befehl', rowHeader: true, render: (c) => h('span', { class: 'cluster' }, icon(COMMANDS[c.command]?.icon || 'send', { size: 16 }), COMMANDS[c.command]?.label || c.command) },
      { key: 'created_at', label: 'Gesendet', render: (c) => h('span', {}, h('time', { datetime: c.created_at, title: formatDateTime(c.created_at) }, formatRelative(c.created_at)), c.created_by ? h('span', { class: 'table__secondary' }, ` · ${c.created_by.display_name}`) : null) },
      { key: 'state', label: 'Zustand', render: (c) => commandState(c) },
      { key: 'result', label: 'Ergebnis', render: (c) => c.result || '–' },
    ],
    empty: emptyState({ icon: 'send', title: 'Noch keine Befehle', text: canControl ? 'Befehle wie „Neu laden“ oder „Identifizieren“ stehen oben rechts.' : 'Hier erscheinen gesendete Befehle.' }),
  });
  const eventsSlot = h('div');
  panels.log = h('div', { class: 'sd-log' },
    card({ title: 'Befehlsverlauf', icon: 'send', subtitle: 'Die letzten 20 Befehle an diese Stele.', flush: true, body: cmdTable.el }),
    card({ title: 'Ereignisse', icon: 'activity', subtitle: 'Meldungen der letzten 24 Stunden.', flush: true, body: eventsSlot,
      actions: can('monitoring.view') ? h('a', { class: 'btn btn--ghost btn--sm', href: `#/monitoring?stele=${id}` }, 'Im Monitoring', icon('chevron-right', { size: 16 })) : null }));

  function commandState(c) {
    if (c.done_at) return /fehl|nicht|deaktiv|error/i.test(c.result || '') ? chip('danger', 'fehlgeschlagen', 'x-circle', { size: 'sm' }) : chip('success', 'ausgeführt', 'check-circle', { size: 'sm' });
    if (c.delivered_at) return chip('info', 'zugestellt', 'send', { size: 'sm' });
    return chip('neutral', 'wartet', 'clock', { size: 'sm' });
  }

  let logLoaded = false;
  async function refreshLog(background = false) {
    if (panels.log.hidden && logLoaded) return;
    if (!logLoaded) fill(eventsSlot, loadingBlock());
    try {
      const r = await api.get(`/api/steles/${id}/commands`, { query: { limit: 20 }, signal: ctx.signal, background });
      cmdTable.update(r.items || []);
    } catch (err) { if (err.name !== 'AbortError' && !background) toast.error(errorMessage(err)); }
    if (!can('monitoring.view')) {
      fill(eventsSlot, h('p', { class: 'sd-pad text-2' }, 'Ereignisse sind mit dem Recht „Monitoring ansehen“ sichtbar.'));
    } else {
      try {
        const m = await api.get(`/api/monitoring/steles/${id}`, { query: { hours: 24 }, signal: ctx.signal, background });
        const ev = m.events || [];
        fill(eventsSlot, ev.length ? h('ul', { class: 'list' }, ev.map((e) => h('li', {},
          eventLevelChip(e.level),
          h('div', { class: 'list__main' }, h('span', {}, e.message), h('span', { class: 'list__meta' }, h('time', { datetime: e.ts, title: formatDateTime(e.ts) }, formatRelative(e.ts))))))) :
          h('p', { class: 'sd-pad text-2' }, 'Keine Ereignisse in den letzten 24 Stunden.'));
      } catch (err) {
        if (err.name !== 'AbortError') fill(eventsSlot, h('p', { class: 'sd-pad text-2' }, `Ereignisse konnten nicht geladen werden: ${errorMessage(err)}`));
      }
    }
    logLoaded = true;
  }

  // ---------- Zusammenbau ----------
  function renderAll() {
    renderHead();
    renderOverviewParts();
    followItem();
    renderConnection();
  }
  for (const el of Object.values(panels)) t.panel.append(el);
  root.append(page({ wide: false }, header, cmdHintSlot, h('div', {}, t.el, t.panel)));
  renderAll();
  renderDefault();
  showTab(initial);

  let polling = false;
  const timer = setInterval(async () => {
    if (document.hidden || polling) return;
    polling = true;
    try {
      const s = await api.get(`/api/steles/${id}`, { signal: ctx.signal, background: true });
      stele = { ...s, player_url: s.player_url || stele.player_url };
      renderAll();
      renderDefault();
      if (!panels.log.hidden) await refreshLog(true);
    } catch { /* Hintergrund – nächster Versuch folgt */ } finally {
      polling = false;
    }
  }, POLL_MS);
  cleanups.push(() => clearInterval(timer));

  return () => cleanups.forEach((fn) => fn());
}

