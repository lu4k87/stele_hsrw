// Sitzung schützen: aktive Benutzer bleiben angemeldet (Keepalive), inaktive werden gewarnt
// und nach Ablauf abgemeldet. Hintergrund-Polling zählt nicht als Aktivität.
import { h } from './dom.js';
import { api } from './api.js';
import { bus } from './bus.js';
import { session, applySession } from './session.js';
import { openDialog } from './ui/dialog.js';

const WARN_BEFORE_MS = 120000;

export function startIdleWatch() {
  let lastServer = Date.now();
  let lastInteraction = Date.now();
  let warning = null;
  let pinging = false;

  const offActivity = bus.on('api:activity', () => {
    lastServer = Date.now();
    if (warning) { warning.close('extended'); warning = null; }
  });
  const onInteract = () => { lastInteraction = Date.now(); };
  const opts = { passive: true, capture: true };
  window.addEventListener('pointerdown', onInteract, opts);
  window.addEventListener('keydown', onInteract, opts);

  async function ping() {
    if (pinging) return;
    pinging = true;
    try {
      const s = await api.get('/api/auth/session');
      if (!s.authenticated) bus.emit('session:expired');
      else applySession(s);
    } catch { /* Netzfehler: nächster Versuch im nächsten Takt */ } finally {
      pinging = false;
    }
  }

  function showWarning() {
    const remaining = h('strong', { class: 'num' });
    const update = () => {
      const left = Math.max(0, Math.round((lastServer + session.idleTimeoutS * 1000 - Date.now()) / 1000));
      remaining.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} min`;
    };
    update();
    const t = setInterval(update, 1000);
    warning = openDialog({
      title: 'Sitzung läuft bald ab',
      size: 'sm',
      content: h('p', { class: 'text-2' }, 'Aus Sicherheitsgründen erfolgt nach längerer Inaktivität eine automatische Abmeldung in ', remaining, '.'),
      actions: [
        { label: 'Abmelden', value: 'logout' },
        { label: 'Angemeldet bleiben', variant: 'primary', icon: 'refresh', onClick: async () => { await ping(); return 'extended'; } },
      ],
      onClose: (r) => {
        clearInterval(t);
        warning = null;
        if (r === 'logout') bus.emit('session:logout-request');
      },
    });
  }

  const timer = setInterval(() => {
    if (!session.authenticated) return;
    const idleMs = session.idleTimeoutS * 1000;
    const now = Date.now();
    const sinceServer = now - lastServer;
    if (sinceServer >= idleMs) {
      if (warning) { warning.close('expired'); warning = null; }
      bus.emit('session:expired');
      return;
    }
    // Aktiv am Arbeiten, aber ohne Serverkontakt → Sitzung still verlängern
    if (lastInteraction > lastServer && sinceServer > Math.min(idleMs / 2, 300000)) { ping(); return; }
    if (!warning && sinceServer > idleMs - WARN_BEFORE_MS) showWarning();
  }, 15000);

  return () => {
    clearInterval(timer);
    offActivity();
    window.removeEventListener('pointerdown', onInteract, opts);
    window.removeEventListener('keydown', onInteract, opts);
    if (warning) warning.close(null);
  };
}
