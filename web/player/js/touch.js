// Touch-Modus für Besucher (SPEC §9.5): Hinweis-Element, Kachelmenü (max. 2 Ebenen), Inhalte
// (Bild, PDF/Galerie mit Wischen + Pfeilen, Video mit Steuerung, Info-Folie, Webseite), Aktionsleiste,
// „Noch da?“-Countdown und Rückkehr zur Diashow. Große Ziele, aus 3–5 m lesbar.

import { h, clamp, readableTextColor, safeColor, randomId, isoUtc, formatClockTime } from './util.js';
import { iconSvg } from '/shared/icons.js';
import { TIMING } from './config.js';
import { decodeImage } from './slides/common.js';
import { createTextSlide } from './slides/text.js';
import { createWebSlide } from './slides/web.js';
import { createVideo, loadVideo, playVideo, releaseVideo } from './slides/video.js';
import { errorLog } from './log.js';

const SWIPE_MIN_PX = 90;

function button(cls, icon, label, onClick, { iconSize = 48, aria = null } = {}) {
  const btn = h('button', { type: 'button', class: cls, 'aria-label': aria || label || null },
    icon ? iconSvg(icon, { size: iconSize }) : null,
    label ? h('span', { class: 'btn-label', text: label }) : null);
  btn.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(ev); });
  return btn;
}

// ---------- Blätter-Ansicht (Galerie, PDF): Wischen, große Pfeile, Punkte oder Seitenzähler ----------

