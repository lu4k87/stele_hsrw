"""JSON-Strukturen mit Standardwerten (SPEC §5): auffüllen (`merge_defaults`) und prüfen.

Jede `normalize_*`-Funktion nimmt den bisherigen Stand (`base`) und eine Teiländerung (`patch`) entgegen,
prüft die Änderung feldgenau und liefert das vollständige Objekt. Fehler landen im übergebenen Validator.
"""
from __future__ import annotations

import copy
import re
import secrets

from . import db as dbm
from . import fonts as fontsm
from .config import WEB_DIR
from .validation import Validator, is_int

# ------------------------------------------------------------ Standardwerte

PRESENTATION_SETTINGS = {
    "default_duration_s": 7,
    "transition": "fade",
    "transition_ms": 800,
    "order": "sequential",
    "image_fit": "cover",
    "ken_burns": False,
    "video_sound": False,
    "video_play_to_end": True,
    "background": "#000000",
    "show_header": True,
    "show_footer": True,
    "show_progress": False,
    "caption_style": "bar",
}
TRANSITIONS = ("none", "fade", "slide-left", "slide-up", "zoom")

TEXT_TEMPLATES = ("title_text", "image_text", "statement", "event", "list")
TEXT_DATA = {
    "template": "title_text",
    "fields": {"title": "", "subtitle": "", "body": "", "image_content_id": None,
               "date": "", "time": "", "location": "", "items": [],
               "audience": "", "admission": "", "qr_url": "", "qr_label": ""},
    "style": {"bg_color": "#0F2747", "text_color": "#FFFFFF", "accent_color": "#F5B400",
              "bg_image_content_id": None, "overlay": 0.4, "align": "left", "size": "m",
              # Feingestaltung (null = wie Design bzw. Standard der Vorlage), siehe TEXT_STYLE_OPTIONAL
              "heading_font": None, "body_font": None, "heading_weight": None, "body_weight": None,
              "body_px": None, "heading_scale": None, "line_height": None, "heading_tracking": None,
              "heading_case": None, "title_color": None, "subtitle_color": None,
              "bg_color2": None, "bg_angle": None, "padding": None, "valign": None,
              "box": None, "box_color": None, "box_radius": None, "rule": None, "logo_corner": None},
}
# Neue Stil-Felder: null → nicht in der aufgelösten Folie (Status-Hash veröffentlichter Stände bleibt gleich)
TEXT_STYLE_OPTIONAL = ("heading_font", "body_font", "heading_weight", "body_weight", "body_px", "heading_scale",
                       "line_height", "heading_tracking", "heading_case", "title_color", "subtitle_color",
                       "bg_color2", "bg_angle", "padding", "valign", "box", "box_color", "box_radius", "rule",
                       "logo_corner")
FONT_WEIGHTS = (100, 200, 300, 400, 500, 600, 700, 800, 900)
# Neue optionale Felder: leer → nicht im Manifest (veröffentlichte Stände bleiben unverändert)
TEXT_OPTIONAL_FIELDS = ("audience", "admission", "qr_url", "qr_label")
QR_URL_MAX = 500
WEB_DATA = {"url": "", "zoom": 1.0, "refresh_s": 0, "interactive": True,
            "embed_check": {"embeddable": None, "message": "", "checked_at": None}}
VIDEO_DATA = {"codec": "", "audio": False, "transcoded": False, "compatible": True}

