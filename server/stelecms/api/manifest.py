"""Manifest-Antwort mit ETag und 304 (SPEC §8)."""
from __future__ import annotations

from flask import jsonify, make_response, request


def _etag_matches(version: str) -> bool:
    raw = request.headers.get("If-None-Match") or ""
    if not raw:
        return False
    for part in raw.split(","):
        tag = part.strip()
        if tag.startswith("W/"):
            tag = tag[2:]
        if tag == "*" or tag.strip('"') == version:
            return True
    return False


def manifest_response(manifest: dict):
    version = manifest["version"]
    if _etag_matches(version):
        resp = make_response("", 304)
    else:
        resp = jsonify(manifest)
    resp.headers["ETag"] = f'"{version}"'
    resp.headers["Cache-Control"] = "no-cache"
    return resp
