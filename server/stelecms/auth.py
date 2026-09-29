"""Sitzung, aktueller Benutzer, Anmeldeprüfung (SPEC §7.2)."""
from __future__ import annotations

from functools import wraps

from flask import g, has_request_context, request, session

from . import appsettings, timeutil
from . import db as dbm
from .errors import ApiError, unauthenticated
from .security import is_loopback, new_csrf_token

SESSION_EXPIRED_MSG = "Sitzung abgelaufen – bitte neu anmelden."
# Hintergrund-Polling der UI (Header „X-Background-Poll: 1“) verlängert den Leerlauf-Zähler nicht;
# die Leerlauf-Prüfung findet trotzdem statt.
BACKGROUND_HEADER = "X-Background-Poll"

USER_SELECT = ("SELECT u.*, r.name AS role_name, r.is_admin AS role_is_admin "
               "FROM users u JOIN roles r ON r.id = u.role_id")


def _epoch() -> float:
    return timeutil.utcnow().timestamp()


def role_permission_keys(conn, role_id: int) -> list[str]:
    return [r["permission"] for r in conn.execute(
        "SELECT permission FROM role_permissions WHERE role_id = ?", (role_id,)).fetchall()]


def load_user_from_session() -> None:
    """before_request: Benutzer aus der Sitzung laden, Leerlauf und session_version prüfen."""
    from .permissions import effective

    g.user = None
    g.perms = frozenset()
    g.session_expired = False
    uid = session.get("uid")
    if not uid:
        return
    conn = dbm.get_db()
    user = dbm.row(conn, USER_SELECT + " WHERE u.id = ?", (uid,))
    if not user or not user["is_active"] or user["session_version"] != session.get("sv"):
        session.clear()
        g.session_expired = bool(user)
        return
    settings = appsettings.get_settings(conn)
    now = _epoch()
    last = float(session.get("la") or 0)
    if now - last > settings["session_idle_minutes"] * 60:
        session.clear()
        g.session_expired = True
        return
    if request.headers.get(BACKGROUND_HEADER) != "1":
        session["la"] = now
    g.user = user
    g.perms = frozenset(effective(role_permission_keys(conn, user["role_id"]), bool(user["role_is_admin"])))


def current_user() -> dict | None:
    return g.get("user") if has_request_context() else None


def current_permissions() -> frozenset:
    return g.get("perms", frozenset())


def ensure_authenticated() -> dict:
    user = current_user()
    if user is None:
        if g.get("session_expired"):
            raise unauthenticated(SESSION_EXPIRED_MSG)
        raise unauthenticated("Bitte anmelden.")
    return user


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        ensure_authenticated()
        return fn(*args, **kwargs)
    return wrapper


def start_session(user: dict) -> None:
    session.clear()
    session["uid"] = user["id"]
    session["sv"] = user["session_version"]
    session["csrf"] = new_csrf_token()
    session["la"] = _epoch()


def end_session() -> None:
    session.clear()


# ------------------------------------------------------------ Ausgabe

def is_locked(user: dict) -> bool:
    until = timeutil.parse_iso(user.get("locked_until"))
    return bool(until and until > timeutil.utcnow())


def serialize_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user["display_name"],
        "email": user["email"],
        "role": {"id": user["role_id"], "name": user.get("role_name", ""), "is_admin": bool(user.get("role_is_admin"))},
        "is_active": bool(user["is_active"]),
        "is_demo": bool(user["is_demo"]),
        "must_change_password": bool(user["must_change_password"]),
        "locked": is_locked(user),
        "locked_until": user["locked_until"] if is_locked(user) else None,
        "last_login_at": user["last_login_at"],
        "created_at": user["created_at"],
        "updated_at": user["updated_at"],
    }


def load_user(conn, user_id: int) -> dict | None:
    return dbm.row(conn, USER_SELECT + " WHERE u.id = ?", (user_id,))


def session_payload(conn) -> dict:
    from .config import APP_NAME, APP_VERSION

    settings = appsettings.get_settings(conn)
    dev_active = bool(settings["dev_login_enabled"]) and is_loopback()
    dev_users = []
    if dev_active:
        dev_users = [{"username": r["username"], "display_name": r["display_name"], "role_name": r["role_name"]}
                     for r in dbm.rows(conn, USER_SELECT + " WHERE u.is_demo = 1 AND u.is_active = 1 "
                                       "ORDER BY r.is_admin DESC, u.id")]
    user = current_user()
    return {
        "authenticated": user is not None,
        "user": serialize_user(user) if user else None,
        "permissions": sorted(current_permissions()) if user else [],
        "csrf_token": session.get("csrf") if user else None,
        "idle_timeout_s": settings["session_idle_minutes"] * 60,
        "session_expired": bool(g.get("session_expired")) and user is None,
        "dev_login": {"enabled": dev_active, "users": dev_users},
        "app": {"name": APP_NAME, "version": APP_VERSION, "org_name": settings["org_name"],
                "test_mode": bool(settings["dev_login_enabled"])},
    }


# ------------------------------------------------------------ Personen

def person(conn, user_id: int | None) -> dict | None:
    """Personen-Verweis {id, display_name} (mit Cache je Request)."""
    if not user_id:
        return None
    cache = g.setdefault("_person_cache", {}) if has_request_context() else {}
    if user_id not in cache:
        r = dbm.row(conn, "SELECT id, display_name FROM users WHERE id = ?", (user_id,))
        cache[user_id] = {"id": r["id"], "display_name": r["display_name"]} if r else None
    return cache[user_id]


def account_locked_error(user: dict) -> ApiError:
    until = timeutil.parse_iso(user.get("locked_until"))
    retry = max(1, int((until - timeutil.utcnow()).total_seconds())) if until else 60
    minutes = max(1, (retry + 59) // 60)
    return ApiError(423, "account_locked",
                    f"Zu viele Fehlversuche. Das Konto ist für {minutes} Minute{'n' if minutes != 1 else ''} "
                    "gesperrt. Bitte später erneut versuchen.",
                    details={"retry_after_s": retry})
