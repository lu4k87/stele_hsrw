// Player als Vorschau im Hochformat-Rahmen (iframe, gleiche Herkunft, postMessage nach SPEC §9.2).
//
//   const pf = playerFrame({ src: playerUrls.preview(12, { source: 'draft' }), label: 'Entwurf' });
//   container.append(pf.el);
//   pf.on('player:state', (s) => …);  pf.send({ type: 'goto', index: 3 });
//   pf.send({ type: 'render', slide, design, settings, view: 'slide' });   // Einzelfolie (mode=slide)
//   pf.destroy();   // beim Verlassen der Ansicht
import { h } from '../dom.js';
import { icon } from '../icons.js';

export const playerUrls = {
  preview: (presentationId, { source = 'draft', slide = null, autoplay = true, touch = false } = {}) => {
    const q = new URLSearchParams({ mode: 'preview', presentation: String(presentationId), source, autoplay: autoplay ? '1' : '0' });
    if (slide !== null && slide !== undefined) q.set('slide', String(slide));
    if (touch) q.set('touch', '1');
    return `/player/?${q}`;
  },
  slide: () => '/player/?mode=slide',
  mirror: (steleId) => `/player/?mode=mirror&stele=${encodeURIComponent(steleId)}`,
};

export function playerFrame({ src, width = 1080, height = 1920, label = null, maxHeight = null, title = 'Vorschau der Stele', className = null } = {}) {
  const listeners = new Map();
  const queue = [];
  let ready = false;
  let readyResolve;
  const readyPromise = new Promise((r) => { readyResolve = r; });

  const iframe = h('iframe', { src, title, loading: 'eager', allow: 'autoplay; fullscreen' });
  const overlay = h('div', { class: 'player-frame__overlay', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Vorschau wird geladen …');
  const el = h('div', {
    class: ['player-frame', className],
    style: { '--frame-ratio': `${width} / ${height}`, '--frame-max-h': maxHeight },
  }, iframe, overlay, label ? h('span', { class: 'player-frame__label' }, label) : null);

  const onMessage = (e) => {
    if (e.origin !== location.origin || e.source !== iframe.contentWindow) return;
    const msg = e.data;
    if (!msg || msg.source !== 'stelecms' || typeof msg.type !== 'string') return;
    if (msg.type === 'player:ready') {
      ready = true;
      overlay.hidden = true;
      readyResolve();
      while (queue.length) post(queue.shift());
    }
    if (msg.type === 'player:error') showError(msg.message || 'Die Vorschau konnte nicht geladen werden.');
    for (const fn of listeners.get(msg.type) || []) fn(msg);
    for (const fn of listeners.get('*') || []) fn(msg);
  };
  window.addEventListener('message', onMessage);

  // Kein „ready“ nach 12 s → Hinweis statt endlosem Laden
  const timeout = setTimeout(() => { if (!ready) showError('Die Vorschau antwortet nicht. Bitte neu laden.'); }, 12000);

  function showError(text) {
    overlay.hidden = false;
    overlay.replaceChildren(icon('alert-triangle', { size: 28 }), h('span', {}, text),
      h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick: () => reload() }, icon('refresh', { size: 16 }), 'Neu laden'));
  }

  function post(msg) {
    iframe.contentWindow?.postMessage({ ...msg, source: 'stelecms' }, location.origin);
  }

  function reload(newSrc = null) {
    ready = false;
    overlay.hidden = false;
    overlay.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Vorschau wird geladen …');
    iframe.src = newSrc || iframe.src;
  }

  return {
    el,
    iframe,
    ready: readyPromise,
    send(msg) { if (ready) post(msg); else queue.push(msg); },
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    reload,
    destroy() {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      iframe.src = 'about:blank';
      el.remove();
    },
  };
}
