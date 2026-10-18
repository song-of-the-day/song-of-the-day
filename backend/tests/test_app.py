from __future__ import annotations

import importlib
import os
import subprocess
import sys
from pathlib import Path

import pytest
from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from sotd import create_app
from sotd.errors import ApiError
from sotd.extensions import db, login_manager
from sotd.logging import configure_logging
from sotd.theme import ThemeOptionsError, get_theme_options
from tests.support import VALID_PRODUCTION_ENV, AppFactory


def test_testing_app_configuration(app: Flask) -> None:
    assert app.config["APP_ENV"] == "testing"
    assert app.testing is True
    assert app.config["MAX_CONTENT_LENGTH"] == 256 * 1024
    assert app.config["SESSION_COOKIE_NAME"] == "sotd_session"
    assert not isinstance(app.wsgi_app, ProxyFix)


def test_blueprints_are_mounted_under_api(app: Flask) -> None:
    assert set(app.blueprints) == {
        "health",
        "auth",
        "account",
        "profile",
        "entries",
        "annotations",
        "uploads",
        "users",
        "songs",
    }
    rules = {rule.rule: rule.endpoint for rule in app.url_map.iter_rules()}
    assert rules["/api/health"] == "health.health"
    assert rules["/api/users/<username>"] == "users.get_profile"


def test_cli_group_is_registered(app: Flask) -> None:
    assert "sotd" in app.cli.commands


def test_overrides_are_validated() -> None:
    with pytest.raises(RuntimeError, match="LOG_FORMAT must be one of"):
        create_app("testing", {"LOG_FORMAT": "xml"})


def test_proxy_fix_uses_trusted_proxy_count(app_factory: AppFactory) -> None:
    with app_factory(TRUSTED_PROXY_COUNT=2) as proxied:
        assert isinstance(proxied.wsgi_app, ProxyFix)
        assert (proxied.wsgi_app.x_for, proxied.wsgi_app.x_proto, proxied.wsgi_app.x_host) == (
            2,
            2,
            2,
        )
        response = proxied.test_client().get(
            "/api/health",
            headers={"X-Forwarded-For": "203.0.113.9, 10.0.0.2", "X-Forwarded-Proto": "https"},
        )
        assert response.status_code == 200


def test_production_app_boots_from_environment() -> None:
    # A separate interpreter keeps the production app's process-wide state (logging, the
    # rate limiter's Redis storage) out of this test session.
    script = (
        "from sotd import create_app; app = create_app(); "
        "print(app.config['SESSION_COOKIE_NAME'], app.debug, app.testing, "
        "type(app.wsgi_app).__name__)"
    )
    env = {**os.environ, **VALID_PRODUCTION_ENV, "APP_ENV": "production", "LOG_LEVEL": "ERROR"}
    result = subprocess.run(  # noqa: S603 (fixed argv, no shell)
        [sys.executable, "-c", script],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["__Host-sotd_session", "False", "False", "ProxyFix"]


def test_invalid_production_environment_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "")
    with pytest.raises(RuntimeError, match="Invalid production configuration"):
        create_app("production")


def test_missing_theme_options_fail_fast(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("THEME_OPTIONS_PATH", str(tmp_path / "missing.json"))
    get_theme_options.cache_clear()
    try:
        with pytest.raises(ThemeOptionsError, match="Cannot load theme options"):
            create_app("testing")
    finally:
        monkeypatch.delenv("THEME_OPTIONS_PATH")
        get_theme_options.cache_clear()


def test_wsgi_module_exposes_an_app(
    monkeypatch: pytest.MonkeyPatch, app: Flask, database_url: str
) -> None:
    monkeypatch.setenv("APP_ENV", "testing")
    monkeypatch.setenv("TEST_DATABASE_URL", database_url)
    monkeypatch.delitem(sys.modules, "sotd.wsgi", raising=False)
    wsgi = importlib.import_module("sotd.wsgi")
    try:
        assert isinstance(wsgi.app, Flask)
        assert wsgi.app is not app
        assert wsgi.app.config["APP_ENV"] == "testing"
        assert wsgi.app.test_client().get("/api/health").status_code == 200
    finally:
        with wsgi.app.app_context():
            db.engine.dispose()
        configure_logging(app.config["LOG_LEVEL"], app.config["LOG_FORMAT"])


def test_unauthorized_handler_raises_a_json_401(app: Flask) -> None:
    with app.test_request_context("/api/entries"), pytest.raises(ApiError) as excinfo:
        login_manager.unauthorized()
    assert excinfo.value.to_dict() == {
        "error": {"code": "unauthorized", "message": "Log in to continue."}
    }
    assert excinfo.value.status == 401
