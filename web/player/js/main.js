// Einstieg des Stelen-Players: Modus aus der URL (SPEC §9.1), Kiosk-Härtung, Boot je Modus.
//   /player/                          Normalbetrieb (Schlüssel aus localStorage/Cookie, sonst Kopplung)
//   /player/?key=…                    Schlüssel übernehmen, URL bereinigen
//   /player/?mode=preview&presentation=<id>&source=draft|published[&slide=][&autoplay=0|1][&touch=1]
//   /player/?mode=slide               Einzelfolie per postMessage({type:'render'})
//   /player/?mode=mirror&stele=<id>   Live-Ansicht (stumm, folgt showItem)

import { TIMING, PLAYER_VERSION } from './config.js';
import { createApi, ApiError } from './api.js';
import { store } from './store.js';
import { Stage } from './stage.js';
import { clock, onMinute, wallParts, parseHm } from './time.js';
import { Player } from './player.js';
import { Telemetry } from './telemetry.js';
import { BootScreen, PairingScreen, Diagnostics, showIdentify } from './overlays.js';
import { errorLog } from './log.js';
import { listenAdmin, postToAdmin, isEmbedded } from './messaging.js';
import { sleep } from './util.js';

const params = new URLSearchParams(location.search);
const MODES = ['normal', 'preview', 'slide', 'mirror'];
const mode = MODES.includes(params.get('mode')) ? params.get('mode') : 'normal';
const stageEl = document.getElementById('stage');
const stage = new Stage(stageEl);
const bootedAt = Date.now();
document.documentElement.dataset.mode = mode;

let player = null;
let telemetry = null;
let manifestVersion = null;
let manifestReceivedAt = null;
let steleKey = null;

// ---------- Kiosk-Härtung (SPEC §9.4) ----------

function hardenKiosk(strict) {
  const isEditable = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('selectstart', (e) => { if (!isEditable(e.target)) e.preventDefault(); });
  if (!strict) return;
  // Kein Seiten-Zoom per Geste, Strg+Rad oder Tastatur.
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault();
  });
}

// ---------- Fehlerbehandlung: melden, im Normalbetrieb gedrosselt neu laden ----------

let fatalTimer = null;
function scheduleFatalReload(reason) {
  if (mode !== 'normal' || fatalTimer) return;
  const last = Number(store.get('lastFatalReload', 0)) || 0;
  if (Date.now() - last < TIMING.fatalReloadMinGapMs) return; // max. 1× pro 5 min
  errorLog.report(`Unbehandelter Fehler – Neustart in 10 s (${reason})`);
  fatalTimer = setTimeout(() => {
    store.set('lastFatalReload', Date.now());
    reloadPage();
  }, TIMING.fatalReloadDelayMs);
}

window.addEventListener('error', (ev) => {
  if (!ev || !ev.message) return; // Ladefehler von Ressourcen landen nicht hier
  errorLog.report(`${ev.message}${ev.filename ? ` (${ev.filename.split('/').pop()}:${ev.lineno})` : ''}`);
  scheduleFatalReload(ev.message);
});
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason;
  const name = r && r.name;
  const msg = r && r.message ? r.message : String(r);
  // Abgebrochene/abgelehnte Wiedergabe ist kein Programmfehler.
  if (name === 'AbortError' || name === 'NotAllowedError') return;
  errorLog.report(`Unbehandelt: ${msg}`);
  if (r instanceof Error && !(r instanceof ApiError)) scheduleFatalReload(msg);
});

function reloadPage() {
  if (telemetry) telemetry.persist();
  location.reload();
}

// ---------- Zustand an die Admin-Oberfläche ----------

function stateMessage() {
  if (!player) return;
  const s = player.show.state();
  postToAdmin('player:state', { ...s, mode: player.uiMode });
}

if (isEmbedded()) {
  errorLog.subscribe((e) => postToAdmin('player:error', { message: e.message, item_id: e.item_id }));
}

