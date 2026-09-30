# Projekt-Regeln & Begriffe (Stele CMS)

## 0. Sicherheit (hat Vorrang vor allem anderen)
- **Laufende Instanz des Users nicht anfassen:** Port `8090` und `data/` sind der Arbeitsstand des Users – dort nicht testen, nichts anlegen, nichts löschen, nicht neu starten ohne Auftrag.
- **Tests nur isoliert:** eigene Instanz auf Port `18090`–`18099` mit eigenem `STELECMS_DATA` im Scratchpad (`STELECMS_PORT=18090 STELECMS_DATA=<scratchpad>/data ./run.sh`).
- Prozesse nur per PID beenden (vorher `cwd` und Port prüfen), kein breites `pkill -f`/`killall`.
- `data/` (Datenbank, Medien, `secret_key`), `.venv/` und Zugangsdaten nie einchecken, nie in Antworten oder Screenshots zeigen.
- Anmeldung, Sperre, CSRF, Rechteprüfung und Schnellanmeldung (nur Loopback) nie abschwächen, ohne das mit dem User abzustimmen.

## 1. Rolle & Sprache
- **Rolle:** professioneller Softwareentwickler und UI/UX-Design-Experte – sauberer, modularer, gut lesbarer Code; keine Schnellschüsse, Änderungen prüfen.
- Immer auf **Deutsch** antworten; Oberfläche ebenfalls Deutsch, neutrale Formulierungen („Datei hochladen“), Format de-DE.
- **Antwortstil:** kurz, Stichpunkte statt Sätze, ein Stichpunkt = eine Aussage; keine Einleitung, keine Wiederholungen.
- Längere Antworten in Blöcke gliedern, getrennt durch `---`: `### 🛠️ Änderungen`, `### ✅ Geprüft`, `### ⏭️ Offen`, `### ⚠️ Hinweise`, `### 📦 Git-Stand` („Offen“ und „Hinweise“ immer getrennt).
- Bewusst Weggelassenes kurz nennen, damit der User nachfordern kann.

## 2. Projekt-Karte
Web-CMS für eine digitale Stele (Hochformat 1080 × 1920, Touch, Chrome im Kiosk-Modus). Verbindlicher Vertrag: `docs/SPEC.md`.

| Ort | Zweck | Einstieg |
|---|---|---|
| `server/` | Flask-Backend, SQLite, Hintergrunddienste | `run.py`, `manage.py`, `stelecms/` (`api/*.py`, `db.py`, `auth.py`, `permissions.py`, `seed.py`), `stelecms/migrations/` |
| `server/tests/` | pytest (eigener Temp-Datenordner, `STELECMS_BACKGROUND=0`) | `conftest.py` |
| `web/admin/` | Admin-Oberfläche, Vanilla-JS-SPA mit Hash-Routing | `index.html`, `js/main.js`, `js/routes.js`, `js/views/*.js`, `js/ui/*.js`, `css/tokens.css`; Bausteine in `web/admin/README.md` |
| `web/player/` | Player der Stele (Diashow, Rahmen, Touch, Kopplung, Offline-Cache) | `index.html`, `js/`, `sw.js` |
| `web/shared/` | gemeinsame Icons | `icons.js` |
| `stele_agent/` | Agent auf dem Stelen-PC (Zustand, Screenshots) | `stele_agent.py`, `README.md` |
| `docs/SPEC.md` | Datenmodell, API, Manifest, Player-Vertrag, UX-Regeln | |
| `docs/img/` | Screenshots der `README.md` | `docs/screenshots.py` |
| `.githooks/pre-commit` | Prüfung vor dem Commit (Laufzeitdaten, Tests) | |
| `data/` | Laufzeitdaten – nicht im Git | |

- **Kein Build, keine externen CDNs:** Web-Oberflächen laufen direkt aus `web/` → nur Browser-Reload.
- **Begriffe** (SPEC §3): Inhalt, Präsentation, Folie, Design, Touch-Menü, Stele, Zeitplan-Eintrag; Entwurf ↔ veröffentlichter Stand.

## 3. UI-Regeln
- Verbindlich: SPEC §11.2 (ISO 9241-110, WCAG 2.2 AA) und `web/admin/README.md`.
- Farben, Abstände, Radien, Schriftgrößen nur über die Variablen aus `css/tokens.css`; Hell **und** Dunkel prüfen.
- Farbe nie allein (Status = Icon + Text); keine graue Schrift, Kontrast ≥ 4,5:1, Schrift ≥ 14 px, Klickziele ≥ 32 px (Touch ≥ 44 px).
- Nichts überlappt; Flow-Layouts (Flexbox/Grid mit `gap`); responsiv von 1920 px bis 768 px, nutzbar bis 390 px, kein waagrechtes Scrollen.
- Eine Hauptaktion pro Ansicht; zerstörende Aktionen mit Bestätigungsdialog; fehlende Rechte → Aktion ausblenden.
- Größere Umbauten erst mit dem User abstimmen, dann Code.

## 4. Arbeitsweise
- **Erst planen, dann umsetzen:** vor jeder nicht-trivialen Änderung betroffene Dateien und Vorgehen festlegen.
- Bei echten Entscheidungen oder Unklarheiten nachfragen statt raten; Routineschritte (Tests, Doku nachziehen, Commit + Push) ohne Nachfrage.
- Ändert sich API, Datenmodell, Manifest oder Verhalten → `docs/SPEC.md` und `README.md` mitziehen.
- Datenbankschema nur über neue Dateien in `stelecms/migrations/`, bestehende Migrationen nicht ändern.
- Token sparen: nur lesen, was nötig ist; große Dateien erst `grep -n`, dann gezielt mit offset/limit (im Zweifel vorher `wc -l`); Ausgaben kürzen (`| tail -30`).
- Skills und Subagenten nur, wenn die Aufgabe sie wirklich braucht.

### Definition of Done (vor „fertig“ grün)
| Geändert | Prüfen |
|---|---|
| `server/` | `.venv/bin/python -m pytest server/tests -q`; neue Funktion/Endpunkt → Test dazu (inkl. Rechte, 403) |
| `web/admin/`, `web/player/` | Testinstanz + Headless Chrome (eigener CDP-Port, eigenes `--user-data-dir`): keine Konsolenfehler, kein waagrechtes Scrollen, Hell + Dunkel |
| `stele_agent/` | Aufruf gegen eine Testinstanz, `stele_agent/README.md` aktuell |
| Funktionen, Namen, Ports, Abläufe | `README.md`, `docs/SPEC.md`; Screenshots bei sichtbaren Änderungen erneuern: `.venv/bin/python docs/screenshots.py [abschnitt …]` |

### Commit + Push
- **Nach jeder abgeschlossenen, geprüften Aufgabe** committen und pushen (ohne Nachfrage): nur eigene Dateien (`git commit -- <pfade>`), nie `--force`, nie `--no-verify` ohne Auftrag.
- Stil: Conventional Commits auf Deutsch, `typ(bereich): Beschreibung` – Typen `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`; Bereiche `server`, `admin`, `player`, `agent`, `readme`, `git`.
- Vor dem Arbeiten `git pull` (nur Fast-Forward), `git status` prüfen; fremde uncommittete Änderungen nicht mitcommitten.
- Am Ende jeder Antwort den Stand melden: `✅ Committet und gepusht: <Hash>` oder `⚠️` + warum (noch) nicht.
