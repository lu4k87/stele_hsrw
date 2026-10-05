// Service Worker des Stelen-Players (SPEC §9.4), Scope /player/.
// - Player-Dateien (/player/, /shared/): network-first, Rückfall auf Cache (offline-fähig)
// - /media/*: cache-first (Dateien sind unveränderlich), Range-Anfragen → 206 aus dem Cache
// - Nachricht {type:'prefetch', assets, key}: fehlende Dateien vorab laden (max. 2 parallel),
//   nicht mehr benötigte Dateien entfernen
// - Seiten in den Modi preview/slide/mirror werden nicht bedient (reines Netz).

const SHELL_CACHE = 'stelecms-shell-v2';
const MEDIA_CACHE = 'stelecms-media-v1';
const META_CACHE = 'stelecms-meta-v1';
const KEY_URL = '/player/__stelecms_key';
const NETWORK_TIMEOUT_MS = 6000;
const PARALLEL = 2;

const SHELL_FILES = [
  '/player/', '/player/index.html', '/player/css/player.css', '/player/css/frame.css',
  '/player/css/textslides.css', '/player/css/touch.css', '/player/css/states.css',
  '/player/js/main.js', '/player/js/api.js', '/player/js/config.js', '/player/js/frame.js', '/player/js/log.js',
  '/player/js/messaging.js', '/player/js/overlays.js', '/player/js/player.js', '/player/js/schedule.js',
  '/player/js/slideshow.js', '/player/js/stage.js', '/player/js/store.js', '/player/js/telemetry.js',
  '/player/js/time.js', '/player/js/touch.js', '/player/js/util.js',
  '/player/js/slides/common.js', '/player/js/slides/fit.js', '/player/js/slides/image.js', '/player/js/slides/index.js',
  '/player/js/slides/pdf.js', '/player/js/slides/text.js', '/player/js/slides/video.js', '/player/js/slides/web.js',
  '/shared/icons.js',
];
const NO_SW_MODES = ['preview', 'slide', 'mirror'];

let steleKey = null;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => Promise.all(SHELL_FILES.map((url) =>
    fetch(url, { cache: 'no-store' }).then((res) => (res.ok ? cache.put(url, res) : null)).catch(() => null)))));
});

self.addEventListener('activate', (event) => {
  const keep = [SHELL_CACHE, MEDIA_CACHE, META_CACHE];
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (!keep.includes(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

function modeOf(url) {
  try { return new URL(url).searchParams.get('mode') || 'normal'; } catch { return 'normal'; }
}

async function clientMode(clientId) {
  if (!clientId) return 'normal';
  try {
    const client = await self.clients.get(clientId);
    return client ? modeOf(client.url) : 'normal';
  } catch { return 'normal'; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const isMedia = url.pathname.startsWith('/media/');
  const isShell = url.pathname.startsWith('/player/') || url.pathname.startsWith('/shared/');
  if (!isMedia && !isShell) return;
  if (req.mode === 'navigate') {
    if (NO_SW_MODES.includes(modeOf(req.url))) return;
    event.respondWith(networkFirst(req, true));
    return;
  }
  event.respondWith((async () => {
    if (NO_SW_MODES.includes(await clientMode(event.clientId))) return fetch(req);
    return isMedia ? mediaFirst(req) : networkFirst(req, false);
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// Player-Dateien: Netz zuerst, Cache als Rückfall. Seiten-Aufruf ohne Query speichern (Schlüssel!).
async function networkFirst(req, isNavigation) {
  const url = new URL(req.url);
  const cacheKey = isNavigation ? '/player/' : url.origin + url.pathname;
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await withTimeout(fetch(req, { cache: 'no-store' }), NETWORK_TIMEOUT_MS);
    if (res.ok && res.type === 'basic') cache.put(cacheKey, res.clone()).catch(() => {});
    if (res.status < 500) return res;
    // Serverfehler (z. B. Wartung): gespeicherten Stand bevorzugen, sonst Fehlerantwort durchreichen.
    const fallback = await cache.match(cacheKey, { ignoreSearch: true });
    return fallback || res;
  } catch {
    const cached = await cache.match(cacheKey, { ignoreSearch: true });
    if (cached) return cached;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function getKey() {
  if (steleKey) return steleKey;
  try {
    const res = await (await caches.open(META_CACHE)).match(KEY_URL);
    steleKey = res ? (await res.text()) || null : null;
  } catch { steleKey = null; }
  return steleKey;
}

async function saveKey(key) {
  steleKey = key || null;
  try {
    const cache = await caches.open(META_CACHE);
    if (key) await cache.put(KEY_URL, new Response(key));
    else await cache.delete(KEY_URL);
  } catch { /* egal */ }
}

function mediaKey(url) {
  const u = new URL(url, self.location.origin);
  return u.origin + u.pathname;
}

async function fetchMedia(url, range = null) {
  const headers = {};
  if (range) headers.Range = range;
  const key = await getKey();
  if (key) headers['X-Stele-Key'] = key;
  return fetch(url, { headers, credentials: 'same-origin', cache: 'no-store' });
}

// Mediendateien: Cache zuerst; Range-Anfragen werden aus der gespeicherten Datei als 206 beantwortet.
async function mediaFirst(req) {
  const key = mediaKey(req.url);
  const range = req.headers.get('range');
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(key);
  if (cached) return range ? rangeResponse(cached, range) : cached;
  try {
    const res = await fetchMedia(req.url, range);
    if (!range && res.status === 200) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

async function rangeResponse(cached, rangeHeader) {
  const blob = await cached.blob();
  const size = blob.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).split(',')[0].trim());
  let start;
  let end;
  if (m && m[1] !== '') {
    start = Number(m[1]);
    end = m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
  } else if (m && m[2] !== '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  }
  if (!m || start === undefined || start >= size || start > end) {
    return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const type = cached.headers.get('Content-Type') || 'application/octet-stream';
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}

// ---------- Vorab-Laden ----------

let prefetchRunning = false;
let prefetchNext = null;

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'prefetch' || !Array.isArray(msg.assets)) return;
  event.waitUntil((async () => {
    if (msg.key) await saveKey(msg.key);
    prefetchNext = msg.assets.filter((a) => typeof a === 'string' && a.startsWith('/media/'));
    if (prefetchRunning) return;
    prefetchRunning = true;
    try {
      while (prefetchNext) {
        const list = prefetchNext;
        prefetchNext = null;
        await prefetch(list);
      }
    } finally {
      prefetchRunning = false;
    }
  })());
});

async function prefetch(assets) {
  const cache = await caches.open(MEDIA_CACHE);
  const wanted = new Set(assets.map(mediaKey));
  // Aufräumen: nicht mehr benötigte Dateien entfernen.
  for (const req of await cache.keys()) {
    if (!wanted.has(mediaKey(req.url))) await cache.delete(req);
  }
  const missing = [];
  for (const key of wanted) if (!(await cache.match(key))) missing.push(key);
  let i = 0;
  const worker = async () => {
    while (i < missing.length) {
      const url = missing[i++];
      try {
        const res = await fetchMedia(url);
        if (res.status === 200) await cache.put(url, res);
      } catch { /* nächster Versuch beim nächsten Manifest bzw. in 10 min */ }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}