DESIGN_CONFIG = {
    "header": {"enabled": True, "height": 180, "bg_color": "#0F2747", "text_color": "#FFFFFF",
               "logo_content_id": None, "logo_position": "left", "title": "Willkommen", "subtitle": "",
               "show_clock": True, "show_date": True, "date_format": "long"},
    "footer": {"enabled": True, "height": 96, "bg_color": "#0F2747", "text_color": "#FFFFFF",
               "mode": "ticker", "text": "", "ticker_items": [], "ticker_rss_url": "",
               "ticker_speed": 120, "ticker_separator": "•"},
    "theme": {"font": "sans", "accent_color": "#F5B400",
              # Standard für Info-Folien (null = Standard der Vorlage), siehe DESIGN_THEME_OPTIONAL
              "heading_font": None, "heading_weight": None, "body_weight": None, "line_height": None,
              "heading_tracking": None, "heading_case": None},
}
DESIGN_THEME_OPTIONAL = ("heading_font", "heading_weight", "body_weight", "line_height", "heading_tracking",
                         "heading_case")

TOUCH_CONFIG = {
    "title": "Informationen", "intro": "Bitte ein Thema wählen", "columns": 2, "idle_timeout_s": 60,
    "attract": {"enabled": True, "text": "Tippen für Informationen"},
    "tiles": [],
}
MAX_TILES = 12

STELE_SETTINGS = {
    "volume": 0.8,
    "touch_enabled": True,
    "night_mode": {"enabled": False, "start": "22:00", "end": "06:00"},
    "daily_reload": "03:30",
    "show_cursor": False,
}


def merge_defaults(defaults, value):
    """Füllt fehlende Schlüssel rekursiv mit Standardwerten auf; unbekannte Schlüssel entfallen."""
    if isinstance(defaults, dict):
        value = value if isinstance(value, dict) else {}
        return {k: merge_defaults(dv, value.get(k, dv)) if isinstance(dv, dict) else
                copy.deepcopy(value.get(k, dv)) for k, dv in defaults.items()}
    return copy.deepcopy(value)


def _sub(v: Validator, data, key: str) -> Validator:
    sub = Validator(data if isinstance(data, dict) else {}, prefix=f"{v.prefix}{key}.")
    if key in v.data and not isinstance(v.data.get(key), dict):
        v.error(key, "Bitte ein Objekt angeben.")
    return sub


def _content_ref(conn, v: Validator, key: str, value, types=("image",), label: str = "Bild"):
    """Prüft einen Verweis auf einen Inhalt der Mediathek (oder None)."""
    if value is None:
        return None
    if not is_int(value):
        v.error(key, "Ungültiger Verweis auf einen Inhalt.")
        return None
    r = dbm.row(conn, "SELECT id, type FROM contents WHERE id = ?", (value,))
    if r is None:
        v.error(key, "Der gewählte Inhalt existiert nicht mehr. Bitte neu auswählen.")
        return None
    if types and r["type"] not in types:
        v.error(key, f"Bitte ein {label} aus der Mediathek wählen.")
        return None
    return value


def _font_ref(conn, v: Validator, key: str, default, *, allow_none: bool = True):
    """Schrift-Schlüssel: mitgeliefert (web/shared/fonts.js) oder hochgeladen (`custom-<id>`)."""
    if key not in v.data:
        return default
    value = v.data[key]
    if value is None:
        return None if allow_none else default
    if value in fontsm.builtin_keys():
        return value
    fid = fontsm.custom_id(value)
    if fid is not None and dbm.scalar(conn, "SELECT 1 FROM fonts WHERE id = ?", (fid,)):
        return value
    v.error(key, "Bitte eine Schrift aus der Liste wählen.")
    return default


def _opt(v: Validator, key: str, default, read):
    """Optionaler Wert: ausdrücklich null → zurück auf „erben“; sonst Prüfung per `read(default)`."""
    if key in v.data and v.data[key] is None:
        return None
    return read(default)


def _typography(conn, v: Validator, d: dict) -> None:
    """Gemeinsame Typografie-Felder von Design (`theme`) und Info-Folie (`style`)."""
    d["heading_font"] = _font_ref(conn, v, "heading_font", d["heading_font"])
    for key in ("heading_weight", "body_weight"):
        d[key] = v.choice(key, FONT_WEIGHTS, default=d[key], allow_none=True)
    d["line_height"] = v.number("line_height", min_value=1.0, max_value=2.0, default=d["line_height"],
                                allow_none=True)
    d["heading_tracking"] = v.number("heading_tracking", min_value=-0.05, max_value=0.25,
                                     default=d["heading_tracking"], allow_none=True)
    d["heading_case"] = v.choice("heading_case", ("none", "upper"), default=d["heading_case"], allow_none=True)


