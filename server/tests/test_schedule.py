"""Zeitplan: Auflösungsregel (Mitternacht, Priorität, Datumsbereich), API, Zeitleiste, Konflikte (§7.8)."""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from stelecms import timeutil
from stelecms.schedule import entry_from_row, resolve_at

from conftest import make_presentation, make_stele, make_text

WED = date(2026, 9, 30)   # Mittwoch
THU = date(2026, 10, 1)


def _e(id, start, end, days=(1, 2, 3, 4, 5, 6, 7), priority=0, date_from=None, date_until=None,
       updated_at="2026-01-01T00:00:00Z", enabled=1, pid=None):
    return entry_from_row({"id": id, "presentation_id": pid or id * 10, "days": list(days), "start_time": start,
                           "end_time": end, "date_from": date_from, "date_until": date_until,
                           "priority": priority, "enabled": enabled, "updated_at": updated_at})


def m(hhmm):
    return timeutil.hhmm_to_min(hhmm)


def test_basic_interval_half_open():
    e = [_e(1, "18:00", "22:00", days=[1, 2, 3, 4, 5])]
    assert resolve_at(e, WED, m("18:00")).id == 1
    assert resolve_at(e, WED, m("21:59")).id == 1
    assert resolve_at(e, WED, m("22:00")) is None
    assert resolve_at(e, date(2026, 10, 3), m("19:00")) is None  # Samstag


def test_overnight_counts_start_day():
    e = [_e(1, "22:00", "02:00", days=[3])]   # nur mittwochs beginnend
    assert resolve_at(e, WED, m("23:30")).id == 1
    assert resolve_at(e, THU, m("01:59")).id == 1       # Ausläufer vom Mittwoch
    assert resolve_at(e, THU, m("02:00")) is None
    assert resolve_at(e, THU, m("23:00")) is None       # Donnerstag beginnt nicht


def test_end_24_00():
    e = [_e(1, "20:00", "24:00")]
    assert resolve_at(e, WED, m("23:59")).id == 1
    assert resolve_at(e, THU, m("00:00")) is None


def test_priority_then_date_range_then_latest():
    a = _e(1, "08:00", "20:00", priority=0)
    b = _e(2, "10:00", "12:00", priority=5)
    assert resolve_at([a, b], WED, m("11:00")).id == 2
    c = _e(3, "10:00", "12:00", priority=0, date_from="2026-09-01", date_until="2026-10-31")
    assert resolve_at([a, c], WED, m("11:00")).id == 3
    d = _e(4, "08:00", "20:00", updated_at="2026-06-01T00:00:00Z")
    assert resolve_at([a, d], WED, m("09:00")).id == 4


def test_date_range_and_disabled():
    e = [_e(1, "00:00", "24:00", date_from="2026-10-01", date_until="2026-10-01")]
    assert resolve_at(e, WED, m("12:00")) is None and resolve_at(e, THU, m("12:00")).id == 1
    assert resolve_at([_e(2, "00:00", "24:00", enabled=0)], WED, 600) is None


@pytest.fixture
def setup(admin):
    default = make_presentation(admin, "Standard", [make_text(admin)["id"]], publish=True)
    evening = make_presentation(admin, "Abend", [make_text(admin, "A")["id"]], publish=True)
    s = make_stele(admin, default_presentation_id=default["id"])
    return default, evening, s


def test_schedule_api_crud_and_validation(admin, setup):
    default, evening, s = setup
    r = admin.post("/api/schedule", json={"stele_id": s["id"], "presentation_id": evening["id"], "days": [],
                                          "start_time": "18:00", "end_time": "18:00"})
    assert r.status_code == 422
    assert {"days", "end_time"} <= set(r.get_json()["error"]["fields"])
    r = admin.post("/api/schedule", json={"stele_id": s["id"], "presentation_id": evening["id"], "days": [5, 1, 1],
                                          "start_time": "18:00", "end_time": "22:00", "label": "Abend",
                                          "date_from": "2026-10-10", "date_until": "2026-10-01"})
    assert r.status_code == 422 and "date_until" in r.get_json()["error"]["fields"]
    r = admin.post("/api/schedule", json={"stele_id": s["id"], "presentation_id": evening["id"], "days": [5, 1, 1],
                                          "start_time": "18:00", "end_time": "22:00", "label": "Abend"})
    assert r.status_code == 201
    e = r.get_json()
    assert e["days"] == [1, 5] and e["presentation"] == {"id": evening["id"], "name": "Abend", "status": "published"}
    lst = admin.get(f"/api/schedule?stele_id={s['id']}").get_json()
    assert lst["total"] == 1 and lst["default_presentation"]["id"] == default["id"]
    assert admin.patch(f"/api/schedule/{e['id']}", json={"enabled": False}).get_json()["enabled"] is False
    assert admin.delete(f"/api/schedule/{e['id']}").get_json() == {"ok": True}
    actions = [x["action"] for x in admin.get("/api/audit?entity_type=schedule").get_json()["items"]]
    assert actions == ["delete", "update", "create"]


