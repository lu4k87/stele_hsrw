"""Designs (SPEC §7.6): Header, Footer, Schrift, Akzentfarbe."""
from __future__ import annotations

from flask import Blueprint, jsonify

from .. import appsettings, schemas, timeutil
from .. import auth as authm
from .. import db as dbm
from ..audit import audit, q
from ..errors import conflict
from ..permissions import require
from ..resolve import Resolver
from ..validation import Validator, body, is_int
from .common import check_unchanged, get_or_404, list_response, ok

bp = Blueprint("api_designs", __name__, url_prefix="/api/designs")


def used_by(conn, resolver: Resolver, design_id: int) -> list[dict]:
    return [{"id": p["id"], "name": p["name"], "status": resolver.status(p)}
            for p in dbm.rows(conn, "SELECT * FROM presentations WHERE design_id = ? ORDER BY name COLLATE NOCASE",
                              (design_id,))]


def serialize(conn, r: dict, resolver: Resolver | None = None) -> dict:
    resolver = resolver or Resolver(conn)
    cfg = schemas.merge_defaults(schemas.DESIGN_CONFIG, dbm.jloads(r["config"], {}))
    return {"id": r["id"], "name": r["name"], "config": cfg,
            "logo_url": resolver.image_url(cfg["header"].get("logo_content_id")),
            "used_by": used_by(conn, resolver, r["id"]),
            "created_at": r["created_at"], "created_by": authm.person(conn, r["created_by"]),
            "updated_at": r["updated_at"], "updated_by": authm.person(conn, r["updated_by"])}


@bp.get("")
@require("presentations.view")
def list_designs():
    conn = dbm.get_db()
    resolver = Resolver(conn).load_all()
    rows = dbm.rows(conn, "SELECT * FROM designs ORDER BY name COLLATE NOCASE, id")
    return list_response([serialize(conn, r, resolver) for r in rows])


@bp.get("/<int:did>")
@require("presentations.view")
def get_design(did: int):
    conn = dbm.get_db()
    return jsonify(serialize(conn, get_or_404(conn, "designs", did)))


@bp.post("")
@require("designs.edit")
def create_design():
    conn = dbm.get_db()
    data = body()
    v = Validator(data)
    source = None
    if data.get("copy_from") is not None:
        if not is_int(data["copy_from"]) or \
                (source := dbm.row(conn, "SELECT * FROM designs WHERE id = ?", (data["copy_from"],))) is None:
            v.error("copy_from", "Das Vorlage-Design gibt es nicht (mehr).")
    name = v.text("name", required=source is None, max_len=80, empty_msg="Bitte einen Namen eingeben.")
    if not name and source is not None:
        name = (source["name"] + " (Kopie)")[:80]
    base = dbm.jloads(source["config"], {}) if source else None
    cfg = schemas.normalize_design_config(conn, base, data.get("config"), v)
    v.done()
    user = authm.current_user()
    now = timeutil.now_iso()
    with dbm.transaction(conn):
        did = dbm.insert(conn, "designs", {"name": name, "config": dbm.jdumps(cfg), "created_by": user["id"],
                                           "updated_by": user["id"], "created_at": now, "updated_at": now})
        audit(conn, "create", "design", f"hat das Design {q(name)} angelegt"
              + (f" (Kopie von {q(source['name'])})" if source else ""), entity_id=did, entity_name=name)
    return jsonify(serialize(conn, get_or_404(conn, "designs", did))), 201


@bp.patch("/<int:did>")
@require("designs.edit")
def update_design(did: int):
    conn = dbm.get_db()
    r = get_or_404(conn, "designs", did)
    data = body()
    v = Validator(data)
    name = v.text("name", max_len=80)
    if "name" in data and not name:
        v.error("name", "Bitte einen Namen eingeben.")
    old_cfg = schemas.merge_defaults(schemas.DESIGN_CONFIG, dbm.jloads(r["config"], {}))
    cfg = schemas.normalize_design_config(conn, old_cfg, data.get("config"), v) if "config" in data else None
    v.done()
    changes = {}
    if name and name != r["name"]:
        changes["name"] = name
    if cfg is not None and cfg != old_cfg:
        changes["config"] = dbm.jdumps(cfg)
    with dbm.transaction(conn):
        check_unchanged(conn, "designs", did, data, f"Das Design {q(r['name'])}")
        if changes:
            user = authm.current_user()
            fields = sorted(changes)
            changes.update({"updated_at": timeutil.now_iso(), "updated_by": user["id"]})
            dbm.update(conn, "designs", did, changes)
            label = name or r["name"]
            summary = (f"hat das Design {q(r['name'])} in {q(name)} umbenannt" if fields == ["name"]
                       else f"hat das Design {q(label)} bearbeitet")
            audit(conn, "update", "design", summary, entity_id=did, entity_name=label, details={"fields": fields})
    return jsonify(serialize(conn, get_or_404(conn, "designs", did)))


@bp.delete("/<int:did>")
@require("designs.edit")
def delete_design(did: int):
    conn = dbm.get_db()
    r = get_or_404(conn, "designs", did)
    users = used_by(conn, Resolver(conn), did)
    if users:
        n = len(users)
        raise conflict(f"Das Design {q(r['name'])} wird noch von {n} Präsentation{'en' if n != 1 else ''} "
                       "verwendet. Bitte dort zuerst ein anderes Design wählen.", "in_use",
                       {"usages": [{"type": "presentation", "id": u["id"], "name": u["name"]} for u in users]})
    with dbm.transaction(conn):
        conn.execute("DELETE FROM designs WHERE id = ?", (did,))
        if appsettings.get_settings(conn)["default_design_id"] == did:
            appsettings.save_settings(conn, {"default_design_id": None})
        audit(conn, "delete", "design", f"hat das Design {q(r['name'])} gelöscht", entity_id=did,
              entity_name=r["name"])
    return ok()
