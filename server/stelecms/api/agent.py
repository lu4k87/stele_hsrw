"""Agent-API (SPEC §10): Systembericht und Screenshot des Stelen-PCs (Stelen-Schlüssel)."""
from __future__ import annotations

import io

from flask import Blueprint, current_app, jsonify, request
from PIL import Image, UnidentifiedImageError

from .. import steles, timeutil
from .. import db as dbm
from ..errors import ApiError
from ..validation import body, is_int, is_number
from .player import apply_command_results, require_stele

bp = Blueprint("api_agent", __name__, url_prefix="/api/agent")

SCREENSHOT_MAX_W = 1080
SCREENSHOT_MAX_PIXELS = 40_000_000


def _pct(value):
    return round(float(value), 1) if is_number(value) and 0 <= value <= 100 else None


def _s(value, n: int = 200) -> str:
    return value[:n] if isinstance(value, str) else ""


@bp.post("/report")
def report():
    conn = dbm.get_db()
    s = require_stele(conn)
    data = body()
    now = timeutil.now_iso()
    old = dbm.jloads(s["last_agent"], {})
    screen = data.get("screen") if isinstance(data.get("screen"), dict) else {}
    agent = {
        "hostname": _s(data.get("hostname"), 120), "os": _s(data.get("os"), 200),
        "uptime_s": float(data["uptime_s"]) if is_number(data.get("uptime_s")) else None,
        "cpu": _pct(data.get("cpu")), "ram": _pct(data.get("ram")), "disk": _pct(data.get("disk")),
        "temp": round(float(data["temp"]), 1) if is_number(data.get("temp")) and -50 < data["temp"] < 150 else None,
        "ips": [_s(ip, 64) for ip in (data.get("ips") if isinstance(data.get("ips"), list) else [])[:10]
                if isinstance(ip, str)],
        "screen": {"w": screen.get("w") if is_int(screen.get("w")) else None,
                   "h": screen.get("h") if is_int(screen.get("h")) else None},
        "agent_version": _s(data.get("agent_version"), 40),
        "screenshot_at": old.get("screenshot_at"),
    }
    with dbm.transaction(conn):
        conn.execute("UPDATE steles SET last_agent_at = ?, last_agent = ? WHERE id = ?",
                     (now, dbm.jdumps(agent), s["id"]))
        conn.execute("INSERT OR REPLACE INTO stele_metrics(stele_id, ts, cpu, ram, disk, temp) VALUES (?,?,?,?,?,?)",
                     (s["id"], now, agent["cpu"], agent["ram"], agent["disk"], agent["temp"]))
        # Ergänzung: Ergebnisse von Agent-Befehlen (z. B. „Screenshots auf der Stele deaktiviert“)
        apply_command_results(conn, s["id"], data.get("command_results"), now)
        rows = steles.deliver_commands(conn, s["id"], steles.AGENT_COMMANDS, now)
    return jsonify({"ok": True, "commands": [{"id": r["id"], "command": r["command"]} for r in rows]})


@bp.post("/screenshot")
def screenshot():
    conn = dbm.get_db()
    s = require_stele(conn)
    f = request.files.get("image")
    if f is None:
        raise ApiError(422, "validation_error", "Es wurde kein Bild übertragen.", fields={"image": "Pflichtangabe."})
    raw = f.read()
    try:
        with Image.open(io.BytesIO(raw)) as im:
            if im.width * im.height > SCREENSHOT_MAX_PIXELS:  # vor dem Dekodieren: kleine Datei, riesiges Bild
                raise ApiError(413, "too_large", "Der Screenshot ist zu groß (höchstens 40 Megapixel).")
            im.load()
            img = im.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise ApiError(415, "unsupported_media", "Der Screenshot ist kein lesbares Bild (JPEG erwartet).")
    if img.width > SCREENSHOT_MAX_W:
        img.thumbnail((SCREENSHOT_MAX_W, SCREENSHOT_MAX_W * 4), Image.LANCZOS)
    path = steles.screenshot_path(current_app.config, s["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    img.save(tmp, "JPEG", quality=82)
    tmp.replace(path)
    now = timeutil.now_iso()
    with dbm.transaction(conn):
        agent = dbm.jloads(dbm.scalar(conn, "SELECT last_agent FROM steles WHERE id = ?", (s["id"],)), {})
        agent["screenshot_at"] = now
        conn.execute("UPDATE steles SET last_agent = ? WHERE id = ?", (dbm.jdumps(agent), s["id"]))
        conn.execute("UPDATE stele_commands SET done_at = ?, result = 'OK: Screenshot empfangen', "
                     "delivered_at = COALESCE(delivered_at, ?) WHERE stele_id = ? AND command = 'screenshot' "
                     "AND done_at IS NULL", (now, now, s["id"]))
    return jsonify({"ok": True, "taken_at": now})
