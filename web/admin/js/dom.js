// DOM-Helfer: h() baut Elemente ohne innerHTML (kein XSS-Risiko durch Benutzertexte).
//
//   h('button', { class: 'btn btn--primary', onClick: save, 'aria-label': 'Speichern' }, icon('save'), 'Speichern')
//
// props: class | className (String oder Array), style (Objekt oder String), dataset (Objekt),
//        on<Event> (Funktion), attrs (Objekt), text, sowie beliebige Attribute/Properties.
//        Werte null/undefined/false werden ausgelassen. Kinder: Strings, Nodes, Arrays, null/false.

const PROP_KEYS = new Set(['value', 'checked', 'selected', 'disabled', 'indeterminate', 'hidden', 'multiple', 'readOnly', 'required']);

export function h(tag, props = {}, ...children) {
  const el = tag instanceof Element ? tag : document.createElement(tag);
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = {};
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    } else if (key === 'style') {
      if (typeof value === 'string') el.style.cssText = value;
      else for (const [k, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue;
        if (k.startsWith('--')) el.style.setProperty(k, v); else el.style[k] = v;
      }
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined) el.dataset[k] = v;
    } else if (key === 'attrs') {
      for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
    } else if (key === 'text') {
      el.textContent = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (PROP_KEYS.has(key)) {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Inhalt ersetzen. */
export function mount(el, ...children) {
  clear(el);
  return append(el, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Stylesheet einer Ansicht einmalig nachladen: useStyles('/admin/css/views/media.css'). */
const loadedStyles = new Map();
export function useStyles(href) {
  if (loadedStyles.has(href)) return loadedStyles.get(href);
  const p = new Promise((resolve) => {
    const link = h('link', { rel: 'stylesheet', href });
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    document.head.append(link);
  });
  loadedStyles.set(href, p);
  return p;
}

export function debounce(fn, ms = 300) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

let uidCounter = 0;
export function uid(prefix = 'id') {
  uidCounter += 1;
  return `${prefix}-${uidCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Wartet einen Frame (z. B. nach dem Einfügen, bevor fokussiert wird). */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** Kopiert Text in die Zwischenablage (mit Fallback für http://). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0;left:-1000px' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** Initialen für Avatare: „Rita Redaktion“ → „RR“. */
export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
