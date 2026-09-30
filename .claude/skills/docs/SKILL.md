---
name: docs
description: Doku im Stele CMS pflegen – README.md, docs/SPEC.md, web/admin/README.md, stele_agent/README.md, Screenshots in docs/img. Nutzen bei "Doku", "README", "SPEC", "dokumentieren", nach neuen Funktionen und beim Doku-Abgleich am Ende paralleler Chats.
---

# Doku pflegen

## Wo steht was
- `README.md`: Quick Setup, Funktionen mit Screenshots, Schnellstart, Konfiguration, Konten, Stele einrichten, Aufbau, Entwicklung/Git, Tests, Backup.
- `docs/SPEC.md`: verbindlicher Vertrag – Datenmodell (§4), JSON (§5), Rechte (§6), API (§7), Manifest (§8), Player (§9), Agent (§10), Admin/UX (§11). Groß → erst `grep -n "^#"`, dann gezielt lesen.
- `web/admin/README.md`: Bausteine und View-Vertrag der Admin-Oberfläche.
- `stele_agent/README.md`: Aufruf, Optionen, Autostart des Agenten.
- `docs/img/*.png`: nie von Hand → `.venv/bin/python docs/screenshots.py [abschnitt …]` (isoliert, maskiert Schlüssel und Pfade).

## Schreiben
- Ändert sich API, Datenmodell, Manifest oder Verhalten → SPEC **und** README im selben Commit.
- Jede Zeile nennt etwas Konkretes: Pfad, Endpunkt, Recht, Knopf, Wert, Schritt. Keine Floskeln.
- Prüffrage: Kann der Leser damit etwas tun oder finden? Sonst konkret machen oder streichen.
- Begriffe nach SPEC §3 (Inhalt, Präsentation, Folie, Design, Touch-Menü, Stele, Zeitplan-Eintrag; Entwurf ↔ veröffentlichter Stand).
- Neue Bilder in der README mit `alt`-Text; nebeneinander per `<img width="49%">`.

## Doku-Abgleich „wenn alle Chats fertig sind“
- Vorher nichts ändern oder committen; nur lesend vorbereiten. Peers per `SendMessage` abonnieren.
- Wenn alle fertig sind: README und SPEC Abschnitt für Abschnitt gegen den Code prüfen (Routen, Endpunkte, Rechte, Ports, Knöpfe, Abläufe), Screenshots neu erzeugen, dann committen und pushen.
