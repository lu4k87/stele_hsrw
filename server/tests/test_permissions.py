"""Rechte je Endpunkt (403/401), Schutzregeln (SPEC §6.3), Benutzer und Rollen (§7.3)."""
from __future__ import annotations

import pytest

from conftest import Client

# (Methode, Pfad, Body) – Betrachter darf das alles nicht
FORBIDDEN_FOR_VIEWER = [
    ("POST", "/api/contents", {"type": "text", "title": "X", "data": {}}),
    ("DELETE", "/api/contents/1", None),
    ("POST", "/api/contents/bulk-delete", {"ids": [1]}),
    ("POST", "/api/contents/check-url", {"url": "https://example.com"}),
    ("POST", "/api/presentations", {"name": "X"}),
    ("PUT", "/api/presentations/1/items", {"items": []}),
    ("POST", "/api/presentations/1/publish", {}),
    ("POST", "/api/presentations/1/reject", {"note": "nein"}),
    ("DELETE", "/api/presentations/1", None),
    ("POST", "/api/designs", {"name": "X"}),
    ("PATCH", "/api/designs/1", {"name": "Y"}),
    ("POST", "/api/touch-menus", {"name": "X"}),
    ("POST", "/api/steles", {"name": "X"}),
    ("POST", "/api/steles/1/commands", {"command": "reload"}),
    ("POST", "/api/steles/1/rotate-key", None),
    ("POST", "/api/schedule", {}),
    ("GET", "/api/users", None),
    ("POST", "/api/users", {}),
    ("POST", "/api/roles", {"name": "X"}),
    ("GET", "/api/audit", None),
    ("GET", "/api/audit/export.csv", None),
    ("PATCH", "/api/settings", {"org_name": "X"}),
    ("GET", "/api/system/backup", None),
    ("GET", "/api/system/info", None),
    ("GET", "/api/pairing/pending", None),
]

NEEDS_LOGIN = ["/api/contents", "/api/presentations", "/api/designs", "/api/touch-menus", "/api/steles",
               "/api/schedule", "/api/monitoring/overview", "/api/dashboard", "/api/audit", "/api/settings",
               "/api/users", "/api/roles", "/api/permissions"]


@pytest.mark.parametrize("method,path,payload", FORBIDDEN_FOR_VIEWER)
def test_viewer_forbidden(betrachter, method, path, payload):
    r = betrachter.open(method, path, json=payload)
    assert r.status_code == 403, (path, r.get_json())
    assert r.get_json()["error"]["code"] == "forbidden"


@pytest.mark.parametrize("path", NEEDS_LOGIN)
def test_requires_login(anon, path):
    r = anon.get(path)
    assert r.status_code == 401 and r.get_json()["error"]["code"] == "unauthenticated"


@pytest.mark.parametrize("path", ["/api/contents", "/api/presentations", "/api/designs", "/api/touch-menus",
                                  "/api/steles", "/api/schedule", "/api/monitoring/overview", "/api/dashboard"])
def test_viewer_can_read(betrachter, path):
    assert betrachter.get(path).status_code == 200


def test_permission_catalog(admin):
    groups = admin.get("/api/permissions").get_json()["groups"]
    keys = [p["key"] for g in groups for p in g["permissions"]]
    assert keys[0] == "monitoring.view" and keys[-1] == "settings.manage" and len(keys) == 20
    edit = next(p for g in groups for p in g["permissions"] if p["key"] == "presentations.edit")
    assert set(edit["implies"]) == {"presentations.view", "content.view"} and edit["description"]


def test_effective_permissions_of_roles(admin):
    roles = {r["name"]: r for r in admin.get("/api/roles").get_json()["items"]}
    assert set(roles) == {"Administrator", "Redaktion", "Autor", "Betrachter"}
    red = roles["Redaktion"]
    assert "presentations.view" in red["effective_permissions"] and "presentations.view" not in red["permissions"]
    assert "steles.view" in red["effective_permissions"]
    assert roles["Administrator"]["is_admin"] and len(roles["Administrator"]["effective_permissions"]) == 20
    assert roles["Autor"]["user_count"] == 1


def test_autor_can_request_review_but_not_publish(autor):
    p = autor.post("/api/presentations", json={"name": "Autorenwerk"}).get_json()
    assert autor.post(f"/api/presentations/{p['id']}/publish", json={}).status_code == 403
    r = autor.post(f"/api/presentations/{p['id']}/request-review", json={"note": "Bitte ansehen"})
    assert r.status_code == 200 and r.get_json()["review_state"] == "requested"
    assert r.get_json()["review_by"]["display_name"] == "Arne Autor"


