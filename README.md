# Stele CMS

Web-CMS für eine **digitale Stele** (Hochformat 1080 × 1920, Touch, PC mit Chrome im Kiosk-Modus):
Inhalte pflegen, Präsentationen gestalten, per Zeitplan ausspielen, Stelen überwachen.

<p>
  <img src="docs/img/dashboard.png" alt="Admin-Oberfläche: Übersicht mit Stele, Freigaben und letzter Aktivität" width="72%">
  <img src="docs/img/player.png" alt="Player auf der Stele im Hochformat" width="24%">
</p>

*Links die Admin-Oberfläche (Übersicht), rechts der Player, wie er auf der Stele läuft.*

> **Testbetrieb:** Das CMS läuft vorerst nur lokal (`127.0.0.1:8090`). Netzwerk, HTTPS und die
> endgültige Anmeldung folgen später.

## Inhalt

1. [Funktionen](#1-funktionen)
2. [Schnellstart](#2-schnellstart)
3. [Konfiguration](#3-konfiguration)
4. [Konten und Rollen](#4-konten-und-rollen)
5. [Stele einrichten](#5-stele-einrichten)
6. [Aufbau des Repos](#6-aufbau-des-repos)
7. [Entwicklung und Git](#7-entwicklung-und-git)
8. [Tests](#8-tests)
9. [Backup](#9-backup)

## 1. Funktionen

### Mediathek

- Inhalte: Bilder, Videos, PDFs, Info-Folien (aus Vorlagen), Webseiten
- Suche, Filter nach Typ und Schlagwort, Raster- oder Listenansicht
- Anzeige, in wie vielen Präsentationen ein Inhalt verwendet wird

![Mediathek mit Bildern, Info-Folien, Video und Webseite](docs/img/media.png)

### Präsentationen

- Diashow aus Folien mit eigener Dauer, Übergang und Gültigkeitszeitraum
- **Design**: Rahmen mit Header (Logo, Titel, Uhr) und Footer (Laufband oder Text)
- **Touch-Menü**: Kacheln für Besucher, Rückkehr zur Diashow nach Inaktivität
- Bearbeitet wird der Entwurf; an die Stele geht nur der **veröffentlichte** Stand
- Freigabe: Autoren reichen ein, Redaktion veröffentlicht

![Präsentations-Editor: Folienliste, Vorschau im Hochformat, Einstellungen der Folie](docs/img/editor.png)

### Zeitplan

- Präsentation je Stele nach Wochentag, Uhrzeit, Datumsbereich und Priorität
- Ohne passenden Eintrag läuft die Standard-Präsentation
- Wochenansicht mit Hinweis auf Konflikte und unveröffentlichte Stände

![Zeitplan in der Wochenansicht](docs/img/schedule.png)

### Stelen und Monitoring

- Mehrere Stelen: Name, Standort, IP, Standard-Präsentation
- Zustand, Verfügbarkeit, laufende Wiedergabe, Touch-Nutzung, Fehler
- Optional: Stelen-Agent meldet CPU, RAM, Temperatur und liefert Screenshots

![Monitoring: Zustand und Verfügbarkeit der Stele](docs/img/monitoring.png)

### Benutzer, Rollen, Protokoll

- Lokale Konten mit Passwort-Hash, Sitzung und Sperre nach Fehlversuchen
- Rollen bündeln Rechte pro Funktion; jedes Konto hat genau eine Rolle
- Protokoll aller Änderungen und Anmeldungen

![Rollen und Rechte](docs/img/roles.png)

### Player

- Läuft in Chrome (Kiosk) auf dem Stelen-PC, Bühne fest in Stelen-Auflösung
- Kopplung per 6-stelligem Code oder Player-Link mit Schlüssel
- Offline-Cache: spielt weiter, wenn das CMS nicht erreichbar ist
- Keine externen CDNs, kein Build-Schritt – alles läuft aus dem Repo

## 2. Schnellstart

Voraussetzungen:

- Python ≥ 3.10 mit `venv` (Debian/Ubuntu: `sudo apt install python3-venv`)
- `ffmpeg` (inkl. `ffprobe`) für Videos, `poppler-utils` (`pdftoppm`, `pdfinfo`) für PDFs
- Chrome für den Player

```bash
git clone git@github.com:lu4k87/stele_hsrw.git
cd stele_hsrw
./run.sh
```

- Erster Start legt `.venv` an und installiert die Abhängigkeiten
- Admin-Oberfläche: <http://127.0.0.1:8090/admin/>
- Player-Link der Stele: steht im Startprotokoll und im CMS unter **Stelen → Verbindung**
- Neue Datenbank erhält Demo-Inhalte (abschaltbar, siehe Konfiguration)

## 3. Konfiguration

| Umgebungsvariable | Standard | Zweck |
|---|---|---|
| `STELECMS_HOST` | `127.0.0.1` | Bind-Adresse (später Netzwerk) |
| `STELECMS_PORT` | `8090` | Port |
| `STELECMS_DATA` | `./data` | Datenbank, Medien, Screenshots, Schlüssel |
| `STELECMS_BACKGROUND` | `1` | `0` = ohne Hintergrunddienste (Tests) |
| `STELECMS_SEED_DEMO` | `1` | Demo-Inhalte bei neuer Datenbank |

Beispiel für eine zweite Instanz mit eigenen Daten:

```bash
STELECMS_PORT=8091 STELECMS_DATA=/tmp/stele-test ./run.sh
```

## 4. Konten und Rollen

![Anmeldung mit Schnellanmeldung im Testbetrieb](docs/img/login.png)

- Schnellanmeldung mit Demo-Konten: nur im Testbetrieb und nur von localhost

| Konto | Passwort | Rolle |
|---|---|---|
| `admin` | `admin123` | Administrator (Demo) |
| `redaktion` | `redaktion123` | Redaktion (Demo) |
| `autor` | `autor123` | Autor (Demo) |
| `betrachter` | `betrachter123` | Betrachter (Demo) |

Eigenes Administratorkonto und Passwörter auf der Kommandozeile:

```bash
.venv/bin/python server/manage.py create-admin --username <name> --display-name "<Anzeigename>"   # Passwort wird erzeugt
.venv/bin/python server/manage.py reset-password --username <name>
.venv/bin/python server/manage.py list-users
```

> **Vor dem Netzwerkbetrieb:** Demo-Konten löschen oder deaktivieren und die Schnellanmeldung unter
> **Einstellungen → Sicherheit** abschalten.

## 5. Stele einrichten

1. Im CMS **Stelen → Stele hinzufügen** – Name, Standort, IP.
2. Auf dem Stelen-PC Chrome im Kiosk-Modus mit dem Player öffnen:

   ```bash
   google-chrome --kiosk --noerrdialogs --disable-infobars \
     --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 \
     --disable-pinch "http://<cms>:8090/player/"
   ```

3. Der Player zeigt einen 6-stelligen Code → im Assistenten auswählen oder eingeben.
   Alternativ direkt den Player-Link mit Schlüssel verwenden.
4. Optional den Stelen-Agenten starten (CPU, RAM, Temperatur, Screenshots):
   [stele_agent/README.md](stele_agent/README.md).

## 6. Aufbau des Repos

| Pfad | Inhalt |
|---|---|
| `server/` | Flask-Backend (`stelecms/`), `run.py`, `manage.py`, Tests (`tests/`) |
| `web/admin/` | Admin-Oberfläche (Vanilla JS, ohne Build) – Aufbau in [web/admin/README.md](web/admin/README.md) |
| `web/player/` | Player für die Stele (Diashow, Rahmen, Touch-Modus, Offline-Cache) |
| `web/shared/` | gemeinsame Icons |
| `stele_agent/` | Agent für den Stelen-PC |
| `docs/SPEC.md` | Spezifikation (Datenmodell, API, Player-Vertrag, UX-Regeln) |
| `docs/img/` | Screenshots für diese README |
| `.githooks/` | Prüfung vor jedem Commit |
| `data/` | Laufzeitdaten – nicht im Git |

## 7. Entwicklung und Git

Einmalig nach dem Klonen:

```bash
git config core.hooksPath .githooks   # Prüfung vor jedem Commit einschalten
git config pull.ff only               # kein stiller Merge beim Pull
```

Ablauf:

```bash
git pull                       # Stand holen
# … ändern, testen …
git status                     # prüfen, was sich geändert hat
git add <dateien>
git commit -m "feat(admin): kurze Beschreibung"
git push
```

- **Commit-Stil:** `typ(bereich): Beschreibung` – Typen `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`;
  Bereiche z. B. `server`, `admin`, `player`, `agent`
- **Prüfung vor dem Commit** (`.githooks/pre-commit`):
  - lehnt Laufzeitdaten ab (`data/`, `.venv/`, Datenbank, `secret_key`)
  - führt bei Änderungen unter `server/` die Tests aus
  - im Ausnahmefall überspringen: `git commit --no-verify`
- **Nicht im Git:** `data/` (Datenbank, Medien, Schlüssel), `.venv/`, Editor-Einstellungen
- **Zeilenenden:** `.gitattributes` hält alle Textdateien auf LF
- **Web-Oberflächen:** kein Build – Browser neu laden genügt

## 8. Tests

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest server/tests -q
```

## 9. Backup

- Datenbank: im CMS unter **Einstellungen → System → Backup herunterladen** (SQLite)
- Medien: Ordner `data/media/` sichern
