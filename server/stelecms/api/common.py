"""Gemeinsame Helfer der API-Blueprints."""
from __future__ import annotations

from flask import jsonify, request

from .. import db as dbm
from ..errors import ApiError, not_found

NOT_FOUND_MSGS = {
    "users": "Dieser Benutzer wurde nicht gefunden. Möglicherweise wurde er gelöscht.",
    "roles": "Diese Rolle wurde nicht gefunden. Möglicherweise wurde sie gelöscht.",
    "contents": "Dieser Inhalt wurde nicht gefunden. Möglicherweise wurde er gelöscht.",
    "presentations": "Diese Präsentation wurde nicht gefunden. Möglicherweise wurde sie gelöscht.",
    "designs": "Dieses Design wurde nicht gefunden. Möglicherweise wurde es gelöscht.",
    "touch_menus": "Dieses Touch-Menü wurde nicht gefunden. Möglicherweise wurde es gelöscht.",
    "steles": "Diese Stele wurde nicht gefunden. Möglicherweise wurde sie entfernt.",
    "schedule_entries": "Dieser Zeitplan-Eintrag wurde nicht gefunden. Möglicherweise wurde er gelöscht.",
}


def get_or_404(conn, table: str, row_id: int) -> dict:
    """Datensatz per ID laden (Tabellenname nur aus dem Code)."""
    r = dbm.row(conn, f"SELECT * FROM {table} WHERE id = ?", (row_id,))
    if r is None:
        raise not_found(NOT_FOUND_MSGS.get(table, "Der Eintrag wurde nicht gefunden."))
    return r


def list_response(items: list, total: int | None = None, **extra):
    payload = {"items": items, "total": len(items) if total is None else total}
    payload.update(extra)
    return jsonify(payload)


def ok():
    return jsonify({"ok": True})


def arg_int(name: str, default: int, lo: int, hi: int) -> int:
    raw = request.args.get(name)
    if raw in (None, ""):
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ApiError(422, "validation_error", "Bitte die Filterangaben prüfen.",
                       fields={name: "Bitte eine ganze Zahl angeben."})
    return max(lo, min(hi, value))


def arg_id(name: str) -> int | None:
    raw = request.args.get(name)
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except ValueError:
        raise ApiError(422, "validation_error", "Bitte die Filterangaben prüfen.",
                       fields={name: "Ungültige ID."})