# --------------------------------------------------- Diashow-Einstellungen

def normalize_presentation_settings(base, patch, v: Validator) -> dict:
    out = merge_defaults(PRESENTATION_SETTINGS, base)
    if patch is None:
        return out
    if not isinstance(patch, dict):
        v.error("settings", "Bitte ein Objekt angeben.")
        return out
    s = Validator(patch, prefix="settings.")
    out["default_duration_s"] = s.number("default_duration_s", min_value=2, max_value=600,
                                         default=out["default_duration_s"])
    out["transition"] = s.choice("transition", TRANSITIONS, default=out["transition"])
    out["transition_ms"] = s.integer("transition_ms", min_value=0, max_value=3000, default=out["transition_ms"])
    out["order"] = s.choice("order", ("sequential", "shuffle"), default=out["order"])
    out["image_fit"] = s.choice("image_fit", ("cover", "contain"), default=out["image_fit"])
    for key in ("ken_burns", "video_sound", "video_play_to_end", "show_header", "show_footer", "show_progress"):
        out[key] = s.boolean(key, default=out[key])
    out["background"] = s.color("background", default=out["background"])
    out["caption_style"] = s.choice("caption_style", ("bar", "shadow"), default=out["caption_style"])
    v.merge(s)
    return out


_PAGES_RE = re.compile(r"^\s*\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*\s*$")


def normalize_item_options(patch, v: Validator, prefix: str) -> dict:
    """Folien-Optionen (§5.3): nur gesetzte Schlüssel bleiben erhalten (fehlend = Präsentations-Standard)."""
    if patch is None:
        return {}
    if not isinstance(patch, dict):
        v.errors.setdefault(prefix.rstrip("."), "Bitte ein Objekt angeben.")
        return {}
    s = Validator(patch, prefix=prefix)
    out = {}
    if patch.get("fit") is not None:
        out["fit"] = s.choice("fit", ("cover", "contain"))
    for key in ("ken_burns", "sound", "play_to_end", "fullscreen"):
        if patch.get(key) is not None:
            out[key] = s.boolean(key)
    if patch.get("pages") not in (None, ""):
        pages = patch.get("pages")
        if not isinstance(pages, str) or not _PAGES_RE.match(pages):
            s.error("pages", "Seiten bitte wie „1-3,5“ angeben.")
        else:
            out["pages"] = re.sub(r"\s+", "", pages)
    if patch.get("page_duration_s") is not None:
        out["page_duration_s"] = s.number("page_duration_s", min_value=1, max_value=600)
    v.merge(s)
    return {k: val for k, val in out.items() if val is not None}


def parse_pages(spec: str | None, page_count: int) -> list[int]:
    """„1-3,5“ → [1, 2, 3, 5] (nur vorhandene Seiten, ohne Doppelte). Leer → alle."""
    if not page_count:
        return []
    if not spec:
        return list(range(1, page_count + 1))
    pages: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            try:
                lo, hi = int(a), int(b)
            except ValueError:
                continue
            if lo > hi:
                lo, hi = hi, lo
            rng = range(lo, hi + 1)
        else:
            try:
                rng = [int(part)]
            except ValueError:
                continue
        for p in rng:
            if 1 <= p <= page_count and p not in pages:
                pages.append(p)
    return pages or list(range(1, page_count + 1))


# ---------------------------------------------------------- Info-Folie