def test_stele_now_and_next_change(admin, setup, monkeypatch):
    default, evening, s = setup
    admin.post("/api/schedule", json={"stele_id": s["id"], "presentation_id": evening["id"], "days": [1, 2, 3, 4, 5],
                                      "start_time": "18:00", "end_time": "22:00"})
    # Mittwoch 19:00 Berlin (Sommerzeit, UTC+2) = 17:00 UTC
    monkeypatch.setattr(timeutil, "utcnow", lambda: datetime(2026, 9, 30, 17, 0, tzinfo=timezone.utc))
    admin.login("admin")  # Leerlauf-Uhr folgt der gesetzten Zeit
    st = admin.get(f"/api/steles/{s['id']}").get_json()
    assert st["now"]["presentation"]["id"] == evening["id"] and st["now"]["source"] == "schedule"
    assert st["next_change"] == {"at": "2026-09-30T20:00:00Z",
                                 "presentation": {"id": default["id"], "name": "Standard"}}
    monkeypatch.setattr(timeutil, "utcnow", lambda: datetime(2026, 10, 3, 17, 0, tzinfo=timezone.utc))  # Samstag
    admin.login("admin")
    assert admin.get(f"/api/steles/{s['id']}").get_json()["now"]["source"] == "default"


def test_unpublished_presentation_does_not_run(admin, setup, monkeypatch):
    default, _evening, s = setup
    draft = make_presentation(admin, "Entwurf", [make_text(admin)["id"]])
    admin.post("/api/schedule", json={"stele_id": s["id"], "presentation_id": draft["id"],
                                      "start_time": "00:00", "end_time": "24:00"})
    st = admin.get(f"/api/steles/{s['id']}").get_json()
    assert st["now"]["presentation"]["id"] == default["id"] and st["now"]["source"] == "default"
    tl = admin.get(f"/api/schedule/timeline?stele_id={s['id']}&from=2026-09-30&days=1").get_json()
    seg = tl["days"][0]["segments"][0]
    assert seg["source"] == "default" and seg["unpublished_entry_ids"]


def test_timeline_segments_and_conflicts(admin, setup):
    default, evening, s = setup
    other = make_presentation(admin, "Andere", [make_text(admin)["id"]], publish=True)
    admin.post("/api/schedule", json={"stele_id": s["id"], "presentation_id": evening["id"], "days": [3],
                                      "start_time": "18:00", "end_time": "22:00"})
    admin.post("/api/schedule", json={"stele_id": s["id"], "presentation_id": other["id"], "days": [3],
                                      "start_time": "21:00", "end_time": "23:00"})
    r = admin.get(f"/api/schedule/timeline?stele_id={s['id']}&from=2026-09-30&days=2")
    assert r.status_code == 200
    tl = r.get_json()
    assert tl["timezone"] == "Europe/Berlin" and [d["date"] for d in tl["days"]] == ["2026-09-30", "2026-10-01"]
    segs = [(x["start"], x["end"], x["source"]) for x in tl["days"][0]["segments"]]
    assert segs[0] == ("00:00", "18:00", "default") and segs[-1] == ("23:00", "24:00", "default")
    assert ("18:00", "21:00", "schedule") in segs
    assert len(tl["conflicts"]) == 1 and tl["conflicts"][0]["date"] == "2026-09-30"
    assert tl["days"][1]["segments"] == [{"start": "00:00", "end": "24:00", "presentation":
                                          {"id": default["id"], "name": "Standard"}, "source": "default",
                                          "entry_id": None, "unpublished_entry_ids": []}]
    assert admin.get("/api/schedule/timeline").status_code == 422


def test_manifest_contains_schedule(admin, setup, app):
    from conftest import Client, stele_key
    _default, evening, s = setup
    admin.post("/api/schedule", json={"stele_id": s["id"], "presentation_id": evening["id"], "days": [1, 2, 3, 4, 5],
                                      "start_time": "18:00", "end_time": "22:00", "priority": 2})
    player = Client(app)
    player.c.environ_base["HTTP_X_STELE_KEY"] = stele_key(s)
    m = player.get("/api/player/manifest").get_json()
    assert m["schedule"][0]["start"] == "18:00" and m["schedule"][0]["priority"] == 2
    assert set(m["presentations"]) == {str(evening["id"]), str(s["default_presentation"]["id"])}
