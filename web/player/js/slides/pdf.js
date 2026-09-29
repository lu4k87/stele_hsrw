// PDF-Folie: Seiten (PNG) nacheinander, je page_duration_s, weiche Überblendung; nächste Seite vorab dekodiert.

import { h, PausableTimer, withTimeout } from '../util.js';
import { TIMING } from '../config.js';
import { baseView, durationMs, decodeImage } from './common.js';

export function createPdfSlide(slide, ctx) {
  const pages = Array.isArray(slide.pages) ? slide.pages.filter(Boolean) : [];
  const pageMs = Math.max(1, Number(slide.page_duration_s) || 8) * 1000;
  const imgA = h('img', { class: 'media fit-contain pdf-page is-front', alt: '', decoding: 'async', draggable: 'false' });
  const imgB = h('img', { class: 'media fit-contain pdf-page', alt: '', decoding: 'async', draggable: 'false' });
  const el = h('div', { class: 'sv sv-pdf', style: { background: ctx.settings.background } }, imgA, imgB);
  const view = baseView(el);
  view.plannedMs = Number(slide.duration_s) > 0 ? durationMs(slide, ctx.settings) : Math.max(1, pages.length) * pageMs;
  let front = imgA;
  let back = imgB;
  let index = 0;
  let timer = null;
  let destroyed = false;
  let preloadIndex = -1;

  const preload = (i) => {
    if (pages.length < 2) return;
    preloadIndex = i;
    back.src = pages[i];
    back.decode().catch(() => { /* Fehler beim Umblättern behandelt */ });
  };

  const scheduleNext = () => {
    if (pages.length < 2 || destroyed) return;
    timer = new PausableTimer(nextPage, pageMs);
    timer.start();
  };

  async function nextPage() {
    if (destroyed) return;
    const next = (index + 1) % pages.length;
    try {
      if (preloadIndex !== next) back.src = pages[next];
      await withTimeout(decodeImage(back, 5000), 6000);
    } catch {
      scheduleNext(); // Seite fehlt: aktuelle Seite bleibt stehen, beim nächsten Takt erneut
      return;
    }
    if (destroyed) return;
    back.classList.add('is-front');
    front.classList.remove('is-front');
    [front, back] = [back, front];
    index = next;
    // Nach der Überblendung die folgende Seite in die hintere Ebene laden.
    setTimeout(() => { if (!destroyed) preload((index + 1) % pages.length); }, 700);
    scheduleNext();
  }

  view.load = async () => {
    if (!pages.length) throw new Error('PDF ohne Seiten');
    imgA.src = pages[0];
    await decodeImage(imgA, TIMING.imageTimeoutMs);
    preload(1 % pages.length);
  };
  view.start = () => { if (!timer) scheduleNext(); };
  view.pause = () => timer && timer.pause();
  view.resume = () => { if (timer) timer.resume(); else scheduleNext(); };
  view.destroy = () => {
    destroyed = true;
    if (timer) timer.clear();
    imgA.removeAttribute('src');
    imgB.removeAttribute('src');
    el.remove();
  };
  return view;
}
