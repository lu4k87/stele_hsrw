"""Hochgeladene Schriften (SPEC §7.6): auflisten, hochladen, umbenennen, löschen.

Mitgelieferte Schriften stehen in web/shared/fonts.js und brauchen keine API.
"""
from __future__ import annotations

import secrets
import shutil
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request

from .. import auth as authm
from .. import db as dbm
from .. import fonts as fontsm
from .. import media, schemas, timeutil
from ..audit import audit, q
from ..errors import ApiError, conflict
from ..permissions import require
from ..validation import Validator, body
from .common import get_or_404, list_response, ok

bp = Blueprint("api_fonts", __name__, url_prefix="/api/fonts")


def serialize(conn, r: dict, with_usages: bool = True) -> dict:
    out = {"id": r["id"], "key": fontsm.custom_key(r["id"]), "name": r["name"], "url": fontsm.font_url(r),
           "format": r["format"], "weight": r["weight"], "size_bytes": r["size_bytes"],
           "created_at": r["created_at"], "created_by": authm.person(conn, r["created_by"])}
    if with_usages:
        out["usages"] = fontsm.usages(conn, r["id"])
    return out


def _weight(raw) -> int | None:
    """Formularfeld `weight`: leer/„variable“ = variable Schrift, sonst 100..900."""
    if raw in (None, "", "variable"):
        return None
    try:
        w = int(raw)
    except ValueError:
        w = 0
    if w not in schemas.FONT_WEIGHTS:
        raise ApiError(422, "validation_error", "Bitte eine Schriftstärke wählen.",
                       fields={"weight": "Erlaubt: variable oder 100 bis 900 in Hunderterschritten."})
    return w


@bp.get("")
@require("presentations.view", "content.view", any_of=True)
def list_fonts():
    conn = dbm.get_db()
    rows = dbm.rows(conn, "SELECT * FROM fonts ORDER BY name COLLATE NOCASE, id")
    return list_response([serialize(conn, r) for r in rows])


@bp.post("")
@require("designs.edit")
def upload_font():
    conn = dbm.get_db()
    if request.content_length and request.content_length > fontsm.FONT_MAX_BYTES + 64 * 1024:
        raise ApiError(413, "too_large", "Die Schriftdatei ist zu groß (höchstens 8 MB).")
    f = request.files.get("file")
    if not f or not f.filename:
        raise ApiError(422, "validation_error", "Bitte eine Schriftdatei auswählen.",
                       fields={"file": "Bitte eine Schriftdatei auswählen."})
    weight = _weight(request.form.get("weight"))
    v = Validator({"name": request.form.get("name") or ""})
    stem = media.safe_file_name(f.filename).rsplit(".", 1)[0]
    name = v.text("name", max_len=80) or stem[:80]
    v.done()
    data = f.read(fontsm.FONT_MAX_BYTES + 1)
    if len(data) > fontsm.FONT_MAX_BYTES:
        raise ApiError(413, "too_large", "Die Schriftdatei ist zu groß (höchstens 8 MB).")
    fmt = fontsm.detect_format(data)
    if fmt is None:
        raise ApiError(422, "unsupported_type", "Keine Schriftdatei erkannt. Erlaubt sind WOFF2, WOFF, TTF und OTF.",
                       fields={"file": "Erlaubt sind WOFF2, WOFF, TTF und OTF."})
    media_dir = Path(current_app.config["MEDIA_DIR"])
    uid = fontsm.new_uid(conn)
    file_name = f"font.{fmt}"
    folder = media_dir / uid
    folder.mkdir(parents=True, exist_ok=False)
    tmp = folder / f".up-{secrets.token_hex(4)}"
    try:
        tmp.write_bytes(data)
        tmp.replace(folder / file_name)
        user = authm.current_user()
        with dbm.transaction(conn):
            fid = dbm.insert(conn, "fonts", {"uid": uid, "name": name, "file_name": file_name, "format": fmt,
                                             "weight": weight, "size_bytes": len(data), "created_by": user["id"],
                                             "created_at": timeutil.now_iso()})
            audit(conn, "create", "font", f"hat die Schrift {q(name)} hochgeladen", entity_id=fid, entity_name=name)
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return jsonify(serialize(conn, get_or_404(conn, "fonts", fid))), 201


@bp.patch("/<int:fid>")
@require("designs.edit")
def rename_font(fid: int):
    conn = dbm.get_db()
    r = get_or_404(conn, "fonts", fid)
    v = Validator(body())
    name = v.text("name", required=True, max_len=80, empty_msg="Bitte einen Namen eingeben.")
    v.done()
    if name != r["name"]:
        with dbm.transaction(conn):
            conn.execute("UPDATE fonts SET name = ? WHERE id = ?", (name, fid))
            audit(conn, "update", "font", f"hat die Schrift {q(r['name'])} in {q(name)} umbenannt",
                  entity_id=fid, entity_name=name)
    return jsonify(serialize(conn, get_or_404(conn, "fonts", fid)))


@bp.delete("/<int:fid>")
@require("designs.edit")
def delete_font(fid: int):
    conn = dbm.get_db()
    r = get_or_404(conn, "fonts", fid)
    # Prüfung in der Schreib-Transaktion: sonst kann dazwischen ein Stand mit dieser Schrift veröffentlicht werden
    with dbm.transaction(conn):
        usages = fontsm.usages(conn, fid)
        if usages:
            n = len(usages)
            raise conflict(f"Die Schrift {q(r['name'])} wird noch an {n} Stelle{'n' if n != 1 else ''} verwendet. "
                           "Bitte dort zuerst eine andere Schrift wählen (bei veröffentlichten Präsentationen "
                           "danach erneut veröffentlichen).", "in_use", {"usages": usages})
        conn.execute("DELETE FROM fonts WHERE id = ?", (fid,))
        audit(conn, "delete", "font", f"hat die Schrift {q(r['name'])} gelöscht", entity_id=fid,
              entity_name=r["name"])
    media.delete_files(Path(current_app.config["MEDIA_DIR"]), r["uid"])
    return ok()
