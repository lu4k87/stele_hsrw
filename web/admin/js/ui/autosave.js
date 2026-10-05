// Automatisches Speichern eines Entwurfs in Teilen (Präsentations-Editor): sammeln → verzögert senden →
// bei Netz-/Serverfehler erneut versuchen; 409 edit_conflict stoppt bis „Neu laden“. Sichtbarer Status in .el.
//
//   const as = autosave({ ctx, enabled, className: 'pe-save', parts: { meta: sendMeta, items: sendItems } });
//   as.queue('items') · await as.flush() → true = alles gespeichert · Cleanup: as.destroy()
import { h, debounce, mount as fill } from '../dom.js';
import { icon } from '../icons.js';
import { ApiError, errorMessage } from '../api.js';
import { toast } from './toast.js';
import { isEditConflict } from './edit-conflict.js';

const SAVE_DELAY = 700;
const RETRY_MS = 5000;

/**
 * parts         → { name: async () => … } in Sende-Reihenfolge; jeder Teil übernimmt die Antwort selbst
 * fieldMessage(err) → Meldung bei 422 (Standard: err.message)
 * onConflict(err)   → nach 409 edit_conflict (z. B. Hinweis mit „Neu laden“ zeigen; err bleibt in .conflict)
 * conflictMessage   → Warnung beim Verlassen nach einem Konflikt
 */
export function autosave({ ctx, enabled = true, className, parts, fieldMessage = (err) => err.message, onConflict = null, conflictMessage }) {
  const pending = new Set();
  let running = null;
  let error = null;
  let conflict = null;
  let retryTimer = null;
  let lastToast = 0;
  const el = h('div', { class: className, role: 'status', 'aria-live': 'polite' });

  function paint(kind) {
    el.className = `${className} ${className}--${kind}`;
    if (kind === 'saved') fill(el, icon('check-circle', { size: 16 }), 'Alle Änderungen gespeichert');
    else if (kind === 'pending' || kind === 'saving') fill(el, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Wird gespeichert …');
    else if (kind === 'error') {
      fill(el, icon('alert-circle', { size: 16 }), h('span', {}, 'Speichern fehlgeschlagen – '),
        h('button', { type: 'button', class: 'btn btn--link', onClick: () => flush() }, 'erneut versuchen'));
    } else if (kind === 'conflict') fill(el, icon('alert-circle', { size: 16 }), 'Nicht gespeichert – inzwischen anderweitig geändert');
    else fill(el, icon('eye', { size: 16 }), 'Nur Ansicht');
  }

  const debouncedFlush = debounce(() => flush(), SAVE_DELAY);
  const stopTimers = () => { debouncedFlush.cancel(); clearTimeout(retryTimer); };

  function queue(part) {
    if (!enabled) return;
    pending.add(part);
    if (conflict) return;            // wartet auf „Neu laden“
    clearTimeout(retryTimer);
    ctx.setDirty('Die letzten Änderungen werden noch gespeichert. Beim sofortigen Verlassen können sie verloren gehen.');
    paint('pending');
    debouncedFlush();
  }

  function flush() {
    stopTimers();
    if (running) return running;
    if (conflict) return Promise.resolve(false);
    if (!pending.size) return Promise.resolve(true);
    running = (async () => {
      let current = null;            // Teil, der gerade gesendet wird (bei Fehler wieder vormerken)
      error = null;
      paint('saving');
      try {
        while (pending.size) {
          for (const [part, send] of Object.entries(parts)) {
            if (!pending.has(part)) continue;
            pending.delete(part);
            current = part;
            await send();
          }
        }
        paint('saved');
        ctx.setDirty(false);
        return true;
      } catch (err) {
        error = err;
        if (current) pending.add(current);
        if (isEditConflict(err)) {
          conflict = err;
          paint('conflict');
          ctx.setDirty(conflictMessage);
          onConflict?.(err);
          return false;
        }
        paint('error');
        ctx.setDirty('Einige Änderungen konnten nicht gespeichert werden. Beim Verlassen gehen sie verloren.');
        const now = Date.now();
        if (now - lastToast > 8000) {
          lastToast = now;
          toast.error(err instanceof ApiError && err.status === 422 ? `Speichern nicht möglich: ${fieldMessage(err)}` : `Speichern fehlgeschlagen: ${errorMessage(err)}`);
        }
        // Netz-/Serverfehler: automatisch erneut versuchen; Eingabefehler warten auf Korrektur
        if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500) retryTimer = setTimeout(() => flush(), RETRY_MS);
        return false;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    el, paint, queue, flush,
    get conflict() { return conflict; },
    /** Offene Änderungen verwerfen (Neu laden, Löschen). */
    drop() { stopTimers(); pending.clear(); },
    /** Wie drop(), wartet aber einen laufenden Speichervorgang ab (Verwerfen auf dem Server). */
    async settle() { stopTimers(); if (running) await running; pending.clear(); },
    /** Offene Änderungen noch absenden (ohne Abbruchsignal), dann Timer stoppen. */
    destroy() {
      if (enabled && pending.size && !error) flush();
      stopTimers();
    },
  };
}
