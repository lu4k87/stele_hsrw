"""Protokoll (audit_log): wer hat wann was geändert."""
from __future__ import annotations

from flask import has_request_context

from . import db as dbm
from . import timeutil
from .auth import current_user
from .security import client_ip

ACTION_LABELS = {
    "login": "Anmeldung", "login_failed": "Anmeldung fehlgeschlagen", "logout": "Abmeldung",
    "create": "Angelegt", "update": "Geändert", "delete": "Gelöscht", "publish": "Veröffentlicht",
    "request_review": "Freigabe angefragt", "reject": "Freigabe abgelehnt", "discard": "Änderungen verworfen",
    "pair": "Gekoppelt", "command": "Befehl", "password_reset": "Passwort zurückgesetzt",
    "unlock": "Entsperrt", "settings": "Einstellungen", "backup": "Sicherung",
}

ENTITY_LABELS = {
    "session": "Sitzung", "user": "Benutzer", "role": "Rolle", "content": "Inhalt",
    "presentation": "Präsentation", "design": "Design", "touch_menu": "Touch-Menü", "stele": "Stele",
    "schedule": "Zeitplan", "settings": "Einstellungen",
}


def q(name: str | None) -> str:
    """Name in deutschen Anführungszeichen."""
    return f"„{name or ''}“"


def audit(conn, action: str, entity_type: str, summary: str, entity_id: int | None = None,
          entity_name: str = "", details: dict | None = None, user: dict | None = None,
          username: str | None = None) -> int:
    user = user if user is not None else current_user()
    ip = client_ip() if has_request_context() else ""
    return dbm.insert(conn, "audit_log", {
        "ts": timeutil.now_iso(),
        "user_id": user["id"] if user else None,
        "username": (user["username"] if user else None) or username or "system",
        "user_display": (user["display_name"] if user else "") or "",
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name or "",
        "summary": summary,
        "details": dbm.jdumps(details or {}),
        "ip": ip,
    })


def serialize_entry(r: dict) -> dict:
    return {
        "id": r["id"],
        "ts": r["ts"],
        "user": ({"id": r["user_id"], "username": r["username"], "display_name": r["user_display"] or r["username"]}
                 if r["user_id"] is not None else None),
        "action": r["action"],
        "entity_type": r["entity_type"],
        "entity_id": r["entity_id"],
        "entity_name": r["entity_name"],
        "summary": r["summary"],
        "details": dbm.jloads(r["details"], {}),
        "ip": r["ip"],
    }


def diff(old: dict, new: dict, keys) -> dict:
    """Geänderte Felder als {feld: [alt, neu]}."""
    return {k: [old.get(k), new.get(k)] for k in keys if k in new and old.get(k) != new.get(k)}
