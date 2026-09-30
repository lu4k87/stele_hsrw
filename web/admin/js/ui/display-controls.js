// Darstellung in der Kopfleiste (und auf der Anmeldeseite): Zoom (− 100 % +) und Hell/Dunkel-Umschalter.
// Beide liefern { el, destroy } – destroy() meldet die Listener ab.
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { openMenu } from './menu.js';
import { getZoom, setZoom, stepZoom, canZoom, formatZoom, onZoomChange, ZOOM_LEVELS } from '../zoom.js';
import { getEffectiveTheme, toggleTheme, onThemeChange } from '../theme.js';

const KEY_HINT = navigator.platform?.startsWith('Mac') ? '⌘' : 'Strg';

export function zoomControl() {
  const minus = h('button', { type: 'button', class: 'zoom-ctl__step', 'aria-label': 'Verkleinern', title: `Verkleinern (${KEY_HINT} –)` }, icon('minus', { size: 18 }));
  const plus = h('button', { type: 'button', class: 'zoom-ctl__step', 'aria-label': 'Vergrößern', title: `Vergrößern (${KEY_HINT} +)` }, icon('plus', { size: 18 }));
  const value = h('button', { type: 'button', class: 'zoom-ctl__value num', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  const el = h('div', { class: 'zoom-ctl', role: 'group', 'aria-label': 'Zoom der Oberfläche' }, minus, value, plus);

  const render = () => {
    const z = getZoom();
    value.textContent = formatZoom(z);
    value.setAttribute('aria-label', `Zoom: ${formatZoom(z)} – Stufe wählen`);
    value.title = `Zoom ${formatZoom(z)} – ${KEY_HINT} 0 setzt auf 100 % zurück`;
    value.classList.toggle('is-changed', z !== 1);
    minus.disabled = !canZoom(-1);
    plus.disabled = !canZoom(1);
  };
  minus.addEventListener('click', () => stepZoom(-1));
  plus.addEventListener('click', () => stepZoom(1));
  value.addEventListener('click', () => openMenu(value, zoomMenuItems()));
  const off = onZoomChange(render);
  render();
  return { el, destroy: off };
}

/** Menüeinträge für die Zoom-Stufen (auch im Benutzer-Menü). */
export function zoomMenuItems() {
  const z = getZoom();
  return [
    { heading: 'Zoom der Oberfläche' },
    ...ZOOM_LEVELS.map((l) => ({ label: formatZoom(l), checked: l === z, onClick: () => setZoom(l), hint: l === 1 ? 'Standard' : null })),
    { separator: true },
    { heading: `Tasten: ${KEY_HINT} + / ${KEY_HINT} – / ${KEY_HINT} 0` },
  ];
}

export function themeToggle() {
  const btn = h('button', { type: 'button', class: 'btn btn--ghost btn--icon theme-toggle' });
  const render = (t = getEffectiveTheme()) => {
    const dark = t === 'dark';
    const label = dark ? 'Helles Design einschalten' : 'Dunkles Design einschalten';
    btn.replaceChildren(icon(dark ? 'sun' : 'moon'));
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };
  btn.addEventListener('click', () => toggleTheme());
  const off = onThemeChange(render);
  render();
  return { el: btn, destroy: off };
}
