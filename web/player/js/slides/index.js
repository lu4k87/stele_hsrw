// Auswahl des Renderers je Folientyp.

import { h } from '../util.js';
import { iconSvg } from '/shared/icons.js';
import { baseView, durationMs } from './common.js';
import { createImageSlide } from './image.js';
import { createVideoSlide } from './video.js';
import { createPdfSlide } from './pdf.js';
import { createTextSlide } from './text.js';
import { createWebSlide } from './web.js';

const FACTORIES = {
  image: createImageSlide,
  video: createVideoSlide,
  pdf: createPdfSlide,
  text: createTextSlide,
  web: createWebSlide,
};

export const PLAYABLE_TYPES = Object.keys(FACTORIES);

// Folie in der echten Diashow abspielbar? (gelöschte/deaktivierte Folien werden übersprungen)
export function isPlayable(slide) {
  return Boolean(slide && FACTORIES[slide.type] && slide.enabled !== false);
}

// Ruhiger Platzhalter (Einzelfolien-Vorschau: Inhalt gelöscht oder Typ unbekannt).
export function createPlaceholderSlide(slide, ctx, message = 'Inhalt nicht gefunden') {
  const el = h('div', { class: 'sv sv-placeholder', style: { background: ctx.settings.background } },
    h('div', { class: 'ph-inner' },
      h('span', { class: 'ph-icon' }, iconSvg('alert-circle', { size: 120 })),
      h('p', { class: 'ph-text', text: message }),
      slide && slide.title ? h('p', { class: 'ph-sub', text: slide.title }) : null));
  const view = baseView(el);
  view.plannedMs = durationMs(slide, ctx.settings);
  return view;
}

export function createSlideView(slide, ctx) {
  const factory = slide && FACTORIES[slide.type];
  if (!factory) {
    if (ctx.allowPlaceholder) return createPlaceholderSlide(slide, ctx);
    throw new Error(`Unbekannter Folientyp „${slide && slide.type}“`);
  }
  return factory(slide, ctx);
}