def _roles(client):
    return {r["name"]: r["id"] for r in client.get("/api/roles").get_json()["items"]}


def _users(client):
    return {u["username"]: u for u in client.get("/api/users").get_json()["items"]}


def test_create_user_generated_password(admin, app):
    r = admin.post("/api/users", json={"username": "neu.user", "display_name": "Neu",
                                       "role_id": _roles(admin)["Autor"]})
    assert r.status_code == 201
    body = r.get_json()
    assert len(body["generated_password"]) == 12 and body["user"]["must_change_password"] is True
    Client(app).login("neu.user", body["generated_password"])


def test_create_user_validation(admin):
    r = admin.post("/api/users", json={"username": "a", "display_name": "", "role_id": 999, "password": "kurz"})
    assert r.status_code == 422
    assert set(r.get_json()["error"]["fields"]) >= {"username", "display_name", "role_id", "password"}
    r = admin.post("/api/users", json={"username": "ADMIN", "display_name": "X", "role_id": 1})
    assert r.status_code == 422 and "username" in r.get_json()["error"]["fields"]


def test_reset_password_ends_sessions(admin, app):
    victim = Client(app).login("autor")
    uid = _users(admin)["autor"]["id"]
    r = admin.post(f"/api/users/{uid}/password", json={})
    assert r.status_code == 200 and r.get_json()["generated_password"]
    assert victim.get("/api/contents").status_code == 401


def test_self_protection(admin):
    me = _users(admin)["admin"]
    r = admin.delete(f"/api/users/{me['id']}")
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "self_protection"
    r = admin.patch(f"/api/users/{me['id']}", json={"role_id": _roles(admin)["Autor"]})
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "self_protection"
    r = admin.patch(f"/api/users/{me['id']}", json={"is_active": False})
    assert r.get_json()["error"]["code"] == "self_protection"


def test_last_admin(admin, app):
    roles = _roles(admin)
    hr_role = admin.post("/api/roles", json={"name": "Personal", "permissions": ["users.manage"]}).get_json()
    admin.post("/api/users", json={"username": "personal", "display_name": "HR", "role_id": hr_role["id"],
                                   "password": "personal123", "must_change_password": False})
    hr = Client(app).login("personal", "personal123")
    admin_id = _users(admin)["admin"]["id"]
    for method, payload in (("DELETE", None), ("PATCH", {"is_active": False}),
                            ("PATCH", {"role_id": roles["Autor"]})):
        r = hr.open(method, f"/api/users/{admin_id}", json=payload)
        assert r.status_code == 409 and r.get_json()["error"]["code"] == "last_admin", (method, payload)
    # Mit einem zweiten Administrator geht es
    admin.post("/api/users", json={"username": "chefin", "display_name": "Chefin", "role_id": roles["Administrator"],
                                   "password": "chefin12345"})
    assert hr.patch(f"/api/users/{admin_id}", json={"is_active": False}).status_code == 200


def test_role_locked_and_in_use(admin):
    roles = _roles(admin)
    r = admin.patch(f"/api/roles/{roles['Administrator']}", json={"name": "Chef"})
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "role_locked"
    r = admin.delete(f"/api/roles/{roles['Administrator']}")
    assert r.status_code == 403 and r.get_json()["error"]["code"] == "role_locked"
    r = admin.delete(f"/api/roles/{roles['Autor']}")
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "role_in_use"
    assert r.get_json()["error"]["details"]["user_count"] == 1


def test_role_copy_update_delete(admin):
    roles = _roles(admin)
    r = admin.post("/api/roles", json={"name": "Autor plus", "copy_from": roles["Autor"]})
    assert r.status_code == 201
    new = r.get_json()
    assert "presentations.edit" in new["permissions"]
    r = admin.patch(f"/api/roles/{new['id']}", json={"permissions": ["content.view", "gibt.es.nicht"]})
    assert r.status_code == 422
    r = admin.patch(f"/api/roles/{new['id']}", json={"permissions": ["content.delete"]})
    assert r.get_json()["effective_permissions"] == ["content.view", "content.delete"]
    assert admin.delete(f"/api/roles/{new['id']}").get_json() == {"ok": True}
