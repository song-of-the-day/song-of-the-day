"""Application configuration, read from environment variables.

``load_config()`` picks :class:`DevelopmentConfig`, :class:`TestingConfig` or
:class:`ProductionConfig` from ``APP_ENV``. Each config reads its environment once, when
it is instantiated, and records values it cannot parse. ``Config.validate()`` (called by
``create_app()``) raises a single :class:`RuntimeError` listing every problem; the
production config adds its own deployment rules. The environment variables themselves
are documented in ``.env.example``.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from datetime import timedelta
from typing import Any, ClassVar, Final
from urllib.parse import urlsplit

DEFAULT_DATABASE_URL: Final = "postgresql+psycopg://sotd:sotd@localhost:5432/sotd"
DEFAULT_TEST_DATABASE_URL: Final = "postgresql+psycopg://sotd:sotd@localhost:5432/sotd_test"
DEFAULT_DEV_APP_BASE_URL: Final = "http://localhost:5173"

#: Request body limit for every JSON endpoint; the upload view raises it per request.
MAX_JSON_BODY_BYTES: Final = 256 * 1024
#: Minimum length of a production ``SECRET_KEY``.
MIN_SECRET_KEY_LENGTH: Final = 32

MAIL_BACKENDS: Final = frozenset({"smtp", "console", "memory"})
LOG_FORMATS: Final = frozenset({"json", "text"})
LOG_LEVELS: Final = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})

# Fallback signing keys exist only for local development and tests. They are long enough
# to pass the length rule, so the placeholder rule is what keeps them out of production.
_DEV_SECRET_KEY: Final = "sotd-development-only-secret-key-never-use-in-production"  # noqa: S105
_TEST_SECRET_KEY: Final = "sotd-testing-only-secret-key-never-use-in-production"  # noqa: S105

#: Values that must never be used as a production ``SECRET_KEY`` (compared case-insensitively).
KNOWN_PLACEHOLDER_SECRETS: Final = frozenset(
    {
        "change-me",
        "changeme",
        "change_me",
        "replace-me",
        "replaceme",
        "placeholder",
        "secret",
        "secret-key",
        "secret_key",
        "your-secret-key",
        "insecure",
        "development",
        "dev",
        "test",
        "testing",
        _DEV_SECRET_KEY,
        _TEST_SECRET_KEY,
    }
)

_TRUE_VALUES: Final = frozenset({"1", "true", "yes", "on"})
_FALSE_VALUES: Final = frozenset({"0", "false", "no", "off"})


def normalize_database_url(url: str) -> str:
    """Return ``url`` with a ``postgres://``/``postgresql://`` scheme mapped to psycopg 3.

    Hosting providers commonly hand out ``postgres://`` URLs, which SQLAlchemy would map
    to the wrong (or a missing) driver.

    Args:
        url: A database URL.

    Returns:
        The URL with the ``postgresql+psycopg://`` scheme, or ``url`` unchanged when it
        already names a driver or another database.
    """
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url.removeprefix(prefix)
    return url


def is_allowed_base_url(url: str) -> bool:
    """Return whether ``url`` is acceptable as the production ``APP_BASE_URL``.

    It must be ``https://<host>``; ``http://localhost[:port]`` is also accepted for local
    production-mode runs (such as the e2e stack).

    Args:
        url: The configured base URL.
    """
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:  # Malformed or out-of-range port.
        return False
    if port == 0:
        return False
    if parts.scheme == "https":
        return bool(parts.hostname)
    return parts.scheme == "http" and parts.hostname == "localhost"


def _engine_options() -> dict[str, Any]:
    return {
        "pool_pre_ping": True,
        "pool_size": 2,
        "max_overflow": 2,
        "pool_recycle": 1800,
        "connect_args": {"connect_timeout": 5, "options": "-c statement_timeout=15000"},
        # SQL parameters hold request data (notes, emails, password hashes); keep them
        # out of the text of database errors, which the 500 handler logs.
        "hide_parameters": True,
    }


class _EnvReader:
    """Typed accessors over an environment mapping that collect parse problems.

    Empty values are treated as unset, which matches how ``.env`` files and compose
    files commonly leave optional variables blank.
    """

    def __init__(self, environ: Mapping[str, str]) -> None:
        self._environ = environ
        self.problems: list[str] = []

    def is_set(self, name: str) -> bool:
        return bool(self._environ.get(name, "").strip())

    def get_str(self, name: str, default: str | None = None) -> str | None:
        value = self._environ.get(name, "").strip()
        return value or default

    def get_bool(self, name: str, default: bool) -> bool:
        raw = self.get_str(name)
        if raw is None:
            return default
        value = raw.lower()
        if value in _TRUE_VALUES:
            return True
        if value in _FALSE_VALUES:
            return False
        self.problems.append(f"{name} must be true or false (got {raw!r}).")
        return default

    def get_int(self, name: str, default: int | None) -> int | None:
        raw = self.get_str(name)
        if raw is None:
            return default
        try:
            value = int(raw)
        except ValueError:
            value = -1
        if value < 0:
            self.problems.append(f"{name} must be a non-negative integer (got {raw!r}).")
            return default
        return value

    def get_float(self, name: str, default: float) -> float:
        raw = self.get_str(name)
        if raw is None:
            return default
        try:
            value = float(raw)
        except ValueError:
            value = 0.0
        if not value > 0:  # Also rejects NaN.
            self.problems.append(f"{name} must be a positive number (got {raw!r}).")
            return default
        return value


class Config:
    """Settings shared by every environment.

    Subclasses change behavior through the private class-level defaults below; the
    upper-case instance attributes are what Flask loads via ``app.config.from_object``.

    Args:
        environ: The environment to read; defaults to ``os.environ``.
    """

    APP_ENV: ClassVar[str] = "development"

    _database_url_var: ClassVar[str] = "DATABASE_URL"
    _default_database_url: ClassVar[str | None] = DEFAULT_DATABASE_URL
    _fallback_secret_key: ClassVar[str | None] = _DEV_SECRET_KEY
    _default_app_base_url: ClassVar[str | None] = DEFAULT_DEV_APP_BASE_URL
    _default_trusted_proxy_count: ClassVar[int | None] = 0
    _default_cookie_secure: ClassVar[bool] = False
    _host_prefixed_cookies: ClassVar[bool] = False
    _default_mail_backend: ClassVar[str | None] = "console"
    _default_ratelimit_enabled: ClassVar[bool] = True
    _default_ratelimit_storage_uri: ClassVar[str | None] = "memory://"
    _default_log_format: ClassVar[str] = "text"
    _argon2_profile: ClassVar[str] = "RFC_9106_LOW_MEMORY"

    def __init__(self, environ: Mapping[str, str] | None = None) -> None:
        env = _EnvReader(os.environ if environ is None else environ)

        self.DEBUG: bool = False
        self.TESTING: bool = False
        self.SECRET_KEY: str | None = env.get_str("SECRET_KEY", self._fallback_secret_key)

        database_url = env.get_str(self._database_url_var, self._default_database_url)
        self.SQLALCHEMY_DATABASE_URI: str | None = (
            normalize_database_url(database_url) if database_url else None
        )
        self.SQLALCHEMY_ENGINE_OPTIONS: dict[str, Any] = _engine_options()
        self.MAX_CONTENT_LENGTH: int = MAX_JSON_BODY_BYTES

        base_url = env.get_str("APP_BASE_URL", self._default_app_base_url)
        self.APP_BASE_URL: str | None = base_url.rstrip("/") if base_url else None
        self.TRUSTED_PROXY_COUNT: int | None = env.get_int(
            "TRUSTED_PROXY_COUNT", self._default_trusted_proxy_count
        )

        self._init_cookies(env)
        self._init_csrf()
        self._init_rate_limits(env)
        self._init_mail(env)
        self._init_youtube(env)

        self.LOG_LEVEL: str = (env.get_str("LOG_LEVEL") or "INFO").upper()
        self.LOG_FORMAT: str = (env.get_str("LOG_FORMAT") or self._default_log_format).lower()
        #: Name of an ``argon2.profiles`` parameter set used for password hashing.
        self.ARGON2_PROFILE: str = self._argon2_profile

        self._env = env

    def _init_cookies(self, env: _EnvReader) -> None:
        secure = env.get_bool("SESSION_COOKIE_SECURE", self._default_cookie_secure)
        # Browsers reject "__Host-" cookies that lack the Secure flag, so the prefix is
        # only used when cookies are Secure (the e2e stack runs production over http).
        prefix = "__Host-" if self._host_prefixed_cookies and secure else ""
        self.SESSION_COOKIE_NAME: str = f"{prefix}sotd_session"
        self.SESSION_COOKIE_SECURE: bool = secure
        self.SESSION_COOKIE_HTTPONLY: bool = True
        self.SESSION_COOKIE_SAMESITE: str = "Lax"
        self.SESSION_COOKIE_PATH: str = "/"
        self.SESSION_COOKIE_DOMAIN: str | None = None
        self.PERMANENT_SESSION_LIFETIME: timedelta = timedelta(days=30)

        self.REMEMBER_COOKIE_NAME: str = f"{prefix}sotd_remember"
        self.REMEMBER_COOKIE_SECURE: bool = secure
        self.REMEMBER_COOKIE_HTTPONLY: bool = True
        self.REMEMBER_COOKIE_SAMESITE: str = "Lax"
        self.REMEMBER_COOKIE_PATH: str = "/"
        self.REMEMBER_COOKIE_DOMAIN: str | None = None
        self.REMEMBER_COOKIE_DURATION: timedelta = timedelta(days=30)
        self.REMEMBER_COOKIE_REFRESH_EACH_REQUEST: bool = True

    def _init_csrf(self) -> None:
        self.WTF_CSRF_ENABLED: bool = True
        self.WTF_CSRF_TIME_LIMIT: int | None = None
        self.WTF_CSRF_SSL_STRICT: bool = True
        self.WTF_CSRF_HEADERS: list[str] = ["X-CSRFToken"]

    def _init_rate_limits(self, env: _EnvReader) -> None:
        #: The per-app switch, read from the RATELIMIT_ENABLED environment variable.
        #: Flask-Limiter's own RATELIMIT_ENABLED flag lives on the process-wide extension
        #: object (the last app initialized wins), so it stays on and this switch is
        #: enforced per app by a request filter (see sotd.extensions).
        self.RATE_LIMITS_ENABLED: bool = env.get_bool(
            "RATELIMIT_ENABLED", self._default_ratelimit_enabled
        )
        self.RATELIMIT_ENABLED: bool = True
        self.RATELIMIT_STORAGE_URI: str | None = env.get_str(
            "RATELIMIT_STORAGE_URI", self._default_ratelimit_storage_uri
        )
        # Short socket timeouts keep a Redis outage from stalling requests; the limiter
        # then falls back to per-process in-memory counters.
        self.RATELIMIT_STORAGE_OPTIONS: dict[str, float] = {
            "socket_connect_timeout": 1.0,
            "socket_timeout": 1.0,
        }
        self.RATELIMIT_KEY_PREFIX: str = "sotd"
        self.RATELIMIT_HEADERS_ENABLED: bool = True
        self.RATELIMIT_SWALLOW_ERRORS: bool = True
        self.RATELIMIT_IN_MEMORY_FALLBACK_ENABLED: bool = True

    def _init_mail(self, env: _EnvReader) -> None:
        backend = env.get_str("MAIL_BACKEND", self._default_mail_backend)
        self.MAIL_BACKEND: str | None = backend.lower() if backend else None
        self.ALLOW_CONSOLE_MAIL: bool = env.get_bool("ALLOW_CONSOLE_MAIL", False)
        self.MAIL_SERVER: str | None = env.get_str("MAIL_SERVER")
        self.MAIL_USE_TLS: bool = env.get_bool("MAIL_USE_TLS", False)
        self.MAIL_USE_SSL: bool = env.get_bool("MAIL_USE_SSL", False)
        self.MAIL_PORT: int | None = env.get_int("MAIL_PORT", 465 if self.MAIL_USE_SSL else 587)
        self.MAIL_USERNAME: str | None = env.get_str("MAIL_USERNAME")
        self.MAIL_PASSWORD: str | None = env.get_str("MAIL_PASSWORD")
        self.MAIL_FROM: str | None = env.get_str("MAIL_FROM")
        self.MAIL_TIMEOUT: float = env.get_float("MAIL_TIMEOUT", 10.0)

    def _init_youtube(self, env: _EnvReader) -> None:
        #: YouTube Data API v3 key for the auto-match feature; without it the
        #: endpoint reports ``reason: "disabled"`` and users link videos themselves.
        self.YOUTUBE_API_KEY: str | None = env.get_str("YOUTUBE_API_KEY")

    def validate(self) -> None:
        """Check the settings and raise if anything is wrong.

        Raises:
            RuntimeError: Listing every problem found, one per line.
        """
        problems = [*self._env.problems, *self._problems()]
        if problems:
            details = "\n".join(f"  - {problem}" for problem in problems)
            raise RuntimeError(f"Invalid {self.APP_ENV} configuration:\n{details}")

    def _problems(self) -> list[str]:
        problems: list[str] = []
        if self.LOG_LEVEL not in LOG_LEVELS:
            problems.append(f"LOG_LEVEL must be one of {', '.join(sorted(LOG_LEVELS))}.")
        if self.LOG_FORMAT not in LOG_FORMATS:
            problems.append(f"LOG_FORMAT must be one of {', '.join(sorted(LOG_FORMATS))}.")
        if self.MAIL_BACKEND is not None and self.MAIL_BACKEND not in MAIL_BACKENDS:
            problems.append(f"MAIL_BACKEND must be one of {', '.join(sorted(MAIL_BACKENDS))}.")
        return problems


class DevelopmentConfig(Config):
    """Local development: debug mode, console mail and in-memory rate limits."""

    APP_ENV: ClassVar[str] = "development"

    def __init__(self, environ: Mapping[str, str] | None = None) -> None:
        super().__init__(environ)
        self.DEBUG = True


class TestingConfig(Config):
    """Automated tests: in-memory mail, rate limits off and cheap password hashing."""

    APP_ENV: ClassVar[str] = "testing"

    _database_url_var: ClassVar[str] = "TEST_DATABASE_URL"
    _default_database_url: ClassVar[str | None] = DEFAULT_TEST_DATABASE_URL
    _fallback_secret_key: ClassVar[str | None] = _TEST_SECRET_KEY
    _default_mail_backend: ClassVar[str | None] = "memory"
    _default_ratelimit_enabled: ClassVar[bool] = False
    _argon2_profile: ClassVar[str] = "CHEAPEST"

    def __init__(self, environ: Mapping[str, str] | None = None) -> None:
        super().__init__(environ)
        self.TESTING = True


class ProductionConfig(Config):
    """Deployed environments. Secrets and infrastructure must come from the environment."""

    APP_ENV: ClassVar[str] = "production"

    _default_database_url: ClassVar[str | None] = None
    _fallback_secret_key: ClassVar[str | None] = None
    _default_app_base_url: ClassVar[str | None] = None
    _default_trusted_proxy_count: ClassVar[int | None] = None
    _default_cookie_secure: ClassVar[bool] = True
    _host_prefixed_cookies: ClassVar[bool] = True
    _default_mail_backend: ClassVar[str | None] = None
    _default_ratelimit_storage_uri: ClassVar[str | None] = None
    _default_log_format: ClassVar[str] = "json"

    def validate(self) -> None:
        """Force debug/testing off, then apply the production deployment rules.

        Raises:
            RuntimeError: Listing every problem found, one per line.
        """
        self.DEBUG = False
        self.TESTING = False
        super().validate()

    def _problems(self) -> list[str]:
        return [
            *super()._problems(),
            *self._secret_key_problems(),
            *self._infrastructure_problems(),
            *self._mail_problems(),
        ]

    def _secret_key_problems(self) -> list[str]:
        key = self.SECRET_KEY
        if not key:
            return ["SECRET_KEY is required."]
        problems: list[str] = []
        if len(key) < MIN_SECRET_KEY_LENGTH:
            problems.append(f"SECRET_KEY must be at least {MIN_SECRET_KEY_LENGTH} characters.")
        if key.lower() in KNOWN_PLACEHOLDER_SECRETS:
            problems.append("SECRET_KEY is a known placeholder; generate a random value.")
        return problems

    def _infrastructure_problems(self) -> list[str]:
        problems: list[str] = []
        if not self.SQLALCHEMY_DATABASE_URI:
            problems.append("DATABASE_URL is required.")
        if not self.APP_BASE_URL:
            problems.append("APP_BASE_URL is required.")
        elif not is_allowed_base_url(self.APP_BASE_URL):
            problems.append(
                "APP_BASE_URL must start with https:// (http://localhost[:port] is allowed "
                "for local runs)."
            )
        storage_uri = self.RATELIMIT_STORAGE_URI
        if self.RATE_LIMITS_ENABLED and (not storage_uri or storage_uri.startswith("memory://")):
            problems.append(
                "RATELIMIT_STORAGE_URI must point at shared storage such as Redis "
                "(memory:// is only allowed with RATELIMIT_ENABLED=false)."
            )
        if not self._env.is_set("TRUSTED_PROXY_COUNT"):
            problems.append(
                "TRUSTED_PROXY_COUNT must be set explicitly (the number of reverse proxies "
                "in front of gunicorn, or 0)."
            )
        return problems

    def _mail_problems(self) -> list[str]:
        if self.MAIL_BACKEND == "console" and self.ALLOW_CONSOLE_MAIL:
            return []
        if self.MAIL_BACKEND != "smtp":
            return [
                "MAIL_BACKEND must be smtp (console is only allowed with ALLOW_CONSOLE_MAIL=true)."
            ]
        problems: list[str] = []
        if not self.MAIL_SERVER:
            problems.append("MAIL_SERVER is required when MAIL_BACKEND=smtp.")
        if not self.MAIL_FROM:
            problems.append("MAIL_FROM is required when MAIL_BACKEND=smtp.")
        if not (self.MAIL_USE_TLS or self.MAIL_USE_SSL):
            problems.append(
                "Set MAIL_USE_TLS or MAIL_USE_SSL; plaintext SMTP is refused in production."
            )
        return problems


_CONFIGS: Final[Mapping[str, type[Config]]] = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
}


def load_config(name: str | None = None, environ: Mapping[str, str] | None = None) -> Config:
    """Instantiate the config class for an environment.

    Args:
        name: ``development``, ``testing`` or ``production``. Defaults to ``APP_ENV``,
            then ``development``.
        environ: The environment to read; defaults to ``os.environ``.

    Returns:
        The (not yet validated) configuration.

    Raises:
        RuntimeError: If the environment name is unknown.
    """
    env = os.environ if environ is None else environ
    selected = (name or env.get("APP_ENV", "").strip() or "development").lower()
    try:
        config_class = _CONFIGS[selected]
    except KeyError:
        known = ", ".join(_CONFIGS)
        raise RuntimeError(f"Unknown APP_ENV {selected!r}; expected one of: {known}.") from None
    return config_class(env)
