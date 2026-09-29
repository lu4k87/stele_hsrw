// Einfacher Ereignisbus für app-weite Signale.
// Ereignisse: 'session:changed', 'session:expired', 'api:activity', 'nav:refresh', 'route:changed'
const handlers = new Map();

export const bus = {
  on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    return () => handlers.get(event)?.delete(fn);
  },
  emit(event, payload) {
    for (const fn of [...(handlers.get(event) || [])]) {
      try { fn(payload); } catch (err) { console.error(`Fehler in Ereignis-Handler „${event}“`, err); }
    }
  },
};
