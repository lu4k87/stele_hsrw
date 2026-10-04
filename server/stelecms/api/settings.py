"""Systemeinstellungen, Sicherung und Systeminfo (SPEC §7.9)."""
from __future__ import annotations

import shutil
import sqlite3
import sys
from pathlib import Path

from flask import Blueprint, after_this_request, current_app, jsonify, send_file

from .. import appsettings, timeutil
from .. import auth as authm
from .. import db as dbm
from ..audit import audit
from ..config import APP_VERSION
from ..errors import validation
from ..permissions import has, require
from ..validation import body

bp = Blueprint("api_settings", __name__, url_prefix="/api")


def _visible(settings: dict) -> dict:
    if has("settings.manage"):
        return settings
    return {k: settings[k] for k in appsettings.PUBLIC_KEYS}


@bp.get("/settings")
def get_settings():
    authm.ensure_authenticated()
    return jsonify(_visible(appsettings.get_settings(dbm.get_db())))


@bp.patch("/settings")
@require("settings.manage")
def patch_settings():
    conn = dbm.get_db()
    data = body()
    clean, errors = appsettings.validate_patch(conn, data)
    if errors:
        raise validation(errors)
    old = appsettings.get_settings(conn)
    changed = {k: v for k, v in clean.items() if old.get(k) != v}
    if changed:
        with dbm.transaction(conn):
            appsettings.save_settings(conn, changed)
            audit(conn, "settings", "settings", "hat die Systemeinstellungen geändert", entity_name="Einstellungen",
                  details={"changes": {k: [old.get(k), v] for k, v in changed.items()}})
    return jsonify(appsettings.get_settings(conn))


@bp.get("/system/backup")
@require("settings.manage")
def backup():
    conn = dbm.get_db()
    tz = appsettings.get_settings(conn)["timezone"]
    stamp = timeutil.local_now(tz).strftime("%Y%m%d-%H%M")
    name = f"stelecms-backup-{stamp}.db"
    target = Path(current_app.config["BACKUP_DIR"]) / f".{name}.{timeutil.utcnow().timestamp():.0f}.tmp"
    dest = sqlite3.connect(str(target))
    try:
        conn.backup(dest)
    except BaseException:
        dest.close()
        target.unlink(missing_ok=True)  # keine halbe Sicherung liegen lassen
        raise
    dest.close()
    with dbm.transaction(conn):
        audit(conn, "backup", "settings", "hat eine Sicherung der Datenbank heruntergeladen",
              entity_name="Datenbank", details={"file_name": name, "size_bytes": target.stat().st_size})

    @after_this_request
    def _cleanup(resp):
        # Datei erst nach dem Senden löschen (Linux: offene Datei bleibt lesbar)
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass
        return resp

    resp = send_file(target, mimetype="application/vnd.sqlite3", as_attachment=True, download_name=name,
                     max_age=None)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.get("/system/info")
@require("settings.manage")
def system_info():
    cfg = current_app.config
    return jsonify({
        "version": APP_VERSION, "data_dir": str(cfg["DATA_DIR"]), "db_path": str(cfg["DB_PATH"]),
        "media_dir": str(cfg["MEDIA_DIR"]), "host": cfg["HOST"], "port": cfg["PORT"],
        "python": sys.version.split()[0], "ffmpeg": shutil.which("ffmpeg") is not None,
        "pdftoppm": shutil.which("pdftoppm") is not None,
        "started_at": current_app.extensions["stelecms_started_at"],
    })
