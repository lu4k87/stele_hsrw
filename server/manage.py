"""Verwaltung auf der Kommandozeile: Administrator anlegen, Passwort zurücksetzen, Benutzer auflisten.

Beispiele:
  .venv/bin/python server/manage.py create-admin --username mk --display-name "MK (Admin)"
  .venv/bin/python server/manage.py reset-password --username mk
  .venv/bin/python server/manage.py list-users

Datenordner wie beim Server über STELECMS_DATA (Standard: <repo>/data). Fehlt die Datenbank, wird sie
inklusive Migrationen und Erstbefüllung (Seed) angelegt. Jede Änderung landet im Protokoll (Benutzer „system“).
"""
from __future__ import annotations

import argparse
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from stelecms import appsettings, create_app, timeutil  # noqa: E402
from stelecms import auth as authm  # noqa: E402
from stelecms import db as dbm  # noqa: E402
from stelecms.audit import audit, q  # noqa: E402
from stelecms.security import generate_password, hash_password  # noqa: E402
from stelecms.validation import EMAIL_RE  # noqa: E402

GENERATED_LENGTH = 14
# Wie die API (§7.3), aber schon ab 2 Zeichen (z. B. Kürzel „mk“ für persönliche Administratorkonten).
CLI_USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{2,32}$")


class CliError(Exception):
    """Fehler mit verständlicher Meldung für die Kommandozeile (Exit-Code 1)."""


def _app(overrides: dict | None = None):
    cfg = {"BACKGROUND": False}
    cfg.update(overrides or {})
    return create_app(cfg)


def _password(conn, given: str | None) -> tuple[str, bool]:
    """(Passwort, erzeugt?) – geprüft gegen die Mindestlänge aus den Einstellungen."""
    min_len = appsettings.get_settings(conn)["password_min_length"]
    if given is None:
        return generate_password(max(GENERATED_LENGTH, min_len)), True
    if len(given) < min_len:
        raise CliError(f"Das Passwort muss mindestens {min_len} Zeichen haben.")
    return given, False


def _admin_role_id(conn) -> int:
    rid = dbm.scalar(conn, "SELECT id FROM roles WHERE is_admin = 1 ORDER BY id LIMIT 1")
    if rid is None:
        raise CliError("Die Rolle Administrator fehlt in der Datenbank.")
    return rid


def create_admin(conn, username: str, display_name: str, email: str = "", password: str | None = None,
                 must_change: bool = True, update: bool = False) -> tuple[dict, str | None]:
    """Legt einen Administrator an (oder aktualisiert ihn mit update=True). Rückgabe (Benutzer, erzeugtes Passwort)."""
    if not CLI_USERNAME_RE.match(username or ""):
        raise CliError("Ungültiger Benutzername: 2–32 Zeichen, Buchstaben (ohne Umlaute), Ziffern sowie . _ -")
    display_name = (display_name or "").strip()
    if not display_name or len(display_name) > 80:
        raise CliError("Bitte einen Anzeigenamen mit 1 bis 80 Zeichen angeben.")
    if email and not EMAIL_RE.match(email):
        raise CliError("Ungültige E-Mail-Adresse.")
    pw, generated = _password(conn, password)
    role_id = _admin_role_id(conn)
    existing = dbm.row(conn, "SELECT * FROM users WHERE username = ?", (username,))
    now = timeutil.now_iso()
    system = {"username": "system"}
    with dbm.transaction(conn):
        if existing and not update:
            raise CliError(f"Der Benutzer „{existing['username']}“ existiert bereits. Mit --update wird er zum "
                           "Administrator und erhält das neue Passwort.")
        if existing:
            conn.execute("UPDATE users SET display_name = ?, email = ?, password_hash = ?, role_id = ?, is_active = 1, "
                         "is_demo = 0, must_change_password = ?, failed_logins = 0, locked_until = NULL, "
                         "session_version = session_version + 1, updated_at = ? WHERE id = ?",
                         (display_name, email or existing["email"], hash_password(pw), role_id, 1 if must_change else 0,
                          now, existing["id"]))
            uid = existing["id"]
            audit(conn, "update", "user", f"hat den Benutzer {q(display_name)} per Kommandozeile zum Administrator "
                                          "gemacht und das Passwort gesetzt", entity_id=uid, entity_name=username,
                  user=None, username=system["username"])
        else:
            uid = dbm.insert(conn, "users", {
                "username": username, "display_name": display_name, "email": email or "",
                "password_hash": hash_password(pw), "role_id": role_id, "is_active": 1, "is_demo": 0,
                "must_change_password": 1 if must_change else 0, "created_at": now, "updated_at": now})
            audit(conn, "create", "user", f"hat den Administrator {q(display_name)} ({username}) per Kommandozeile "
                                          "angelegt", entity_id=uid, entity_name=username, user=None,
                  username=system["username"])
    return authm.load_user(conn, uid), (pw if generated else None)


