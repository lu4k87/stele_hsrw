// Rahmen um die Folien (SPEC §9.3): Header (Logo, Titel/Untertitel, Uhr/Datum) und Footer
// (Laufband mit konstanter Geschwindigkeit in px/s als nahtlose Schleife oder statischer Text).
// Neu aufgebaut wird nur, wenn sich Design/Einstellungen wirklich ändern (kein Flackern).

import { h, clampNumber, safeColor, readableTextColor } from './util.js';
import { formatTime, formatDate, onMinute, clock } from './time.js';
import { fitLine } from './slides/fit.js';

const FONT_CLASSES = ['font-sans', 'font-serif', 'font-condensed'];

export function headerHeight(design) {
  return Math.round(clampNumber(design && design.header && design.header.height, 100, 400, 180));
}

export function footerHeight(design) {
  return Math.round(clampNumber(design && design.footer && design.footer.height, 60, 240, 96));
}

// Folienbereich in Bühnen-Pixeln: oben/unten belegte Höhe für eine Folie (fullscreen → 0).
export function frameInsets(design, settings, slide = null) {
  if (!design || (slide && slide.fullscreen)) return { top: 0, bottom: 0 };
  const top = settings && settings.show_header !== false && design.header.enabled ? headerHeight(design) : 0;
  const bottom = settings && settings.show_footer !== false && design.footer.enabled ? footerHeight(design) : 0;
  return { top, bottom };
}

export function tickerItems(design, feeds) {
  const f = design.footer;
  const own = Array.isArray(f.ticker_items) ? f.ticker_items.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const feed = f.ticker_rss_url && feeds && feeds[f.ticker_rss_url];
  const fromFeed = feed && Array.isArray(feed.items) ? feed.items.map((s) => String(s || '').trim()).filter(Boolean) : [];
  return own.concat(fromFeed);
}

export class Frame {
  constructor(stageEl) {
    this.stageEl = stageEl;
    this.header = h('header', { class: 'frame-header is-absent', 'aria-hidden': 'true' });
    this.footer = h('footer', { class: 'frame-footer is-absent', 'aria-hidden': 'true' });
    stageEl.append(this.header, this.footer);
    this.timezone = null;
    this.feeds = {};
    this.design = null;
    this.key = '';
    this.tickerAnim = null;
    this.clockEls = null;
    this.hidden = false;
    onMinute(() => this.updateClock());
  }

  setContext({ timezone, feeds } = {}) {
    if (timezone !== undefined && timezone !== this.timezone) {
      this.timezone = timezone;
      this.updateClock();
    }
    if (feeds !== undefined) this.feeds = feeds || {};
  }

  // design: normalisiert oder null (ohne Rahmen); settings: Diashow-Einstellungen.
  apply(design, settings) {
    const showHeader = Boolean(design && settings.show_header !== false && design.header.enabled);
    const showFooter = Boolean(design && settings.show_footer !== false && design.footer.enabled);
    const items = design ? tickerItems(design, this.feeds) : [];
    const key = JSON.stringify([design, showHeader, showFooter, items]);
    if (key === this.key) return false;
    this.key = key;
    this.design = design;
    const theme = design ? design.theme : { font: 'sans', accent_color: '#F5B400' };
    const font = ['sans', 'serif', 'condensed'].includes(theme.font) ? theme.font : 'sans';
    this.stageEl.classList.remove(...FONT_CLASSES);
    this.stageEl.classList.add(`font-${font}`);
    const accent = safeColor(theme.accent_color, '#F5B400');
    this.stageEl.style.setProperty('--accent', accent);
    this.stageEl.style.setProperty('--accent-fg', readableTextColor(accent));
    this.buildHeader(showHeader ? design.header : null);
    this.buildFooter(showFooter ? design.footer : null, items);
    return true;
  }

