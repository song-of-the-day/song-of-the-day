from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterator
from typing import Any

import pytest
from flask import Blueprint, Flask, Response
from flask.testing import FlaskClient
from sqlalchemy import text

from sotd.api.utils import json_response
from sotd.extensions import csrf, db
from sotd.logging import (
    JsonFormatter,
    RequestContextFilter,
    bind_user_id,
    configure_logging,
    get_request_id,
    is_valid_request_id,
)
from tests.support import AppFactory

GENERATED_ID = re.compile(r"[0-9a-f]{32}")
SECRET_VALUES = ("hunter2-password", "cookie-secret", "csrf-secret", "reset-secret")
#: A value bound into a failing SQL statement, standing in for request data.
SQL_PARAMETER = "a note the user wrote"

probe_bp = Blueprint("test_logging", __name__, url_prefix="/api/_test/logging")
csrf.exempt(probe_bp)


@probe_bp.post("/login")
def fake_login() -> Response:
    bind_user_id(7)
    logging.getLogger("sotd.test").info("user logged in")
    return json_response({"ok": True})


@probe_bp.get("/fail")
def fail() -> Response:
    try:
        raise ValueError("boom")
    except ValueError:
        logging.getLogger("sotd.test").exception("handled failure")
    return json_response({"ok": False})


@probe_bp.get("/db-error")
def db_error() -> Response:
    db.session.execute(
        text("SELECT 1 / 0 WHERE CAST(:note AS text) <> ''"), {"note": SQL_PARAMETER}
    )
    return json_response({"ok": True})


@pytest.fixture
def json_app(app: Flask, app_factory: AppFactory) -> Iterator[Flask]:
    try:
        with app_factory(LOG_FORMAT="json") as test_app:
            test_app.register_blueprint(probe_bp)
            yield test_app
    finally:
        # Logging is process-wide: restore what the session app configured.
        configure_logging(app.config["LOG_LEVEL"], app.config["LOG_FORMAT"])


def log_lines(output: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in output.splitlines() if line.startswith("{")]


# --- Request ids ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "value", ["abc", "A-1-b", "a" * 64, "3f2c9e5a-1b7d-4c1e-9f57-0b6f7d2a9c11"]
)
def test_valid_request_ids(value: str) -> None:
    assert is_valid_request_id(value)


@pytest.mark.parametrize("value", ["", "a" * 65, "has space", "under_score", "semi;colon", "é"])
def test_invalid_request_ids(value: str) -> None:
    assert not is_valid_request_id(value)


def test_incoming_request_id_is_echoed(client: FlaskClient) -> None:
    response = client.get("/api/health", headers={"X-Request-ID": "nginx-abc-123"})
    assert response.headers["X-Request-ID"] == "nginx-abc-123"


@pytest.mark.parametrize("incoming", ["a" * 65, "bad id", "x\ty", "<script>"])
def test_invalid_request_id_is_replaced(client: FlaskClient, incoming: str) -> None:
    response = client.get("/api/health", headers={"X-Request-ID": incoming})
    assert GENERATED_ID.fullmatch(response.headers["X-Request-ID"])


def test_request_id_is_generated_when_missing(client: FlaskClient) -> None:
    first = client.get("/api/health").headers["X-Request-ID"]
    second = client.get("/api/health").headers["X-Request-ID"]
    assert GENERATED_ID.fullmatch(first)
    assert first != second


def test_error_responses_carry_a_request_id(client: FlaskClient) -> None:
    response = client.get("/api/missing", headers={"X-Request-ID": "trace-404"})
    assert response.status_code == 404
    assert response.headers["X-Request-ID"] == "trace-404"


def test_get_request_id_is_stable_within_a_request(app: Flask) -> None:
    with app.test_request_context(headers={"X-Request-ID": "bad id"}):
        first = get_request_id()
        assert get_request_id() == first
        assert GENERATED_ID.fullmatch(first)


# --- JSON format ------------------------------------------------------------------------


