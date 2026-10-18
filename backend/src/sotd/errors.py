"""JSON error responses.

Every error leaves the API as ``{"error": {"code", "message", "fields"?, ...details}}``
Application code raises :class:`ApiError`; the handlers registered
by :func:`register_error_handlers` translate framework exceptions (unknown routes, CSRF
failures, rate limits, oversized bodies) and turn anything unexpected into a 500 that
carries the request id and is logged once with its traceback.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, Final

from flask import Flask, Response, jsonify
from flask_limiter import RateLimitExceeded
from flask_wtf.csrf import CSRFError
from werkzeug.exceptions import HTTPException, InternalServerError

from sotd.logging import get_request_id

logger = logging.getLogger(__name__)

VALIDATION_ERROR: Final = "validation_error"

#: Error codes and default messages for framework-raised HTTP errors.
_HTTP_ERRORS: Final[Mapping[int, tuple[str, str]]] = {
    400: ("bad_request", "The request could not be understood."),
    401: ("unauthorized", "Log in to continue."),
    403: ("forbidden", "You don't have access to this."),
    404: ("not_found", "Not found."),
    405: ("method_not_allowed", "Method not allowed."),
    413: ("payload_too_large", "The request body is too large."),
    415: ("unsupported_media_type", "Unsupported content type."),
    429: ("rate_limited", "Too many requests. Please try again later."),
    500: ("internal_error", "Something went wrong. Please try again."),
    503: ("service_unavailable", "The service is unavailable. Please try again later."),
}

# Werkzeug adds these to HTTPException responses; JSON responses set their own.
_DROPPED_EXCEPTION_HEADERS: Final = frozenset({"content-type", "content-length"})


class ApiError(Exception):
    """An error that maps directly to a JSON error response.

    Args:
        status: HTTP status code.
        code: Stable, machine-readable error code.
        message: Human-readable message that is safe to show to the user.
        fields: Per-field messages keyed by dotted path into the request body (used with
            ``validation_error``).
        **details: Extra keys added to the error object, e.g. ``existing_entry_id``.
    """

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        fields: Mapping[str, str] | None = None,
        **details: Any,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = dict(fields) if fields is not None else None
        self.details = details

    def to_dict(self) -> dict[str, Any]:
        """Return the response body for this error."""
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.fields is not None:
            error["fields"] = self.fields
        error.update(self.details)
        return {"error": error}


def validation_error(fields: Mapping[str, str]) -> ApiError:
    """Build a ``422 validation_error`` with per-field messages.

    Args:
        fields: Messages keyed by dotted path into the request body.
    """
    return ApiError(422, VALIDATION_ERROR, "Some fields are invalid.", fields=fields)


def error_response(error: ApiError, headers: Mapping[str, str] | None = None) -> Response:
    """Render ``error`` as a JSON response.

    Args:
        error: The error to render.
        headers: Extra response headers.
    """
    response = jsonify(error.to_dict())
    response.status_code = error.status
    if headers:
        response.headers.update(headers)
    return response


def register_error_handlers(app: Flask) -> None:
    """Register the JSON error handlers on ``app``."""
    app.register_error_handler(ApiError, _handle_api_error)
    app.register_error_handler(CSRFError, _handle_csrf_error)
    app.register_error_handler(RateLimitExceeded, _handle_rate_limited)
    app.register_error_handler(HTTPException, _handle_http_exception)
    app.register_error_handler(Exception, _handle_unexpected_error)


def _handle_api_error(error: ApiError) -> Response:
    return error_response(error)


def _handle_csrf_error(_error: CSRFError) -> Response:
    return error_response(
        ApiError(403, "csrf_failed", "The CSRF token is missing or invalid. Refresh and retry.")
    )


def _handle_rate_limited(_error: RateLimitExceeded) -> Response:
    # Flask-Limiter's after_request hook adds Retry-After (RATELIMIT_HEADERS_ENABLED).
    code, message = _HTTP_ERRORS[429]
    return error_response(ApiError(429, code, message))


def _handle_http_exception(error: HTTPException) -> Response:
    if isinstance(error, InternalServerError):
        return _internal_error(error.original_exception or error)
    status = error.code or HTTPStatus.INTERNAL_SERVER_ERROR
    code, message = _HTTP_ERRORS.get(status, _generic_http_error(status))
    headers = {
        name: value
        for name, value in error.get_headers()
        if name.lower() not in _DROPPED_EXCEPTION_HEADERS
    }
    return error_response(ApiError(status, code, message), headers=headers)


def _handle_unexpected_error(error: Exception) -> Response:
    return _internal_error(error)


def _internal_error(error: BaseException) -> Response:
    logger.error("Unhandled exception", exc_info=error)
    code, message = _HTTP_ERRORS[500]
    return error_response(ApiError(500, code, message, request_id=get_request_id()))


def _generic_http_error(status: int) -> tuple[str, str]:
    try:
        known = HTTPStatus(status)
    except ValueError:
        return "http_error", "The request failed."
    return known.name.lower(), f"{known.phrase}."
