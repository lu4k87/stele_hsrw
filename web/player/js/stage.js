// Bühne in Stelen-Auflösung, per transform: scale() zentriert in das Fenster eingepasst (schwarzer Rand).

import { DEFAULT_STAGE } from './config.js';
import { clampNumber } from './util.js';

export class Stage {
  constructor(el) {
    this.el = el;
    this.width = DEFAULT_STAGE.width;
    this.height = DEFAULT_STAGE.height;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.listeners = new Set();
    this.el.style.width = `${this.width}px`;
    this.el.style.height = `${this.height}px`;
    this._onResize = () => this.fit();
    window.addEventListener('resize', this._onResize);
    this.fit();
  }

  setSize(width, height) {
    const w = Math.round(clampNumber(width, 320, 7680, DEFAULT_STAGE.width));
    const hgt = Math.round(clampNumber(height, 320, 7680, DEFAULT_STAGE.height));
    if (w === this.width && hgt === this.height) return false;
    this.width = w;
    this.height = hgt;
    this.el.style.width = `${w}px`;
    this.el.style.height = `${hgt}px`;
    this.fit();
    return true;
  }

  fit() {
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (!vw || !vh) return;
    const s = Math.min(vw / this.width, vh / this.height);
    this.scale = s;
    this.offsetX = Math.round((vw - this.width * s) / 2);
    this.offsetY = Math.round((vh - this.height * s) / 2);
    this.el.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${s})`;
    for (const fn of this.listeners) fn(s);
  }

  onResize(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Fensterkoordinaten → Bühnen-Pixel
  toStage(clientX, clientY) {
    return { x: (clientX - this.offsetX) / this.scale, y: (clientY - this.offsetY) / this.scale };
  }
}
