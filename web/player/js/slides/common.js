// Gemeinsame Bausteine der Folien-Renderer.
//
// Jede Folie ist eine „Ansicht“ mit einheitlicher Schnittstelle:
//   el            Wurzelelement (füllt die Ebene)
//   load()        lädt/dekodiert vorab (Element hängt bereits unsichtbar im DOM); wirft bei Fehler
//   start()       Wiedergabe beginnt (Folie sichtbar)
//   pause()/resume()/restart()
//   destroy()     gibt Ressourcen frei (Video-Decoder, iframes, Animationen)
//   plannedMs     geplante Dauer; selfTimed = true → Ende meldet die Ansicht selbst über onEnd()
//   onEnd/onError werden von der Diashow gesetzt

import { withTimeout } from '../util.js';

export function baseView(el) {
  return {
    el,
    plannedMs: 10_000,
    selfTimed: false,
    onEnd: null,
    onError: null,
    async load() {},
    start() {},
    pause() {},
    resume() {},
    restart() {},
    destroy() { el.remove(); },
  };
}

export function durationMs(slide, settings) {
  const s = Number(slide && slide.duration_s) || Number(settings && settings.default_duration_s) || 10;
  return Math.max(2, s) * 1000;
}

export function shortUrl(url) {
  const s = String(url || '');
  return s.length > 60 ? `…${s.slice(-57)}` : s;
}

// Bild vollständig dekodieren (kein Aufbau während der Überblendung).
export async function decodeImage(img, ms = 15_000) {
  try {
    await withTimeout(img.decode(), ms, 'Bild lädt zu lange');
  } catch {
    if (!(img.complete && img.naturalWidth > 0)) {
      throw new Error(`Bild konnte nicht geladen werden (${shortUrl(img.currentSrc || img.src)})`);
    }
  }
}

// Absätze aus Klartext: Leerzeile = neuer Absatz, einfacher Umbruch = <br>. Kein innerHTML.
export function textParagraphs(text) {
  const paras = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paras.map((para) => {
    const p = document.createElement('p');
    para.split('\n').forEach((line, i) => {
      if (i) p.appendChild(document.createElement('br'));
      p.appendChild(document.createTextNode(line));
    });
    return p;
  });
}
