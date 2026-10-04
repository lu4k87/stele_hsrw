// API-Client: JSON, CSRF-Header, einheitliche Fehler (ApiError), Upload mit Fortschritt.
//
//   const list = await api.get('/api/contents', { query: { type: 'image', q } });
//   await api.patch(`/api/presentations/${id}`, { name });
//   try { … } catch (e) { if (e instanceof ApiError && e.code === 'validation_error') showFieldErrors(e.fields) }
import { bus } from './bus.js';

let csrfToken = null;
export function setCsrfToken(token) { csrfToken = token || null; }

export class ApiError extends Error {
  constructor({ status = 0, code = 'server_error', message = 'Unbekannter Fehler.', fields = {}, details = {} } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields || {};
    this.details = details || {};
  }
}

const TIMEOUT_MS = 20000;
const timeoutError = () => new ApiError({ status: 0, code: 'timeout', message: 'Der Server antwortet nicht (Zeitüberschreitung). Bitte Verbindung prüfen und erneut versuchen.' });

const DEFAULT_MESSAGES = {
  0: 'Keine Verbindung zum Server. Bitte Verbindung prüfen und erneut versuchen.',
  400: 'Die Anfrage war ungültig.',
  401: 'Sitzung abgelaufen – bitte neu anmelden.',
  403: 'Für diese Aktion fehlt die Berechtigung.',
  404: 'Der Eintrag wurde nicht gefunden – eventuell wurde er gelöscht.',
  409: 'Die Aktion ist gerade nicht möglich (Konflikt).',
  413: 'Die Datei ist zu groß.',
  415: 'Dieser Dateityp wird nicht unterstützt.',
  422: 'Bitte die markierten Eingaben prüfen.',
  423: 'Das Konto ist vorübergehend gesperrt.',
  429: 'Zu viele Versuche – bitte kurz warten.',
  500: 'Auf dem Server ist ein Fehler aufgetreten. Bitte später erneut versuchen.',
};
const DEFAULT_CODES = { 0: 'network', 400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 413: 'too_large', 415: 'unsupported_media', 422: 'validation_error', 423: 'account_locked', 429: 'rate_limited' };

function defaultMessage(status) { return DEFAULT_MESSAGES[status] || DEFAULT_MESSAGES[status >= 500 ? 500 : 400]; }

export function buildUrl(path, query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined || v === '') continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

const AUTH_PATHS = ['/api/auth/login', '/api/auth/dev-login', '/api/auth/session'];

function toApiError(status, data, path) {
  const err = (data && data.error) || {};
  const e = new ApiError({
    status,
    code: err.code || DEFAULT_CODES[status] || (status >= 500 ? 'server_error' : 'bad_request'),
    message: err.message || defaultMessage(status),
    fields: err.fields,
    details: err.details,
  });
  if (status === 401 && !AUTH_PATHS.some((p) => path.startsWith(p)) && e.code !== 'invalid_credentials') {
    bus.emit('session:expired', e);
  }
  return e;
}

/** Abbruch durch den Aufrufer (signal) oder nach timeout ms – was zuerst kommt. */
function withTimeout(signal, timeout) {
  if (!timeout || typeof AbortSignal.timeout !== 'function') return signal;
  const t = AbortSignal.timeout(timeout);
  if (!signal) return t;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, t]) : signal;
}

/** Antwort lesen; unlesbar → null, Abbruch/Zeitüberschreitung beim Lesen weiterreichen. */
function readBody(read) {
  return read().catch((err) => {
    if (err?.name === 'TimeoutError') throw timeoutError();
    if (err?.name === 'AbortError') throw err;
    return null;
  });
}

// background: true = Hintergrund-Abfrage (Polling); zählt nicht als Benutzeraktivität und
// verlängert die Sitzung serverseitig nicht (Header X-Background-Poll).
// timeout: Abbruch nach ms (Standard 20 s, 0 = ohne) → ApiError status 0, code 'timeout'.
async function request(method, path, { body, query, signal, headers = {}, raw = false, background = false, timeout = TIMEOUT_MS } = {}) {
  const url = buildUrl(path, query);
  const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json', ...headers }, signal: withTimeout(signal, timeout) };
  if (background) opts.headers['X-Background-Poll'] = '1';
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (method !== 'GET' && csrfToken) opts.headers['X-CSRF-Token'] = csrfToken;

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    if (err?.name === 'TimeoutError') throw timeoutError();
    if (err?.name === 'AbortError') throw err;
    throw new ApiError({ status: 0, code: 'network', message: DEFAULT_MESSAGES[0] });
  }
  if (!background) bus.emit('api:activity');

  if (raw) {
    if (!res.ok) {
      const data = await readBody(() => res.json());
      throw toApiError(res.status, data, path);
    }
    return res;
  }
  if (res.status === 204 || res.status === 304) return null;
  const type = res.headers.get('content-type') || '';
  const data = await readBody(() => (type.includes('application/json') ? res.json() : res.text()));
  if (!res.ok) throw toApiError(res.status, typeof data === 'object' ? data : null, path);
  return data;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
  raw: (method, path, opts) => request(method, path, { ...opts, raw: true }),
  url: buildUrl,

  /**
   * Datei-Upload mit Fortschritt (XHR, weil fetch keinen Upload-Fortschritt kennt).
   * onProgress(anteil 0..1); signal (AbortSignal) bricht ab.
   */
  upload(path, formData, { onProgress, signal } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', path);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
      xhr.upload.onprogress = (ev) => { if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total); };
      xhr.onload = () => {
        bus.emit('api:activity');
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { data = null; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(toApiError(xhr.status, data, path));
      };
      xhr.onerror = () => reject(new ApiError({ status: 0, code: 'network', message: DEFAULT_MESSAGES[0] }));
      xhr.onabort = () => reject(new DOMException('Abgebrochen', 'AbortError'));
      if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(formData);
    });
  },

  /** Datei herunterladen (z. B. Backup, CSV) über einen temporären Link. */
  download(path, query) {
    const a = document.createElement('a');
    a.href = buildUrl(path, query);
    a.rel = 'noopener';
    a.download = '';
    document.body.append(a);
    a.click();
    a.remove();
  },
};

/** Fehlermeldung für Menschen aus beliebigem Fehler. */
export function errorMessage(err) {
  if (!err) return 'Unbekannter Fehler.';
  if (err instanceof ApiError) return err.message;
  if (err.name === 'AbortError') return 'Abgebrochen.';
  return err.message || 'Unbekannter Fehler.';
}
