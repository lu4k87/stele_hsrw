// Vollflächige Zustände der Bühne: Start, Standby, Nachtmodus, Kopplung, Identifizieren, Diagnose.

import { h, formatDuration } from './util.js';
import { iconSvg } from '/shared/icons.js';
import { formatTime, formatDate, onMinute, clock } from './time.js';
import { PLAYER_VERSION, TIMING } from './config.js';
import { errorLog } from './log.js';

function toggle(el, show) {
  el.classList.toggle('is-hidden', !show);
}

// Start-/Ladebildschirm (dezent, kein Schwarzbild ohne Hinweis).
export class BootScreen {
  constructor(stageEl) {
    this.text = h('div', { class: 'boot-text', text: 'Wird gestartet …' });
    this.el = h('div', { class: 'boot' }, h('div', { class: 'boot-spinner', 'aria-hidden': 'true' }), this.text);
    stageEl.appendChild(this.el);
  }

  message(text) { this.text.textContent = text; }
  hide() { toggle(this.el, false); }
  show(text) { if (text) this.message(text); toggle(this.el, true); }
}

// Standby: keine Präsentation oder keine gültige Folie – ruhig, org_name und Uhrzeit.
export class Standby {
  constructor(stageEl) {
    this.org = h('div', { class: 'sb-org' });
    this.time = h('div', { class: 'sb-time' });
    this.date = h('div', { class: 'sb-date' });
    this.el = h('div', { class: 'standby is-hidden', 'aria-hidden': 'true' },
      h('div', { class: 'sb-inner' }, this.org, this.time, this.date));
    stageEl.appendChild(this.el);
    this.timezone = null;
    this.visible = false;
    onMinute(() => this.update());
  }

  set({ orgName, timezone }) {
    this.org.textContent = orgName || '';
    this.timezone = timezone;
    this.update();
  }

  update() {
    if (!this.visible) return;
    const now = clock.now();
    this.time.textContent = formatTime(now, this.timezone);
    this.date.textContent = formatDate(now, this.timezone, 'long');
  }

  show(v) {
    this.visible = Boolean(v);
    toggle(this.el, this.visible);
    this.update();
  }
}

// Nachtmodus: Bildschirm schwarz.
export class NightScreen {
  constructor(stageEl) {
    this.el = h('div', { class: 'night is-hidden', 'aria-hidden': 'true' });
    stageEl.appendChild(this.el);
  }

  show(v) { toggle(this.el, v); }
}

// Kopplungsbildschirm (SPEC §9.6).
export class PairingScreen {
  constructor(stageEl) {
    this.code = h('div', { class: 'pr-code', 'aria-live': 'polite' });
    this.status = h('div', { class: 'pr-status', 'aria-live': 'polite' });
    this.el = h('div', { class: 'pairing is-hidden' },
      h('div', { class: 'pr-inner' },
        h('div', { class: 'pr-icon' }, iconSvg('stele', { size: 120 })),
        h('h1', { class: 'pr-title', text: 'Stele koppeln' }),
        h('p', { class: 'pr-lead', text: 'Kopplungscode' }),
        this.code,
        h('ol', { class: 'pr-steps' },
          h('li', null, 'Im CMS anmelden: ', h('strong', { class: 'pr-origin', text: location.origin })),
          h('li', null, 'Unter ', h('strong', { text: 'Stelen → Stele hinzufügen' }), ' diesen Code eingeben.'),
          h('li', null, 'Die Stele startet danach automatisch.')),
        this.status));
    stageEl.appendChild(this.el);
  }

  setCode(code) {
    const c = String(code || '').replace(/\D/g, '');
    this.code.textContent = c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c || '––– –––';
  }

  setStatus(text, level = 'info') {
    this.status.textContent = text || '';
    this.status.dataset.level = level;
  }

  show(v) { toggle(this.el, v); }
}

