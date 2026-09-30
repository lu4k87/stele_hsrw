// Setzt gespeichertes Farbschema und Zoom vor dem ersten Zeichnen (kein Aufblitzen/Springen).
// Umbruchpunkte rechnet danach js/zoom.js um.
(function () {
  try {
    var root = document.documentElement;
    var t = localStorage.getItem('stelecms.theme');
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    var z = Number(localStorage.getItem('stelecms.zoom'));
    if ([0.8, 0.9, 1.1, 1.25, 1.5].indexOf(z) >= 0) {
      root.style.zoom = String(z);
      root.style.setProperty('--ui-zoom', String(z));
    }
  } catch (e) { /* Speicher nicht verfügbar – Standard gilt */ }
})();
