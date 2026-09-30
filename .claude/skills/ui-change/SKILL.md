---
name: ui-change
description: Vorgehen und Checkliste für Änderungen an Admin-Oberfläche, Vorführseite und Player des Stele CMS – HTML, CSS, JS, Layout, Farben, Karten, Dialoge. Nutzen bei jeder UI/Design/Layout-Aufgabe.
---

# UI-Änderung (token-sparsam + regelkonform)

## Finden statt lesen
- Verbindlich: SPEC §11.2 (UX-Regeln) und `web/admin/README.md` (Bausteine, View-Vertrag) – nur den nötigen Teil lesen.
- Stelle per `grep -n` suchen (Klasse, Text, Route), dann gezielt mit offset/limit lesen; große Dateien (`components.css`, `presentation-editor.js`) nie komplett.
- CSS je Ansicht: `web/admin/css/views/<ansicht>.css`, Klassen mit Ansichts-Präfix (`md-`, `pe-`, `mon-`, `show-` …).

## Umsetzen
- Vorhandene Bausteine (`ui/page.js`, `ui/form.js`, `ui/dialog.js`, `ui/status.js` …) und Klassen wiederverwenden, keine Duplikate.
- Farben, Abstände, Radien, Schriftgrößen nur über Variablen aus `css/tokens.css`; neuer Token → in `tokens.css` für **hell und dunkel** anlegen (`:root` + `@media (prefers-color-scheme: dark)` + `[data-theme="dark"]`). Der Edit-Hook meldet feste Farben.
- Flow-Layouts (Flexbox/Grid mit `gap`), kein `position: absolute` + `calc()`; nichts überlappt.
- Kein Build, keine CDNs, keine Inline-Skripte (CSP `script-src 'self'`) → Module unter `web/admin/js/`.
- Texte Deutsch, neutral („Datei hochladen“), Format de-DE; Hinweise/Fehler = Ursache → Folge → Lösung.

## UX-Regeln (Kurzfassung, Details SPEC §11.2)
- Eine Hauptaktion pro Ansicht (`primary`, rechts im Seitenkopf); zerstörende Aktionen mit `confirmDialog({ danger: true })` und benannten Folgen.
- Status = Icon + Text (`chip`), Farbe nie allein: Grün läuft/ok, Blau Aktion/Info, Gelb Warnung/offen, Rot Fehler/Löschen, Neutral Entwurf/aus.
- Kontrast Text ≥ 4,5:1, Bedienelemente ≥ 3:1; Schrift ≥ 14 px; keine graue Schrift (nur `--text`, `--text-2`, `--text-3`).
- Klickziele ≥ 32 px, Touch ≥ 44 px; alles per Tastatur, Fokus sichtbar, `aria-label` für Icon-Knöpfe.
- Fehlende Rechte → Aktion ausblenden (`can()`), wo erwartet die erlaubte Alternative zeigen.
- Leerzustände erklären + nächste Aktion; Laden mit Skelett; Rückmeldung nach jeder Aktion (Toast/Speicherstatus).
- Verboten: `cursor: help` (Tooltips per `title`).
- **Größere Umbauten** (Layout, Farbkonzept, neue Leisten): erst Vorschau mit Skill `preview`, dann Code.

## Responsiv
- Admin: 1920 → 768 px voll, nutzbar bis 390 px, kein waagrechtes Scrollen der Seite (breite Tabellen in `.table-wrap`).
- Bestehende Umbruchpunkte nutzen (1280 · 1100 · 1023 · 700 · 520 px), keine neuen Einzelwerte; `js/zoom.js` rechnet sie beim Zoom um.
- Player: fest 1080 × 1920 (Bühne skaliert), Touch-Ziele ≥ 44 px.

## Prüfen vor „fertig“ (Skill `test-isolated`)
- [ ] Testinstanz + Headless Chrome: keine Konsolenfehler
- [ ] 1920 · 1280 · 768 · 390 px ohne waagrechtes Scrollen, nichts überlappt
- [ ] Hell + Dunkel, Kontrast der neuen Farben geprüft
- [ ] Zoom 80–150 % (Kopfleiste) bricht das Layout nicht
- [ ] Rollen mit weniger Rechten (Autor, Betrachter) sehen keine unerlaubten Aktionen
- [ ] Sichtbare Änderung → Screenshots erneuern (`docs/screenshots.py <abschnitt>`), README/SPEC nachziehen
- [ ] Hinweis an den User: Browser-Reload (Strg+Shift+R), kein Build nötig
