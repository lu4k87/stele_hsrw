"""Statische Auslieferung (SPEC §2 URL-Aufteilung): Admin-SPA, Player, gemeinsame Dateien, Mediendateien."""
from __future__ import annotations

import mimetypes
import re
from pathlib import Path

from flask import Flask, abort, redirect, request, send_file, send_from_directory
from werkzeug.security import safe_join

from . import auth
from . import db as dbm
from . import steles
from .errors import ApiError

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("video/x-matroska", ".mkv")

UID_RE = re.compile(r"^[0-9a-f]{16}$")
MEDIA_CACHE = "private, max-age=31536000, immutable"


def _no_cache(resp):
    resp.headers["Cache-Control"] = "no-cache"
    return resp


def _static(base: Path, path: str, spa_fallback: bool = False):
    """Datei aus einem web/-Ordner; SPA: unbekannte Pfade ohne Endung → index.html."""
    full = safe_join(str(base), path) if path else None
    if full and Path(full).is_file():
        return _no_cache(send_from_directory(base, path, max_age=None))
    if spa_fallback and (not path or "." not in Path(path).name) and (base / "index.html").is_file():
        return _no_cache(send_from_directory(base, "index.html", max_age=None))
    abort(404)


def register_web(app: Flask) -> None:
    web_dir = Path(app.config["WEB_DIR"])
    admin_dir, player_dir, shared_dir = web_dir / "admin", web_dir / "player", web_dir / "shared"

    @app.get("/")
    def root():
        return redirect("/admin/", code=302)

    @app.get("/admin")
    def admin_redirect():
        return redirect("/admin/", code=301)

    @app.get("/admin/")
    @app.get("/admin/<path:path>")
    def admin_files(path: str = ""):
        return _static(admin_dir, path, spa_fallback=True)

    @app.get("/shared/<path:path>")
    def shared_files(path: str):
        return _static(shared_dir, path)

    @app.get("/player")
    def player_redirect():
        qs = request.query_string.decode("latin-1")
        return redirect("/player/" + (f"?{qs}" if qs else ""), code=301)

    @app.get("/player/")
    def player_index():
        resp = _static(player_dir, "index.html")
        key = (request.args.get("key") or "").strip()
        if key:
            # Nur gültige Schlüssel übernehmen (ungültige Links setzen kein Cookie)
            if steles.stele_by_key(dbm.get_db(), key) is not None:
                steles.set_key_cookie(resp, key)
        return resp

    @app.get("/player/sw.js")
    def player_sw():
        resp = _static(player_dir, "sw.js")
        resp.headers["Service-Worker-Allowed"] = "/player/"
        return resp

    @app.get("/player/<path:path>")
    def player_files(path: str):
        return _static(player_dir, path)

    @app.get("/media/<uid>/<path:name>")
    def media_file(uid: str, name: str):
        _check_media_access()
        if not UID_RE.match(uid):
            abort(404)
        media_dir = Path(app.config["MEDIA_DIR"])
        full = safe_join(str(media_dir / uid), name)
        if not full or not Path(full).is_file():
            abort(404)
        resp = send_file(full, conditional=True, max_age=None, etag=True)
        resp.headers["Cache-Control"] = MEDIA_CACHE
        resp.headers["Accept-Ranges"] = "bytes"
        return resp


def _check_media_access() -> None:
    """Mediendateien: angemeldete Sitzung oder gültiger Stelen-Schlüssel (Cookie oder Header)."""
    if auth.current_user() is not None:
        return
    if steles.stele_by_key(dbm.get_db(), steles.key_from_request()) is not None:
        return
    raise ApiError(401, "unauthenticated", "Für diese Datei ist eine Anmeldung oder ein Stelen-Schlüssel nötig.")