def normalize_text_data(conn, base, patch, v: Validator) -> dict:
    out = merge_defaults(TEXT_DATA, base)
    if patch is None:
        return out
    if not isinstance(patch, dict):
        v.error("data", "Bitte ein Objekt angeben.")
        return out
    d = Validator(patch, prefix="data.")
    out["template"] = d.choice("template", TEXT_TEMPLATES, default=out["template"])
    if "fields" in patch:
        f = _sub(d, patch.get("fields"), "fields")
        fields = out["fields"]
        fields["title"] = f.text("title", max_len=200, default=fields["title"])
        fields["subtitle"] = f.text("subtitle", max_len=200, default=fields["subtitle"])
        fields["body"] = f.text("body", max_len=3000, default=fields["body"], multiline=True)
        for key in ("date", "time", "location", "audience", "admission"):
            fields[key] = f.text(key, max_len=120, default=fields[key])
        fields["qr_url"] = f.url("qr_url", allow_empty=True, default=fields["qr_url"])
        if len(fields["qr_url"]) > QR_URL_MAX:
            f.error("qr_url", f"Die Adresse ist zu lang für einen QR-Code (höchstens {QR_URL_MAX} Zeichen).")
            fields["qr_url"] = ""
        fields["qr_label"] = f.text("qr_label", max_len=80, default=fields["qr_label"])
        items = f.string_list("items", max_items=20, max_len=200)
        if items is not None:
            fields["items"] = items
        if "image_content_id" in f.data:
            fields["image_content_id"] = _content_ref(conn, f, "image_content_id", f.data.get("image_content_id"))
        d.merge(f)
    if "style" in patch:
        st = _sub(d, patch.get("style"), "style")
        style = out["style"]
        for key in ("bg_color", "text_color", "accent_color"):
            style[key] = st.color(key, default=style[key])
        if "bg_image_content_id" in st.data:
            style["bg_image_content_id"] = _content_ref(conn, st, "bg_image_content_id",
                                                        st.data.get("bg_image_content_id"))
        style["overlay"] = st.number("overlay", min_value=0, max_value=0.8, default=style["overlay"])
        style["align"] = st.choice("align", ("left", "center"), default=style["align"])
        style["size"] = st.choice("size", ("s", "m", "l"), default=style["size"])
        _typography(conn, st, style)
        style["body_font"] = _font_ref(conn, st, "body_font", style["body_font"])
        style["body_px"] = st.integer("body_px", min_value=28, max_value=96, default=style["body_px"],
                                      allow_none=True)
        style["heading_scale"] = st.number("heading_scale", min_value=1.2, max_value=3.5,
                                           default=style["heading_scale"], allow_none=True)
        for key in ("title_color", "subtitle_color", "bg_color2", "box_color"):
            style[key] = _opt(st, key, style[key], lambda dv, k=key: st.color(k, default=dv))
        style["bg_angle"] = st.integer("bg_angle", min_value=0, max_value=360, default=style["bg_angle"],
                                       allow_none=True)
        style["padding"] = st.choice("padding", ("s", "m", "l"), default=style["padding"], allow_none=True)
        style["valign"] = st.choice("valign", ("top", "center", "bottom"), default=style["valign"], allow_none=True)
        style["box"] = st.choice("box", ("none", "solid", "glass"), default=style["box"], allow_none=True)
        style["box_radius"] = st.integer("box_radius", min_value=0, max_value=80, default=style["box_radius"],
                                         allow_none=True)
        style["rule"] = _opt(st, "rule", style["rule"], lambda dv: st.boolean("rule", default=dv))
        style["logo_corner"] = st.choice("logo_corner", ("none", "top-left", "top-right", "bottom-left",
                                                         "bottom-right"), default=style["logo_corner"], allow_none=True)
        d.merge(st)
    v.merge(d)
    return out


