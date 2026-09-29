"""Zeitplan (SPEC §7.8): Einträge und Zeitleiste mit Konflikten."""
from __future__ import annotations

from datetime import date

from flask import Blueprint, jsonify, request

from .. import appsettings, timeutil
from .. import db as dbm
from ..audit import audit, q
from ..errors import ApiError
from ..permissions import require
from ..resolve import Resolver
from ..schedule import SteleSchedule
from ..validation import Validator, body, is_int
from .common import arg_id, arg_int, get_or_404, ok

bp = Blueprint("api_schedule", __name__, url_prefix="/api/schedule")

DAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


def _serialize(conn, e: dict, resolver: Resolver) -> dict:
    p = resolver.presentation(e["presentation_id"])
    return {
        "id": e["id"], "stele_id": e["stele_id"],
        "presentation": {"id": p["id"], "name": p["name"], "status": resolver.status(p)} if p else None,
        "label": e["label"], "days": dbm.jloads(e["days"], []), "start_time": e["start_time"],
        "end_time": e["end_time"], "date_from": e["date_from"], "date_until": e["date_until"],
        "priority": e["priority"], "enabled": bool(e["enabled"]),
        "created_at": e["created_at"], "updated_at": e["updated_at"],
    }


def _days_text(days: list[int]) -> str:
    if days == [1, 2, 3, 4, 5, 6, 7]:
        return "täglich"
    if days == [1, 2, 3, 4, 5]:
        return "Mo–Fr"
    return ", ".join(DAY_SHORT[d - 1] for d in days)


def _validate(conn, data: dict, v: Validator, old: dict | None) -> dict:
    out = {}
    creating = old is None
    if creating or "stele_id" in data:
        sid = data.get("stele_id")
        if not is_int(sid) or dbm.scalar(conn, "SELECT 1 FROM steles WHERE id = ?", (sid,)) is None:
            v.error("stele_id", "Bitte eine Stele wählen.")
        else:
            out["stele_id"] = sid
    if creating or "presentation_id" in data:
        pid = data.get("presentation_id")
        if not is_int(pid) or dbm.scalar(conn, "SELECT 1 FROM presentations WHERE id = ?", (pid,)) is None:
            v.error("presentation_id", "Bitte eine Präsentation wählen.")
        else:
            out["presentation_id"] = pid
    if "label" in data:
        out["label"] = v.text("label", max_len=80, default="") or ""
    if creating or "days" in data:
        days = data.get("days", [1, 2, 3, 4, 5, 6, 7] if creating else None)
        if not isinstance(days, list) or not days or not all(is_int(d) and 1 <= d <= 7 for d in days):
            v.error("days", "Bitte mindestens einen Wochentag wählen.")
        else:
            out["days"] = dbm.jdumps(sorted(set(days)))
    if creating or "start_time" in data:
        st = v.time("start_time", required=True)
        if st is not None:
            out["start_time"] = st
    if creating or "end_time" in data:
        et = v.time("end_time", required=True, allow_24=True)
        if et is not None:
            out["end_time"] = et
    start = out.get("start_time", old["start_time"] if old else None)
    end = out.get("end_time", old["end_time"] if old else None)
    if start and end and timeutil.hhmm_to_min(start) == timeutil.hhmm_to_min(end) % 1440 and \
            not (start == "00:00" and end == "24:00"):
        v.error("end_time", "Beginn und Ende dürfen nicht gleich sein (für ganztägig 00:00 bis 24:00 wählen).")
    if "date_from" in data:
        out["date_from"] = v.date("date_from")
    if "date_until" in data:
        out["date_until"] = v.date("date_until")
    dfrom = out.get("date_from", old["date_from"] if old else None)
    duntil = out.get("date_until", old["date_until"] if old else None)
    if dfrom and duntil and duntil < dfrom:
        v.error("date_until", "Das Enddatum darf nicht vor dem Startdatum liegen.")
    if "priority" in data:
        pr = v.integer("priority", min_value=-100, max_value=100)
        if pr is not None:
            out["priority"] = pr
    if "enabled" in data:
        en = v.boolean("enabled")
        if en is not None:
            out["enabled"] = 1 if en else 0
    return out


def _describe(conn, values: dict) -> str:
    p = dbm.row(conn, "SELECT name FROM presentations WHERE id = ?", (values["presentation_id"],))
    s = dbm.row(conn, "SELECT name FROM steles WHERE id = ?", (values["stele_id"],))
    days = _days_text(dbm.jloads(values["days"], []))
    return (f"{q(p['name'] if p else '')} auf {q(s['name'] if s else '')} "
            f"({days}, {values['start_time']}–{values['end_time']})")


