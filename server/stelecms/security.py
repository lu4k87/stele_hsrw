"""Passwort-Hash, CSRF, Sicherheits-Header, Rate-Limit."""
from __future__ import annotations

import hmac
import secrets
import string
import threading
import time
from collections import deque

from flask import current_app, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from .errors import ApiError

# ------------------------------------------------------------ Passwörter

_DUMMY_HASH: dict[str, str] = {}


def hash_password(password: str) -> str:
    method = current_app.config.get("PASSWORD_HASH_METHOD", "scrypt")
    return generate_password_hash(password, method=method)


def check_password(pw_hash: str | None, password: str) -> bool:
    if not pw_hash:
        # Gleicher Rechenaufwand wie bei echten Konten (kein Hinweis, ob der Benutzer existiert)
        method = current_app.config.get("PASSWORD_HASH_METHOD", "scrypt")
        if method not in _DUMMY_HASH:
            _DUMMY_HASH[method] = generate_password_hash(secrets.token_hex(8), method=method)
        check_password_hash(_DUMMY_HASH[method], password or "")
        return False
    try:
        return check_password_hash(pw_hash, password or "")
    except (ValueError, TypeError):
        return False


_PW_ALPHABET = "".join(c for c in string.ascii_letters + string.digits if c not in "0OoIl1")


def generate_password(length: int = 12) -> str:
    """Zufallspasswort ohne leicht verwechselbare Zeichen, mit Ziffer und Groß-/Kleinbuchstaben."""
    while True:
        pw = "".join(secrets.choice(_PW_ALPHABET) for _ in range(length))
        if any(c.isdigit() for c in pw) and any(c.islower() for c in pw) and any(c.isupper() for c in pw):
            return pw


# ------------------------------------------------------------------ CSRF

CSRF_EXEMPT_PREFIXES = ("/api/player/", "/api/agent/")
CSRF_EXEMPT_PATHS = ("/api/auth/login", "/api/auth/dev-login")
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def csrf_required() -> bool:
    if request.method in SAFE_METHODS:
        return False
    path = request.path
    if not path.startswith("/api/"):
        return False
    if path in CSRF_EXEMPT_PATHS or path.startswith(CSRF_EXEMPT_PREFIXES):
        return False
    return True


def check_csrf() -> None:
    """Vergleicht den Header X-CSRF-Token mit dem Token der Sitzung (nur bei angemeldeter Sitzung).

    Ohne Sitzung meldet die Anmeldeprüfung 401 – die kommt fachlich zuerst.
    """
    if not csrf_required():
        return
    expected = session.get("csrf")
    if not expected:
        return
    sent = request.headers.get("X-CSRF-Token", "")
    if not sent or not hmac.compare_digest(str(sent), str(expected)):
        raise ApiError(403, "forbidden", "Sicherheitsprüfung fehlgeschlagen – Seite neu laden.")


# ------------------------------------------------------ Sicherheits-Header

CSP_ADMIN = ("default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
             "style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self' http: https:; "
             "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
CSP_PLAYER = ("default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
              "style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src *; "
              "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")


def apply_security_headers(resp):
    h = resp.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("Referrer-Policy", "same-origin")
    path = request.path
    if path.startswith("/media/"):
        # Mediendateien: nur Einbettung auf gleicher Herkunft
        h.setdefault("X-Frame-Options", "SAMEORIGIN")
        return resp
    h.setdefault("X-Frame-Options", "SAMEORIGIN")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if path.startswith("/player"):
        h.setdefault("Content-Security-Policy", CSP_PLAYER)
    else:
        h.setdefault("Content-Security-Policy", CSP_ADMIN)
    if path.startswith("/api/"):
        h.setdefault("Cache-Control", "no-store")
    return resp


# ------------------------------------------------------------ Rate-Limit

class RateLimiter:
    """Gleitendes Zeitfenster je Schlüssel (z. B. IP), threadsicher, nur im Speicher."""

    def __init__(self, max_hits: int, window_s: float):
        self.max_hits = max_hits
        self.window_s = window_s
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque:
        dq = self._hits.setdefault(key, deque())
        while dq and now - dq[0] > self.window_s:
            dq.popleft()
        return dq

    def blocked(self, key: str) -> float:
        """0 = erlaubt, sonst Sekunden bis zum nächsten erlaubten Versuch."""
        now = time.monotonic()
        with self._lock:
            dq = self._prune(key, now)
            if len(dq) >= self.max_hits:
                return max(1.0, self.window_s - (now - dq[0]))
            return 0.0

    def hit(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._prune(key, now).append(now)

    def check_and_hit(self, key: str) -> float:
        now = time.monotonic()
        with self._lock:
            dq = self._prune(key, now)
            if len(dq) >= self.max_hits:
                return max(1.0, self.window_s - (now - dq[0]))
            dq.append(now)
            return 0.0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def client_ip() -> str:
    return request.remote_addr or ""


def is_loopback(ip: str | None = None) -> bool:
    ip = ip if ip is not None else client_ip()
    if not ip:
        return False
    if ip.startswith("::ffff:"):
        ip = ip[7:]
    return ip == "::1" or ip.startswith("127.")
