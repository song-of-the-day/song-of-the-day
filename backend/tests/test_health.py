from __future__ import annotations

import logging

import pytest
from flask import Blueprint
from flask.testing import FlaskClient

from sotd.api.utils import json_response
from sotd.extensions import limiter
from tests.support import AppFactory

#: Nothing listens on port 1, so connecting fails immediately with "connection refused".
UNREACHABLE_DATABASE_URL = "postgresql+psycopg://sotd:hunter2@127.0.0.1:1/sotd"


def test_health_ok(client: FlaskClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Request-ID"]


def test_health_is_503_when_the_database_is_unreachable(
    app_factory: AppFactory, caplog: pytest.LogCaptureFixture
) -> None:
    with (
        app_factory(SQLALCHEMY_DATABASE_URI=UNREACHABLE_DATABASE_URL) as broken_app,
        caplog.at_level(logging.WARNING, logger="sotd.api.health"),
    ):
        response = broken_app.test_client().get("/api/health")
    assert response.status_code == 503
    assert response.get_json() == {
        "error": {
            "code": "service_unavailable",
            "message": "The service is unavailable. Please try again later.",
        }
    }
    assert response.headers["Cache-Control"] == "no-store"
    warnings = [r for r in caplog.records if r.name == "sotd.api.health"]
    assert len(warnings) == 1
    assert "OperationalError" in warnings[0].getMessage()
    assert "hunter2" not in caplog.text


def test_health_is_not_rate_limited(app_factory: AppFactory) -> None:
    probe = Blueprint("test_health_probe", __name__)
    probe.add_url_rule("/api/_test/probe", "probe", lambda: json_response({"ok": True}))
    try:
        with app_factory(RATE_LIMITS_ENABLED=True, RATELIMIT_DEFAULT="1/minute") as limited_app:
            limited_app.register_blueprint(probe)
            client = limited_app.test_client()
            health_statuses = [client.get("/api/health").status_code for _ in range(3)]
            probe_statuses = [client.get("/api/_test/probe").status_code for _ in range(2)]
    finally:
        # Default limits live on the process-wide limiter; don't leak them to other apps.
        limiter.limit_manager.set_default_limits([])
    assert health_statuses == [200, 200, 200]
    assert probe_statuses == [200, 429]
