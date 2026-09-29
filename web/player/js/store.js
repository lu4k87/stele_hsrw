// Sicherer Zugriff auf localStorage (JSON). Fehler (voll, gesperrt) werden geschluckt.

const PREFIX = 'stelecms.';

export const store = {
  get(name, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + name);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(name, value) {
    try {
      localStorage.setItem(PREFIX + name, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(name) {
    try { localStorage.removeItem(PREFIX + name); } catch { /* egal */ }
  },
};
