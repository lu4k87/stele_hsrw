// Setzt das gespeicherte Farbschema vor dem ersten Zeichnen (kein Aufblitzen des hellen Designs).
(function () {
  try {
    var t = localStorage.getItem('stelecms.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* Speicher nicht verfügbar – Systemeinstellung gilt */ }
})();