// Befehle aus dem Admin, die in allen Modi mit Diashow gelten.
function adminControls(extra = {}) {
  return {
    goto: (m) => player.show.goto(Number(m.index) || 0, { transition: 'none' }),
    next: () => player.show.next(),
    prev: () => player.show.prev(),
    play: () => player.play(),
    pause: () => player.pause(),
    reload: () => location.reload(),
    openTouch: () => player.openTouch(),
    closeTouch: () => player.closeTouch(),
    ...extra,
  };
}

function diagnosticsInfo() {
  const cur = player && player.show.current;
  return {
    mode: player ? `${mode} · ${player.uiMode}` : mode,
    stele: player && player.manifest ? player.manifest.stele : null,
    keyEnd: steleKey ? steleKey.slice(-4) : null,
    manifestVersion,
    manifestAgeS: manifestReceivedAt ? (Date.now() - manifestReceivedAt) / 1000 : null,
    online: telemetry ? telemetry.online !== false : navigator.onLine,
    lastContactS: telemetry && telemetry.lastOkAt ? (Date.now() - telemetry.lastOkAt) / 1000 : null,
    presentation: cur ? `${cur.pres.name || '–'} (ID ${cur.pres.id ?? '–'}, ${player.source})` : null,
    slide: cur ? `${cur.index + 1}/${cur.pres.slides.length} · ${cur.slide.type} · ${cur.slide.title || ''}` : null,
    uptimeS: (Date.now() - bootedAt) / 1000,
    sw: 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'aktiv' : 'nicht aktiv') : 'nicht verfügbar',
  };
}

// ---------- Manifest ----------

function validManifest(m) {
  return m && typeof m === 'object' && Number(m.schema) === 1 && m.presentations && typeof m.presentations === 'object';
}

function noteManifest(m) {
  manifestVersion = m.version || null;
  manifestReceivedAt = Date.now();
}

// ---------- Normalbetrieb ----------

