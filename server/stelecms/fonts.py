"""Schriften (SPEC §5.5): mitgelieferte Schlüssel aus web/shared/fonts.js und hochgeladene (`custom-<id>`).

Verweise stehen in Design (`theme.font`, `theme.heading_font`) und Info-Folie (`style.body_font`,
`style.heading_font`); das Manifest liefert für hochgeladene Schriften `fonts: {key: {url, weight, name}}`.
"""
from __future__ import annotations

import re
import secrets

from . import db as dbm
from .config import WEB_DIR

FONT_FIELDS = ("font", "heading_font", "body_font")
FONT_MAX_BYTES = 8 * 1024 * 1024
FORMATS = {b"wOF2": "woff2", b"wOFF": "woff", b"\x00\x01\x00\x00": "ttf", b"true": "ttf", b"OTTO": "otf"}
_CUSTOM_RE = re.compile(r"^custom-(\d{1,9})$")
_BUILTIN_CACHE: tuple[str, ...] | None = None


def builtin_keys() -> tuple[str, ...]:
    """Schlüssel der mitgelieferten Schriften (BUILTIN_FONTS in web/shared/fonts.js)."""
    global _BUILTIN_CACHE
    if _BUILTIN_CACHE is None:
        keys: list[str] = []
        try:
            src = (WEB_DIR / "shared" / "fonts.js").read_text(encoding="utf-8")
            m = re.search(r"BUILTIN_FONTS\s*=\s*Object\.freeze\(\[(.*?)\]\);", src, re.S)
            if m:
                keys = re.findall(r"key:\s*'([a-z0-9-]+)'", m.group(1))
        except OSError:
            keys = []
        _BUILTIN_CACHE = tuple(keys) or ("sans", "serif", "condensed")
    return _BUILTIN_CACHE


def custom_key(fid: int) -> str:
    return f"custom-{fid}"


def custom_id(key) -> int | None:
    m = _CUSTOM_RE.match(key) if isinstance(key, str) else None
    return int(m.group(1)) if m else None


def detect_format(head: bytes) -> str | None:
    return FORMATS.get(head[:4])


def new_uid(conn) -> str:
    while True:
        uid = secrets.token_hex(8)
        if dbm.scalar(conn, "SELECT 1 FROM contents WHERE uid = ? UNION SELECT 1 FROM fonts WHERE uid = ?",
                      (uid, uid)) is None:
            return uid


def font_url(r) -> str:
    return f"/media/{r['uid']}/{r['file_name']}"


def font_refs(obj) -> set[str]:
    """Alle Schlüssel hochgeladener Schriften in Design-/Folien-Strukturen (rekursiv)."""
    found: set[str] = set()

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in FONT_FIELDS and custom_id(v) is not None:
                    found.add(v)
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(obj)
    return found


def fonts_map(conn, keys) -> dict:
    """{key: {url, weight, name}} für vorhandene hochgeladene Schriften; gelöschte fallen weg."""
    ids = sorted({i for i in (custom_id(k) for k in keys) if i is not None})
    if not ids:
        return {}
    marks = ",".join("?" * len(ids))
    rows = dbm.rows(conn, f"SELECT * FROM fonts WHERE id IN ({marks})", ids)
    return {custom_key(r["id"]): {"url": font_url(r), "weight": r["weight"],
                                  "name": r["name"]} for r in rows}


def usages(conn, fid: int) -> list[dict]:
    """Designs, Info-Folien und veröffentlichte Stände, die die Schrift verwenden."""
    pattern = f'%"{custom_key(fid)}"%'
    out = [{"type": "design", "id": r["id"], "name": r["name"], "published": False}
           for r in dbm.rows(conn, "SELECT id, name FROM designs WHERE config LIKE ? ORDER BY name", (pattern,))]
    out += [{"type": "content", "id": r["id"], "name": r["title"], "published": False}
            for r in dbm.rows(conn, "SELECT id, title FROM contents WHERE type = 'text' AND data LIKE ? "
                                    "ORDER BY title", (pattern,))]
    out += [{"type": "presentation", "id": r["id"], "name": r["name"], "published": True}
            for r in dbm.rows(conn, "SELECT id, name FROM presentations WHERE published_snapshot LIKE ? "
                                    "ORDER BY name", (pattern,))]
    return out
