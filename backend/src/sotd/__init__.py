"""Song of the Day: a private, anti-social music journal (Flask API)."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Final

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from sotd import cli, security
from sotd import logging as request_logging
from sotd import models as models  # Re-exported; importing it registers every table.
from sotd.api import register_blueprints
from sotd.api.utils import apply_api_headers, enforce_body_policy
from sotd.config import load_config
from sotd.errors import register_error_handlers
from sotd.extensions import csrf, db, limiter, migrate
from sotd.services import sessions
from sotd.theme import get_theme_options

#: Components with app-level setup, run in order once the extensions are bound. New
#: components add their ``init_app`` here.
COMPONENT_INITIALIZERS: Final[tuple[Callable[[Flask], None], ...]] = (
    security.init_app,
    sessions.init_app,
    register_error_handlers,
    register_blueprints,
    cli.init_app,
)


def create_app(config_name: str | None = None, overrides: Mapping[str, Any] | None = None) -> Flask:
    """Build the Flask application.

    Args:
        config_name: ``development``, ``testing`` or ``production``; defaults to
            ``APP_ENV``.
        overrides: Settings applied on top of the environment before validation (used by
            tests).

    Returns:
        The configured application.

    Raises:
        RuntimeError: If the configuration is invalid (every problem is listed).
        sotd.theme.ThemeOptionsError: If the theme options file is missing or invalid.
    """
    config = load_config(config_name)
    for key, value in (overrides or {}).items():
        setattr(config, key, value)
    config.validate()
    get_theme_options()

    app = Flask(__name__)
    app.config.from_object(config)

    proxies: int = app.config["TRUSTED_PROXY_COUNT"]
    if proxies > 0:
        app.wsgi_app = ProxyFix(  # type: ignore[method-assign]
            app.wsgi_app, x_for=proxies, x_proto=proxies, x_host=proxies
        )

    # before_request hooks run in registration order: request ids first, then the API
    # body policy (415 and per-view body limits) before CSRFProtect parses any form
    # body, then CSRF and rate limits.
    request_logging.init_app(app)
    app.before_request(enforce_body_policy)
    db.init_app(app)
    migrate.init_app(app, db)
    csrf.init_app(app)
    limiter.init_app(app)
    for initialize in COMPONENT_INITIALIZERS:
        initialize(app)
    app.after_request(apply_api_headers)
    return app
