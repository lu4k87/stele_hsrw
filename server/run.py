"""Einstieg: Stele CMS starten (waitress, sonst Flask-Server threaded ohne Reloader).

Umgebungsvariablen: STELECMS_HOST, STELECMS_PORT, STELECMS_DATA, STELECMS_SECRET_KEY,
STELECMS_BACKGROUND, STELECMS_SEED_DEMO (s. docs/SPEC.md §2).
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from stelecms import create_app  # noqa: E402
from stelecms.seed import log_player_links  # noqa: E402


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    log = logging.getLogger("stelecms")
    app = create_app()
    host, port = app.config["HOST"], app.config["PORT"]
    log.info("Stele CMS läuft auf http://%s:%s/admin/ (Daten: %s)", host, port, app.config["DATA_DIR"])
    log_player_links(app)
    log.info("Eigenes Administratorkonto anlegen: .venv/bin/python server/manage.py create-admin "
             "--username <name> --display-name \"<Anzeigename>\" (Passwort wird erzeugt, wenn --password fehlt)")
    try:
        from waitress import serve
    except ImportError:
        log.warning("waitress nicht installiert – Flask-Entwicklungsserver wird verwendet.")
        app.run(host=host, port=port, threaded=True, use_reloader=False, debug=False)
        return
    serve(app, host=host, port=port, threads=16, ident="SteleCMS", channel_timeout=300,
          max_request_body_size=1024 ** 4)


if __name__ == "__main__":
    main()
