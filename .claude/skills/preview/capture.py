#!/usr/bin/env python3
"""Screenshots des Stele CMS für Vorschau-Seiten – isoliert wie docs/screenshots.py.

  .venv/bin/python .claude/skills/preview/capture.py <shots.json> --out <scratchpad>/shots [--only a,b]

Startet eine eigene Testinstanz (Standard Port 18096, Demo-Daten im Temp-Ordner) und einen eigenen
headless Chrome (CDP 19226, de-DE); Port 8090 und data/ des Users bleiben unberührt. Stelen-Schlüssel
und lokale Pfade werden vor jeder Aufnahme ersetzt.

shots.json:
  {"defaults": {"width": 1440, "height": 900, "theme": "light", "user": "admin", "wait": 1.5},
   "shots": [
     {"name": "dashboard", "page": "admin", "hash": "/"},
     {"name": "media_dark", "page": "admin", "hash": "/media", "theme": "dark"},
     {"name": "kopf_neu", "page": "admin", "hash": "/", "clip": ".page-header",
      "css": ".page-header { background: var(--primary-soft); }"},
     {"name": "tour", "page": "show", "clip": "#rundgang"},
     {"name": "player", "page": "player", "width": 540, "height": 960},
     {"name": "mockup", "url": "file:///pfad/mockup.html"}]}
  page  = admin (Hash-Route) · show (Vorführseite) · player (Player der Demo-Stele) · url = beliebige Adresse
  js    = Rumpf einer async-Funktion (await erlaubt), läuft nach Laden + Theme;
          ein return-Wert wird ausgegeben (Prüfwerte)
  css   = zusätzliches CSS (geplante Änderung vorab einspielen, z. B. Vorher/Nachher)
  clip  = nur dieses Element (Selektor) aufnehmen, pad = Rand in px (Standard 12)
  user  = Demo-Konto (admin, redaktion, autor, betrachter) – zeigt die Ansicht mit dessen Rechten
Die Seite wird pro Shot neu geladen, damit sich Zustände nicht mischen.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "docs"))
import screenshots as S  # noqa: E402  (Browser, Page, Shooter, login, api, wait_json, stop)


def main():
    ap = argparse.ArgumentParser(description="Screenshots für Vorschau-Seiten (isoliert).")
    ap.add_argument("shots")
    ap.add_argument("--out", required=True, help="Zielordner (Scratchpad)")
    ap.add_argument("--only", help="nur diese Shots (Komma-Liste)")
    ap.add_argument("--port", type=int, default=18096)
    ap.add_argument("--cdp-port", type=int, default=19226)
    args = ap.parse_args()
    if not 18090 <= args.port <= 18099:
        sys.exit("Bitte einen Testport 18090–18099 verwenden.")
    spec = json.load(open(args.shots, encoding="utf-8"))
    defaults = {"width": 1440, "height": 900, "theme": "light", "user": "admin", "wait": 1.5, "pad": 12, **spec.get("defaults", {})}
    only = set(args.only.split(",")) if args.only else None
    shots = [{**defaults, **s} for s in spec["shots"] if not only or s["name"] in only]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    tmp = Path(tempfile.mkdtemp(prefix="stele-preview-"))
    data = tmp / "data"
    base = f"http://127.0.0.1:{args.port}"
    errors, server, browser = [], None, None
    try:
        env = {**os.environ, "STELECMS_PORT": str(args.port), "STELECMS_DATA": str(data), "STELECMS_HOST": "127.0.0.1",
               "STELECMS_SEED_DEMO": "1", "STELECMS_BACKGROUND": "1"}
        server = subprocess.Popen([sys.executable, str(ROOT / "server" / "run.py")], cwd=ROOT, env=env,
                                  stdout=open(tmp / "server.log", "w"), stderr=subprocess.STDOUT)
        S.wait_json(base + "/api/auth/session", 90)
        browser = S.Browser(args.cdp_port, tmp / "chrome", errors)
        p = browser.new_page()
        S.login(p, base)
        key = S.api(p, "GET", "/api/steles/1")["player_url"].split("key=", 1)[1]
        browser.close_page(p)
        shooter = S.Shooter(base, key, data, out)
        user = None
        for shot in shots:
            page = browser.new_page(w=shot["width"], h=shot["height"], theme=shot["theme"],
                                    isolated=shot.get("page") == "player")
            if shot.get("page") in ("admin", "show"):
                if user != shot["user"]:
                    S.login(page, base, shot["user"])
                    user = shot["user"]
                url = base + ("/admin/show-stele-index.html" if shot["page"] == "show" else "/admin/#" + shot.get("hash", "/"))
            elif shot.get("page") == "player":
                url = f"{base}/player/?key={key}"
            else:
                url = shot["url"]
            page.goto(url, wait=3 if shot.get("page") == "player" else 2)
            if shot.get("css"):
                page.js("(css) => document.head.append(Object.assign(document.createElement('style'), {textContent: css}))", shot["css"])
            if shot.get("js"):
                r = page.js(f"async () => {{ {shot['js']} }}")
                if r is not None:
                    print(f"   = {shot['name']}: {r}")  # Rückgabe des js (Prüfwerte)
            time.sleep(shot["wait"])
            clip = f"document.querySelector({json.dumps(shot['clip'])})" if shot.get("clip") else None
            shooter.shot(page, shot["name"], clip, pad=shot["pad"])
            browser.close_page(page)
    finally:
        if browser:
            browser.quit()
        S.stop(server)
        shutil.rmtree(tmp, ignore_errors=True)
    if errors:
        print("Fehler/Warnungen:\n  " + "\n  ".join(errors))
    print(f"ok: {len(shooter.written)} Bilder in {out}")


if __name__ == "__main__":
    main()
