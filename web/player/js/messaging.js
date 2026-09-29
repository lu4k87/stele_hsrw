// postMessage-API (SPEC §9.2): nur gleiche Herkunft, alle Nachrichten mit source: 'stelecms'.

const SOURCE = 'stelecms';

export function isEmbedded() {
  try { return window.parent !== window; } catch { return true; }
}

// Nachricht an die Admin-Oberfläche (Eltern-Fenster). Ohne Einbettung: nichts tun.
export function postToAdmin(type, data = {}) {
  if (!isEmbedded()) return;
  try {
    window.parent.postMessage({ ...data, type, source: SOURCE }, location.origin);
  } catch { /* Eltern-Fenster anderer Herkunft: ignorieren */ }
}

// handlers: { goto(msg), next(), … } – unbekannte Typen und fremde Herkunft werden ignoriert.
export function listenAdmin(handlers) {
  const onMessage = (ev) => {
    if (ev.origin !== location.origin) return;
    if (ev.source && ev.source !== window.parent && ev.source !== window) return;
    const msg = ev.data;
    if (!msg || typeof msg !== 'object' || msg.source !== SOURCE || typeof msg.type !== 'string') return;
    if (msg.type.startsWith('player:')) return; // eigene Antworten (bei Selbsttest) nicht verarbeiten
    const fn = handlers[msg.type];
    if (typeof fn !== 'function') return;
    try {
      const r = fn(msg);
      if (r && typeof r.catch === 'function') r.catch((err) => postToAdmin('player:error', { message: String(err && err.message || err) }));
    } catch (err) {
      postToAdmin('player:error', { message: String(err && err.message || err) });
    }
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