def normalize_web_data(base, patch, v: Validator, *, require_url: bool = False) -> dict:
    out = merge_defaults(WEB_DATA, base)
    if patch is None:
        if require_url and not out["url"]:
            v.error("data.url", "Bitte eine Adresse (https://…) eingeben.")
        return out
    if not isinstance(patch, dict):
        v.error("data", "Bitte ein Objekt angeben.")
        return out
    d = Validator(patch, prefix="data.")
    out["url"] = d.url("url", required=require_url and not out["url"], default=out["url"])
    out["zoom"] = d.number("zoom", min_value=0.25, max_value=3, default=out["zoom"])
    out["refresh_s"] = d.integer("refresh_s", min_value=0, max_value=86400, default=out["refresh_s"])
    out["interactive"] = d.boolean("interactive", default=out["interactive"])
    ec = patch.get("embed_check")
    if isinstance(ec, dict):
        emb = ec.get("embeddable")
        out["embed_check"] = {
            "embeddable": emb if emb in (True, False, None) else None,
            "message": str(ec.get("message") or "")[:500],
            "checked_at": ec.get("checked_at") if isinstance(ec.get("checked_at"), str) else None,
        }
    v.merge(d)
    return out


# ---------------------------------------------------------------- Design

def normalize_design_config(conn, base, patch, v: Validator) -> dict:
    out = merge_defaults(DESIGN_CONFIG, base)
    if patch is None:
        return out
    if not isinstance(patch, dict):
        v.error("config", "Bitte ein Objekt angeben.")
        return out
    c = Validator(patch, prefix="config.")
    if "header" in patch:
        h = _sub(c, patch.get("header"), "header")
        hd = out["header"]
        hd["enabled"] = h.boolean("enabled", default=hd["enabled"])
        hd["height"] = h.integer("height", min_value=100, max_value=400, default=hd["height"])
        hd["bg_color"] = h.color("bg_color", default=hd["bg_color"])
        hd["text_color"] = h.color("text_color", default=hd["text_color"])
        if "logo_content_id" in h.data:
            hd["logo_content_id"] = _content_ref(conn, h, "logo_content_id", h.data.get("logo_content_id"))
        hd["logo_position"] = h.choice("logo_position", ("left", "center"), default=hd["logo_position"])
        hd["title"] = h.text("title", max_len=80, default=hd["title"])
        hd["subtitle"] = h.text("subtitle", max_len=120, default=hd["subtitle"])
        hd["show_clock"] = h.boolean("show_clock", default=hd["show_clock"])
        hd["show_date"] = h.boolean("show_date", default=hd["show_date"])
        hd["date_format"] = h.choice("date_format", ("long", "short"), default=hd["date_format"])
        c.merge(h)
    if "footer" in patch:
        f = _sub(c, patch.get("footer"), "footer")
        ft = out["footer"]
        ft["enabled"] = f.boolean("enabled", default=ft["enabled"])
        ft["height"] = f.integer("height", min_value=60, max_value=240, default=ft["height"])
        ft["bg_color"] = f.color("bg_color", default=ft["bg_color"])
        ft["text_color"] = f.color("text_color", default=ft["text_color"])
        ft["mode"] = f.choice("mode", ("ticker", "text"), default=ft["mode"])
        ft["text"] = f.text("text", max_len=300, default=ft["text"])
        items = f.string_list("ticker_items", max_items=50, max_len=300)
        if items is not None:
            ft["ticker_items"] = items
        ft["ticker_rss_url"] = f.url("ticker_rss_url", allow_empty=True, default=ft["ticker_rss_url"])
        ft["ticker_speed"] = f.integer("ticker_speed", min_value=40, max_value=400, default=ft["ticker_speed"])
        ft["ticker_separator"] = f.text("ticker_separator", max_len=5, default=ft["ticker_separator"], strip=False)
        c.merge(f)
    if "theme" in patch:
        t = _sub(c, patch.get("theme"), "theme")
        th = out["theme"]
        th["font"] = _font_ref(conn, t, "font", th["font"], allow_none=False)
        th["accent_color"] = t.color("accent_color", default=th["accent_color"])
        _typography(conn, t, th)
        c.merge(t)
    v.merge(c)
    return out