  buildHeader(cfg) {
    const el = this.header;
    el.replaceChildren();
    this.clockEls = null;
    el.classList.toggle('is-absent', !cfg);
    if (!cfg) return;
    const height = headerHeight(this.design);
    el.style.setProperty('--hh', String(height));
    el.style.height = `${height}px`;
    el.style.background = safeColor(cfg.bg_color, '#0F2747');
    el.style.color = safeColor(cfg.text_color, '#FFFFFF');
    const center = cfg.logo_position === 'center';
    el.className = `frame-header logo-${center ? 'center' : 'left'}${this.hidden ? ' is-hidden' : ''}`;
    const logo = this.design.logo_url
      ? h('div', { class: 'hd-logo' }, h('img', { src: this.design.logo_url, alt: '', draggable: 'false', decoding: 'async' }))
      : null;
    const refit = () => requestAnimationFrame(() => el.querySelectorAll('.fit-line').forEach((line) => fitLine(line, { min: 0.55 })));
    if (logo) {
      logo.firstChild.addEventListener('error', () => { logo.remove(); refit(); }, { once: true });
      logo.firstChild.addEventListener('load', refit, { once: true });
    }
    const title = String(cfg.title || '').trim();
    const subtitle = String(cfg.subtitle || '').trim();
    const titles = title || subtitle ? h('div', { class: 'hd-titles' },
      title ? h('div', { class: 'hd-title fit-line', text: title }) : null,
      subtitle ? h('div', { class: 'hd-subtitle fit-line', text: subtitle }) : null) : h('div', { class: 'hd-titles' });
    let clockBox = null;
    if (cfg.show_clock || cfg.show_date) {
      const time = cfg.show_clock ? h('div', { class: 'hd-time' }) : null;
      const date = cfg.show_date ? h('div', { class: 'hd-date' }) : null;
      clockBox = h('div', { class: 'hd-clock' }, time, date);
      this.clockEls = { time, date, format: cfg.date_format === 'short' ? 'short' : 'long' };
    }
    if (center) el.append(titles, logo || h('div', { class: 'hd-logo is-empty' }), clockBox || h('div', { class: 'hd-clock' }));
    else el.append(...[logo, titles, clockBox].filter(Boolean));
    this.updateClock();
    // Nach dem Layout (und nach Logo/Schriften) Titel einzeilig einpassen.
    refit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit).catch(() => {});
  }

  buildFooter(cfg, items) {
    const el = this.footer;
    if (this.tickerAnim) { this.tickerAnim.cancel(); this.tickerAnim = null; }
    el.replaceChildren();
    el.classList.toggle('is-absent', !cfg);
    if (!cfg) return;
    const height = footerHeight(this.design);
    el.style.setProperty('--fh', String(height));
    el.style.height = `${height}px`;
    el.style.background = safeColor(cfg.bg_color, '#0F2747');
    el.style.color = safeColor(cfg.text_color, '#FFFFFF');
    el.className = `frame-footer mode-${cfg.mode === 'text' ? 'text' : 'ticker'}${this.hidden ? ' is-hidden' : ''}`;
    if (cfg.mode === 'text') {
      const text = String(cfg.text || '').trim();
      if (text) {
        const line = h('div', { class: 'ft-text fit-line', text });
        el.appendChild(line);
        requestAnimationFrame(() => fitLine(line, { min: 0.5 }));
      }
      return;
    }
    if (!items.length) return;
    const sep = String(cfg.ticker_separator ?? '•').trim();
    const seq = () => h('div', { class: 'tk-seq' }, items.map((text) => [
      h('span', { class: 'tk-item', text }),
      h('span', { class: 'tk-sep', 'aria-hidden': 'true', text: sep || ' ' }),
    ]));
    const track = h('div', { class: 'tk-track' }, seq());
    el.appendChild(h('div', { class: 'tk-viewport' }, track));
    const speed = clampNumber(cfg.ticker_speed, 40, 400, 120);
    const start = () => {
      if (!track.isConnected) return;
      const first = track.firstChild;
      const width = first.getBoundingClientRect().width / (this.scale() || 1);
      if (!width) return;
      // So viele Kopien, dass die Bühne auch beim Verschieben um eine Sequenzbreite gefüllt bleibt.
      const stageWidth = this.stageEl.offsetWidth || 1080;
      const copies = Math.max(1, Math.ceil(stageWidth / width)) + 1;
      while (track.childElementCount < copies) track.appendChild(first.cloneNode(true));
      this.tickerAnim = track.animate(
        [{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${-width}px,0,0)` }],
        { duration: (width / speed) * 1000, iterations: Infinity, easing: 'linear' },
      );
    };
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(() => requestAnimationFrame(start)).catch(start);
  }

  // Tatsächlicher Skalierungsfaktor der Bühne (getBoundingClientRect liefert Fenster-Pixel).
  scale() {
    const w = this.stageEl.getBoundingClientRect().width;
    return w && this.stageEl.offsetWidth ? w / this.stageEl.offsetWidth : 1;
  }

  updateClock() {
    if (!this.clockEls) return;
    const now = clock.now();
    const { time, date, format } = this.clockEls;
    if (time) time.textContent = formatTime(now, this.timezone);
    if (date) date.textContent = formatDate(now, this.timezone, format);
  }

  // Vollbild-Folie: Header/Footer weich aus-/einblenden (Dauer = Übergang).
  setHidden(hidden, ms = 400) {
    this.hidden = Boolean(hidden);
    for (const el of [this.header, this.footer]) {
      el.style.setProperty('--frame-fade', `${Math.max(0, ms)}ms`);
      el.classList.toggle('is-hidden', this.hidden);
    }
  }
}
