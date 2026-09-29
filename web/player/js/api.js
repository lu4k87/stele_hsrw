// Fetch-Hülle für die Player-API: Stelen-Schlüssel als Header, Zeitlimit, JSON, ETag.

export class ApiError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createApi({ getKey = () => null } = {}) {
  async function request(path, { method = 'GET', body, timeoutMs = 10_000, etag = null } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = { Accept: 'application/json' };
    const key = getKey();
    if (key) headers['X-Stele-Key'] = key;
    if (etag) headers['If-None-Match'] = `"${etag}"`;
    const init = { method, headers, credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    try {
      let res;
      try {
        res = await fetch(path, init);
      } catch {
        throw new ApiError(0, ctrl.signal.aborted ? 'Zeitüberschreitung' : 'Server nicht erreichbar', 'network');
      }
      if (res.status === 304) return { status: 304, data: null, etag };
      let data = null;
      let text = '';
      try { text = await res.text(); } catch { text = ''; }
      if (text) {
        try { data = JSON.parse(text); } catch { data = null; }
      }
      if (!res.ok) {
        const err = data && data.error;
        throw new ApiError(res.status, (err && err.message) || `HTTP ${res.status}`, (err && err.code) || '');
      }
      const tag = (res.headers.get('ETag') || '').replace(/^W\//, '').replace(/"/g, '') || null;
      return { status: res.status, data, etag: tag };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    request,
    get: (path, opts = {}) => request(path, { ...opts, method: 'GET' }),
    post: (path, body, opts = {}) => request(path, { ...opts, method: 'POST', body }),
  };
}