# ------------------------------------------------------------ Touch-Menü

_TILE_ICONS_CACHE: list[str] | None = None
_ICON_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def tile_icons() -> list[str]:
    """Erlaubte Kachel-Icons aus web/shared/icons.js (TILE_ICON_LABELS); leer = jedes gültige Kürzel."""
    global _TILE_ICONS_CACHE
    if _TILE_ICONS_CACHE is None:
        names: list[str] = []
        try:
            src = (WEB_DIR / "shared" / "icons.js").read_text(encoding="utf-8")
            m = re.search(r"TILE_ICON_LABELS\s*=\s*\{(.*?)\};", src, re.S)
            if m:
                names = [a or b for a, b in re.findall(r"(?:'([a-z0-9-]+)'|\b([a-z][a-z0-9]*))\s*:\s*'", m.group(1))]
        except OSError:
            names = []
        _TILE_ICONS_CACHE = names
    return _TILE_ICONS_CACHE


def _tile_id() -> str:
    return "t-" + secrets.token_hex(2)


def _normalize_tiles(conn, tiles, v: Validator, key: str, depth: int, used_ids: set) -> list:
    if not isinstance(tiles, list):
        v.error(key, "Kacheln bitte als Liste angeben.")
        return []
    if len(tiles) > MAX_TILES:
        v.error(key, f"Höchstens {MAX_TILES} Kacheln je Ebene.")
        tiles = tiles[:MAX_TILES]
    icons = tile_icons()
    out = []
    for i, tile in enumerate(tiles):
        p = f"{key}.{i}"
        if not isinstance(tile, dict):
            v.errors.setdefault(f"{v.prefix}{p}", "Ungültige Kachel.")
            continue
        t = Validator(tile, prefix=f"{v.prefix}{p}.")
        tid = tile.get("id")
        if not isinstance(tid, str) or not re.match(r"^[A-Za-z0-9_-]{1,40}$", tid) or tid in used_ids:
            tid = _tile_id()
            while tid in used_ids:
                tid = _tile_id()
        used_ids.add(tid)
        label = t.text("label", required=True, max_len=60, default="", empty_msg="Bitte eine Beschriftung eingeben.")
        icon = tile.get("icon") or "info"
        if not isinstance(icon, str) or (icons and icon not in icons) or not _ICON_NAME_RE.match(icon):
            t.error("icon", "Unbekanntes Icon. Bitte aus der Liste wählen.")
            icon = "info"
        color = t.color("color", default="#1E5AA8")
        image_id = _content_ref(conn, t, "image_content_id", tile.get("image_content_id"))
        action_in = tile.get("action")
        action = None
        if not isinstance(action_in, dict):
            t.error("action", "Bitte festlegen, was beim Antippen passiert.")
        else:
            a = Validator(action_in, prefix=f"{t.prefix}action.")
            atype = a.choice("type", ("content", "gallery", "submenu"), required=True)
            if atype == "content":
                cid = action_in.get("content_id")
                if cid is None:
                    a.error("content_id", "Bitte einen Inhalt wählen.")
                else:
                    cid = _content_ref(conn, a, "content_id", cid, types=None)
                action = {"type": "content", "content_id": cid}
            elif atype == "gallery":
                ids = action_in.get("content_ids")
                clean_ids = []
                if not isinstance(ids, list) or not ids:
                    a.error("content_ids", "Bitte mindestens ein Bild oder Video für die Galerie wählen.")
                elif len(ids) > 50:
                    a.error("content_ids", "Höchstens 50 Einträge je Galerie.")
                else:
                    for cid in ids:
                        ok = _content_ref(conn, a, "content_ids", cid, types=("image", "video"),
                                          label="Bild oder Video")
                        if ok is not None:
                            clean_ids.append(ok)
                action = {"type": "gallery", "content_ids": clean_ids}
            elif atype == "submenu":
                if depth >= 2:
                    a.error("type", "Untermenüs sind nur auf der ersten Ebene möglich (max. 2 Ebenen).")
                    action = {"type": "submenu", "tiles": []}
                else:
                    sub = Validator({}, prefix=a.prefix)
                    sub_tiles = _normalize_tiles(conn, action_in.get("tiles", []), sub, "tiles", depth + 1, used_ids)
                    a.merge(sub)
                    action = {"type": "submenu", "tiles": sub_tiles}
            t.merge(a)
        v.merge(t)
        out.append({"id": tid, "label": label or "", "icon": icon, "color": color,
                    "image_content_id": image_id, "action": action or {"type": "content", "content_id": None}})
    return out