def reset_password(conn, username: str, password: str | None = None, must_change: bool = True) -> str | None:
    user = dbm.row(conn, "SELECT * FROM users WHERE username = ?", (username,))
    if user is None:
        raise CliError(f"Den Benutzer „{username}“ gibt es nicht.")
    pw, generated = _password(conn, password)
    with dbm.transaction(conn):
        conn.execute("UPDATE users SET password_hash = ?, must_change_password = ?, failed_logins = 0, "
                     "locked_until = NULL, session_version = session_version + 1, updated_at = ? WHERE id = ?",
                     (hash_password(pw), 1 if must_change else 0, timeutil.now_iso(), user["id"]))
        audit(conn, "password_reset", "user", f"hat das Passwort des Benutzers {q(user['display_name'])} per "
                                              "Kommandozeile zurückgesetzt", entity_id=user["id"],
              entity_name=user["username"], user=None, username="system")
    return pw if generated else None


def list_users(conn) -> list[dict]:
    return dbm.rows(conn, authm.USER_SELECT + " ORDER BY u.username COLLATE NOCASE")


# ------------------------------------------------------------------ CLI

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="manage.py", description="Stele CMS – Verwaltung auf der Kommandozeile")
    sub = p.add_subparsers(dest="cmd", required=True)

    ca = sub.add_parser("create-admin", help="Benutzer mit der Rolle Administrator anlegen")
    ca.add_argument("--username", required=True)
    ca.add_argument("--display-name", required=True)
    ca.add_argument("--email", default="")
    ca.add_argument("--password", help="ohne Angabe wird ein Passwort (14 Zeichen) erzeugt und einmal angezeigt")
    ca.add_argument("--must-change", dest="must_change", action="store_true", default=True,
                    help="Passwort muss bei der ersten Anmeldung geändert werden (Standard)")
    ca.add_argument("--no-must-change", dest="must_change", action="store_false")
    ca.add_argument("--update", action="store_true",
                    help="vorhandenen Benutzer zum Administrator machen und Passwort setzen")

    rp = sub.add_parser("reset-password", help="Passwort eines Benutzers zurücksetzen")
    rp.add_argument("--username", required=True)
    rp.add_argument("--password")
    rp.add_argument("--must-change", dest="must_change", action="store_true", default=True)
    rp.add_argument("--no-must-change", dest="must_change", action="store_false")

    sub.add_parser("list-users", help="Benutzer auflisten")
    return p


def main(argv=None, app_overrides: dict | None = None, out=None) -> int:
    out = out or sys.stdout
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s", stream=sys.stderr)
    app = _app(app_overrides)
    conn = dbm.connect(app.config["DB_PATH"])
    try:
        with app.app_context():
            if args.cmd == "create-admin":
                user, generated = create_admin(conn, args.username, args.display_name, args.email, args.password,
                                               args.must_change, args.update)
                print(f"Administrator „{user['username']}“ ({user['display_name']}) ist bereit. "
                      f"Passwortwechsel bei der Anmeldung: {'ja' if user['must_change_password'] else 'nein'}.",
                      file=out)
                if generated:
                    print(f"Erzeugtes Passwort (wird nur jetzt angezeigt): {generated}", file=out)
            elif args.cmd == "reset-password":
                generated = reset_password(conn, args.username, args.password, args.must_change)
                print(f"Passwort von „{args.username}“ wurde zurückgesetzt; bestehende Sitzungen sind beendet.",
                      file=out)
                if generated:
                    print(f"Erzeugtes Passwort (wird nur jetzt angezeigt): {generated}", file=out)
            else:
                print(f"{'Benutzername':<20} {'Anzeigename':<28} {'Rolle':<16} {'aktiv':<6} Demo", file=out)
                for u in list_users(conn):
                    print(f"{u['username']:<20} {u['display_name'][:28]:<28} {u['role_name'][:16]:<16} "
                          f"{'ja' if u['is_active'] else 'nein':<6} {'ja' if u['is_demo'] else 'nein'}", file=out)
    except CliError as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
