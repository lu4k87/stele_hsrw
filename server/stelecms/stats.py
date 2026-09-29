"""Kennzahlen für Monitoring und Übersicht: Verfügbarkeit, Wiedergaben, Touch-Nutzung, Server-Zustand."""
from __future__ import annotations

import os
import shutil
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from . import timeutil
from . import db as dbm


def availability(conn, stele: dict, start: datetime, end: datetime) -> dict:
    """Anteil der Zeit online im Fenster [start, end] (ab Anlage der Stele) + Segmente."""
    created = timeutil.parse_iso(stele["created_at"]) or start
    window_start = max(start, created)
    total = (end - window_start).total_seconds()
    segs = []
    online_s = 0.0
    for r in dbm.rows(conn, "SELECT start_at, end_at FROM stele_online_segments WHERE stele_id = ? AND end_at >= ? "
                            "AND start_at <= ? ORDER BY start_at", (stele["id"], timeutil.iso(window_start),
                                                                    timeutil.iso(end))):
        a = max(timeutil.parse_iso(r["start_at"]), window_start)
        b = min(timeutil.parse_iso(r["end_at"]), end)
        if b < a:
            continue
        online_s += (b - a).total_seconds()
        segs.append({"start": timeutil.iso(a), "end": timeutil.iso(b)})
    pct = round(min(100.0, online_s / total * 100), 1) if total > 0 else (100.0 if segs else 0.0)
    return {"pct": pct, "segments": segs}


def stele_counters(conn, stele_id: int, tz: str, now: datetime | None = None) -> dict:
    now = now or timeutil.utcnow()
    day_start = timeutil.iso(timeutil.local_day_start_utc(tz, now))
    day_ago = timeutil.iso(now - timedelta(hours=24))
    return {
        "plays_today": dbm.scalar(conn, "SELECT COUNT(*) FROM playback_log WHERE stele_id = ? AND started_at >= ?",
                                  (stele_id, day_start)),
        "touch_sessions_today": dbm.scalar(conn, "SELECT COUNT(*) FROM touch_log WHERE stele_id = ? AND ts >= ? "
                                                 "AND event = 'session_start'", (stele_id, day_start)),
        "errors_24h": dbm.scalar(conn, "SELECT COUNT(*) FROM stele_events WHERE stele_id = ? AND ts >= ? "
                                       "AND level = 'error'", (stele_id, day_ago)),
    }


def touch_stats(conn, stele_id: int, since: str, tz: str) -> dict:
    sessions = dbm.scalar(conn, "SELECT COUNT(*) FROM touch_log WHERE stele_id = ? AND ts >= ? AND "
                                "event = 'session_start'", (stele_id, since))
    avg = dbm.scalar(conn, "SELECT AVG(duration_s) FROM touch_log WHERE stele_id = ? AND ts >= ? AND "
                           "event = 'session_end' AND duration_s IS NOT NULL", (stele_id, since))
    top = [{"label": r["label"] or "(ohne Beschriftung)", "count": r["n"]} for r in dbm.rows(
        conn, "SELECT label, COUNT(*) AS n FROM touch_log WHERE stele_id = ? AND ts >= ? AND event = 'tile_open' "
              "GROUP BY label ORDER BY n DESC, label LIMIT 10", (stele_id, since))]
    per_hour = [0] * 24
    zone = timeutil.get_tz(tz)
    for r in conn.execute("SELECT ts FROM touch_log WHERE stele_id = ? AND ts >= ? AND event = 'session_start'",
                          (stele_id, since)):
        dt = timeutil.parse_iso(r["ts"])
        if dt:
            per_hour[dt.astimezone(zone).hour] += 1
    return {"sessions": sessions, "avg_duration_s": round(avg, 1) if avg is not None else None,
            "top_tiles": top, "per_hour": [{"hour": h, "sessions": n} for h, n in enumerate(per_hour)]}


# ------------------------------------------------------------------ Server

_SIZE_CACHE: dict[str, tuple[float, int]] = {}
_SIZE_LOCK = threading.Lock()


def dir_size(path: Path, max_age_s: float = 60) -> int:
    """Belegter Platz eines Ordners (60 s zwischengespeichert, da das Durchlaufen dauern kann)."""
    key = str(path)
    now = time.monotonic()
    with _SIZE_LOCK:
        hit = _SIZE_CACHE.get(key)
        if hit and now - hit[0] < max_age_s:
            return hit[1]
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    with _SIZE_LOCK:
        _SIZE_CACHE[key] = (now, total)
    return total


def server_info(conn, app) -> dict:
    cfg = app.config
    db_path = Path(cfg["DB_PATH"])
    db_size = sum(p.stat().st_size for p in (db_path, Path(str(db_path) + "-wal")) if p.exists())
    try:
        du = shutil.disk_usage(cfg["DATA_DIR"])
        free, total = du.free, du.total
    except OSError:
        free = total = None
    started = app.extensions["stelecms_started_at"]
    day_ago = timeutil.iso(timeutil.utcnow() - timedelta(hours=24))
    return {
        "version": _version(), "started_at": started,
        "uptime_s": int(time.monotonic() - app.extensions["stelecms_started_mono"]),
        "db_size_bytes": db_size, "media_size_bytes": dir_size(Path(cfg["MEDIA_DIR"])),
        "disk_free_bytes": free, "disk_total_bytes": total,
        "content_count": dbm.scalar(conn, "SELECT COUNT(*) FROM contents"),
        "jobs": {"queued": dbm.scalar(conn, "SELECT COUNT(*) FROM jobs WHERE status = 'queued'"),
                 "running": dbm.scalar(conn, "SELECT COUNT(*) FROM jobs WHERE status = 'running'"),
                 "failed": dbm.scalar(conn, "SELECT COUNT(*) FROM jobs WHERE status = 'error' AND updated_at >= ?",
                                      (day_ago,))},
    }


def _version() -> str:
    from .config import APP_VERSION
    return APP_VERSION
