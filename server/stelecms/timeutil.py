"""Zeit-Helfer: UTC-Zeitstempel (ISO 8601 mit Z) und Wanduhr in der eingestellten Zeitzone.

Alle Module rufen die Uhr über `timeutil.utcnow()` ab, damit Tests die Zeit gezielt setzen können.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TZ = "Europe/Berlin"

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_LOCAL_DT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_iso() -> str:
    return iso(utcnow())


def parse_iso(value: str | None) -> datetime | None:
    """ISO-Zeitstempel → aware datetime (UTC). Ungültig → None."""
    if not value or not isinstance(value, str):
        return None
    s = value.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def seconds_since(value: str | None, now: datetime | None = None) -> float | None:
    dt = parse_iso(value)
    if dt is None:
        return None
    return ((now or utcnow()) - dt).total_seconds()


def get_tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TZ)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TZ)


def is_valid_tz(name: str) -> bool:
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError):
        return False


def local_now(tzname: str | None, now: datetime | None = None) -> datetime:
    return (now or utcnow()).astimezone(get_tz(tzname))


def is_hhmm(value, allow_24: bool = False) -> bool:
    if not isinstance(value, str):
        return False
    if allow_24 and value == "24:00":
        return True
    return bool(_TIME_RE.match(value))


def hhmm_to_min(value: str) -> int:
    if value == "24:00":
        return 1440
    h, m = value.split(":")
    return int(h) * 60 + int(m)


def min_to_hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def is_date(value) -> bool:
    if not isinstance(value, str) or not _DATE_RE.match(value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def is_local_dt(value) -> bool:
    if not isinstance(value, str) or not _LOCAL_DT_RE.match(value):
        return False
    try:
        datetime.fromisoformat(value)
        return True
    except ValueError:
        return False


def local_wall_to_utc(d: date, minutes: int, tzname: str) -> datetime:
    """Wanduhr-Zeit (Datum + Minuten seit Mitternacht) → UTC."""
    tz = get_tz(tzname)
    base = datetime(d.year, d.month, d.day, tzinfo=tz) + timedelta(minutes=minutes)
    # Neu an die Zeitzone binden (Sommer-/Winterzeit korrekt)
    naive = base.replace(tzinfo=None)
    return naive.replace(tzinfo=tz).astimezone(timezone.utc)


def local_day_start_utc(tzname: str, now: datetime | None = None) -> datetime:
    loc = local_now(tzname, now)
    return local_wall_to_utc(loc.date(), 0, tzname)


def local_date_bounds_utc(day: date, tzname: str) -> tuple[datetime, datetime]:
    return local_wall_to_utc(day, 0, tzname), local_wall_to_utc(day + timedelta(days=1), 0, tzname)


def format_de(value: str | None, tzname: str) -> str:
    """UTC-ISO → „30.09.2026 10:15:00“ in der eingestellten Zeitzone."""
    dt = parse_iso(value)
    if dt is None:
        return ""
    return dt.astimezone(get_tz(tzname)).strftime("%d.%m.%Y %H:%M:%S")