async function runNormal() {
  hardenKiosk(true);
  const urlKey = params.get('key');
  if (urlKey) {
    store.set('key', urlKey);
    params.delete('key');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }
  steleKey = store.get('key', null);
  const api = createApi({ getKey: () => steleKey });
  const boot = new BootScreen(stageEl);
  const pairing = new PairingScreen(stageEl);
  new Diagnostics(stageEl, stage, diagnosticsInfo);
  registerServiceWorker();

  let authFailures = 0;
  let started = false;
  let pairingActive = false;
  let manifestLoading = null;

  player = new Player({
    stageEl, stage, mode: 'normal', muted: false, touchAllowed: true,
    onPlayed: (rec) => telemetry && telemetry.played(rec),
    onTouchEvent: (ev) => telemetry && telemetry.touch(ev),
    onState: () => {},
  });

  telemetry = new Telemetry({
    api,
    getState: () => ({ manifest_version: manifestVersion, mode: player.uiMode, current: player.current() }),
    onResponse: (data, rtt) => {
      authFailures = 0;
      if (data.server_time) clock.syncServer(data.server_time, rtt);
      if (data.manifest_version && data.manifest_version !== manifestVersion) loadManifest();
      for (const cmd of Array.isArray(data.commands) ? data.commands : []) handleCommand(cmd);
    },
    onAuthError: () => onAuthFailure(),
  });
  errorLog.subscribe((e) => telemetry.error(e));

  function applyManifest(m, fromCache = false) {
    noteManifest(m);
    if (fromCache) manifestReceivedAt = null;
    boot.hide();
    player.applyManifest(m);
    prefetchAssets(m, steleKey);
  }

  async function loadManifest() {
    if (manifestLoading) return manifestLoading;
    manifestLoading = (async () => {
      try {
        const res = await api.get('/api/player/manifest', { etag: manifestVersion, timeoutMs: 20_000 });
        authFailures = 0;
        if (res.status === 304) { manifestReceivedAt = Date.now(); return true; }
        if (!validManifest(res.data)) throw new Error('Manifest ungültig');
        if (!store.set('manifest', res.data)) errorLog.report('Manifest konnte nicht lokal gespeichert werden');
        applyManifest(res.data);
        return true;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onAuthFailure();
        else errorLog.report(`Manifest nicht geladen: ${err.message}`);
        return false;
      } finally {
        manifestLoading = null;
      }
    })();
    return manifestLoading;
  }

  function onAuthFailure() {
    authFailures += 1;
    // Ohne gespeicherten Schlüssel sofort koppeln, sonst erst nach mehreren Ablehnungen (Schlüssel entzogen).
    if (!started || !steleKey || authFailures >= TIMING.authFailuresBeforePairing) startPairing();
  }

  function startPairing() {
    if (pairingActive) return;
    pairingActive = true;
    steleKey = null;
    store.remove('key');
    store.remove('manifest');
    manifestVersion = null;
    player.touch.close();
    player.show.stop();
    player.activeSig = null;
    boot.hide();
    pairing.show(true);
    runPairing(api, pairing).then((key) => {
      steleKey = key;
      store.set('key', key);
      pairingActive = false;
      authFailures = 0;
      pairing.show(false);
      boot.show('Inhalte werden geladen …');
      start();
    });
  }

  async function start() {
    const ok = await loadManifest();
    if (pairingActive) return;
    if (!ok && !player.manifest) {
      const cached = store.get('manifest', null);
      if (validManifest(cached)) {
        errorLog.report('Server nicht erreichbar – letzter gespeicherter Stand wird gezeigt');
        applyManifest(cached, true);
      } else {
        boot.show('Server nicht erreichbar – neuer Versuch in Kürze …');
        setTimeout(start, 10_000);
        return;
      }
    }
    if (!started) {
      started = true;
      telemetry.start();
      // Sicherheitsnetz: Manifest regelmäßig prüfen, auch wenn Heartbeats ausfallen.
      setInterval(() => { if (!pairingActive) loadManifest(); }, 5 * 60_000);
      setInterval(() => { if (player.manifest) prefetchAssets(player.manifest, steleKey); }, TIMING.prefetchRepeatMs);
    }
  }

  // Befehle (SPEC §9.7); jede ID nur einmal ausführen.
  const handled = new Set();
  function handleCommand(cmd) {
    if (!cmd || cmd.id == null || handled.has(cmd.id)) return;
    handled.add(cmd.id);
    switch (cmd.command) {
      case 'reload':
        telemetry.result(cmd.id, true, 'Player neu geladen');
        setTimeout(reloadPage, 300);
        break;
      case 'identify':
        showIdentify(stageEl, player.manifest && player.manifest.stele);
        telemetry.result(cmd.id, true, 'Identifizierung angezeigt');
        break;
      case 'clear_cache':
        telemetry.result(cmd.id, true, 'Cache geleert, Player neu geladen');
        clearCaches().finally(() => setTimeout(reloadPage, 300));
        break;
      case 'screenshot':
        telemetry.result(cmd.id, false, 'Screenshots nimmt der Stelen-Agent auf');
        break;
      default:
        telemetry.result(cmd.id, false, `Unbekannter Befehl „${cmd.command}“`);
    }
  }

  // Täglicher Neustart (nicht während einer Touch-Sitzung – dann direkt danach).
  let dailyPending = false;
  onMinute((now) => {
    const at = parseHm(player.steleSettings.daily_reload);
    if (at === null) return;
    const parts = wallParts(now, player.timezone);
    if (parts.minutes !== at || Date.now() - bootedAt < 120_000) return;
    if (player.touch.isOpen) dailyPending = true;
    else reloadPage();
  });
  const closeTouch = player.touch.o.onClose;
  player.touch.o.onClose = () => {
    closeTouch();
    if (dailyPending) reloadPage();
  };

  startLivenessCheck();
  if (!steleKey) {
    // Vielleicht authentifiziert das Cookie (Server setzt es bei ?key=); sonst Kopplung.
    const ok = await loadManifest();
    if (!ok && !pairingActive) {
      const cached = store.get('manifest', null);
      if (validManifest(cached)) applyManifest(cached, true);
      else if (!player.manifest) boot.show('Server nicht erreichbar – neuer Versuch in Kürze …');
      setTimeout(start, 10_000);
      return;
    }
    if (pairingActive) return;
  } else {
    // Sofort mit gespeichertem Stand beginnen (kein Warten auf das Netz), dann aktualisieren.
    const cached = store.get('manifest', null);
    if (validManifest(cached)) applyManifest(cached, true);
  }
  start();
}

