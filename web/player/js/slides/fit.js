// Fit-Text: Schrift schrittweise verkleinern (CSS-Variable als Faktor), bis der Inhalt in seine Box passt.

function overflows(box) {
  return box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1;
}

// Mehrzeiliger Block: Faktor --k in [min, 1] per Intervallhalbierung. Passt es auch mit min nicht,
// erhält die Box die Klasse is-clipped (weicher Auslauf statt hartem Abschnitt).
export function fitBox(root, box, { min = 0.6, steps = 8, prop = '--k' } = {}) {
  root.style.setProperty(prop, '1');
  box.classList.remove('is-clipped');
  if (!box.clientHeight || !overflows(box)) return 1;
  let lo = min;
  let hi = 1;
  let best = min;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    root.style.setProperty(prop, mid.toFixed(4));
    if (overflows(box)) hi = mid;
    else { best = mid; lo = mid; }
  }
  root.style.setProperty(prop, best.toFixed(4));
  if (overflows(box)) box.classList.add('is-clipped');
  return best;
}

// Einzeilig (white-space: nowrap): Faktor --fit, danach Auslassungspunkte per CSS.
export function fitLine(el, { min = 0.6, steps = 7 } = {}) {
  el.style.setProperty('--fit', '1');
  if (!el.clientWidth || el.scrollWidth <= el.clientWidth + 1) return 1;
  let lo = min;
  let hi = 1;
  let best = min;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    el.style.setProperty('--fit', mid.toFixed(4));
    if (el.scrollWidth > el.clientWidth + 1) hi = mid;
    else { best = mid; lo = mid; }
  }
  el.style.setProperty('--fit', best.toFixed(4));
  return best;
}
