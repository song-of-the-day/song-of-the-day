"""Flask extension singletons, bound to an application in ``create_app()``.

Behavior comes from the application config (``sotd.config``): cookie names and flags,
CSRF settings and every ``RATELIMIT_*`` option (key prefix, headers, swallowed storage
errors and the in-memory fallback). Rate limiting is switched per app by
``RATE_LIMITS_ENABLED``.
"""

from __future__ import annotations

from typing import Final, NoReturn

from flask import current_app
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_login import LoginManager
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

from sotd.errors import ApiError

#: Deterministic constraint and index names, so migrations can reference them.
NAMING_CONVENTION: Final = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base of every model; its metadata carries the naming convention.

    Models subclass this class directly (rather than ``db.Model``) so that they stay
    fully typed; Flask-SQLAlchemy shares the same registry and metadata.
    """

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


db = SQLAlchemy(model_class=Base)
migrate = Migrate()
csrf = CSRFProtect()
limiter = Limiter(key_func=get_remote_address)

#: Flask-Login. ``sotd.services.sessions.init_app`` binds it to the app together with
#: the user loader and the remember-cookie hooks.
login_manager = LoginManager()


def _unauthorized() -> NoReturn:
    raise ApiError(401, "unauthorized", "Log in to continue.")


login_manager.unauthorized_handler(_unauthorized)


@limiter.request_filter
def _rate_limits_disabled() -> bool:
    """Exempt every request when the current app has rate limits switched off.

    Flask-Limiter's own enabled flag lives on this process-wide object, so it is always
    on and the per-app ``RATE_LIMITS_ENABLED`` setting (environment variable
    ``RATELIMIT_ENABLED``) is enforced here. This keeps apps that share a process, as in
    the test suite, from changing each other's behavior.
    """
    return not current_app.config["RATE_LIMITS_ENABLED"]
