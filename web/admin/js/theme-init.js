// Setzt Farbschema und Zoom vor dem ersten Zeichnen (kein Aufblitzen/Springen).
// data-theme ist immer das wirksame Schema ('light' | 'dark'), auch bei „Wie System“ –
// tokens.css braucht so nur einen Dunkel-Block. Umbruchpunkte rechnet danach js/zoom.js um.
(function () {
  var root = document.documentElement;
  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    var t = null;
    try { t = localStorage.getItem('stelecms.theme'); } catch (e) { /* Speicher nicht verfügbar – System gilt */ }
    root.setAttribute('data-theme', t === 'light' || t === 'dark' ? t : (systemDark.matches ? 'dark' : 'light'));
  }
  applyTheme();
  systemDark.addEventListener('change', applyTheme);
  try {
    var z = Number(localStorage.getItem('stelecms.zoom'));
    if ([0.8, 0.9, 1.1, 1.25, 1.5].indexOf(z) >= 0) {
      root.style.zoom = String(z);
      root.style.setProperty('--ui-zoom', String(z));
    }
  } catch (e) { /* Speicher nicht verfügbar – Standard gilt */ }
})();
