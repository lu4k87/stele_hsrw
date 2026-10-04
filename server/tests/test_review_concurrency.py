"""Vier-Augen-Freigabe (Status-Hash, Zurücksetzen) und gleichzeitiges Bearbeiten (expected_updated_at, §3, §7.1)."""
from __future__ import annotations

from stelecms import db as dbm

from conftest import make_presentation, make_text


def _requested(autor, name="Sommerfest"):
    p = make_presentation(autor, name, [make_text(autor, "Fest")["id"]])
    r = autor.post(f"/api/presentations/{p['id']}/request-review", json={"note": "Bitte prüfen"})
    assert r.status_code == 200 and r.get_json()["review_state"] == "requested"
    assert r.get_json()["review_changed"] is False
    return r.get_json()


def test_migration_adds_review_hash(tmp_path):
    conn = dbm.connect(tmp_path / "alt.db")
    conn.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)")
    conn.executescript("BEGIN;\n" + (dbm.MIGRATIONS_DIR / "0001_init.sql").read_text(encoding="utf-8")
                       + "\nINSERT INTO schema_version(version) VALUES (1);\nCOMMIT;")
    assert "review_hash" not in {r["name"] for r in conn.execute("PRAGMA table_info(presentations)")}
    assert dbm.migrate(conn) is False
    assert "review_hash" in {r["name"] for r in conn.execute("PRAGMA table_info(presentations)")}
    conn.close()


def test_editing_after_request_resets_review(autor, admin):
    p = _requested(autor)
    # Umbenennen ändert den Entwurf nicht → Freigabe bleibt
    r = autor.patch(f"/api/presentations/{p['id']}", json={"name": "Sommerfest 2026"})
    assert r.get_json()["review_state"] == "requested"
    # Folien ändern → Freigabe zurückgesetzt
    extra = make_text(autor, "Neu")
    items = [{"content_id": i["content"]["id"]} for i in p["items"]] + [{"content_id": extra["id"]}]
    r = autor.put(f"/api/presentations/{p['id']}/items", json={"items": items})
    body = r.get_json()
    assert body["review_state"] == "none" and body["review_note"] == "" and body["review_by"] is None
    entry = admin.get("/api/audit?entity_type=presentation&action=update").get_json()["items"][0]
    assert entry["details"].get("review_reset") is True
    # Einstellungen ändern nach erneutem Einreichen → ebenfalls zurückgesetzt
    autor.post(f"/api/presentations/{p['id']}/request-review", json={})
    r = autor.patch(f"/api/presentations/{p['id']}", json={"settings": {"transition": "none"}})
    assert r.get_json()["review_state"] == "none"


def test_publish_409_when_changed_since_request(autor, redaktion):
    p = _requested(autor)
    # Indirekte Änderung (Design) setzt die Freigabe nicht zurück, aber der Hash weicht ab
    redaktion.patch(f"/api/designs/{p['design_id']}", json={"config": {"header": {"title": "Neu"}}})
    got = redaktion.get(f"/api/presentations/{p['id']}").get_json()
    assert got["review_state"] == "requested" and got["review_changed"] is True
    r = redaktion.post(f"/api/presentations/{p['id']}/publish", json={})
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "changed_since_review"
    assert redaktion.get(f"/api/presentations/{p['id']}").get_json()["status"] == "draft"
    # Nach ausdrücklicher Bestätigung veröffentlichen
    r = redaktion.post(f"/api/presentations/{p['id']}/publish", json={"confirm_changed": True})
    assert r.status_code == 200
    assert r.get_json()["status"] == "published" and r.get_json()["review_state"] == "none"


def test_publish_unchanged_request_needs_no_confirmation(autor, redaktion):
    p = _requested(autor)
    r = redaktion.post(f"/api/presentations/{p['id']}/publish", json={})
    assert r.status_code == 200 and r.get_json()["review_state"] == "none"


def test_autor_cannot_publish_even_with_confirmation(autor):
    p = _requested(autor)
    r = autor.post(f"/api/presentations/{p['id']}/publish", json={"confirm_changed": True})
    assert r.status_code == 403


def test_discard_resets_review(admin, autor, redaktion):
    p = make_presentation(admin, "Foyer", [make_text(admin)["id"]], publish=True)
    autor.patch(f"/api/presentations/{p['id']}", json={"settings": {"transition": "none"}})
    autor.post(f"/api/presentations/{p['id']}/request-review", json={"note": "Übergang"})
    redaktion.post(f"/api/presentations/{p['id']}/reject", json={"note": "Lieber weich"})
    r = autor.post(f"/api/presentations/{p['id']}/discard")
    body = r.get_json()
    assert r.status_code == 200 and body["status"] == "published"
    assert body["review_state"] == "none" and body["review_note"] == "" and body["review_by"] is None
    assert body["review_at"] is None


def test_presentation_edit_conflict(admin, redaktion, app):
    p = make_presentation(admin, "Foyer", [make_text(admin)["id"]])
    stale = p["updated_at"]
    conn = dbm.connect(app.config["DB_PATH"])
    conn.execute("UPDATE presentations SET updated_at = '2000-01-01T00:00:00Z' WHERE id = ?", (p["id"],))
    conn.close()
    r = redaktion.patch(f"/api/presentations/{p['id']}", json={"name": "X", "expected_updated_at": stale})
    err = r.get_json()["error"]
    assert r.status_code == 409 and err["code"] == "edit_conflict"
    assert "Alex Admin" in err["message"] and err["details"]["updated_by"]["display_name"] == "Alex Admin"
    r = redaktion.put(f"/api/presentations/{p['id']}/items", json={"items": [], "expected_updated_at": stale})
    assert r.status_code == 409
    assert admin.get(f"/api/presentations/{p['id']}").get_json()["name"] == "Foyer"
    # Passender Stand bzw. ohne Angabe → gespeichert; Antwort liefert den neuen Stand
    r = redaktion.patch(f"/api/presentations/{p['id']}",
                        json={"name": "Foyer 2", "expected_updated_at": "2000-01-01T00:00:00Z"})
    assert r.status_code == 200 and r.get_json()["updated_by"]["display_name"] == "Rita Redaktion"
    assert redaktion.patch(f"/api/presentations/{p['id']}", json={"name": "Foyer 3"}).status_code == 200


def test_presentation_edit_rights_before_conflict(betrachter, admin):
    p = make_presentation(admin, "Foyer")
    r = betrachter.patch(f"/api/presentations/{p['id']}", json={"name": "X", "expected_updated_at": "alt"})
    assert r.status_code == 403


def test_design_and_touch_menu_edit_conflict(admin, redaktion, autor):
    d = admin.post("/api/designs", json={"name": "Hell"}).get_json()
    m = admin.post("/api/touch-menus", json={"name": "Menü"}).get_json()
    for url, obj in ((f"/api/designs/{d['id']}", d), (f"/api/touch-menus/{m['id']}", m)):
        # Rechte vor Konflikt: Autor darf Designs/Touch-Menüs nicht bearbeiten
        assert autor.patch(url, json={"name": "X", "expected_updated_at": "alt"}).status_code == 403
        r = redaktion.patch(url, json={"name": "Neu", "expected_updated_at": "2000-01-01T00:00:00Z"})
        assert r.status_code == 409 and r.get_json()["error"]["code"] == "edit_conflict"
        assert "Alex Admin" in r.get_json()["error"]["message"]
        r = redaktion.patch(url, json={"name": "Neu", "expected_updated_at": obj["updated_at"]})
        assert r.status_code == 200 and r.get_json()["name"] == "Neu"
