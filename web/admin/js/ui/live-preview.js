// Live-Vorschau ungespeicherter Stände: Player im Einzelfolien-Modus (mode=slide) + POST /api/preview/resolve.
//
//   const pv = livePreview({ label: 'Vorschau' });
//   side.append(pv.el);
//   pv.update({ design, items: [{ content_id: 7, content: { type: 'text', data } }] },
//             (res) => ({ slide: res.slides[0], design: res.design, settings: res.settings, view: 'slide' }));
//   // Aufräumen: pv.destroy();
//
// update() ist entprellt; nur die jeweils letzte Anfrage wird angezeigt. Fehler erscheinen unter dem Rahmen.
import { h, debounce, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { api, errorMessage } from '../api.js';
import { playerFrame, playerUrls } from './player-frame.js';
import { contentStyles } from './content-common.js';

export function livePreview({ label = null, title = 'Live-Vorschau', delay = 450, height = null } = {}) {
  contentStyles();
  const pf = playerFrame({ src: playerUrls.slide(), label, title });
  const status = h('div', { class: 'cu-preview__status', role: 'status', 'aria-live': 'polite' });
  const el = h('div', { class: 'cu-preview', style: height ? { '--cu-preview-h': height } : null }, pf.el, status);

  let seq = 0;
  let ctrl = null;
  let destroyed = false;
  let last = null;
  let lastMsg = null;
  const send = (msg) => { lastMsg = msg; pf.send(msg); };
  // Nach „Neu laden“ des Players den letzten Stand erneut zeigen
  let readyCount = 0;
  pf.on('player:ready', () => { readyCount += 1; if (readyCount > 1 && lastMsg) pf.send(lastMsg); });

  function setStatus(kind, text) {
    status.classList.toggle('is-error', kind === 'error');
    fill(status,
      kind === 'busy' ? h('span', { class: 'spinner', style: { width: '14px', height: '14px' }, 'aria-hidden': 'true' }) : null,
      kind === 'error' ? icon('alert-circle') : null,
      text || '',
    );
  }

  async function run(body, pick) {
    if (destroyed) return;
    last = { body, pick };
    const my = ++seq;
    ctrl?.abort();
    ctrl = new AbortController();
    setStatus('busy', 'Vorschau wird aktualisiert …');
    try {
      const res = await api.post('/api/preview/resolve', body, { signal: ctrl.signal });
      if (my !== seq || destroyed) return;
      const msg = pick(res);
      if (msg) send({ type: 'render', slide: null, design: null, settings: null, touch_menu: null, view: 'slide', ...msg });
      setStatus('ok', '');
    } catch (err) {
      if (err?.name === 'AbortError' || my !== seq || destroyed) return;
      setStatus('error', `Vorschau nicht verfügbar: ${errorMessage(err)}`);
    }
  }
  const debounced = debounce(run, delay);

  return {
    el,
    frame: pf,
    /** Entprellt aktualisieren. pick(res) → Nachricht für den Player (ohne type). */
    update(body, pick) { debounced(body, pick); },
    /** Sofort aktualisieren. */
    now(body, pick) { debounced.cancel(); run(body, pick); },
    /** Ohne Server direkt rendern (z. B. Beispielfolie). */
    render(msg) { send({ type: 'render', slide: null, design: null, settings: null, touch_menu: null, view: 'slide', ...msg }); },
    retry() { if (last) run(last.body, last.pick); },
    destroy() {
      destroyed = true;
      debounced.cancel();
      ctrl?.abort();
      pf.destroy();
    },
  };
}
