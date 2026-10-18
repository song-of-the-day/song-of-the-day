"""Structured logging and request ids.

``configure_logging`` installs one stdout handler on the root logger that writes either
one JSON object per line (``LOG_FORMAT=json``) or a readable text line. Every record
carries the request context (``request_id``, ``user_id``, ``method``, ``path``) when one
exists, and each request ends with an access line that adds ``status`` and
``duration_ms``. Request bodies, headers, cookies and query strings are never logged.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time
import uuid
from datetime import UTC, datetime
from typing import Final, TextIO

from flask import Flask, Response, g, has_request_context, request

REQUEST_ID_HEADER: Final = "X-Request-ID"

_REQUEST_ID_PATTERN: Final = re.compile(r"[A-Za-z0-9-]{1,64}")
_CONTEXT_FIELDS: Final = ("request_id", "user_id", "method", "path")
_ACCESS_FIELDS: Final = ("status", "duration_ms")
_TEXT_FORMAT: Final = "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"

access_logger = logging.getLogger("sotd.access")


def is_valid_request_id(value: str) -> bool:
    """Return whether an incoming ``X-Request-ID`` value may be reused as-is."""
    return _REQUEST_ID_PATTERN.fullmatch(value) is not None


def get_request_id() -> str:
    """Return the current request's id, assigning one on first use.

    The incoming ``X-Request-ID`` header is reused when it matches
    ``^[A-Za-z0-9-]{1,64}$`` (nginx sets it); otherwise a fresh uuid4 hex is generated.
    Must be called within a request context.
    """
    request_id: str | None = g.get("request_id")
    if request_id is None:
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming if is_valid_request_id(incoming) else uuid.uuid4().hex
        g.request_id = request_id
    return request_id


def bind_user_id(user_id: int | None) -> None:
    """Attach the authenticated user's id to log records for the rest of the request."""
    g.log_user_id = user_id


class RequestContextFilter(logging.Filter):
    """Adds the request context fields to every record (``None`` outside a request)."""

    def filter(self, record: logging.LogRecord) -> bool:
        """Populate the context attributes; never drops a record."""
        if has_request_context():
            record.request_id = get_request_id()
            record.user_id = g.get("log_user_id")
            record.method = request.method
            record.path = request.path
        else:
            for name in _CONTEXT_FIELDS:
                if not hasattr(record, name):
                    setattr(record, name, None)
        return True


class JsonFormatter(logging.Formatter):
    """Formats a record as a single-line JSON object with a stable set of keys."""

    def format(self, record: logging.LogRecord) -> str:
        """Return the JSON line for ``record``."""
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for name in (*_CONTEXT_FIELDS, *_ACCESS_FIELDS):
            payload[name] = getattr(record, name, None)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


class _StdoutHandler(logging.StreamHandler[TextIO]):
    """Writes to whatever ``sys.stdout`` is at emit time.

    Resolving the stream per record keeps output correct when a test runner or process
    manager swaps ``sys.stdout`` after logging was configured.
    """

    def emit(self, record: logging.LogRecord) -> None:
        self.stream = sys.stdout
        super().emit(record)


def configure_logging(level: str, log_format: str) -> None:
    """Install (or replace) the application's stdout handler on the root logger.

    Handlers added by other code, such as pytest's log capture, are left alone, and
    calling this again replaces the previous sotd handler instead of adding another.

    Args:
        level: A :mod:`logging` level name such as ``"INFO"``.
        log_format: ``"json"`` or ``"text"``.
    """
    root = logging.getLogger()
    for existing in [h for h in root.handlers if isinstance(h, _StdoutHandler)]:
        root.removeHandler(existing)
    handler = _StdoutHandler()
    formatter = JsonFormatter() if log_format == "json" else logging.Formatter(_TEXT_FORMAT)
    handler.setFormatter(formatter)
    handler.addFilter(RequestContextFilter())
    root.addHandler(handler)
    root.setLevel(level)
    # httpx logs every request URL at INFO; URLs can carry query-string secrets
    # (for example YOUTUBE_API_KEY), so only warnings and above are emitted.
    logging.getLogger("httpx").setLevel(logging.WARNING)


def init_app(app: Flask) -> None:
    """Configure logging and register the request-id and access-log hooks.

    Call this before any other extension so that its ``before_request`` hook runs first
    (and its ``after_request`` hook last), letting even early failures carry a request id.
    """
    configure_logging(app.config["LOG_LEVEL"], app.config["LOG_FORMAT"])
    app.before_request(_start_request)
    app.after_request(_finish_request)


def _start_request() -> None:
    g.request_started = time.perf_counter()
    get_request_id()


def _finish_request(response: Response) -> Response:
    response.headers[REQUEST_ID_HEADER] = get_request_id()
    started: float = g.get("request_started", time.perf_counter())
    duration_ms = round((time.perf_counter() - started) * 1000, 1)
    access_logger.info(
        "%s %s %s %.1fms",
        request.method,
        request.path,
        response.status_code,
        duration_ms,
        extra={"status": response.status_code, "duration_ms": duration_ms},
    )
    return response
