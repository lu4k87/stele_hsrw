"""Touch-Menüs (SPEC §7.6, Struktur §5.6)."""
from __future__ import annotations

from flask import Blueprint, jsonify

from .. import schemas, timeutil
from .. import auth as authm
from .. import db as dbm
from ..audit import audit, q
from ..errors import conflict
from ..media import content_brief
from ..permissions import require
from ..resolve import Resolver
from ..validation import Validator, body, is_int
from .common import check_unchanged, get_or_404, list_response, ok

bp = Blueprint("api_touch_menus", __name__, url_prefix="/api/touch-menus")


def used_by(conn, resolver: Resolver, menu_id: int) -> list[dict]:
    return [{"id": p["id"], "name": p["name"], "status": resolver.status(p)}
            for p in dbm.rows(conn, "SELECT * FROM presentations WHERE touch_menu_id = ? "
                                    "ORDER BY name COLLATE NOCASE", (menu_id,))]


def _decorate(tiles: list, resolver: Resolver) -> list:
    """Ergänzt Kacheln zur Anzeige: content (Aktion Inhalt), contents (Galerie), image (Kachelbild)."""
    out = []
    for t in tiles or []:
        if not isinstance(t, dict):
            continue
        t = dict(t)
        a = dict(t.get("action") or {})
        t["image"] = content_brief(resolver.content(t.get("image_content_id")))
        t["content"] = None
        if a.get("type") == "content":
            t["content"] = content_brief(resolver.content(a.get("content_id")))
        elif a.get("type") == "gallery":
            a["contents"] = [b for b in (content_brief(resolver.content(cid)) for cid in a.get("content_ids") or [])
                             if b]
        elif a.get("type") == "submenu":
            a["tiles"] = _decorate(a.get("tiles") or [], resolver)
        t["action"] = a
        out.append(t)
    return out


def serialize(conn, r: dict, resolver: Resolver | None = None) -> dict:
    resolver = resolver or Resolver(conn)
    cfg = schemas.merge_defaults(schemas.TOUCH_CONFIG, dbm.jloads(r["config"], {}))
    cfg["tiles"] = _decorate(cfg["tiles"], resolver)
    return {"id": r["id"], "name": r["name"], "config": cfg, "used_by": used_by(conn, resolver, r["id"]),
            "created_at": r["created_at"], "created_by": authm.person(conn, r["created_by"]),
            "updated_at": r["updated_at"], "updated_by": authm.person(conn, r["updated_by"])}


@bp.get("")
@require("presentations.view")
def list_menus():
    conn = dbm.get_db()
    resolver = Resolver(conn).load_all()
    rows = dbm.rows(conn, "SELECT * FROM touch_menus ORDER BY name COLLATE NOCASE, id")
    return list_response([serialize(conn, r, resolver) for r in rows])


@bp.get("/<int:mid>")
@require("presentations.view")
def get_menu(mid: int):
    conn = dbm.get_db()
    return jsonify(serialize(conn, get_or_404(conn, "touch_menus", mid)))


@bp.post("")
@require("touch.edit")
def create_menu():
    conn = dbm.get_db()
    data = body()
    v = Validator(data)
    source = None
    if data.get("copy_from") is not None:
        if not is_int(data["copy_from"]) or \
                (source := dbm.row(conn, "SELECT * FROM touch_menus WHERE id = ?", (data["copy_from"],))) is None:
            v.error("copy_from", "Das Vorlage-Touch-Menü gibt es nicht (mehr).")
    name = v.text("name", required=source is None, max_len=80, empty_msg="Bitte einen Namen eingeben.")
    if not name and source is not None:
        name = (source["name"] + " (Kopie)")[:80]
    base = dbm.jloads(source["config"], {}) if source else None
    cfg = schemas.normalize_touch_config(conn, base, data.get("config"), v)
    v.done()
    user = authm.current_user()
    now = timeutil.now_iso()
    with dbm.transaction(conn):
        mid = dbm.insert(conn, "touch_menus", {"name": name, "config": dbm.jdumps(cfg), "created_by": user["id"],
                                               "updated_by": user["id"], "created_at": now, "updated_at": now})
        audit(conn, "create", "touch_menu", f"hat das Touch-Menü {q(name)} angelegt"
              + (f" (Kopie von {q(source['name'])})" if source else ""), entity_id=mid, entity_name=name)
    return jsonify(serialize(conn, get_or_404(conn, "touch_menus", mid))), 201


@bp.patch("/<int:mid>")
@require("touch.edit")
def update_menu(mid: int):
    conn = dbm.get_db()
    r = get_or_404(conn, "touch_menus", mid)
    data = body()
    v = Validator(data)
    name = v.text("name", max_len=80)
    if "name" in data and not name:
        v.error("name", "Bitte einen Namen eingeben.")
    old_cfg = schemas.merge_defaults(schemas.TOUCH_CONFIG, dbm.jloads(r["config"], {}))
    cfg = schemas.normalize_touch_config(conn, old_cfg, data.get("config"), v) if "config" in data else None
    v.done()
    changes = {}
    if name and name != r["name"]:
        changes["name"] = name
    if cfg is not None and cfg != old_cfg:
        changes["config"] = dbm.jdumps(cfg)
    with dbm.transaction(conn):
        check_unchanged(conn, "touch_menus", mid, data, f"Das Touch-Menü {q(r['name'])}")
        if changes:
            user = authm.current_user()
            fields = sorted(changes)
            changes.update({"updated_at": timeutil.now_iso(), "updated_by": user["id"]})
            dbm.update(conn, "touch_menus", mid, changes)
            label = name or r["name"]
            summary = (f"hat das Touch-Menü {q(r['name'])} in {q(name)} umbenannt" if fields == ["name"]
                       else f"hat das Touch-Menü {q(label)} bearbeitet")
            audit(conn, "update", "touch_menu", summary, entity_id=mid, entity_name=label,
                  details={"fields": fields})
    return jsonify(serialize(conn, get_or_404(conn, "touch_menus", mid)))


@bp.delete("/<int:mid>")
@require("touch.edit")
def delete_menu(mid: int):
    conn = dbm.get_db()
    r = get_or_404(conn, "touch_menus", mid)
    users = used_by(conn, Resolver(conn), mid)
    if users:
        n = len(users)
        raise conflict(f"Das Touch-Menü {q(r['name'])} wird noch von {n} Präsentation{'en' if n != 1 else ''} "
                       "verwendet. Bitte dort zuerst ein anderes Touch-Menü wählen.", "in_use",
                       {"usages": [{"type": "presentation", "id": u["id"], "name": u["name"]} for u in users]})
    with dbm.transaction(conn):
        conn.execute("DELETE FROM touch_menus WHERE id = ?", (mid,))
        audit(conn, "delete", "touch_menu", f"hat das Touch-Menü {q(r['name'])} gelöscht", entity_id=mid,
              entity_name=r["name"])
    return ok()