def normalize_touch_config(conn, base, patch, v: Validator) -> dict:
    out = merge_defaults(TOUCH_CONFIG, base)
    if patch is None:
        return out
    if not isinstance(patch, dict):
        v.error("config", "Bitte ein Objekt angeben.")
        return out
    c = Validator(patch, prefix="config.")
    out["title"] = c.text("title", max_len=80, default=out["title"])
    out["intro"] = c.text("intro", max_len=200, default=out["intro"])
    out["columns"] = c.choice("columns", (1, 2, 3), default=out["columns"])
    out["idle_timeout_s"] = c.integer("idle_timeout_s", min_value=15, max_value=600, default=out["idle_timeout_s"])
    if "attract" in patch:
        a = _sub(c, patch.get("attract"), "attract")
        out["attract"]["enabled"] = a.boolean("enabled", default=out["attract"]["enabled"])
        out["attract"]["text"] = a.text("text", max_len=80, default=out["attract"]["text"])
        c.merge(a)
    if "tiles" in patch:
        out["tiles"] = _normalize_tiles(conn, patch.get("tiles"), c, "tiles", 1, set())
    v.merge(c)
    return out


def touch_content_ids(config: dict) -> set[int]:
    """Alle Inhalts-IDs eines Touch-Menüs (Kachelbilder, Aktionen, Untermenüs)."""
    ids: set[int] = set()

    def walk(tiles):
        for t in tiles or []:
            if not isinstance(t, dict):
                continue
            if is_int(t.get("image_content_id")):
                ids.add(t["image_content_id"])
            a = t.get("action") or {}
            if is_int(a.get("content_id")):
                ids.add(a["content_id"])
            for cid in a.get("content_ids") or []:
                if is_int(cid):
                    ids.add(cid)
            if a.get("type") == "submenu":
                walk(a.get("tiles"))
    walk(config.get("tiles"))
    return ids


# --------------------------------------------------------- Stelen-Einstellungen

def normalize_stele_settings(base, patch, v: Validator) -> dict:
    out = merge_defaults(STELE_SETTINGS, base)
    if patch is None:
        return out
    if not isinstance(patch, dict):
        v.error("settings", "Bitte ein Objekt angeben.")
        return out
    s = Validator(patch, prefix="settings.")
    out["volume"] = s.number("volume", min_value=0, max_value=1, default=out["volume"])
    out["touch_enabled"] = s.boolean("touch_enabled", default=out["touch_enabled"])
    out["show_cursor"] = s.boolean("show_cursor", default=out["show_cursor"])
    out["daily_reload"] = s.time("daily_reload", allow_empty=True, default=out["daily_reload"])
    if "night_mode" in patch:
        n = _sub(s, patch.get("night_mode"), "night_mode")
        nm = out["night_mode"]
        nm["enabled"] = n.boolean("enabled", default=nm["enabled"])
        nm["start"] = n.time("start", default=nm["start"])
        nm["end"] = n.time("end", default=nm["end"])
        if nm["start"] == nm["end"] and nm["enabled"]:
            n.error("end", "Ende und Beginn des Nachtmodus dürfen nicht gleich sein.")
        s.merge(n)
    v.merge(s)
    return out