@bp.get("")
@require("schedule.view")
def list_entries():
    conn = dbm.get_db()
    sid = arg_id("stele_id")
    resolver = Resolver(conn)
    if sid is not None:
        stele = get_or_404(conn, "steles", sid)
        rows = dbm.rows(conn, "SELECT * FROM schedule_entries WHERE stele_id = ? "
                              "ORDER BY priority DESC, start_time, id", (sid,))
        default = None
        if stele["default_presentation_id"]:
            p = resolver.presentation(stele["default_presentation_id"])
            if p:
                default = {"id": p["id"], "name": p["name"], "status": resolver.status(p)}
    else:
        rows = dbm.rows(conn, "SELECT * FROM schedule_entries ORDER BY stele_id, priority DESC, start_time, id")
        default = None
    return jsonify({"items": [_serialize(conn, e, resolver) for e in rows], "total": len(rows),
                    "default_presentation": default})


@bp.post("")
@require("schedule.edit")
def create_entry():
    conn = dbm.get_db()
    data = body()
    v = Validator(data)
    values = _validate(conn, data, v, None)
    v.done()
    now = timeutil.now_iso()
    values.setdefault("label", "")
    values.setdefault("priority", 0)
    values.setdefault("enabled", 1)
    values.update({"created_at": now, "updated_at": now})
    with dbm.transaction(conn):
        eid = dbm.insert(conn, "schedule_entries", values)
        audit(conn, "create", "schedule", f"hat einen Zeitplan-Eintrag angelegt: {_describe(conn, values)}",
              entity_id=eid, entity_name=values["label"])
    return jsonify(_serialize(conn, get_or_404(conn, "schedule_entries", eid), Resolver(conn))), 201


@bp.patch("/<int:eid>")
@require("schedule.edit")
def update_entry(eid: int):
    conn = dbm.get_db()
    old = get_or_404(conn, "schedule_entries", eid)
    data = body()
    v = Validator(data)
    values = _validate(conn, data, v, old)
    v.done()
    changes = {k: val for k, val in values.items() if old.get(k) != val}
    if changes:
        with dbm.transaction(conn):
            changes["updated_at"] = timeutil.now_iso()
            dbm.update(conn, "schedule_entries", eid, changes)
            merged = dict(old, **changes)
            fields = sorted(k for k in changes if k != "updated_at")
            summary = (f"hat einen Zeitplan-Eintrag {'eingeschaltet' if changes['enabled'] else 'ausgeschaltet'}: "
                       if fields == ["enabled"] else "hat einen Zeitplan-Eintrag geändert: ") + _describe(conn, merged)
            audit(conn, "update", "schedule", summary, entity_id=eid, entity_name=merged["label"],
                  details={"fields": fields})
    return jsonify(_serialize(conn, get_or_404(conn, "schedule_entries", eid), Resolver(conn)))


@bp.delete("/<int:eid>")
@require("schedule.edit")
def delete_entry(eid: int):
    conn = dbm.get_db()
    old = get_or_404(conn, "schedule_entries", eid)
    with dbm.transaction(conn):
        desc = _describe(conn, old)
        conn.execute("DELETE FROM schedule_entries WHERE id = ?", (eid,))
        audit(conn, "delete", "schedule", f"hat einen Zeitplan-Eintrag gelöscht: {desc}", entity_id=eid,
              entity_name=old["label"])
    return ok()


@bp.get("/timeline")
@require("schedule.view")
def timeline():
    conn = dbm.get_db()
    sid = arg_id("stele_id")
    if sid is None:
        raise ApiError(422, "validation_error", "Bitte eine Stele wählen.", fields={"stele_id": "Pflichtangabe."})
    stele = get_or_404(conn, "steles", sid)
    tz = appsettings.get_settings(conn)["timezone"]
    raw = request.args.get("from")
    if raw:
        if not timeutil.is_date(raw):
            raise ApiError(422, "validation_error", "Bitte das Startdatum prüfen.",
                           fields={"from": "Bitte ein Datum im Format JJJJ-MM-TT angeben."})
        start = date.fromisoformat(raw)
    else:
        start = timeutil.local_now(tz).date()
    days = arg_int("days", 7, 1, 62)
    return jsonify(SteleSchedule(conn, stele, tz).timeline(start, days))