function createPager(items, { counter = 'dots', noun = 'Bild', onActivity = () => {} } = {}) {
  // items: [{ render(): { el, load(), start?(), pause?(), destroy() }, preload?() }]
  const viewport = h('div', { class: 'pg-viewport' });
  const prevBtn = button('pg-arrow pg-prev', 'chevron-left', '', () => go(index - 1), { iconSize: 72, aria: 'Zurück blättern' });
  const nextBtn = button('pg-arrow pg-next', 'chevron-right', '', () => go(index + 1), { iconSize: 72, aria: 'Weiter blättern' });
  const count = h('div', { class: 'pg-count', 'aria-live': 'polite' });
  const dots = counter === 'dots' && items.length <= 20
    ? h('div', { class: 'pg-dots' }, items.map((_, i) => {
      const d = h('button', { type: 'button', class: 'pg-dot', 'aria-label': `${noun} ${i + 1}` });
      d.addEventListener('click', (ev) => { ev.stopPropagation(); go(i); });
      return d;
    }))
    : null;
  const nav = h('div', { class: 'pg-nav' }, dots, count);
  const root = h('div', { class: 'pager' }, viewport, items.length > 1 ? prevBtn : null, items.length > 1 ? nextBtn : null, nav);
  let index = 0;
  let current = null;
  let busy = false;
  let destroyed = false;

  const updateNav = () => {
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= items.length - 1;
    count.textContent = items.length > 1 || counter === 'pages' ? `${noun} ${index + 1} von ${items.length}` : '';
    if (dots) [...dots.children].forEach((d, i) => d.classList.toggle('is-current', i === index));
  };

  const preloadAround = () => {
    for (const i of [index + 1, index - 1]) if (items[i] && items[i].preload) items[i].preload();
  };

  async function show(i, dir) {
    const view = items[i].render();
    view.el.classList.add('pg-item');
    viewport.appendChild(view.el);
    try {
      await view.load();
    } catch (err) {
      errorLog.report(`Touch-Inhalt: ${err && err.message ? err.message : err}`);
    }
    if (destroyed) { view.destroy(); return; }
    const old = current;
    current = view;
    index = i;
    updateNav();
    if (view.start) view.start();
    if (old) {
      if (old.pause) old.pause();
      const ms = 380;
      const opts = { duration: ms, easing: 'cubic-bezier(0.4,0,0.2,1)', fill: 'both' };
      const from = dir > 0 ? '100%' : '-100%';
      const to = dir > 0 ? '-100%' : '100%';
      const offset = old.el.style.getPropertyValue('--drag') || '0px';
      const a1 = view.el.animate([{ transform: `translate3d(${from},0,0)` }, { transform: 'translate3d(0,0,0)' }], opts);
      const a2 = old.el.animate([{ transform: `translate3d(${offset},0,0)` }, { transform: `translate3d(${to},0,0)` }], opts);
      await Promise.race([Promise.all([a1.finished, a2.finished]).catch(() => {}), new Promise((r) => setTimeout(r, ms + 300))]);
      a1.cancel();
      old.destroy();
    }
    preloadAround();
  }

  async function go(i) {
    if (busy || destroyed || i < 0 || i >= items.length || i === index) return;
    onActivity();
    busy = true;
    try { await show(i, i > index ? 1 : -1); } finally { busy = false; }
  }

  // Wischen: Element folgt dem Finger, Loslassen entscheidet.
  let drag = null;
  viewport.addEventListener('pointerdown', (ev) => {
    if (busy || items.length < 2 || !current) return;
    drag = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, dx: 0, active: false, scale: root.getBoundingClientRect().width / (root.offsetWidth || 1) || 1 };
  });
  viewport.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = (ev.clientX - drag.x) / drag.scale;
    const dy = (ev.clientY - drag.y) / drag.scale;
    if (!drag.active && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) {
      drag.active = true;
      try { viewport.setPointerCapture(ev.pointerId); } catch { /* egal */ }
    }
    if (!drag.active) return;
    const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === items.length - 1);
    drag.dx = atEdge ? dx * 0.3 : dx;
    current.el.style.setProperty('--drag', `${drag.dx}px`);
    current.el.style.transform = `translate3d(${drag.dx}px,0,0)`;
  });
  const endDrag = (ev) => {
    if (!drag || (ev && ev.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    onActivity();
    const target = d.dx < -SWIPE_MIN_PX ? index + 1 : d.dx > SWIPE_MIN_PX ? index - 1 : index;
    if (target !== index && target >= 0 && target < items.length) {
      const el = current.el;
      go(target).then(() => { el.style.transform = ''; });
    } else {
      const el = current.el;
      const a = el.animate([{ transform: `translate3d(${d.dx}px,0,0)` }, { transform: 'translate3d(0,0,0)' }], { duration: 220, easing: 'ease-out' });
      el.style.transform = '';
      el.style.removeProperty('--drag');
      a.finished.catch(() => {});
    }
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  // Klick nach einer Wischbewegung nicht an Inhalte weitergeben.
  viewport.addEventListener('click', (ev) => { if (drag && drag.active) ev.stopPropagation(); }, true);

  return {
    el: root,
    async load() {
      if (!items.length) throw new Error('Keine Einträge');
      updateNav();
      busy = true;
      try { await show(0, 0); } finally { busy = false; }
    },
    pause() { if (current && current.pause) current.pause(); },
    destroy() {
      destroyed = true;
      if (current) current.destroy();
      root.remove();
    },
  };
}

// ---------- Einzelne Touch-Ansichten ----------

function imageView(src, background = '#000') {
  const img = h('img', { class: 'media fit-contain', alt: '', draggable: 'false', decoding: 'async' });
  const el = h('div', { class: 'tv-image', style: { background } }, img);
  return {
    el,
    async load() { img.src = src; await decodeImage(img, TIMING.imageTimeoutMs); },
    destroy() { img.removeAttribute('src'); el.remove(); },
  };
}

function preloadImage(src) {
  let done = false;
  return () => {
    if (done || !src) return;
    done = true;
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  };
}

// Video mit Start/Pause, Neustart und Fortschritt (antippen zum Springen); Ton nach Stelen-Lautstärke.
function videoView(slide, volume, onActivity) {
  const video = createVideo({ src: slide.src, poster: slide.poster, muted: false, volume });
  video.classList.add('fit-contain');
  video.loop = false;
  const playBtn = button('vc-btn vc-play', 'play', '', () => toggle(), { iconSize: 56, aria: 'Abspielen' });
  const restartBtn = button('vc-btn vc-restart', 'skip-back', '', () => { onActivity(); video.currentTime = 0; start(); }, { iconSize: 48, aria: 'Von vorn' });
  const fill = h('div', { class: 'vc-fill' });
  const track = h('div', { class: 'vc-track', role: 'slider', 'aria-label': 'Fortschritt', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  const time = h('div', { class: 'vc-time', text: '0:00' });
  const bar = h('div', { class: 'vc-bar' }, playBtn, restartBtn, track, time);
  const el = h('div', { class: 'tv-video' }, h('div', { class: 'vc-stage' }, video), bar);
  let raf = 0;

  const setPlayIcon = () => {
    const playing = !video.paused && !video.ended;
    playBtn.replaceChildren(iconSvg(playing ? 'pause' : 'play', { size: 56 }));
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
    el.classList.toggle('is-playing', playing);
  };
  const tick = () => {
    const d = video.duration;
    const p = Number.isFinite(d) && d > 0 ? clamp(video.currentTime / d, 0, 1) : 0;
    fill.style.transform = `scaleX(${p})`;
    track.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    time.textContent = `${formatClockTime(video.currentTime)} / ${formatClockTime(Number.isFinite(d) ? d : 0)}`;
    raf = requestAnimationFrame(tick);
  };
  const start = () => {
    playVideo(video).catch((err) => errorLog.report(`Video (Touch): ${err && err.name ? err.name : err}`));
  };
  function toggle() {
    onActivity();
    if (video.paused || video.ended) {
      if (video.ended) video.currentTime = 0;
      start();
    } else video.pause();
  }
  video.addEventListener('play', setPlayIcon);
  video.addEventListener('pause', setPlayIcon);
  video.addEventListener('ended', setPlayIcon);
  video.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
  track.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onActivity();
    const r = track.getBoundingClientRect();
    const d = video.duration;
    if (Number.isFinite(d) && d > 0 && r.width) video.currentTime = clamp((ev.clientX - r.left) / r.width, 0, 1) * d;
  });
  return {
    el,
    async load() { await loadVideo(video, slide.src); tick(); },
    start() { start(); },
    pause() { video.pause(); },
    destroy() { cancelAnimationFrame(raf); releaseVideo(video); el.remove(); },
  };
}

// Folie (aus Touch-Aktion) → Touch-Ansicht.
function slideTouchView(slide, env) {
  const background = env.settings.background || '#000';
  switch (slide.type) {
    case 'image': return imageView(slide.src, background);
    case 'video': return videoView(slide, env.volume, env.onActivity);
    case 'pdf': {
      const pages = Array.isArray(slide.pages) ? slide.pages.filter(Boolean) : [];
      return createPager(pages.map((src) => ({ render: () => imageView(src, background), preload: preloadImage(src) })),
        { counter: 'pages', noun: 'Seite', onActivity: env.onActivity });
    }
    case 'text': {
      const v = createTextSlide(slide, { settings: env.settings, interactive: true });
      return { el: v.el, load: () => v.load(), destroy: () => v.destroy(), refit: v.refit };
    }
    case 'web': {
      const v = createWebSlide(slide, { settings: env.settings, interactive: true });
      return { el: v.el, load: () => v.load(), destroy: () => v.destroy() };
    }
    default: {
      const el = h('div', { class: 'tv-missing' }, iconSvg('alert-circle', { size: 120 }), h('p', { text: 'Inhalt nicht verfügbar' }));
      return { el, async load() {}, destroy() { el.remove(); } };
    }
  }
}

function galleryView(items, env) {
  // PDF-Einträge in einer Galerie werden zu einzelnen Seiten aufgefächert.
  const flat = [];
  for (const s of items || []) {
    if (!s) continue;
    if (s.type === 'pdf' && Array.isArray(s.pages)) s.pages.forEach((src) => flat.push({ type: 'image', src }));
    else flat.push(s);
  }
  return createPager(flat.map((s) => ({
    render: () => slideTouchView(s, env),
    preload: s.type === 'image' ? preloadImage(s.src) : null,
  })), { counter: 'dots', noun: 'Eintrag', onActivity: env.onActivity });
}

// ---------- Touch-Modus ----------

export class TouchMode {
  // opts: stageEl, frame, getInsets() → {top,bottom}, getVolume(), getSettings(),
  //       onOpen(), onClose(), onEvent(ev) (Telemetrie), onActivity()
  constructor(opts) {
    this.o = opts;
    this.menu = null;
    this.enabled = false;
    this.persistent = false;
    this.isOpen = false;
    this.stack = [];
    this.view = null;
    this.session = null;
    this.idleTimer = null;
    this.countdown = null;
    this.attract = h('div', { class: 'attract is-hidden', 'aria-hidden': 'true' },
      h('span', { class: 'attract-icon' }, iconSvg('hand', { size: 64 })), h('span', { class: 'attract-text' }));
    this.root = h('div', { class: 'touch is-hidden', role: 'dialog', 'aria-label': 'Informationen' });
    this.body = h('div', { class: 'tm-body' });
    this.backBtn = button('tm-btn tm-back', 'chevron-left', 'Zurück', () => this.back(), { iconSize: 56 });
    this.homeBtn = button('tm-btn tm-home', 'home', 'Zur Startseite', () => this.home(), { iconSize: 52 });
    this.barTitle = h('div', { class: 'tm-bar-title' });
    this.bar = h('div', { class: 'tm-bar' }, this.backBtn, this.barTitle, this.homeBtn);
    this.still = this.buildStillThere();
    this.root.append(this.body, this.bar, this.still);
    opts.stageEl.append(this.attract, this.root);
    const activity = () => this.activity();
    this.root.addEventListener('pointerdown', activity, true);
    this.root.addEventListener('keydown', activity, true);
    // Tippen in eine Webseite (iframe) ist nicht messbar – Fokuswechsel zählt als Aktivität.
    window.addEventListener('blur', () => { if (this.isOpen) this.activity(); });
  }

  buildStillThere() {
    this.stillNum = h('div', { class: 'st-num' });
    const cont = button('st-continue', 'check', 'Weiter', () => this.activity(true), { iconSize: 56 });
    return h('div', { class: 'still is-hidden', role: 'alertdialog', 'aria-label': 'Noch da?' },
      h('div', { class: 'st-card' },
        h('div', { class: 'st-title', text: 'Noch da?' }),
        h('div', { class: 'st-text', text: 'Gleich geht es zurück zur Startseite.' }),
        this.stillNum, cont));
  }

  // menu: normalisiertes Touch-Menü oder null; enabled: Stelen-Einstellung touch_enabled.
  setMenu(menu, enabled = true) {
    const sig = JSON.stringify(menu);
    const changed = sig !== this.menuSig;
    this.menuSig = sig;
    this.menu = menu;
    this.enabled = Boolean(menu && enabled);
    if (!this.enabled && this.isOpen && !this.persistent) this.close();
    else if (changed && this.isOpen && menu) { this.restack(); this.renderTop(true); }
    this.updateAttract();
  }

  // Neuer Menü-Stand bei geöffnetem Menü: Ebenen anhand der Kachel-IDs neu zuordnen.
  restack() {
    const old = this.stack;
    const stack = [{ kind: 'menu', tiles: this.menu.tiles, title: this.menu.title, intro: this.menu.intro }];
    for (const level of old.slice(1)) {
      const parent = stack[stack.length - 1];
      if (parent.kind !== 'menu') break;
      const id = level.kind === 'menu' ? level.tileId : level.tile.id;
      const tile = (parent.tiles || []).find((t) => t && t.id === id);
      if (!tile) break;
      if (tile.action && tile.action.type === 'submenu') {
        stack.push({ kind: 'menu', tiles: tile.action.tiles || [], title: tile.label || '', intro: '', tileId: tile.id });
      } else stack.push({ kind: 'content', tile });
    }
    this.stack = stack;
  }

  get available() { return this.enabled && Boolean(this.menu); }

  updateAttract(captionShown = this.captionShown, insets = null) {
    this.captionShown = Boolean(captionShown);
    const a = this.menu && this.menu.attract;
    const show = this.available && !this.isOpen && a && a.enabled && !this.suppressAttract;
    this.attract.classList.toggle('is-hidden', !show);
    if (!show) return;
    this.attract.lastChild.textContent = String(a.text || 'Tippen für Informationen');
    const ins = insets || this.o.getInsets();
    this.attract.style.bottom = `${ins.bottom + (this.captionShown ? 190 : 56)}px`;
  }

  setSuppressed(v) { this.suppressAttract = Boolean(v); this.updateAttract(); }

  open({ persistent = false } = {}) {
    if (!this.menu) return false;
    this.persistent = persistent;
    const ins = this.o.getInsets();
    this.root.style.top = `${ins.top}px`;
    this.root.style.bottom = `${ins.bottom}px`;
    this.root.style.setProperty('--tm-accent', 'var(--accent)');
    if (!this.isOpen) {
      this.isOpen = true;
      this.stack = [{ kind: 'menu', tiles: this.menu.tiles, title: this.menu.title, intro: this.menu.intro }];
      this.renderTop(true);
      this.root.classList.remove('is-hidden');
      this.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
      this.updateAttract();
      if (!persistent) {
        this.session = { id: randomId('s-'), started: Date.now() };
        this.event('session_start');
      }
      if (this.o.onOpen) this.o.onOpen();
    } else {
      this.renderTop(true);
    }
    this.activity();
    return true;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.hideStill();
    clearTimeout(this.idleTimer);
    this.destroyView();
    this.root.classList.add('is-hidden');
    this.body.replaceChildren();
    this.stack = [];
    if (this.session) {
      this.event('session_end', { duration_s: Math.round((Date.now() - this.session.started) / 100) / 10 });
      this.session = null;
    }
    this.persistent = false;
    this.updateAttract();
    if (this.o.onClose) this.o.onClose();
  }

  back() {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.renderTop(false);
    } else if (!this.persistent) this.close();
  }

  home() {
    if (this.persistent) {
      this.stack = this.stack.slice(0, 1);
      this.renderTop(false);
    } else this.close();
  }

  event(name, extra = {}) {
    if (!this.o.onEvent || !this.session) return;
    this.o.onEvent({ ts: isoUtc(), event: name, session_id: this.session.id, tile_id: null, label: null, duration_s: null, ...extra });
  }

  openTile(tile) {
    const action = tile.action || {};
    this.event('tile_open', { tile_id: tile.id ?? null, label: tile.label ?? null });
    if (action.type === 'submenu') {
      this.stack.push({ kind: 'menu', tiles: Array.isArray(action.tiles) ? action.tiles : [], title: tile.label || '', intro: '', tileId: tile.id });
    } else {
      this.stack.push({ kind: 'content', tile });
    }
    this.renderTop(false);
  }

  destroyView() {
    if (this.view) {
      try { this.view.destroy(); } catch { /* egal */ }
      this.view = null;
    }
  }

  env() {
    return {
      settings: this.o.getSettings(),
      volume: this.o.getVolume(),
      onActivity: () => this.activity(),
    };
  }

  renderTop(instant) {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    this.destroyView();
    const depth = this.stack.length;
    this.backBtn.classList.toggle('is-hidden', depth <= 1);
    this.homeBtn.querySelector('.btn-label').textContent = this.persistent ? 'Menü' : 'Zur Startseite';
    let screen;
    if (top.kind === 'menu') {
      this.barTitle.textContent = depth > 1 ? top.title : '';
      screen = this.renderMenu(top);
    } else {
      this.barTitle.textContent = top.tile.label || '';
      screen = this.renderContent(top.tile);
    }
    this.body.replaceChildren(screen);
    if (!instant) screen.animate([{ opacity: 0, transform: 'translate3d(0,24px,0)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
  }

  renderMenu(level) {
    const tiles = (level.tiles || []).slice(0, 12);
    const cols = this.menu.columns;
    const grid = h('div', { class: `tm-grid cols-${cols}${tiles.length > cols * 3 ? ' is-dense' : ''}` },
      tiles.map((tile) => this.renderTile(tile)));
    const head = h('div', { class: 'tm-head' },
      h('h1', { class: 'tm-title', text: level.title || '' }),
      level.intro ? h('p', { class: 'tm-intro', text: level.intro }) : null);
    const empty = tiles.length ? null : h('p', { class: 'tm-empty', text: 'Keine Einträge vorhanden' });
    return h('div', { class: 'tm-menu' }, head, empty || grid);
  }

  renderTile(tile) {
    const color = safeColor(tile.color, '#1E5AA8');
    const btn = h('button', {
      type: 'button',
      class: `tm-tile${tile.image_url ? ' has-image' : ''}`,
      style: { '--tile-bg': color, '--tile-fg': tile.image_url ? '#FFFFFF' : readableTextColor(color) },
    });
    if (tile.image_url) {
      const img = h('img', { class: 'tile-img', src: tile.image_url, alt: '', draggable: 'false', decoding: 'async' });
      img.addEventListener('error', () => { img.remove(); btn.classList.remove('has-image'); btn.style.setProperty('--tile-fg', readableTextColor(color)); }, { once: true });
      btn.appendChild(img);
    }
    const isSub = tile.action && tile.action.type === 'submenu';
    btn.append(
      h('span', { class: 'tile-icon' }, iconSvg(tile.icon || 'info', { size: 72 })),
      h('span', { class: 'tile-label', text: tile.label || '' }),
    );
    if (isSub) btn.appendChild(h('span', { class: 'tile-more' }, iconSvg('chevron-right', { size: 48 })));
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); this.openTile(tile); });
    return btn;
  }

  renderContent(tile) {
    const action = tile.action || {};
    const env = this.env();
    let view;
    if (action.type === 'gallery') view = galleryView(action.items, env);
    else if (action.type === 'content' && action.item) view = slideTouchView(action.item, env);
    else view = slideTouchView({ type: 'missing' }, env);
    this.view = view;
    const wrap = h('div', { class: `tm-content tc-${action.type === 'gallery' ? 'gallery' : (action.item && action.item.type) || 'missing'}` }, view.el);
    const loading = h('div', { class: 'tm-loading', 'aria-hidden': 'true' });
    wrap.appendChild(loading);
    Promise.resolve().then(() => view.load()).then(() => {
      if (view.refit) view.refit();
      if (view.start) view.start();
    }).catch((err) => {
      errorLog.report(`Touch-Inhalt „${tile.label || ''}“: ${err && err.message ? err.message : err}`);
      if (this.view === view) {
        wrap.replaceChildren(h('div', { class: 'tv-missing' }, iconSvg('alert-circle', { size: 120 }), h('p', { text: 'Inhalt konnte nicht geladen werden' })));
      }
    }).finally(() => loading.remove());
    return wrap;
  }

  // ---------- Inaktivität ----------

  activity(fromButton = false) {
    if (!this.isOpen) return;
    if (this.o.onActivity) this.o.onActivity();
    if (fromButton || !this.still.classList.contains('is-hidden')) this.hideStill();
    clearTimeout(this.idleTimer);
    if (this.persistent) return;
    this.idleTimer = setTimeout(() => this.showStill(), this.menu.idle_timeout_s * 1000);
  }

  showStill() {
    if (!this.isOpen) return;
    // Laufende Videos pausieren nicht – der Hinweis liegt nur darüber.
    let left = TIMING.stillThereCountdownS;
    this.stillNum.textContent = String(left);
    this.still.classList.remove('is-hidden');
    this.countdown = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        this.hideStill();
        this.close();
        return;
      }
      this.stillNum.textContent = String(left);
    }, 1000);
  }

  hideStill() {
    clearInterval(this.countdown);
    this.countdown = null;
    this.still.classList.add('is-hidden');
  }
}
