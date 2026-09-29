// Fehlerprotokoll des Players: Ringpuffer für die Diagnose + Abonnenten (Telemetrie, Admin-Nachrichten).

import { isoUtc } from './util.js';

const MAX_RECENT = 20;
const listeners = new Set();
const recent = [];
let lastKey = '';
let lastAt = 0;

export const errorLog = {
  // Meldet einen Fehler. Gleiche Meldungen innerhalb von 5 s werden zusammengefasst (kein Fluten).
  report(message, { itemId = null } = {}) {
    const text = String(message || 'Unbekannter Fehler').slice(0, 500);
    const key = `${text}|${itemId}`;
    const now = Date.now();
    if (key === lastKey && now - lastAt < 5000) return;
    lastKey = key;
    lastAt = now;
    const entry = { ts: isoUtc(now), message: text, item_id: itemId ?? null };
    recent.push(entry);
    if (recent.length > MAX_RECENT) recent.shift();
    try { console.warn('[Player]', text); } catch { /* egal */ }
    for (const fn of listeners) {
      try { fn(entry); } catch { /* ein Abonnent darf das Protokoll nicht stören */ }
    }
  },
  recent() { return recent.slice(); },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
