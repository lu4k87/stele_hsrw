// Diashow-Engine (SPEC §9.3/§9.4): zwei Ebenen, Übergänge, Vorab-Laden der nächsten Folie (kein Schwarzbild),
// Gültigkeit je Durchlauf, Shuffle ohne direkte Wiederholung, Watchdog, Fehler-Skip, Wechsel an Foliengrenzen.

import { TIMING, normalizeSettings, normalizeDesign, normalizeTouchMenu } from './config.js';
import { h, PausableTimer, withTimeout, shuffle, isoUtc } from './util.js';
import { createSlideView, createPlaceholderSlide, isPlayable } from './slides/index.js';
import { slideValidAt } from './schedule.js';
import { wallParts, clock } from './time.js';
import { frameInsets } from './frame.js';
import { errorLog } from './log.js';

const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const EMPTY_RETRY_MS = 30_000;
const FAILED_PAUSE_MS = 5 * 60_000; // fehlerhafte Folie 5 min auslassen (kein erneutes Laden/Melden je Durchlauf)

// Rohdaten einer Präsentation (Manifest) → normalisiert und für die Engine vorbereitet.
export function preparePresentation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    raw,
    id: raw.id ?? null,
    name: String(raw.name || ''),
    settings: normalizeSettings(raw.settings),
    design: normalizeDesign(raw.design),
    touch: normalizeTouchMenu(raw.touch_menu),
    slides: Array.isArray(raw.slides) ? raw.slides.filter((s) => s && typeof s === 'object') : [],
    sig: JSON.stringify(raw),
  };
}

