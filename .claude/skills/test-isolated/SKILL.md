---
name: test-isolated
description: Isoliert testen im Stele CMS, ohne die Instanz des Users (Port 8090, data/) zu stören – Testinstanz, Headless Chrome/CDP, Player, Stelen-Agent, pytest. Nutzen vor jedem Browser-, Server- oder Agent-Test und bei "teste", "headless", "Screenshot".
---

# Isoliert testen (nie in der Instanz des Users)

## Grundregeln
- Port `8090` und `data/` gehören dem User: dort nicht testen, nichts anlegen, nichts löschen, nicht neu starten.
- Eigene Instanz: Port `18090`–`18099`, `STELECMS_DATA` im Scratchpad. Bash `run_in_background` nutzen (kein `cd && … &`, sonst ist `$!` die Subshell).
- Auf lange Läufe (Server-Start, Screenshots) warten per `until curl -sf <url> >/dev/null; do sleep 1; done` bzw. `until grep -q <Marker> <log>; …` (mit `timeout`) oder Monitor – `sleep N; tail` blockiert der Harness.
- Prozesse nur per PID beenden (vorher `/proc/<pid>/cmdline` bzw. `cwd` und Port prüfen), nie breites `pkill -f`/`killall`.
- Nie sichtbare Testfenster öffnen; nur headless.
- Stelen-Schlüssel, `secret_key` und lokale Pfade nie in Antworten oder Screenshots (maskieren).

## Server
- `pytest`: `.venv/bin/python -m pytest server/tests -q` (eigener Temp-Datenordner, `STELECMS_BACKGROUND=0`). Neue Endpunkte → Test inkl. Rechte (403).
- Testinstanz: `STELECMS_PORT=18090 STELECMS_DATA=<scratchpad>/data ./run.sh` (Demo-Daten + Schnellanmeldung, nur Loopback).
- Anmeldung im Test: `POST /api/auth/dev-login {"username": "admin"}`; ändernde Aufrufe brauchen `X-CSRF-Token` aus `/api/auth/session`.

## Web (Admin, Vorführseite, Player)
- Chrome headless mit eigenem Profil und CDP-Port (nicht 9222/9333):
  `google-chrome --headless=new --no-sandbox --hide-scrollbars --lang=de-DE --remote-debugging-port=192xx --user-data-dir=<scratchpad>/chrome --disable-background-timer-throttling --disable-renderer-backgrounding`
- `--lang=de-DE` ist Pflicht, sonst zeigen Datums-/Zeitfelder `mm/dd/yyyy` bzw. `AM/PM`.
- CDP-Bausteine wiederverwenden: `Browser`, `Page`, `Shooter` (Maskierung), `login`, `api` aus `docs/screenshots.py` (`sys.path.insert(0, 'docs')`, `import screenshots`). `websocket-client` ist in `requirements-dev.txt`; pyppeteer nicht verwenden (veraltet, startet aktuelles Chrome nicht).
- Prüfen: keine Konsolenfehler (`Runtime.exceptionThrown`, `console.error`), kein waagrechtes Scrollen (`scrollWidth <= clientWidth`) bei 1920 · 1280 · 768 · 390 px, Hell + Dunkel (`localStorage['stelecms.theme']` vor dem Laden setzen).
- SPA-Routen: nach der Anmeldung einmal neu laden, dann `location.hash = '/media'` (gleiche URL mit anderem Hash lädt nicht neu).
- Hohe Ausschnitte: Fenster vergrößern statt `fullPage` – die feste Kopfleiste überdeckt sonst den oberen Rand.

## Player und Stelen-Agent
- Player der Demo-Stele: `GET /api/steles/1` → `player_url` (enthält den Schlüssel) in einem eigenen Tab öffnen; Kopplungscode: `/player/` in einem isolierten Kontext (`Target.createBrowserContext`) ohne Cookies.
- Touch-Nutzung erzeugen: in den Player klicken (öffnet Touch-Menü), Kachel antippen, „Zur Startseite“.
- Agent gegen die Testinstanz: `STELE_AGENT_KEY=<schlüssel> STELE_AGENT_SERVER=http://127.0.0.1:18090 python3 stele_agent/stele_agent.py --interval 10` – **ohne** `--allow-screenshots` (würde den echten Desktop aufnehmen); einmaliger Test: `--once`.

## Screenshots für die README
- `.venv/bin/python docs/screenshots.py [abschnitt …]` erledigt alles selbst (Instanz 18095, Chrome 19225, Player, Agent, Beispieldaten, Maskierung, Aufräumen); `--list`, `--out <scratchpad>` zum Probelauf.