// Kopplung (SPEC §9.6): Code holen, alle 3 s abfragen; abgelaufen → neuer Code.
async function runPairing(api, screen) {
  for (;;) {
    let code;
    try {
      screen.setStatus('Code wird angefordert …');
      const res = await api.post('/api/player/pairing', {
        device_info: { user_agent: navigator.userAgent, screen: { w: window.screen.width, h: window.screen.height }, player_version: PLAYER_VERSION },
      });
      code = res.data && res.data.code;
      if (!code) throw new Error('Keine Antwort');
    } catch (err) {
      screen.setCode('');
      const wait = err.status === 429 ? 30 : 10;
      screen.setStatus(`${err.status === 429 ? 'Zu viele Anfragen' : 'CMS nicht erreichbar'} – neuer Versuch in ${wait} Sekunden`, 'warning');
      await sleep(wait * 1000);
      continue;
    }
    screen.setCode(code);
    screen.setStatus('Warten auf Kopplung …');
    for (;;) {
      await sleep(TIMING.pairingPollMs);
      try {
        const res = await api.get(`/api/player/pairing/${encodeURIComponent(code)}`);
        const d = res.data || {};
        if (d.status === 'paired' && d.key) {
          screen.setStatus(`Gekoppelt${d.stele && d.stele.name ? ` mit „${d.stele.name}“` : ''} – Start …`);
          await sleep(800);
          return d.key;
        }
        if (d.status === 'expired') break;
        screen.setStatus('Warten auf Kopplung …');
      } catch (err) {
        if (err.status === 404 || err.status === 410) break;
        screen.setStatus('Verbindung unterbrochen – Code bleibt gültig', 'warning');
      }
    }
    screen.setStatus('Code abgelaufen – neuer Code wird angefordert …');
  }
}

// Letzte Absicherung: steht die Diashow sichtbar still, weiterschalten bzw. neu laden.
function startLivenessCheck() {
  let stuckSince = 0;
  setInterval(() => {
    if (!player || !player.manifest || player.night || player.empty || player.touch.isOpen || !player.show.playing) {
      stuckSince = 0;
      return;
    }
    const cur = player.show.current;
    const limit = cur ? (cur.view.plannedMs || 10_000) + TIMING.watchdogGraceMs + 30_000 : 60_000;
    const age = cur ? Date.now() - cur.startedAt : (stuckSince ? Date.now() - stuckSince : 0);
    if (!cur && !stuckSince) { stuckSince = Date.now(); return; }
    if (cur && age < limit) { stuckSince = 0; return; }
    if (age >= limit) {
      if (!stuckSince || Date.now() - stuckSince < 60_000) {
        if (!stuckSince) stuckSince = Date.now();
        errorLog.report('Diashow steht – nächste Folie wird erzwungen');
        player.show.next();
      } else {
        scheduleFatalReload('Diashow steht dauerhaft');
      }
    }
  }, 15_000);
}

// ---------- Service Worker (nur Normalbetrieb) ----------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/player/sw.js', { scope: '/player/' })
    .catch((err) => errorLog.report(`Service Worker nicht registriert: ${err.message}`));
}

function prefetchAssets(manifest, key) {
  if (!('serviceWorker' in navigator) || !Array.isArray(manifest.assets)) return;
  navigator.serviceWorker.ready.then((reg) => {
    const sw = reg.active || navigator.serviceWorker.controller;
    if (sw) sw.postMessage({ type: 'prefetch', assets: manifest.assets, key: key || null });
  }).catch(() => {});
}