// Übergangs-Animationen (Web Animations API, compositor-freundlich: nur opacity/transform).
function transitionAnimations(type, incoming, outgoing, ms) {
  if (!ms || type === 'none' || !outgoing) {
    if (!outgoing && type !== 'none' && ms) {
      return [incoming.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: EASE, fill: 'backwards' })];
    }
    return [];
  }
  const opts = { duration: ms, easing: EASE, fill: 'both' };
  switch (type) {
    case 'slide-left':
      return [
        incoming.animate([{ transform: 'translate3d(100%,0,0)' }, { transform: 'translate3d(0,0,0)' }], opts),
        outgoing.animate([{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(-100%,0,0)' }], opts),
      ];
    case 'slide-up':
      return [
        incoming.animate([{ transform: 'translate3d(0,100%,0)' }, { transform: 'translate3d(0,0,0)' }], opts),
        outgoing.animate([{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(0,-100%,0)' }], opts),
      ];
    case 'zoom':
      return [incoming.animate([{ opacity: 0, transform: 'scale(1.12)' }, { opacity: 1, transform: 'scale(1)' }], opts)];
    case 'fade':
    default:
      // Überblendung: die alte Ebene bleibt deckend darunter → kein Durchscheinen von Schwarz.
      return [incoming.animate([{ opacity: 0 }, { opacity: 1 }], opts)];
  }
}

export class Slideshow {
  // opts: container (Ebenen-Container in der Bühne), stage (Stage), getTimezone(), getVolume(), muted,
  //       allowPlaceholder, respectValidity, hooks: onShown(entry), onEmpty(bool), onPlayed(rec), onState()
  constructor(opts) {
    this.o = opts;
    this.container = opts.container;
    this.pres = null;
    this.pending = null;
    this.pendingSince = 0;
    this.current = null;
    this.upcoming = null;
    this.playing = opts.autoplay !== false;
    this.stopped = true;
    this.token = 0;
    this.order = [];
    this.lastIndex = -1;
    this.emptyTimer = null;
    this.forceTimer = null;
    this.isEmpty = false;
    this.failedAt = new Map();
  }

  get total() { return this.pres ? this.pres.slides.length : 0; }
  get index() { return this.current ? this.current.index : -1; }

  // ---------- Öffentliche Steuerung ----------

  // Präsentation setzen. Läuft schon etwas: Übernahme an der nächsten Foliengrenze (max. 30 s warten).
  // immediate: sofort, an derselben Folie (Vorschau mit ungespeichertem Stand).
  setPresentation(pres, { immediate = false, startIndex = null } = {}) {
    if (this.stopped || !this.current) {
      this.pending = null;
      this.pres = pres;
      this.order = [];
      this.failedAt.clear();
      this.stopped = false;
      if (!pres) { this.clearAll(); this.setEmpty(true); return; }
      if (startIndex !== null) this.goto(startIndex, { transition: 'none' });
      else this.advance();
      return;
    }
    if (pres && this.pres && pres.sig === this.pres.sig && !this.pending) return;
    if (immediate) {
      const itemId = this.current.slide.id;
      this.pres = pres;
      this.failedAt.clear();
      this.pending = null;
      this.order = [];
      if (!pres) { this.clearAll(); this.setEmpty(true); return; }
      let idx = startIndex !== null ? startIndex : pres.slides.findIndex((s) => s.id === itemId && itemId != null);
      if (idx < 0) idx = Math.min(this.current.index, pres.slides.length - 1);
      this.goto(Math.max(0, idx), { transition: 'none' });
      return;
    }
    this.pending = { pres };
    this.pendingSince = Date.now();
    this.discardUpcoming();
    clearTimeout(this.forceTimer);
    this.forceTimer = setTimeout(() => this.forcePending(), TIMING.switchMaxWaitMs);
    if (this.isEmpty) this.advance();
  }

  forcePending() {
    if (!this.pending || this.stopped) return;
    if (!this.playing) return; // pausiert (Touch-Sitzung): beim Fortsetzen erneut prüfen
    this.advance();
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    const cur = this.current;
    if (cur) {
      cur.view.resume();
      cur.timer && cur.timer.resume();
      cur.watchdog && cur.watchdog.resume();
      cur.progress && cur.progress.play();
    }
    if (this.pending && Date.now() - this.pendingSince >= TIMING.switchMaxWaitMs) this.advance();
    else if (cur && cur.timer && cur.timer.done) this.advance();
    this.emitState();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    const cur = this.current;
    if (cur) {
      cur.view.pause();
      cur.timer && cur.timer.pause();
      cur.watchdog && cur.watchdog.pause();
      cur.progress && cur.progress.pause();
    }
    this.emitState();
  }

  next() { this.advance({ manual: true }); }

  prev() {
    if (!this.pres || !this.total) return;
    const start = this.current ? this.current.index : 0;
    for (let k = 1; k <= this.total; k++) {
      const idx = (start - k + this.total) % this.total;
      if (this.usable(this.pres.slides[idx], true)) { this.goto(idx); return; }
    }
  }

  // Bestimmte Folie zeigen (ignoriert die Gültigkeit – Vorschau/Live-Ansicht).
  goto(index, { transition = null } = {}) {
    if (!this.pres || !this.total) return;
    const idx = Math.max(0, Math.min(this.total - 1, Number(index) || 0));
    this.stopped = false;
    this.advance({ forceIndex: idx, transition });
  }

  gotoItem(itemId) {
    if (!this.pres) return false;
    const idx = this.pres.slides.findIndex((s) => String(s.id) === String(itemId));
    if (idx < 0) return false;
    if (this.current && this.current.index === idx) return true;
    this.goto(idx);
    return true;
  }

  // Alles anhalten und freigeben (Nachtmodus); setPresentation startet neu.
  stop() {
    this.token++;
    this.stopped = true;
    this.pending = null;
    clearTimeout(this.forceTimer);
    clearTimeout(this.emptyTimer);
    this.logPlayed();
    this.clearAll();
    if (this.isEmpty) this.setEmpty(false);
    clearTimeout(this.emptyTimer);
  }

  // ---------- Intern ----------

  clearAll() {
    this.discardUpcoming();
    if (this.current) this.disposeEntry(this.current);
    this.current = null;
    for (const layer of this.container.querySelectorAll('.layer')) layer.remove();
  }

  usable(slide, ignoreValidity = false) {
    if (!(this.o.allowPlaceholder ? slide : isPlayable(slide))) return false;
    if (ignoreValidity || this.o.respectValidity === false) return true;
    const stamp = wallParts(clock.now(), this.o.getTimezone()).stamp;
    return slideValidAt(slide, stamp);
  }

  validIndices() {
    if (!this.pres) return [];
    const out = [];
    this.pres.slides.forEach((s, i) => { if (this.usable(s)) out.push(i); });
    return out;
  }

  failKey(index) {
    const slide = this.pres && this.pres.slides[index];
    return `${this.pres && this.pres.id}:${slide && slide.id != null ? slide.id : `#${index}`}`;
  }

  recentlyFailed(index) {
    const at = this.failedAt.get(this.failKey(index));
    return at !== undefined && Date.now() - at < FAILED_PAUSE_MS;
  }

  // Nächste Folie wählen; tried = in diesem Anlauf bereits fehlgeschlagene Indizes.
  // Kürzlich fehlgeschlagene Folien werden ausgelassen, solange es andere gibt.
  pick(afterIndex, tried) {
    let valid = this.validIndices().filter((i) => !tried.has(i));
    const healthy = valid.filter((i) => !this.recentlyFailed(i));
    if (healthy.length) valid = healthy;
    if (!valid.length) return null;
    if (this.pres.settings.order === 'shuffle' && valid.length > 1) {
      this.order = this.order.filter((i) => valid.includes(i));
      if (!this.order.length) {
        // Neuer Durchlauf: mischen, erste Folie ≠ zuletzt gezeigte.
        this.order = shuffle(valid.slice());
        if (this.order[0] === this.lastIndex) this.order.push(this.order.shift());
      }
      return this.order.shift();
    }
    const n = this.total;
    for (let k = 1; k <= n; k++) {
      const idx = (afterIndex + k + n) % n;
      if (valid.includes(idx)) return idx;
    }
    return null;
  }

  // Folie in einer unsichtbaren Ebene aufbauen und vollständig laden.
  async load(pres, index) {
    const slide = pres.slides[index];
    const insets = frameInsets(pres.design, pres.settings, slide);
    const layer = h('div', { class: 'layer is-pending', style: { top: `${insets.top}px`, bottom: `${insets.bottom}px`, background: pres.settings.background } });
    const stageW = this.o.stage.width;
    const ctx = {
      settings: pres.settings,
      volume: this.o.getVolume ? this.o.getVolume() : 0.8,
      muted: Boolean(this.o.muted),
      interactive: false,
      allowPlaceholder: Boolean(this.o.allowPlaceholder),
      area: { w: stageW, h: this.o.stage.height - insets.top - insets.bottom },
    };
    let view;
    try {
      view = slide.type === 'missing' ? createPlaceholderSlide(slide, ctx) : createSlideView(slide, ctx);
    } catch (err) {
      layer.remove();
      throw err;
    }
    layer.appendChild(view.el);
    const caption = String(slide.caption || '').trim();
    if (caption) {
      const style = pres.settings.caption_style === 'shadow' ? 'shadow' : 'bar';
      layer.appendChild(h('div', { class: `caption cap-${style}` }, h('span', { text: caption })));
    }
    if (slide.enabled === false && this.o.allowPlaceholder) {
      layer.appendChild(h('div', { class: 'disabled-band', text: 'Deaktiviert – wird nicht gezeigt' }));
    }
    let progressBar = null;
    if (pres.settings.show_progress) {
      progressBar = h('div', { class: 'progress-fill' });
      layer.appendChild(h('div', { class: 'progress' }, progressBar));
    }
    this.container.appendChild(layer);
    try {
      await withTimeout(Promise.resolve(view.load()), TIMING.prepareTimeoutMs, 'Folie lädt zu lange');
    } catch (err) {
      try { view.destroy(); } catch { /* egal */ }
      layer.remove();
      throw err;
    }
    return { pres, index, slide, view, layer, progressBar, caption: Boolean(caption), timer: null, watchdog: null, progress: null, startedAt: 0 };
  }

  // Ab afterIndex die nächste ladbare Folie vorbereiten; Fehler → melden und überspringen.
  // isStale(): true → Ergebnis wird nicht mehr gebraucht (neuer Wechsel, andere Präsentation).
  async prepareFrom(pres, afterIndex, isStale, forceIndex = null) {
    if (forceIndex !== null) {
      try {
        return await this.load(pres, forceIndex);
      } catch (err) {
        this.reportSlideError(pres.slides[forceIndex], err);
        return null;
      }
    }
    const tried = new Set();
    let after = afterIndex;
    for (let attempt = 0; attempt < Math.max(1, pres.slides.length); attempt++) {
      if (isStale()) return null;
      const idx = this.pick(after, tried);
      if (idx === null || idx === undefined) return null;
      tried.add(idx);
      try {
        const entry = await this.load(pres, idx);
        if (isStale()) { this.disposeEntry(entry); return null; }
        return entry;
      } catch (err) {
        this.reportSlideError(pres.slides[idx], err);
        if (pres === this.pres) this.failedAt.set(this.failKey(idx), Date.now());
        after = idx;
      }
    }
    return null;
  }

  reportSlideError(slide, err) {
    const title = slide && slide.title ? `„${slide.title}“: ` : '';
    const msg = `${title}${err && err.message ? err.message : String(err)}`;
    errorLog.report(msg, { itemId: slide ? slide.id ?? null : null });
  }

  discardUpcoming() {
    const up = this.upcoming;
    this.upcoming = null;
    if (!up) return;
    up.cancelled = true;
    up.promise.then((entry) => { if (entry && entry !== this.current) this.disposeEntry(entry); }).catch(() => {});
  }

  disposeEntry(entry) {
    if (!entry) return;
    entry.timer && entry.timer.clear();
    entry.watchdog && entry.watchdog.clear();
    entry.progress && entry.progress.cancel();
    try { entry.view.destroy(); } catch { /* egal */ }
    entry.layer.remove();
  }

  logPlayed() {
    const cur = this.current;
    if (!cur || !cur.startedAt || !this.o.onPlayed || cur.slide.id == null) return;
    const duration = (Date.now() - cur.startedAt) / 1000;
    if (duration < 0.5) return;
    this.o.onPlayed({
      started_at: isoUtc(cur.startedAt),
      duration_s: Math.round(duration * 10) / 10,
      presentation_id: cur.pres.id,
      item_id: cur.slide.id,
      content_id: cur.slide.content_id ?? null,
      title: String(cur.slide.title || ''),
    });
    cur.startedAt = Date.now();
  }

  setEmpty(empty) {
    clearTimeout(this.emptyTimer);
    if (empty) {
      // Keine gültige Folie: später erneut prüfen (Gültigkeit kann beginnen).
      this.emptyTimer = setTimeout(() => { if (!this.stopped) this.advance(); }, EMPTY_RETRY_MS);
    }
    if (empty !== this.isEmpty) {
      this.isEmpty = empty;
      if (this.o.onEmpty) this.o.onEmpty(empty);
    }
    this.emitState();
  }

  // Zur nächsten Folie (Foliengrenze). Übernimmt ggf. eine wartende Präsentation.
  async advance({ forceIndex = null, transition = null, manual = false } = {}) {
    if (this.stopped && forceIndex === null) return;
    const token = ++this.token;
    clearTimeout(this.emptyTimer);
    const cur = this.current;
    if (cur) {
      cur.timer && cur.timer.clear();
      cur.watchdog && cur.watchdog.clear();
    }

    let afterIndex = cur ? cur.index : -1;
    let presChanged = false;
    if (this.pending) {
      const next = this.pending.pres;
      const old = this.pres;
      this.pending = null;
      clearTimeout(this.forceTimer);
      this.pres = next;
      this.order = [];
      this.failedAt.clear();
      presChanged = true;
      this.discardUpcoming();
      if (!next) {
        this.logPlayed();
        this.clearAll();
        this.setEmpty(true);
        return;
      }
      // Gleiche Präsentation mit neuem Stand: nach der aktuellen Folie weitermachen.
      afterIndex = -1;
      if (old && cur && old.id === next.id) {
        const i = next.slides.findIndex((s) => s.id != null && s.id === cur.slide.id);
        afterIndex = i >= 0 ? i : Math.min(cur.index, next.slides.length) - 1;
      }
    }
    if (!this.pres) { this.setEmpty(true); return; }

    // Nur eine gültige Folie, die schon läuft: weiterlaufen lassen statt doppelt aufzubauen.
    if (!presChanged && forceIndex === null && cur && !cur.failed && !manual) {
      const valid = this.validIndices();
      if (valid.length === 1 && valid[0] === cur.index) {
        this.logPlayed();
        if (this.upcoming) this.discardUpcoming();
        cur.view.restart();
        this.startTiming(cur);
        this.emitState();
        return;
      }
    }

    let entry = null;
    const up = this.upcoming;
    this.upcoming = null;
    if (up && forceIndex === null && !presChanged && up.pres === this.pres) {
      entry = await up.promise;
      if (entry && !this.usable(entry.slide)) { this.disposeEntry(entry); entry = null; }
    } else if (up) {
      this.upcoming = up;
      this.discardUpcoming();
    }
    if (token !== this.token) { if (entry) this.disposeEntry(entry); return; }
    if (!entry) {
      const pres = this.pres;
      entry = await this.prepareFrom(pres, afterIndex, () => token !== this.token || pres !== this.pres, forceIndex);
    }
    if (token !== this.token) { if (entry) this.disposeEntry(entry); return; }

    if (!entry) {
      if (forceIndex !== null && cur) return; // gewünschte Folie defekt: aktuelle bleibt stehen
      // Nichts ladbar/gültig: Standby, später erneut versuchen.
      this.logPlayed();
      this.clearAll();
      this.setEmpty(true);
      return;
    }
    this.logPlayed();
    await this.show(entry, transition, token);
  }

  async show(entry, transitionOverride, token) {
    const old = this.current;
    this.current = entry;
    this.lastIndex = entry.index;
    const settings = entry.pres.settings;
    const type = transitionOverride || entry.slide.transition || settings.transition || 'fade';
    const ms = type === 'none' ? 0 : settings.transition_ms;
    const layer = entry.layer;
    layer.classList.remove('is-pending');
    layer.classList.add('is-active');
    layer.style.zIndex = '2';
    if (old) {
      old.layer.classList.remove('is-active');
      old.layer.style.zIndex = '1';
    }
    this.setEmpty(false);
    entry.view.onEnd = () => { if (this.current === entry) this.onSlideEnd(entry); };
    entry.view.onError = (msg) => {
      if (this.current !== entry) return;
      entry.failed = true;
      errorLog.report(`„${entry.slide.title || 'Folie'}“: ${msg}`, { itemId: entry.slide.id ?? null });
      this.advance();
    };
    if (this.playing) entry.view.start();
    if (this.o.onShown) this.o.onShown(entry, ms);
    entry.startedAt = Date.now();
    this.startTiming(entry);
    this.emitState();

    const anims = transitionAnimations(type, layer, old && old.layer, ms);
    if (anims.length) {
      await Promise.race([
        Promise.all(anims.map((a) => a.finished.catch(() => {}))),
        new Promise((r) => setTimeout(r, ms + 600)),
      ]);
      anims.forEach((a) => { try { a.cancel(); } catch { /* egal */ } });
    }
    if (old && old !== this.current) this.disposeEntry(old);
    layer.style.zIndex = '';
    if (token === this.token && this.current === entry) this.prepareUpcoming(entry);
  }

  startTiming(entry) {
    entry.timer && entry.timer.clear();
    entry.watchdog && entry.watchdog.clear();
    entry.progress && entry.progress.cancel();
    const planned = Math.max(1000, entry.view.plannedMs || 10_000);
    entry.timer = entry.view.selfTimed ? null : new PausableTimer(() => this.onSlideEnd(entry), planned);
    entry.watchdog = new PausableTimer(() => {
      if (this.current !== entry) return;
      errorLog.report(`Folie „${entry.slide.title || ''}“ hängt – weiter zur nächsten`, { itemId: entry.slide.id ?? null });
      entry.failed = true;
      this.advance();
    }, planned + TIMING.watchdogGraceMs);
    if (entry.progressBar) {
      entry.progress = entry.progressBar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
        { duration: planned, easing: 'linear', fill: 'forwards' });
    }
    if (this.playing) {
      entry.timer && entry.timer.start();
      entry.watchdog.start();
    } else {
      entry.progress && entry.progress.pause();
    }
  }

  onSlideEnd(entry) {
    if (this.current !== entry) return;
    if (this.o.loopSingle) { // Einzelfolien-Modus: dieselbe Folie wiederholen
      entry.view.restart();
      this.startTiming(entry);
      return;
    }
    if (!this.playing) return; // pausiert: beim Fortsetzen geht es weiter
    this.advance();
  }

  prepareUpcoming(entry) {
    if (this.upcoming || this.pending || this.o.loopSingle) return;
    const valid = this.validIndices();
    if (valid.length <= 1 && valid[0] === entry.index) return;
    const pres = this.pres;
    const up = { pres, cancelled: false, promise: null };
    up.promise = this.prepareFrom(pres, entry.index, () => up.cancelled || pres !== this.pres).then((e) => {
      if (up.cancelled && e) { this.disposeEntry(e); return null; }
      return e;
    });
    this.upcoming = up;
  }

  emitState() {
    if (this.o.onState) this.o.onState();
  }

  state() {
    const cur = this.current;
    return {
      index: cur ? cur.index : -1,
      total: this.total,
      item_id: cur ? cur.slide.id ?? null : null,
      playing: this.playing,
    };
  }
}