// Identifizieren: 10 s Vollbild-Overlay mit Name/Standort und pulsierendem Rahmen.
export function showIdentify(stageEl, stele) {
  const el = h('div', { class: 'identify' },
    h('div', { class: 'id-inner' },
      h('div', { class: 'id-icon' }, iconSvg('stele', { size: 160 })),
      h('div', { class: 'id-name', text: (stele && stele.name) || 'Stele' }),
      stele && stele.location ? h('div', { class: 'id-loc', text: stele.location }) : null,
      h('div', { class: 'id-hint', text: 'Diese Stele wurde im CMS identifiziert.' })));
  stageEl.appendChild(el);
  setTimeout(() => el.remove(), TIMING.identifyMs);
}

// Diagnose: 5× schnell in die linke obere Ecke (150 × 150 Bühnen-px) tippen.
export class Diagnostics {
  constructor(stageEl, stage, getInfo) {
    this.stageEl = stageEl;
    this.stage = stage;
    this.getInfo = getInfo;
    this.taps = [];
    this.el = null;
    this.closeTimer = null;
    window.addEventListener('pointerdown', (ev) => this.onTap(ev), true);
  }

  inCorner(ev) {
    const p = this.stage.toStage(ev.clientX, ev.clientY);
    return p.x >= 0 && p.y >= 0 && p.x <= 150 && p.y <= 150;
  }

  onTap(ev) {
    if (!this.inCorner(ev)) { this.taps = []; return; }
    const now = Date.now();
    this.taps = this.taps.filter((t) => now - t < 3000);
    this.taps.push(now);
    if (this.taps.length >= 5) {
      this.taps = [];
      this.open();
    }
  }

  open() {
    this.close();
    const info = this.getInfo();
    const rows = [
      ['Player-Version', PLAYER_VERSION],
      ['Modus', info.mode],
      ['Stele', info.stele ? `${info.stele.name || '–'}${info.stele.location ? ` (${info.stele.location})` : ''}` : '–'],
      ['Schlüssel', info.keyEnd ? `…${info.keyEnd}` : '–'],
      ['Manifest', info.manifestVersion || '–'],
      ['Manifest-Alter', info.manifestAgeS !== null ? formatDuration(info.manifestAgeS) : '–'],
      ['Verbindung', info.online ? 'online' : 'offline'],
      ['Letzter Kontakt', info.lastContactS !== null ? `vor ${formatDuration(info.lastContactS)}` : '–'],
      ['Bildschirm', `${screen.width} × ${screen.height} (Fenster ${window.innerWidth} × ${window.innerHeight})`],
      ['Bühne', `${this.stage.width} × ${this.stage.height}, Maßstab ${this.stage.scale.toFixed(3)}`],
      ['Präsentation', info.presentation || '–'],
      ['Aktuelle Folie', info.slide || '–'],
      ['Laufzeit', formatDuration(info.uptimeS)],
      ['Service Worker', info.sw || '–'],
    ];
    const errors = errorLog.recent().slice(-6).reverse();
    this.el = h('div', { class: 'diag', role: 'dialog', 'aria-label': 'Diagnose' },
      h('div', { class: 'dg-card' },
        h('div', { class: 'dg-head' },
          h('h2', { text: 'Diagnose' }),
          (() => {
            const b = h('button', { type: 'button', class: 'dg-close', 'aria-label': 'Schließen' }, iconSvg('x', { size: 48 }));
            b.addEventListener('click', (ev) => { ev.stopPropagation(); this.close(); });
            return b;
          })()),
        h('dl', { class: 'dg-list' }, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })])),
        h('h3', { text: 'Letzte Fehler' }),
        errors.length
          ? h('ul', { class: 'dg-errors' }, errors.map((e) => h('li', null, h('span', { class: 'dg-ts', text: e.ts.slice(11, 19) }), ` ${e.message}`)))
          : h('p', { class: 'dg-none', text: 'Keine Fehler' }),
        h('p', { class: 'dg-foot', text: 'Schließt automatisch nach 30 Sekunden.' })));
    this.el.addEventListener('click', (ev) => ev.stopPropagation());
    this.stageEl.appendChild(this.el);
    this.closeTimer = setTimeout(() => this.close(), TIMING.diagnosticsCloseMs);
  }

  close() {
    clearTimeout(this.closeTimer);
    if (this.el) this.el.remove();
    this.el = null;
  }
}
