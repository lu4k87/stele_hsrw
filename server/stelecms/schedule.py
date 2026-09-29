"""Zeitplan-Auflösung (SPEC §7.8): jetzt aktiv, nächster Wechsel, Zeitleiste, Konflikte.

Regel (Server und Player identisch): aktiv sind Einträge mit `enabled`, passendem Wochentag, Uhrzeit in
[start, end) (über Mitternacht zählt der Tag des Beginns) und Datum im Bereich. Gewinner: höchste
Priorität; bei Gleichstand der Eintrag mit Datumsbereich; dann der zuletzt geänderte (dann höhere ID).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from . import timeutil
from . import db as dbm

WEEKDAYS_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]


@dataclass
class Entry:
    id: int
    presentation_id: int
    days: frozenset
    start: int          # Minuten seit Mitternacht
    end: int            # 1..1440; end < start = über Mitternacht
    date_from: date | None
    date_until: date | None
    priority: int
    enabled: bool
    updated_at: str
    label: str = ""

    @property
    def has_range(self) -> bool:
        return self.date_from is not None or self.date_until is not None

    @property
    def overnight(self) -> bool:
        return self.end < self.start

    def day_ok(self, d: date) -> bool:
        if d.isoweekday() not in self.days:
            return False
        if self.date_from and d < self.date_from:
            return False
        if self.date_until and d > self.date_until:
            return False
        return True

    def active(self, d: date, minute: int) -> bool:
        if not self.enabled:
            return False
        if not self.overnight:
            return self.start <= minute < self.end and self.day_ok(d)
        if minute >= self.start and self.day_ok(d):
            return True
        return minute < self.end and self.day_ok(d - timedelta(days=1))

    def intervals(self, d: date) -> list[tuple[int, int]]:
        """Aktive Minuten-Intervalle [a, b) am Tag d (inkl. Ausläufer vom Vortag)."""
        out = []
        if not self.enabled:
            return out
        if not self.overnight:
            if self.day_ok(d):
                out.append((self.start, self.end))
        else:
            if self.day_ok(d):
                out.append((self.start, 1440))
            if self.end > 0 and self.day_ok(d - timedelta(days=1)):
                out.append((0, self.end))
        return out

    def win_key(self):
        return (self.priority, 1 if self.has_range else 0, self.updated_at or "", self.id)


def entry_from_row(r: dict) -> Entry:
    days = dbm.jloads(r["days"], []) if isinstance(r["days"], str) else r["days"]
    return Entry(
        id=r["id"], presentation_id=r["presentation_id"],
        days=frozenset(int(x) for x in days or []),
        start=timeutil.hhmm_to_min(r["start_time"]), end=timeutil.hhmm_to_min(r["end_time"]),
        date_from=date.fromisoformat(r["date_from"]) if r.get("date_from") else None,
        date_until=date.fromisoformat(r["date_until"]) if r.get("date_until") else None,
        priority=int(r["priority"] or 0), enabled=bool(r["enabled"]), updated_at=r.get("updated_at") or "",
        label=r.get("label") or "",
    )


def resolve_at(entries: list[Entry], d: date, minute: int) -> Entry | None:
    active = [e for e in entries if e.active(d, minute)]
    if not active:
        return None
    return max(active, key=Entry.win_key)


def _breakpoints(entries: list[Entry]) -> list[int]:
    pts = {0}
    for e in entries:
        pts.add(e.start)
        pts.add(e.end % 1440)
    return sorted(p for p in pts if 0 <= p < 1440)


class SteleSchedule:
    """Zeitplan einer Stele: nur veröffentlichte Präsentationen können laufen."""

    def __init__(self, conn, stele: dict, tzname: str):
        self.conn = conn
        self.stele = stele
        self.tz = tzname
        rows = dbm.rows(conn, "SELECT e.*, p.name AS p_name, p.published_hash AS p_hash FROM schedule_entries e "
                              "JOIN presentations p ON p.id = e.presentation_id WHERE e.stele_id = ? ORDER BY e.id",
                        (stele["id"],))
        self.all_entries = [entry_from_row(r) for r in rows]
        self.names = {r["presentation_id"]: r["p_name"] for r in rows}
        self.published_ids = {r["presentation_id"] for r in rows if r["p_hash"]}
        self.entries = [e for e in self.all_entries if e.presentation_id in self.published_ids]
        self.default = None
        if stele.get("default_presentation_id"):
            p = dbm.row(conn, "SELECT id, name, published_hash FROM presentations WHERE id = ?",
                        (stele["default_presentation_id"],))
            if p:
                self.names[p["id"]] = p["name"]
                if p["published_hash"]:
                    self.default = p["id"]

    def pres_ref(self, pid) -> dict | None:
        return {"id": pid, "name": self.names.get(pid, "")} if pid else None

    def at(self, d: date, minute: int) -> tuple[int | None, str, int | None]:
        """(presentation_id, source, entry_id) zur Wanduhrzeit."""
        e = resolve_at(self.entries, d, minute)
        if e:
            return e.presentation_id, "schedule", e.id
        if self.default:
            return self.default, "default", None
        return None, "none", None

    def now(self, now_utc: datetime | None = None) -> dict:
        loc = timeutil.local_now(self.tz, now_utc)
        pid, source, eid = self.at(loc.date(), loc.hour * 60 + loc.minute)
        return {"presentation": self.pres_ref(pid), "source": source, "schedule_entry_id": eid}

    def next_change(self, now_utc: datetime | None = None, horizon_days: int = 8) -> dict | None:
        loc = timeutil.local_now(self.tz, now_utc)
        d0, m0 = loc.date(), loc.hour * 60 + loc.minute
        current = self.at(d0, m0)[0]
        points = _breakpoints(self.entries)
        for offset in range(horizon_days + 1):
            d = d0 + timedelta(days=offset)
            for m in points:
                if offset == 0 and m <= m0:
                    continue
                pid = self.at(d, m)[0]
                if pid != current:
                    return {"at": timeutil.iso(timeutil.local_wall_to_utc(d, m, self.tz)),
                            "presentation": self.pres_ref(pid)}
        return None

    def timeline(self, start: date, days: int) -> dict:
        out_days = []
        points = _breakpoints(self.entries)
        for offset in range(days):
            d = start + timedelta(days=offset)
            segments: list[dict] = []
            bounds = points + [1440]
            for i, a in enumerate(points):
                b = bounds[i + 1]
                pid, source, eid = self.at(d, a)
                skipped = sorted(e.id for e in self.all_entries
                                 if e.presentation_id not in self.published_ids and e.active(d, a))
                seg = {"start": timeutil.min_to_hhmm(a), "end": timeutil.min_to_hhmm(b),
                       "presentation": self.pres_ref(pid), "source": source, "entry_id": eid,
                       "unpublished_entry_ids": skipped}
                prev = segments[-1] if segments else None
                if prev and prev["presentation"] == seg["presentation"] and prev["source"] == source \
                        and prev["entry_id"] == eid and prev["unpublished_entry_ids"] == skipped:
                    prev["end"] = seg["end"]
                else:
                    segments.append(seg)
            out_days.append({"date": d.isoformat(), "weekday": d.isoweekday(), "weekday_name": WEEKDAYS_DE[d.weekday()],
                             "segments": segments})
        return {"timezone": self.tz, "days": out_days, "conflicts": self.conflicts(start, days)}

    def conflicts(self, start: date, days: int) -> list[dict]:
        """Zwei aktive Einträge mit gleicher Priorität überschneiden sich."""
        result = []
        enabled = [e for e in self.all_entries if e.enabled]
        for offset in range(days):
            d = start + timedelta(days=offset)
            for i, a in enumerate(enabled):
                ia = a.intervals(d)
                if not ia:
                    continue
                for b in enabled[i + 1:]:
                    if a.priority != b.priority:
                        continue
                    ib = b.intervals(d)
                    if any(x0 < y1 and y0 < x1 for x0, x1 in ia for y0, y1 in ib):
                        winner = max((a, b), key=Entry.win_key)
                        result.append({
                            "date": d.isoformat(), "entry_ids": sorted([a.id, b.id]),
                            "message": (f"{self._label(a)} und {self._label(b)} überschneiden sich am "
                                        f"{d.strftime('%d.%m.%Y')} mit gleicher Priorität. "
                                        f"Es gilt {self._label(winner)}."),
                        })
        return result

    def _label(self, e: Entry) -> str:
        name = e.label or self.names.get(e.presentation_id, "") or f"Eintrag {e.id}"
        return f"„{name}“"


def stele_schedule(conn, stele: dict, tzname: str) -> SteleSchedule:
    return SteleSchedule(conn, stele, tzname)
