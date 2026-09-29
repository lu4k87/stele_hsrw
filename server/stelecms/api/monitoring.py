"""Monitoring (SPEC §7.9): Überblick aller Stelen + Server, Details einer Stele."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify

from .. import stats, steles, timeutil
from .. import db as dbm
from ..permissions import require
from ..resolve import Resolver
from .common import arg_int, get_or_404

bp = Blueprint("api_monitoring", __name__, url_prefix="/api/monitoring")

LIST_MAX = 100


@bp.get("/overview")
@require("monitoring.view")
def overview():
    conn = dbm.get_db()
    resolver = Resolver(conn)
    tz = resolver.settings["timezone"]
    now = timeutil.utcnow()
    out = []
    for s in dbm.rows(conn, "SELECT * FROM steles ORDER BY name COLLATE NOCASE, id"):
        item = steles.serialize(conn, s, resolver, now=now)
        item["availability_24h_pct"] = stats.availability(conn, s, now - timedelta(hours=24), now)["pct"]
        item.update(stats.stele_counters(conn, s["id"], tz, now))
        out.append(item)
    app = current_app._get_current_object()
    return jsonify({"steles": out, "server": stats.server_info(conn, app),
                    "alerts": steles.compute_alerts(conn, app.config, resolver)})


METRICS_MAX = 300
_METRIC_KEYS = ("cpu", "ram", "disk", "temp")


def _downsample(rows, limit=METRICS_MAX):
    """Messwerte (neueste zuerst) auf höchstens `limit` Punkte mitteln – der Verlauf deckt so
    den ganzen Zeitraum ab (z. B. 7 Tage) statt nur die letzten Werte."""
    rows = list(rows)
    size = max(1, -(-len(rows) // limit))  # aufrunden
    out = []
    for i in range(0, len(rows), size):
        chunk = rows[i:i + size]
        point = {"ts": chunk[0]["ts"]}
        for key in _METRIC_KEYS:
            vals = [r[key] for r in chunk if r[key] is not None]
            point[key] = round(sum(vals) / len(vals), 1) if vals else None
        out.append(point)
    return out


@bp.get("/steles/<int:sid>")
@require("monitoring.view")
def stele_detail(sid: int):
    conn = dbm.get_db()
    s = get_or_404(conn, "steles", sid)
    resolver = Resolver(conn)
    tz = resolver.settings["timezone"]
    hours = arg_int("hours", 24, 1, 24 * 31)
    now = timeutil.utcnow()
    since_dt = now - timedelta(hours=hours)
    since = timeutil.iso(since_dt)
    metrics = _downsample(dbm.rows(conn, "SELECT ts, cpu, ram, disk, temp FROM stele_metrics "
                                         "WHERE stele_id = ? AND ts >= ? ORDER BY ts DESC", (sid, since)))
    playback = [{"started_at": r["started_at"], "duration_s": r["duration_s"], "title": r["title"],
                 "content_type": r["ctype"], "presentation_name": r["pname"]}
                for r in dbm.rows(conn, "SELECT l.*, c.type AS ctype, p.name AS pname FROM playback_log l "
                                        "LEFT JOIN contents c ON c.id = l.content_id "
                                        "LEFT JOIN presentations p ON p.id = l.presentation_id "
                                        "WHERE l.stele_id = ? AND l.started_at >= ? "
                                        "ORDER BY l.started_at DESC, l.id DESC LIMIT ?", (sid, since, LIST_MAX))]
    events = [{"ts": r["ts"], "level": r["level"], "kind": r["kind"], "message": r["message"]}
              for r in dbm.rows(conn, "SELECT * FROM stele_events WHERE stele_id = ? AND ts >= ? "
                                      "ORDER BY ts DESC, id DESC LIMIT ?", (sid, since, LIST_MAX))]
    shot = None
    path = steles.screenshot_path(current_app.config, sid)
    if path.is_file():
        agent = dbm.jloads(s["last_agent"], {})
        taken = agent.get("screenshot_at") or timeutil.iso(
            datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc))
        shot = {"url": f"/api/steles/{sid}/screenshot?t={taken}", "taken_at": taken}
    return jsonify({
        "stele": steles.serialize(conn, s, resolver, now=now),
        "availability": stats.availability(conn, s, since_dt, now),
        "metrics": metrics, "playback": playback, "events": events,
        "touch": stats.touch_stats(conn, sid, since, tz),
        "screenshot": shot,
    })
