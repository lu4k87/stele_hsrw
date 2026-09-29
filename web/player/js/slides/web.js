// Webseiten-Folie: iframe (sandbox ohne top-navigation/popups), zoom per CSS-Scale,
// refresh_s > 0 → Neuladen im Hintergrund und Tausch erst nach „load“ (kein weißer Blitz).

import { h, clamp, PausableTimer } from '../util.js';
import { TIMING } from '../config.js';
import { baseView, durationMs } from './common.js';

const SANDBOX = 'allow-scripts allow-same-origin allow-forms';

function isHttpUrl(url) {
  try {
    const u = new URL(url, location.href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Wartet auf „load“, höchstens timeoutMs; danach wird die Seite trotzdem gezeigt.
function waitFrameLoad(frame, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    frame.addEventListener('load', () => { clearTimeout(timer); resolve(true); }, { once: true });
  });
}

export function createWebSlide(slide, ctx) {
  const zoom = clamp(Number(slide.zoom) || 1, 0.25, 4);
  const interactive = Boolean(ctx.interactive);
  const el = h('div', { class: `sv sv-web${interactive ? ' is-interactive' : ''}` });
  const view = baseView(el);
  view.plannedMs = durationMs(slide, ctx.settings);
  const refreshMs = interactive ? 0 : Math.max(0, Number(slide.refresh_s) || 0) * 1000;
  let frame = null;
  let timer = null;
  let destroyed = false;

  const makeFrame = () => h('iframe', {
    class: 'web-frame',
    sandbox: SANDBOX,
    referrerpolicy: 'no-referrer',
    allow: 'autoplay',
    title: slide.title || 'Webseite',
    style: { width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: zoom === 1 ? null : `scale(${zoom})` },
  });

  async function refresh() {
    if (destroyed) return;
    const next = makeFrame();
    next.classList.add('is-behind');
    el.insertBefore(next, el.firstChild);
    next.src = slide.url;
    await waitFrameLoad(next, TIMING.iframeTimeoutMs);
    if (destroyed) { next.remove(); return; }
    const old = frame;
    frame = next;
    next.classList.remove('is-behind');
    if (old) old.remove();
    scheduleRefresh();
  }

  function scheduleRefresh() {
    if (!refreshMs || destroyed) return;
    timer = new PausableTimer(refresh, Math.max(5000, refreshMs));
    timer.start();
  }

  view.load = async () => {
    if (!isHttpUrl(slide.url)) throw new Error('Ungültige Webadresse');
    frame = makeFrame();
    el.appendChild(frame);
    frame.src = slide.url;
    await waitFrameLoad(frame, TIMING.iframeTimeoutMs);
  };
  view.start = () => { if (!timer) scheduleRefresh(); };
  view.pause = () => timer && timer.pause();
  view.resume = () => timer && timer.resume();
  view.destroy = () => {
    destroyed = true;
    if (timer) timer.clear();
    for (const f of el.querySelectorAll('iframe')) { f.src = 'about:blank'; f.remove(); }
    el.remove();
  };
  return view;
}
