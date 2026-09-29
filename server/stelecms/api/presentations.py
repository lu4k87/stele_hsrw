"""Präsentationen (SPEC §7.5) und Vorschau ungespeicherter Stände (§7.5a)."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from .. import appsettings, schemas, timeutil
from .. import auth as authm
from .. import db as dbm
from .. import presentations as pres
from ..audit import audit, q
from ..errors import ApiError, conflict
from ..permissions import require
from ..resolve import Resolver
from ..validation import Validator, body, is_int
from .common import get_or_404, list_response, ok
from .manifest import manifest_response

bp = Blueprint("api_presentations", __name__, url_prefix="/api")


def _load(conn, pid: int) -> dict:
    return get_or_404(conn, "presentations", pid)


def _full(conn, pid: int):
    p = _load(conn, pid)
    return jsonify(pres.full(conn, p, Resolver(conn)))


def _ref_check(conn, v: Validator, key: str, table: str, value, msg: str):
    if value is None:
        return None
    if not is_int(value) or dbm.scalar(conn, f"SELECT 1 FROM {table} WHERE id = ?", (value,)) is None:
        v.error(key, msg)
        return None
    return value


def _touch(conn, pid: int) -> None:
    user = authm.current_user()
    conn.execute("UPDATE presentations SET updated_at = ?, updated_by = ? WHERE id = ?",
                 (timeutil.now_iso(), user["id"] if user else None, pid))


# ------------------------------------------------------------------ Liste, Anlegen

@bp.get("/presentations")
@require("presentations.view")
def list_presentations():
    conn = dbm.get_db()
    resolver = Resolver(conn).load_all()
    used_by = pres.used_by_map(conn)
    rows = dbm.rows(conn, "SELECT * FROM presentations ORDER BY name COLLATE NOCASE, id")
    return list_response([pres.summary(conn, p, resolver, used_by) for p in rows])


@bp.post("/presentations")
@require("presentations.edit")
def create_presentation():
    conn = dbm.get_db()
    data = body()
    v = Validator(data)
    source = None
    if data.get("copy_from") is not None:
        if not is_int(data["copy_from"]) or \
                (source := dbm.row(conn, "SELECT * FROM presentations WHERE id = ?", (data["copy_from"],))) is None:
            v.error("copy_from", "Die Vorlage-Präsentation gibt es nicht (mehr).")
    name = v.text("name", required=source is None, max_len=120, empty_msg="Bitte einen Namen eingeben.")
    if not name and source is not None:
        name = (source["name"] + " (Kopie)")[:120]
    description = v.text("description", max_len=500, multiline=True, default=None)
    design_id = _ref_check(conn, v, "design_id", "designs", data.get("design_id"), "Dieses Design gibt es nicht.")
    menu_id = _ref_check(conn, v, "touch_menu_id", "touch_menus", data.get("touch_menu_id"),
                         "Dieses Touch-Menü gibt es nicht.")
    v.done()
    settings_row = appsettings.get_settings(conn)
    if source is not None:
        settings = schemas.merge_defaults(schemas.PRESENTATION_SETTINGS, dbm.jloads(source["settings"], {}))
        if "design_id" not in data:
            design_id = source["design_id"]
        if "touch_menu_id" not in data:
            menu_id = source["touch_menu_id"]
        if description is None:
            description = source["description"]
    else:
        settings = schemas.merge_defaults(schemas.PRESENTATION_SETTINGS, {})
        settings["default_duration_s"] = settings_row["default_slide_duration_s"]
        if "design_id" not in data:
            design_id = settings_row["default_design_id"]
            if design_id is None or dbm.scalar(conn, "SELECT 1 FROM designs WHERE id = ?", (design_id,)) is None:
                design_id = dbm.scalar(conn, "SELECT id FROM designs ORDER BY id LIMIT 1")
    user = authm.current_user()
    now = timeutil.now_iso()
    with dbm.transaction(conn):
        pid = dbm.insert(conn, "presentations", {
            "name": name, "description": description or "", "settings": dbm.jdumps(settings),
            "design_id": design_id, "touch_menu_id": menu_id, "created_by": user["id"], "updated_by": user["id"],
            "created_at": now, "updated_at": now})
        if source is not None:
            items = Resolver(conn).draft_source(source)["items"]
            for it in items:
                it["id"] = None
            pres.replace_items(conn, pid, items)
        audit(conn, "create", "presentation",
              f"hat die Präsentation {q(name)} angelegt" + (f" (Kopie von {q(source['name'])})" if source else ""),
              entity_id=pid, entity_name=name)
    return _full(conn, pid), 201


# ------------------------------------------------------------------ Lesen, Ändern

@bp.get("/presentations/<int:pid>")
@require("presentations.view")
def get_presentation(pid: int):
    return _full(dbm.get_db(), pid)


@bp.patch("/presentations/<int:pid>")
@require("presentations.edit")
def update_presentation(pid: int):
    conn = dbm.get_db()
    p = _load(conn, pid)
    data = body()
    v = Validator(data)
    name = v.text("name", max_len=120)
    if "name" in data and not name:
        v.error("name", "Bitte einen Namen eingeben.")
    description = v.text("description", max_len=500, multiline=True)
    old_settings = schemas.merge_defaults(schemas.PRESENTATION_SETTINGS, dbm.jloads(p["settings"], {}))
    settings = schemas.normalize_presentation_settings(old_settings, data.get("settings"), v) \
        if "settings" in data else None
    design_id = _ref_check(conn, v, "design_id", "designs", data.get("design_id"), "Dieses Design gibt es nicht.")
    menu_id = _ref_check(conn, v, "touch_menu_id", "touch_menus", data.get("touch_menu_id"),
                         "Dieses Touch-Menü gibt es nicht.")
    v.done()
    changes = {}
    if name and name != p["name"]:
        changes["name"] = name
    if description is not None and description != p["description"]:
        changes["description"] = description
    if settings is not None and settings != old_settings:
        changes["settings"] = dbm.jdumps(settings)
    if "design_id" in data and design_id != p["design_id"]:
        changes["design_id"] = design_id
    if "touch_menu_id" in data and menu_id != p["touch_menu_id"]:
        changes["touch_menu_id"] = menu_id
    if changes:
        user = authm.current_user()
        fields = sorted(changes)
        with dbm.transaction(conn):
            changes.update({"updated_at": timeutil.now_iso(), "updated_by": user["id"]})
            dbm.update(conn, "presentations", pid, changes)
            label = name or p["name"]
            summary = (f"hat die Präsentation {q(p['name'])} in {q(name)} umbenannt" if fields == ["name"]
                       else f"hat die Präsentation {q(label)} bearbeitet")
            audit(conn, "update", "presentation", summary, entity_id=pid, entity_name=label,
                  details={"fields": fields})
    return _full(conn, pid)


@bp.put("/presentations/<int:pid>/items")
@require("presentations.edit")
def put_items(pid: int):
    conn = dbm.get_db()
    p = _load(conn, pid)
    data = body()
    v = Validator(data)
    if "items" not in data:
        v.error("items", "Bitte die Folienliste angeben.")
    items = pres.validate_items(conn, data.get("items"), v)
    v.done()
    before = len(Resolver(conn).items(pid))
    with dbm.transaction(conn):
        pres.replace_items(conn, pid, items)
        _touch(conn, pid)
        audit(conn, "update", "presentation", f"hat die Folien der Präsentation {q(p['name'])} geändert",
              entity_id=pid, entity_name=p["name"], details={"items_before": before, "items_after": len(items)})
    return _full(conn, pid)


# ------------------------------------------------------------------ Veröffentlichen & Freigabe

@bp.post("/presentations/<int:pid>/publish")
@require("presentations.publish")
def publish(pid: int):
    conn = dbm.get_db()
    p = _load(conn, pid)
    data = body()
    note = data.get("note") if isinstance(data.get("note"), str) else ""
    resolver = Resolver(conn)
    message, bad = pres.publish_problems(conn, p, resolver)
    if message:
        raise ApiError(422, "validation_error", message, details={"items": bad})
    user = authm.current_user()
    with dbm.transaction(conn):
        was = p["published_at"] is not None
        pres.publish(conn, p, resolver, user["id"])
        audit(conn, "publish", "presentation",
              f"hat die Präsentation {q(p['name'])} {'erneut ' if was else ''}veröffentlicht",
              entity_id=pid, entity_name=p["name"], details={"note": note.strip()[:500]} if note.strip() else {})
    return _full(conn, pid)


@bp.post("/presentations/<int:pid>/request-review")
@require("presentations.edit")
def request_review(pid: int):
    conn = dbm.get_db()
    p = _load(conn, pid)
    data = body()
    v = Validator(data)
    note = v.text("note", max_len=500, multiline=True, default="") or ""
    v.done()
    user = authm.current_user()
    with dbm.transaction(conn):
        conn.execute("UPDATE presentations SET review_state = 'requested', review_note = ?, review_by = ?, "
                     "review_at = ? WHERE id = ?", (note, user["id"], timeutil.now_iso(), pid))
        audit(conn, "request_review", "presentation",
              f"hat die Freigabe der Präsentation {q(p['name'])} angefragt", entity_id=pid, entity_name=p["name"],
              details={"note": note} if note else {})
    return _full(conn, pid)


@bp.post("/presentations/<int:pid>/reject")
@require("presentations.publish")
def reject(pid: int):
    conn = dbm.get_db()
    p = _load(conn, pid)
    data = body()
    v = Validator(data)
    note = v.text("note", required=True, max_len=500, multiline=True,
                  empty_msg="Bitte eine Begründung für die Ablehnung eingeben.")
    v.done()
    if p["review_state"] != "requested":
        raise conflict("Für diese Präsentation ist keine Freigabe angefragt.")
    user = authm.current_user()
    with dbm.transaction(conn):
        conn.execute("UPDATE presentations SET review_state = 'rejected', review_note = ?, review_by = ?, "
                     "review_at = ? WHERE id = ?", (note, user["id"], timeutil.now_iso(), pid))
        audit(conn, "reject", "presentation", f"hat die Freigabe der Präsentation {q(p['name'])} abgelehnt",
              entity_id=pid, entity_name=p["name"], details={"note": note})
    return _full(conn, pid)


@bp.post("/presentations/<int:pid>/discard")
@require("presentations.edit")
def discard(pid: int):
    conn = dbm.get_db()
    p = _load(conn, pid)
    if not p["published_source"]:
        raise conflict("Die Präsentation wurde noch nie veröffentlicht – es gibt keinen Stand zum Zurücksetzen.")
    with dbm.transaction(conn):
        pres.discard(conn, p)
        _touch(conn, pid)
        audit(conn, "discard", "presentation",
              f"hat die Änderungen an der Präsentation {q(p['name'])} verworfen", entity_id=pid,
              entity_name=p["name"])
    return _full(conn, pid)


@bp.delete("/presentations/<int:pid>")
@require("presentations.delete")
def delete_presentation(pid: int):
    conn = dbm.get_db()
    p = _load(conn, pid)
    usages = pres.usages(conn, pid)
    if usages:
        n = len(usages)
        raise conflict(f"Die Präsentation {q(p['name'])} wird noch verwendet ({n}× als Standard einer Stele oder "
                       "im Zeitplan). Bitte dort zuerst eine andere Präsentation wählen.", "in_use",
                       {"usages": usages})
    with dbm.transaction(conn):
        conn.execute("DELETE FROM presentations WHERE id = ?", (pid,))
        audit(conn, "delete", "presentation", f"hat die Präsentation {q(p['name'])} gelöscht",
              entity_id=pid, entity_name=p["name"])
    return ok()


@bp.get("/presentations/<int:pid>/manifest")
@require("presentations.view")
def presentation_manifest(pid: int):
    conn = dbm.get_db()
    p = _load(conn, pid)
    source = request.args.get("source") or "draft"
    if source not in ("draft", "published"):
        raise ApiError(422, "validation_error", "Bitte die Quelle prüfen.",
                       fields={"source": "Erlaubt: draft, published."})
    manifest = Resolver(conn).preview_manifest(p, source)
    if manifest is None:
        raise ApiError(404, "not_found", "Diese Präsentation wurde noch nicht veröffentlicht.")
    return manifest_response(manifest)


# ------------------------------------------------------------------ Vorschau (§7.5a)

def _missing_slide(it: dict) -> dict:
    return {"id": it.get("id") if is_int(it.get("id")) else None, "content_id": it.get("content_id"),
            "type": "missing", "title": "", "duration_s": 0, "transition": it.get("transition") or "none",
            "valid_from": it.get("valid_from"), "valid_until": it.get("valid_until"),
            "caption": it.get("caption") or "", "fullscreen": False}


@bp.post("/preview/resolve")
@require("presentations.view")
def preview_resolve():
    """Löst ungespeicherte Stände auf (ohne Speichern). Ungültige Einzelwerte fallen auf Standards zurück."""
    conn = dbm.get_db()
    data = body()
    scratch = Validator({})
    resolver = Resolver(conn)
    settings = schemas.normalize_presentation_settings(None, data.get("settings") if isinstance(
        data.get("settings"), dict) else None, scratch)
    design = None
    if isinstance(data.get("design"), dict):
        cfg = schemas.normalize_design_config(conn, None, data["design"], Validator({}))
        cfg["logo_url"] = resolver.image_url(cfg["header"].get("logo_content_id"))
        design = cfg
    touch_menu = None
    if isinstance(data.get("touch_menu"), dict):
        cfg = schemas.normalize_touch_config(conn, None, data["touch_menu"], Validator({}))
        cfg["tiles"] = [resolver.tile(t, settings) for t in cfg["tiles"]]
        touch_menu = cfg
    slides = []
    raw_items = data.get("items") if isinstance(data.get("items"), list) else []
    for it in raw_items[:pres.MAX_ITEMS]:
        if not isinstance(it, dict):
            continue
        iv = Validator(it)
        item = {"id": it.get("id") if is_int(it.get("id")) else None,
                "duration_s": iv.number("duration_s", min_value=1, max_value=3600, allow_none=True),
                "transition": iv.choice("transition", schemas.TRANSITIONS, allow_none=True),
                "valid_from": iv.local_datetime("valid_from"), "valid_until": iv.local_datetime("valid_until"),
                "caption": iv.text("caption", max_len=300, default="") or "",
                "options": schemas.normalize_item_options(it.get("options"), iv, "options.")}
        enabled = it.get("enabled") is not False
        c = _preview_content(conn, resolver, it)
        if c is None:
            s = _missing_slide(dict(it, **item))
        else:
            s = resolver.slide(c, settings, item)
            if c["status"] != "ready":
                s["status"] = c["status"]
        s["enabled"] = enabled
        slides.append(s)
    return jsonify({"settings": settings, "design": design, "touch_menu": touch_menu, "slides": slides})


def _preview_content(conn, resolver: Resolver, it: dict) -> dict | None:
    """Inhalt der Folie; `content` überschreibt die gespeicherten Daten einer Info-Folie/Webseite."""
    stored = resolver.content(it.get("content_id"))
    override = it.get("content") if isinstance(it.get("content"), dict) else None
    if override is None:
        return stored
    ctype = override.get("type") if override.get("type") in ("text", "web") else (stored or {}).get("type")
    if ctype not in ("text", "web"):
        return stored
    if stored is not None and stored["type"] != ctype:
        return stored
    base = dbm.jloads(stored["data"], {}) if stored else None
    patch = override.get("data") if isinstance(override.get("data"), dict) else {}
    scratch = Validator({})
    if ctype == "text":
        new_data = schemas.normalize_text_data(conn, base, patch, scratch)
    else:
        new_data = schemas.normalize_web_data(base, patch, scratch)
    row = dict(stored) if stored else {
        "id": it.get("content_id") if is_int(it.get("content_id")) else None, "uid": "", "type": ctype,
        "title": "", "status": "ready", "width": None, "height": None, "duration_s": None, "page_count": None}
    if isinstance(override.get("title"), str):
        row["title"] = override["title"][:200]
    row["type"] = ctype
    row["data"] = dbm.jdumps(new_data)
    return row
