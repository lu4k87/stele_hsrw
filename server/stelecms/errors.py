"""ApiError und JSON-Fehlerbehandlung (SPEC §7.1)."""
from __future__ import annotations

import logging

from flask import jsonify, request
from werkzeug.exceptions import HTTPException

log = logging.getLogger("stelecms")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, fields: dict | None = None,
                 details: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields or {}
        self.details = details or {}

    def to_dict(self) -> dict:
        err = {"code": self.code, "message": self.message}
        if self.fields:
            err["fields"] = self.fields
        if self.details:
            err["details"] = self.details
        return {"error": err}


# ------------------------------------------------------------- Kurzformen

def not_found(message: str = "Der Eintrag wurde nicht gefunden. Möglicherweise wurde er gelöscht.") -> ApiError:
    return ApiError(404, "not_found", message)


def forbidden(message: str = "Für diese Aktion fehlt die Berechtigung.") -> ApiError:
    return ApiError(403, "forbidden", message)


def conflict(message: str, code: str = "conflict", details: dict | None = None) -> ApiError:
    return ApiError(409, code, message, details=details)


def validation(fields: dict, message: str | None = None) -> ApiError:
    msg = message or "Bitte die markierten Eingaben prüfen."
    return ApiError(422, "validation_error", msg, fields=fields)


def unauthenticated(message: str = "Bitte anmelden.") -> ApiError:
    return ApiError(401, "unauthenticated", message)


# -------------------------------------------------------------- Handler

_HTTP_CODES = {
    400: ("bad_request", "Die Anfrage ist ungültig."),
    401: ("unauthenticated", "Bitte anmelden."),
    403: ("forbidden", "Für diese Aktion fehlt die Berechtigung."),
    404: ("not_found", "Diese Adresse gibt es nicht."),
    405: ("method_not_allowed", "Diese Aktion ist für diese Adresse nicht erlaubt."),
    410: ("expired", "Der Eintrag ist abgelaufen."),
    413: ("too_large", "Die Datei oder Anfrage ist zu groß."),
    415: ("unsupported_media", "Dieses Format wird nicht unterstützt."),
    429: ("rate_limited", "Zu viele Anfragen. Bitte kurz warten und erneut versuchen."),
}


def _wants_json() -> bool:
    p = request.path
    return p.startswith("/api/") or p == "/api" or p.startswith("/media/")


def register_error_handlers(app) -> None:
    @app.errorhandler(ApiError)
    def _api_error(err: ApiError):
        resp = jsonify(err.to_dict())
        resp.status_code = err.status
        if err.code == "rate_limited" and err.details.get("retry_after_s"):
            resp.headers["Retry-After"] = str(int(err.details["retry_after_s"]))
        return resp

    @app.errorhandler(HTTPException)
    def _http_error(err: HTTPException):
        if not _wants_json():
            return err
        code, msg = _HTTP_CODES.get(err.code, ("error", err.description or "Fehler"))
        resp = jsonify({"error": {"code": code, "message": msg}})
        resp.status_code = err.code or 500
        if err.code == 405 and getattr(err, "valid_methods", None):
            resp.headers["Allow"] = ", ".join(err.valid_methods)
        return resp

    @app.errorhandler(Exception)
    def _unhandled(err: Exception):
        log.exception("Unbehandelter Fehler bei %s %s", request.method, request.path)
        if not _wants_json():
            return "Interner Serverfehler", 500
        resp = jsonify({"error": {"code": "server_error",
                                  "message": "Interner Fehler auf dem Server. Bitte erneut versuchen; "
                                             "bleibt der Fehler, das Protokoll des Servers prüfen."}})
        resp.status_code = 500
        return resp
