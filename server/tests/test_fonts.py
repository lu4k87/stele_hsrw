"""Schriften (SPEC §5.4, §5.5, §7.6): Upload, Verweise in Design/Info-Folie, Manifest, Löschschutz, Rechte."""
import io

from conftest import make_presentation, make_text

WOFF2 = b"wOF2" + b"\x00" * 60
TTF = b"\x00\x01\x00\x00" + b"\x00" * 60


def upload_font(client, data=WOFF2, file_name="Hausschrift.woff2", **form):
    return client.post("/api/fonts", data={"file": (io.BytesIO(data), file_name), **form},
                       content_type="multipart/form-data")


def test_upload_list_and_serve(admin, betrachter):
    r = upload_font(admin, weight="700")
    assert r.status_code == 201, r.get_json()
    f = r.get_json()
    assert f["key"] == f"custom-{f['id']}" and f["name"] == "Hausschrift" and f["weight"] == 700
    assert f["format"] == "woff2" and f["url"].endswith("/font.woff2") and f["usages"] == []
    assert admin.get(f["url"]).data == WOFF2
    assert [x["id"] for x in betrachter.get("/api/fonts").get_json()["items"]] == [f["id"]]
    r = upload_font(admin, TTF, "Text.ttf", name="Text Regular")
    assert r.status_code == 201 and r.get_json()["weight"] is None and r.get_json()["format"] == "ttf"


def test_upload_rejects_other_files_and_needs_right(admin, autor, betrachter):
    r = upload_font(admin, b"<html>keine Schrift</html>", "font.woff2")
    assert r.status_code == 422 and r.get_json()["error"]["code"] == "unsupported_type"
    assert upload_font(admin, weight="450").status_code == 422
    assert upload_font(autor).status_code == 403
    assert upload_font(betrachter).status_code == 403
    assert autor.get("/api/fonts").status_code == 200


def test_design_and_text_style_validate_fonts(admin):
    fid = upload_font(admin).get_json()["id"]
    r = admin.post("/api/designs", json={"name": "Neu", "config": {"theme": {
        "font": "atkinson", "heading_font": f"custom-{fid}", "heading_weight": 700, "line_height": 1.55,
        "heading_case": "upper"}}})
    assert r.status_code == 201, r.get_json()
    th = r.get_json()["config"]["theme"]
    assert th["font"] == "atkinson" and th["heading_font"] == f"custom-{fid}" and th["heading_case"] == "upper"
    bad = admin.post("/api/designs", json={"name": "X", "config": {"theme": {"font": "comic-sans"}}})
    assert bad.status_code == 422 and "config.theme.font" in bad.get_json()["error"]["fields"]
    bad = admin.post("/api/designs", json={"name": "X", "config": {"theme": {"heading_font": "custom-999"}}})
    assert bad.status_code == 422


def test_text_style_fields_and_reset(admin):
    t = make_text(admin, style={"body_px": 60, "box": "glass", "bg_color2": "#1e5aa8", "bg_angle": 135,
                                "rule": False, "logo_corner": "top-right", "heading_scale": 2.4})
    st = t["data"]["style"]
    assert st["body_px"] == 60 and st["box"] == "glass" and st["bg_color2"] == "#1E5AA8" and st["rule"] is False
    r = admin.patch(f"/api/contents/{t['id']}", json={"data": {"style": {"bg_color2": None, "rule": None, "body_px": None}}})
    st = r.get_json()["data"]["style"]
    assert st["bg_color2"] is None and st["rule"] is None and st["body_px"] is None and st["box"] == "glass"
    for bad in ({"box": "rahmen"}, {"body_px": 200}, {"heading_weight": 450}, {"valign": "middle"}, {"title_color": "rot"}):
        r = admin.patch(f"/api/contents/{t['id']}", json={"data": {"style": bad}})
        assert r.status_code == 422, bad


def test_unset_fields_keep_published_hash_and_manifest_lists_fonts(admin):
    t = make_text(admin)
    p = make_presentation(admin, content_ids=[t["id"]], publish=True)
    assert p["status"] == "published"
    m = admin.get(f"/api/presentations/{p['id']}/manifest?source=draft").get_json()
    style = m["presentations"][str(p["id"])]["slides"][0]["style"]
    assert "heading_font" not in style and "box" not in style and m["fonts"] == {}
    f = upload_font(admin).get_json()
    admin.patch(f"/api/contents/{t['id']}", json={"data": {"style": {"heading_font": f["key"]}}})
    assert admin.get(f"/api/presentations/{p['id']}").get_json()["status"] == "changed"
    m = admin.get(f"/api/presentations/{p['id']}/manifest?source=draft").get_json()
    assert m["fonts"] == {f["key"]: {"url": f["url"], "weight": None, "name": "Hausschrift"}}
    assert f["url"] in m["assets"]
    admin.patch(f"/api/contents/{t['id']}", json={"data": {"style": {"heading_font": None}}})
    assert admin.get(f"/api/presentations/{p['id']}").get_json()["status"] == "published"


def test_preview_resolve_returns_fonts(admin):
    f = upload_font(admin).get_json()
    r = admin.post("/api/preview/resolve", json={"design": {"theme": {"font": f["key"]}}, "items": [
        {"content": {"type": "text", "data": {"fields": {"title": "A"}, "style": {"body_font": "lora"}}}}]})
    body = r.get_json()
    assert body["fonts"] == {f["key"]: {"url": f["url"], "weight": None, "name": "Hausschrift"}}
    assert body["design"]["theme"] == {"font": f["key"], "accent_color": "#F5B400"}
    assert body["slides"][0]["style"]["body_font"] == "lora"


def test_delete_blocked_while_used(admin, app):
    f = upload_font(admin).get_json()
    d = admin.post("/api/designs", json={"name": "D", "config": {"theme": {"font": f["key"]}}}).get_json()
    r = admin.delete(f"/api/fonts/{f['id']}")
    assert r.status_code == 409 and r.get_json()["error"]["details"]["usages"][0]["type"] == "design"
    admin.patch(f"/api/designs/{d['id']}", json={"config": {"theme": {"font": "sans"}}})
    assert admin.delete(f"/api/fonts/{f['id']}").status_code == 200
    assert admin.get(f["url"]).status_code == 404
    assert admin.get("/api/fonts").get_json()["items"] == []


def test_rename(admin, autor):
    f = upload_font(admin).get_json()
    assert admin.patch(f"/api/fonts/{f['id']}", json={"name": "Neu"}).get_json()["name"] == "Neu"
    assert admin.patch(f"/api/fonts/{f['id']}", json={"name": ""}).status_code == 422
    assert autor.patch(f"/api/fonts/{f['id']}", json={"name": "X"}).status_code == 403
