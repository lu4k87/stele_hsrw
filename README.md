# Stele CMS

Web-CMS für eine **digitale Stele** (Hochformat 1080 × 1920, Touch, PC mit Chrome im Kiosk-Modus).
Inhalte anlegen und pflegen, Präsentationen (Diashows) mit Header/Footer und Touch-Menü gestalten,
per Zeitplan ausspielen, Stelen überwachen – mit Benutzer-, Rollen- und Rechteverwaltung.

> **Testbetrieb:** Das CMS läuft vorerst nur lokal (`127.0.0.1:8090`). Die Anmeldung kann über
> Demo-Konten simuliert werden (nur von localhost). Netzwerk, HTTPS und die endgültige Anmeldung
> folgen später.

## Starten

```bash
./run.sh
```

- Legt beim ersten Start `.venv` an und installiert die Abhängigkeiten (Python ≥ 3.10).
- Admin-Oberfläche: <http://127.0.0.1:8090/admin/>
- Player-Link der Stele(n): steht im Startprotokoll und im CMS unter **Stelen → Verbindung**.
- Systempakete für Video und PDF: `ffmpeg` (inkl. `ffprobe`) und `poppler-utils` (`pdftoppm`, `pdfinfo`).

| Umgebungsvariable | Standard | Zweck |
|---|---|---|
| `STELECMS_HOST` | `127.0.0.1` | Bind-Adresse (später Netzwerk) |
| `STELECMS_PORT` | `8090` | Port |
| `STELECMS_DATA` | `./data` | Datenbank, Medien, Screenshots, Schlüssel |
| `STELECMS_BACKGROUND` | `1` | `0` = ohne Hintergrunddienste (Tests) |
| `STELECMS_SEED_DEMO` | `1` | Demo-Inhalte bei neuer Datenbank |

## Konten

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

Vor dem Netzwerkbetrieb: Demo-Konten löschen oder deaktivieren und die Schnellanmeldung unter
**Einstellungen → Sicherheit** abschalten.

## Stele einrichten

1. Im CMS **Stelen → Stele hinzufügen** – Name, Standort, IP.
2. Auf dem Stelen-PC Chrome im Kiosk-Modus mit dem Player öffnen:
   `google-chrome --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 --disable-pinch "http://<cms>:8090/player/"`
3. Der Player zeigt einen 6-stelligen Code → im Assistenten auswählen oder eingeben. Alternativ direkt den Player-Link mit Schlüssel verwenden.
4. Optional den Stelen-Agenten für CPU/RAM/Temperatur und Screenshots starten: [stele_agent/README.md](stele_agent/README.md).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `server/` | Flask-Backend (`stelecms/`), `run.py`, `manage.py`, Tests (`tests/`) |
| `web/admin/` | Admin-Oberfläche (Vanilla JS, ohne Build) – Aufbau in [web/admin/README.md](web/admin/README.md) |
| `web/player/` | Player für die Stele (Diashow, Rahmen, Touch-Modus, Offline-Cache) |
| `web/shared/` | gemeinsame Icons |
| `stele_agent/` | Agent für den Stelen-PC |
| `docs/SPEC.md` | Spezifikation (Datenmodell, API, Player-Vertrag, UX-Regeln) |
| `data/` | Laufzeitdaten – nicht im Git |

## Tests

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest server/tests -q
```

## Backup

Im CMS unter **Einstellungen → System → Backup herunterladen** (SQLite-Datenbank). Medien liegen in `data/media/`.
