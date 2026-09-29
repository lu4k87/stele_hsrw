# Stelen-Agent

Kleines Python-Skript für den PC in der Stele. Es läuft neben Chrome (Kiosk-Modus) und meldet dem Stele CMS regelmäßig den Zustand des Rechners:

- Rechnername, Betriebssystem, Laufzeit, CPU-, RAM- und Plattenauslastung, Temperatur, IP-Adressen, Bildschirmauflösung
- auf Anforderung aus dem CMS (Monitoring → „Screenshot“) ein verkleinertes Bildschirmfoto (max. 540 px breit, JPEG) – **nur**, wenn der Agent mit `--allow-screenshots` gestartet wurde

Der Agent braucht nur Python ≥ 3.8 (Standardbibliothek). Optional genutzt, wenn installiert:

| Paket | Wozu |
|---|---|
| `psutil` | genauere Werte (CPU, Temperatur, Netzwerk), auch unter Windows |
| `mss` + `Pillow` | Bildschirmfotos (Windows, Linux/X11) |

Ohne `psutil` liest der Agent unter Linux `/proc` und `/sys`; unter Windows fehlen dann CPU und Temperatur.
Für Bildschirmfotos ohne `mss`/`Pillow` werden unter Linux `import` (ImageMagick, X11) bzw. `grim` (Wayland) versucht.

```bash
python3 -m pip install --user psutil mss Pillow   # optional
```

## Aufruf

```bash
python3 stele_agent.py --server http://<cms>:8090 --key <schlüssel> [--interval 60] [--allow-screenshots]
```

| Option | Bedeutung |
|---|---|
| `--server` | Adresse des CMS (Standard `http://127.0.0.1:8090`, auch `STELE_AGENT_SERVER`) |
| `--key` | Stelen-Schlüssel – steht im CMS unter *Stelen → Stele → Player-Adresse* (`…/player/?key=<schlüssel>`). Alternativ Umgebungsvariable `STELE_AGENT_KEY` (erscheint dann nicht in der Prozessliste). |
| `--interval` | Sekunden zwischen zwei Berichten (Standard 60, mindestens 10) |
| `--allow-screenshots` | Bildschirmfotos auf Anforderung erlauben. Ohne diese Option meldet der Agent „Screenshots auf der Stele deaktiviert“. |
| `--once` | nur einen Bericht senden und beenden (zum Testen der Verbindung; Rückgabewert 0 = erfolgreich) |
| `-v`, `--verbose` | ausführliche Ausgabe |

Verhalten bei Fehlern: Ist das CMS nicht erreichbar, versucht der Agent es nach 15 s, 30 s, 60 s … erneut, höchstens alle 5 Minuten. Er beendet sich nie wegen eines Fehlers. Ein falscher Schlüssel (401) wird als Fehler protokolliert.

Schnittstelle (SPEC §10): `POST /api/agent/report` (JSON) → `{ok, commands: [{id, command}]}` und `POST /api/agent/screenshot` (multipart, Feld `image`, JPEG). Zusätzlich sendet der Agent `agent_version`, `screenshot_at`, im nächsten Bericht `command_results: [{id, ok, message}]` und beim Hochladen das Formularfeld `command_id` – der Server darf diese Felder ignorieren.

## Autostart unter Linux (systemd-Benutzerdienst)

1. Skript ablegen, z. B. `~/stele_agent/stele_agent.py`.
2. Schlüssel in eine nur für den Benutzer lesbare Datei schreiben:

   ```bash
   mkdir -p ~/.config/stele-agent
   printf 'STELE_AGENT_KEY=%s\nSTELE_AGENT_SERVER=%s\n' '<schlüssel>' 'http://<cms>:8090' > ~/.config/stele-agent/env
   chmod 600 ~/.config/stele-agent/env
   ```

3. Dienst `~/.config/systemd/user/stele-agent.service` anlegen:

   ```ini
   [Unit]
   Description=Stelen-Agent (Stele CMS)
   After=graphical-session.target network-online.target

   [Service]
   EnvironmentFile=%h/.config/stele-agent/env
   ExecStart=/usr/bin/python3 %h/stele_agent/stele_agent.py --allow-screenshots
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=default.target
   ```

   Für Bildschirmfotos braucht der Dienst Zugriff auf die grafische Sitzung. Unter X11 ggf. in `[Service]` ergänzen: `Environment=DISPLAY=:0`.

4. Aktivieren und prüfen:

   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now stele-agent.service
   loginctl enable-linger "$USER"      # Dienst auch ohne offene Anmeldung starten
   journalctl --user -u stele-agent -f
   ```

## Autostart unter Windows (Aufgabenplanung)

Aufgabe beim Anmelden des Kiosk-Benutzers starten (Eingabeaufforderung als dieser Benutzer):

```bat
setx STELE_AGENT_KEY "<schlüssel>"
schtasks /Create /TN "Stelen-Agent" /SC ONLOGON /RL LIMITED /F ^
  /TR "\"C:\Program Files\Python312\pythonw.exe\" \"C:\Stele\stele_agent.py\" --server http://<cms>:8090 --allow-screenshots"
```

- `pythonw.exe` startet ohne Konsolenfenster (Pfad an die Python-Installation anpassen).
- In der Aufgabenplanung unter *Einstellungen* „Aufgabe bei Fehler neu starten“ aktivieren (z. B. alle 1 Minute, 999-mal) und „Aufgabe beenden, falls sie länger läuft als“ **deaktivieren**.
- Bildschirmfotos funktionieren nur in der angemeldeten Sitzung (Trigger „Bei Anmeldung“, nicht „Beim Start“ ohne Anmeldung).

## Chrome im Kiosk-Modus

Die Player-Adresse mit Schlüssel steht im CMS unter *Stelen → Stele*. Aufruf (SPEC §10):

```bash
google-chrome --kiosk --noerrdialogs --disable-infobars --autoplay-policy=no-user-gesture-required \
  --overscroll-history-navigation=0 --disable-pinch "http://<cms>:8090/player/?key=<schlüssel>"
```

Windows:

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --noerrdialogs --disable-infobars ^
  --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 --disable-pinch ^
  "http://<cms>:8090/player/?key=<schlüssel>"
```

Hinweise:

- Beim ersten Aufruf speichert der Player den Schlüssel und entfernt ihn aus der Adresszeile; danach genügt `http://<cms>:8090/player/`. Ohne Schlüssel zeigt der Player einen **Kopplungscode**, der im CMS unter *Stelen → Stele hinzufügen* eingegeben wird.
- Autostart Linux: Datei `~/.config/autostart/stele-player.desktop` mit `Exec=` = obiger Aufruf und `X-GNOME-Autostart-enabled=true`. Windows: Verknüpfung mit obigem Aufruf in `shell:startup` oder eine weitere Aufgabe „Bei Anmeldung“.
- Energiesparen, Bildschirmschoner und automatische Updates mit Neustart-Dialogen auf dem Stelen-PC abschalten; den Nachtmodus (schwarzer Bildschirm) steuert das CMS.
- Nach einem Absturz von Chrome startet ein Autostart-Eintrag den Player nicht neu. Für echten Dauerbetrieb Chrome über einen systemd-Benutzerdienst mit `Restart=always` starten (Linux) bzw. in der Aufgabenplanung „bei Fehler neu starten“ setzen (Windows).
- Der Player lädt sich täglich zur eingestellten Uhrzeit (`daily_reload`) selbst neu und arbeitet bei Netzausfall mit dem zuletzt gespeicherten Stand weiter.