async function clearCaches() {
  store.remove('manifest');
  try {
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  } catch (err) {
    errorLog.report(`Cache nicht geleert: ${err.message}`);
  }
}

// ---------- Vorschau ----------

async function runPreview() {
  hardenKiosk(false);
  const boot = new BootScreen(stageEl);
  const id = params.get('presentation');
  const source = params.get('source') === 'draft' ? 'draft' : 'published';
  const startIndex = params.has('slide') ? Math.max(0, Number(params.get('slide')) || 0) : null;
  player = new Player({
    stageEl, stage, mode: 'preview', muted: false, touchAllowed: true,
    autoplay: params.get('autoplay') !== '0',
    onState: stateMessage,
  });
  player.setFixedPresentation(id);
  listenAdmin(adminControls({
    setManifest: (m) => {
      if (!validManifest(m.manifest)) throw new Error('Manifest ungültig');
      boot.hide();
      player.applyManifest(m.manifest, { immediate: true });
    },
  }));
  if (!id) {
    boot.show('Keine Präsentation angegeben');
    postToAdmin('player:ready', { total: 0 });
    return;
  }
  const api = createApi();
  try {
    const res = await api.get(`/api/presentations/${encodeURIComponent(id)}/manifest?source=${source}`, { timeoutMs: 20_000 });
    if (!validManifest(res.data)) throw new Error('Manifest ungültig');
    noteManifest(res.data);
    boot.hide();
    player.applyManifest(res.data, { startIndex });
    if (params.get('touch') === '1') player.openTouch();
    postToAdmin('player:ready', { total: player.show.total });
  } catch (err) {
    boot.show(`Vorschau nicht verfügbar: ${err.message}`);
    postToAdmin('player:error', { message: err.message });
    postToAdmin('player:ready', { total: 0 });
  }
}

// ---------- Einzelfolie ----------

function runSlide() {
  hardenKiosk(false);
  player = new Player({ stageEl, stage, mode: 'slide', muted: false, touchAllowed: false, onState: stateMessage });
  listenAdmin(adminControls({
    render: (m) => player.render(m),
  }));
  document.addEventListener('tx:fit', (e) => postToAdmin('player:fit', e.detail));
  postToAdmin('player:ready', { total: 0 });
}

// ---------- Live-Ansicht ----------

async function runMirror() {
  hardenKiosk(false);
  const boot = new BootScreen(stageEl);
  const id = params.get('stele');
  player = new Player({ stageEl, stage, mode: 'mirror', muted: true, touchAllowed: false, onState: stateMessage });
  listenAdmin(adminControls({
    showItem: (m) => player.show.gotoItem(m.item_id),
  }));
  const api = createApi();
  let ready = false;
  const load = async () => {
    try {
      const res = await api.get(`/api/steles/${encodeURIComponent(id)}/manifest`, { etag: manifestVersion, timeoutMs: 20_000 });
      if (res.status === 304) return;
      if (!validManifest(res.data)) throw new Error('Manifest ungültig');
      noteManifest(res.data);
      boot.hide();
      player.applyManifest(res.data);
      if (!ready) {
        ready = true;
        postToAdmin('player:ready', { total: player.show.total });
      }
    } catch (err) {
      if (!ready) boot.show(`Live-Ansicht nicht verfügbar: ${err.message}`);
      errorLog.report(`Live-Ansicht: ${err.message}`);
    }
  };
  if (!id) { boot.show('Keine Stele angegeben'); return; }
  await load();
  setInterval(load, TIMING.mirrorPollMs);
}

const runners = { normal: runNormal, preview: runPreview, slide: runSlide, mirror: runMirror };
Promise.resolve().then(runners[mode]).catch((err) => {
  errorLog.report(`Start fehlgeschlagen: ${err && err.message ? err.message : err}`);
  scheduleFatalReload('Start fehlgeschlagen');
});