def test_access_line_has_every_field(json_app: Flask, capsys: pytest.CaptureFixture[str]) -> None:
    capsys.readouterr()
    json_app.test_client().get("/api/health?x=1", headers={"X-Request-ID": "req-1"})
    lines = log_lines(capsys.readouterr().out)
    access = [line for line in lines if line["logger"] == "sotd.access"]
    assert len(access) == 1
    line = access[0]
    assert set(line) == {
        "ts",
        "level",
        "logger",
        "msg",
        "request_id",
        "user_id",
        "method",
        "path",
        "status",
        "duration_ms",
    }
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", line["ts"])
    assert line["level"] == "INFO"
    assert line["request_id"] == "req-1"
    assert line["user_id"] is None
    assert line["method"] == "GET"
    assert line["path"] == "/api/health"
    assert line["status"] == 200
    assert isinstance(line["duration_ms"], float)
    assert line["duration_ms"] >= 0
    assert "x=1" not in line["msg"]


def test_records_inside_a_request_carry_the_context(
    json_app: Flask, capsys: pytest.CaptureFixture[str]
) -> None:
    capsys.readouterr()
    json_app.test_client().post(
        "/api/_test/logging/login", json={"password": "x"}, headers={"X-Request-ID": "req-2"}
    )
    lines = log_lines(capsys.readouterr().out)
    app_line = next(line for line in lines if line["logger"] == "sotd.test")
    assert app_line["msg"] == "user logged in"
    assert app_line["request_id"] == "req-2"
    assert app_line["user_id"] == 7
    assert app_line["path"] == "/api/_test/logging/login"
    assert app_line["status"] is None
    access = next(line for line in lines if line["logger"] == "sotd.access")
    assert access["user_id"] == 7


def test_exceptions_are_included(json_app: Flask, capsys: pytest.CaptureFixture[str]) -> None:
    capsys.readouterr()
    json_app.test_client().get("/api/_test/logging/fail")
    lines = log_lines(capsys.readouterr().out)
    failure = next(line for line in lines if line["msg"] == "handled failure")
    assert failure["level"] == "ERROR"
    assert "ValueError: boom" in failure["exc"]


def test_secrets_are_never_logged(json_app: Flask, capsys: pytest.CaptureFixture[str]) -> None:
    capsys.readouterr()
    client = json_app.test_client()
    client.set_cookie("sotd_session", "cookie-secret")
    client.post(
        "/api/_test/logging/login?token=reset-secret",
        json={"email": "ada@example.com", "password": "hunter2-password"},
        headers={"X-CSRFToken": "csrf-secret"},
    )
    output = capsys.readouterr().out
    assert log_lines(output)
    for secret in SECRET_VALUES:
        assert secret not in output


def test_database_errors_are_logged_without_their_sql_parameters(
    json_app: Flask, capsys: pytest.CaptureFixture[str]
) -> None:
    capsys.readouterr()
    response = json_app.test_client().get("/api/_test/logging/db-error")
    assert response.status_code == 500
    output = capsys.readouterr().out
    failure = next(line for line in log_lines(output) if line["msg"] == "Unhandled exception")
    assert "division by zero" in failure["exc"]
    assert SQL_PARAMETER not in output


def test_json_formatter_outside_a_request_and_with_stack_info() -> None:
    record = logging.LogRecord("sotd.x", logging.WARNING, __file__, 1, "hello %s", ("you",), None)
    record.stack_info = "Stack (most recent call last):\n  here"
    RequestContextFilter().filter(record)
    payload = json.loads(JsonFormatter().format(record))
    assert payload["msg"] == "hello you"
    assert payload["level"] == "WARNING"
    assert payload["request_id"] is None
    assert payload["method"] is None
    assert "here" in payload["stack"]


def test_context_filter_keeps_fields_set_by_the_caller() -> None:
    record = logging.makeLogRecord({"name": "sotd.x", "msg": "m", "request_id": "from-worker"})
    assert RequestContextFilter().filter(record) is True
    assert vars(record)["request_id"] == "from-worker"
    assert vars(record)["user_id"] is None


# --- Text format and handler management -------------------------------------------------


def test_text_format_includes_the_request_id(
    client: FlaskClient, capsys: pytest.CaptureFixture[str]
) -> None:
    capsys.readouterr()
    client.get("/api/health", headers={"X-Request-ID": "text-req"})
    output = capsys.readouterr().out
    assert "INFO sotd.access [text-req] GET /api/health 200" in output


def test_configure_logging_replaces_its_own_handler(app: Flask) -> None:
    root = logging.getLogger()
    before = list(root.handlers)
    configure_logging("WARNING", "text")
    try:
        assert len(root.handlers) == len(before)
        assert root.level == logging.WARNING
    finally:
        configure_logging(app.config["LOG_LEVEL"], app.config["LOG_FORMAT"])
