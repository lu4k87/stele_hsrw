// Bild-Folie: object-fit nach fit, optional Ken-Burns (langsamer Zoom, wechselnde Richtung).

import { h } from '../util.js';
import { TIMING } from '../config.js';
import { baseView, durationMs, decodeImage } from './common.js';

const KEN_BURNS = [
  [{ transform: 'scale(1) translate(0, 0)' }, { transform: 'scale(1.1) translate(-1.6%, -1.2%)' }],
  [{ transform: 'scale(1.1) translate(1.4%, 1.2%)' }, { transform: 'scale(1) translate(0, 0)' }],
  [{ transform: 'scale(1.02) translate(1.2%, -1.4%)' }, { transform: 'scale(1.12) translate(-1%, 1.4%)' }],
  [{ transform: 'scale(1.12) translate(-1.2%, 1%)' }, { transform: 'scale(1.02) translate(1%, -1.2%)' }],
];
let kenBurnsCounter = 0;

export function createImageSlide(slide, ctx) {
  const fit = slide.fit === 'contain' || slide.fit === 'cover' ? slide.fit : ctx.settings.image_fit;
  const kenBurns = !ctx.interactive && Boolean(slide.ken_burns ?? ctx.settings.ken_burns);
  const img = h('img', { class: `media fit-${fit === 'contain' ? 'contain' : 'cover'}`, alt: '', decoding: 'async', draggable: 'false' });
  const el = h('div', { class: 'sv sv-image', style: { background: ctx.settings.background } }, img);
  const view = baseView(el);
  view.plannedMs = durationMs(slide, ctx.settings);
  let anim = null;

  const startKenBurns = () => {
    if (!kenBurns || anim) return;
    const frames = KEN_BURNS[kenBurnsCounter++ % KEN_BURNS.length];
    const duration = view.plannedMs + (ctx.settings.transition_ms || 0) * 2 + 1000;
    anim = img.animate(frames, { duration, easing: 'linear', fill: 'forwards' });
  };

  view.load = async () => {
    img.src = slide.src;
    await decodeImage(img, TIMING.imageTimeoutMs);
  };
  view.start = startKenBurns;
  view.pause = () => anim && anim.pause();
  view.resume = () => anim && anim.play();
  view.restart = () => { if (anim) anim.cancel(); anim = null; startKenBurns(); };
  view.destroy = () => {
    if (anim) anim.cancel();
    img.removeAttribute('src');
    el.remove();
  };
  return view;
}
