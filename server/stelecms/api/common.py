"""Gemeinsame Helfer der API-Blueprints."""
from __future__ import annotations

from flask import jsonify, request

from .. import db as dbm
from .. import timeutil
from ..audit import audit, q
from ..auth import current_user, person
from ..errors import ApiError, conflict, not_found

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


def check_unchanged(conn, table: str, row_id: int, data: dict, label: str) -> None:
    """Gleichzeitiges Bearbeiten: `expected_updated_at` aus dem Body muss zum gespeicherten Stand passen.

    In der Schreib-Transaktion aufrufen (Stand frisch lesen). Ohne `expected_updated_at` keine Prüfung.
    ponytail: Zeitstempel auf Sekunden (SPEC §3) – zwei Speicherungen derselben Sekunde fallen nicht auf;
    Ausbau mit Versionszähler, wenn das in der Praxis vorkommt.
    """
    expected = data.get("expected_updated_at")
    if expected is None:
        return
    r = dbm.row(conn, f"SELECT updated_at, updated_by FROM {table} WHERE id = ?", (row_id,))
    if r is None or expected == r["updated_at"]:
        return
    who = person(conn, r["updated_by"])
    by = f" von {who['display_name']}" if who else ""
    raise conflict(f"{label} wurde inzwischen{by} geändert – bitte neu laden.", "edit_conflict",
                   {"updated_at": r["updated_at"], "updated_by": who})


def presentations_using(conn, resolver, column: str, row_id: int) -> list[dict]:
    """Präsentationen, die ein Design bzw. Touch-Menü verwenden (`column` nur aus dem Code)."""
    return [{"id": p["id"], "name": p["name"], "status": resolver.status(p)}
            for p in dbm.rows(conn, f"SELECT * FROM presentations WHERE {column} = ? ORDER BY name COLLATE NOCASE",
                              (row_id,))]


def in_use_conflict(subject: str, users: list[dict], alternative: str) -> ApiError:
    """409 `in_use` beim Löschen: „<subject> wird noch von n Präsentationen verwendet …“."""
    n = len(users)
    return conflict(f"{subject} wird noch von {n} Präsentation{'en' if n != 1 else ''} "
                    f"verwendet. Bitte dort zuerst {alternative} wählen.", "in_use",
                    {"usages": [{"type": "presentation", "id": u["id"], "name": u["name"]} for u in users]})


def save_named(conn, table: str, entity: str, noun: str, r: dict, data: dict, changes: dict) -> None:
    """PATCH mit Name + Konfiguration (Designs, Touch-Menüs): Bearbeitungskonflikt prüfen, speichern, protokollieren.

    noun klein wie im Protokollsatz („das Design“); reine Namensänderung → „… in „Neu“ umbenannt“.
    """
    rid = r["id"]
    with dbm.transaction(conn):
        check_unchanged(conn, table, rid, data, f"{noun[0].upper()}{noun[1:]} {q(r['name'])}")
        if not changes:
            return
        fields = sorted(changes)
        label = changes.get("name", r["name"])
        dbm.update(conn, table, rid, {**changes, "updated_at": timeutil.now_iso(), "updated_by": current_user()["id"]})
        summary = (f"hat {noun} {q(r['name'])} in {q(label)} umbenannt" if fields == ["name"]
                   else f"hat {noun} {q(label)} bearbeitet")
        audit(conn, "update", entity, summary, entity_id=rid, entity_name=label, details={"fields": fields})


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
