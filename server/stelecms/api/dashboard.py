"""Übersicht (SPEC §7.9 /api/dashboard): Abschnitte nach Rechten, fehlende Rechte = null."""
from __future__ import annotations

from datetime import timedelta

from flask import Blueprint, current_app, jsonify

from .. import audit as auditm
from .. import auth as authm
from .. import steles, timeutil
from .. import db as dbm
from ..permissions import has, has_any
from ..resolve import Resolver

bp = Blueprint("api_dashboard", __name__, url_prefix="/api")


@bp.get("/dashboard")
def dashboard():
    authm.ensure_authenticated()
    conn = dbm.get_db()
    resolver = Resolver(conn).load_all()
    tz = resolver.settings["timezone"]
    now = timeutil.utcnow()
    out = {"steles": None, "reviews": None, "unpublished": None, "expiring": None, "activity": None,
           "alerts": [], "counts": {}}

    if has_any("steles.view", "monitoring.view"):
        out["steles"] = [steles.serialize(conn, s, resolver, now=now)
                         for s in dbm.rows(conn, "SELECT * FROM steles ORDER BY name COLLATE NOCASE, id")]

    if has("presentations.view"):
        pres_rows = dbm.rows(conn, "SELECT * FROM presentations ORDER BY updated_at DESC, id DESC")
        out["reviews"] = [{
            "presentation": {"id": p["id"], "name": p["name"]},
            "requested_by": authm.person(conn, p["review_by"]), "requested_at": p["review_at"],
            "note": p["review_note"],
        } for p in sorted((p for p in pres_rows if p["review_state"] == "requested"),
                          key=lambda p: p["review_at"] or "", reverse=True)]
        unpublished = []
        for p in pres_rows:
            st = resolver.status(p)
            if st != "published":
                unpublished.append({"id": p["id"], "name": p["name"], "status": st, "updated_at": p["updated_at"],
                                    "updated_by": authm.person(conn, p["updated_by"])})
        out["unpublished"] = unpublished[:20]
        local_now = timeutil.local_now(tz, now)
        lo = local_now.strftime("%Y-%m-%dT%H:%M")
        hi = (local_now + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M")
        out["expiring"] = [{
            "presentation": {"id": r["pid"], "name": r["pname"]}, "item_id": r["id"],
            "title": r["title"] or "", "valid_until": r["valid_until"],
        } for r in dbm.rows(conn, "SELECT i.id, i.valid_until, p.id AS pid, p.name AS pname, c.title "
                                  "FROM presentation_items i JOIN presentations p ON p.id = i.presentation_id "
                                  "LEFT JOIN contents c ON c.id = i.content_id "
                                  "WHERE i.enabled = 1 AND i.valid_until IS NOT NULL AND i.valid_until > ? "
                                  "AND i.valid_until <= ? ORDER BY i.valid_until, i.id", (lo, hi))]

    if has("audit.view"):
        out["activity"] = [auditm.serialize_entry(r) for r in
                           dbm.rows(conn, "SELECT * FROM audit_log ORDER BY ts DESC, id DESC LIMIT 10")]

    if has("monitoring.view"):
        out["alerts"] = steles.compute_alerts(conn, current_app.config, resolver)

    out["counts"] = {
        "contents": dbm.scalar(conn, "SELECT COUNT(*) FROM contents"),
        "presentations": dbm.scalar(conn, "SELECT COUNT(*) FROM presentations"),
        "steles": dbm.scalar(conn, "SELECT COUNT(*) FROM steles"),
        "users": dbm.scalar(conn, "SELECT COUNT(*) FROM users"),
    }
    return jsonify(out)
