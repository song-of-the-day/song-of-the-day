from __future__ import annotations

from datetime import timedelta

import pytest

# TestingConfig is used through the module so pytest doesn't collect it as a test class.
from sotd import config as config_module
from sotd.config import (
    DEFAULT_DATABASE_URL,
    DEFAULT_TEST_DATABASE_URL,
    MAX_JSON_BODY_BYTES,
    Config,
    DevelopmentConfig,
    ProductionConfig,
    is_allowed_base_url,
    load_config,
    normalize_database_url,
)
from tests.support import VALID_PRODUCTION_ENV


def production(**changes: str | None) -> ProductionConfig:
    env = dict(VALID_PRODUCTION_ENV)
    for name, value in changes.items():
        if value is None:
            env.pop(name, None)
        else:
            env[name] = value
    return ProductionConfig(env)


def problems_of(config: Config) -> str:
    with pytest.raises(RuntimeError) as excinfo:
        config.validate()
    return str(excinfo.value)


# --- load_config ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("development", DevelopmentConfig),
        ("testing", config_module.TestingConfig),
        ("production", ProductionConfig),
    ],
)
def test_load_config_by_name(name: str, expected: type[Config]) -> None:
    assert type(load_config(name, {})) is expected


def test_load_config_reads_app_env() -> None:
    assert type(load_config(None, {"APP_ENV": " Testing "})) is config_module.TestingConfig


def test_load_config_defaults_to_development() -> None:
    assert type(load_config(None, {})) is DevelopmentConfig


def test_load_config_rejects_unknown_environment() -> None:
    with pytest.raises(RuntimeError, match="Unknown APP_ENV 'staging'"):
        load_config("staging", {})


def test_load_config_defaults_to_process_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "testing")
    monkeypatch.setenv("LOG_LEVEL", "debug")
    config = load_config()
    assert isinstance(config, config_module.TestingConfig)
    assert config.LOG_LEVEL == "DEBUG"


# --- URL helpers ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("postgres://u:p@h:5432/d", "postgresql+psycopg://u:p@h:5432/d"),
        ("postgresql://u:p@h/d", "postgresql+psycopg://u:p@h/d"),
        ("postgresql+psycopg://u@h/d", "postgresql+psycopg://u@h/d"),
        ("postgresql+psycopg2://u@h/d", "postgresql+psycopg2://u@h/d"),
        ("sqlite:///x.db", "sqlite:///x.db"),
    ],
)
def test_normalize_database_url(url: str, expected: str) -> None:
    assert normalize_database_url(url) == expected


def test_database_url_is_normalized_in_config() -> None:
    config = DevelopmentConfig({"DATABASE_URL": "postgres://a:b@c/d"})
    assert config.SQLALCHEMY_DATABASE_URI == "postgresql+psycopg://a:b@c/d"


@pytest.mark.parametrize(
    ("url", "allowed"),
    [
        ("https://sotd.ca", True),
        ("https://sotd.ca:8443/app", True),
        ("http://localhost", True),
        ("http://localhost:8080", True),
        ("http://sotd.ca", False),
        ("http://127.0.0.1:8080", False),
        ("https://", False),
        ("ftp://sotd.ca", False),
        ("http://localhost:notaport", False),
        ("http://localhost:0", False),
        ("sotd.ca", False),
    ],
)
def test_is_allowed_base_url(url: str, allowed: bool) -> None:
    assert is_allowed_base_url(url) is allowed


# --- Environment defaults ------------------------------------------------------------------


def test_development_defaults() -> None:
    config = DevelopmentConfig({})
    config.validate()
    assert config.APP_ENV == "development"
    assert config.DEBUG is True
    assert config.TESTING is False
    assert config.SECRET_KEY
    assert config.SQLALCHEMY_DATABASE_URI == DEFAULT_DATABASE_URL
    assert config.APP_BASE_URL == "http://localhost:5173"
    assert config.TRUSTED_PROXY_COUNT == 0
    assert config.MAIL_BACKEND == "console"
    assert config.RATE_LIMITS_ENABLED is True
    assert config.RATELIMIT_STORAGE_URI == "memory://"
    assert config.LOG_FORMAT == "text"
    assert config.LOG_LEVEL == "INFO"
    assert config.ARGON2_PROFILE == "RFC_9106_LOW_MEMORY"


def test_testing_defaults() -> None:
    config = config_module.TestingConfig({})
    config.validate()
    assert config.TESTING is True
    assert config.DEBUG is False
    assert config.SQLALCHEMY_DATABASE_URI == DEFAULT_TEST_DATABASE_URL
    assert config.MAIL_BACKEND == "memory"
    assert config.RATE_LIMITS_ENABLED is False
    assert config.RATELIMIT_ENABLED is True  # Flask-Limiter's process-wide flag stays on.
    assert config.ARGON2_PROFILE == "CHEAPEST"
    assert config.SECRET_KEY != DevelopmentConfig({}).SECRET_KEY


def test_testing_reads_test_database_url() -> None:
    config = config_module.TestingConfig(
        {"TEST_DATABASE_URL": "postgresql://x@y/z", "DATABASE_URL": "postgres://no"}
    )
    assert config.SQLALCHEMY_DATABASE_URI == "postgresql+psycopg://x@y/z"


def test_shared_settings() -> None:
    config = DevelopmentConfig({})
    assert config.MAX_CONTENT_LENGTH == MAX_JSON_BODY_BYTES == 256 * 1024
    assert config.SQLALCHEMY_ENGINE_OPTIONS == {
        "pool_pre_ping": True,
        "pool_size": 2,
        "max_overflow": 2,
        "pool_recycle": 1800,
        "connect_args": {"connect_timeout": 5, "options": "-c statement_timeout=15000"},
        "hide_parameters": True,
    }
    assert config.WTF_CSRF_ENABLED is True
    assert config.WTF_CSRF_TIME_LIMIT is None
    assert config.WTF_CSRF_SSL_STRICT is True
    assert config.WTF_CSRF_HEADERS == ["X-CSRFToken"]
    assert config.RATELIMIT_KEY_PREFIX == "sotd"
    assert config.RATELIMIT_HEADERS_ENABLED is True
    assert config.RATELIMIT_SWALLOW_ERRORS is True
    assert config.RATELIMIT_IN_MEMORY_FALLBACK_ENABLED is True
    assert config.RATELIMIT_STORAGE_OPTIONS == {
        "socket_connect_timeout": 1.0,
        "socket_timeout": 1.0,
    }


def test_engine_options_are_not_shared_between_instances() -> None:
    first, second = DevelopmentConfig({}), DevelopmentConfig({})
    first.SQLALCHEMY_ENGINE_OPTIONS["pool_size"] = 99
    assert second.SQLALCHEMY_ENGINE_OPTIONS["pool_size"] == 2


def test_youtube_api_key_is_optional() -> None:
    assert DevelopmentConfig({}).YOUTUBE_API_KEY is None
    assert DevelopmentConfig({"YOUTUBE_API_KEY": "  key-123  "}).YOUTUBE_API_KEY == "key-123"
    assert DevelopmentConfig({"YOUTUBE_API_KEY": "  "}).YOUTUBE_API_KEY is None


def test_app_base_url_trailing_slash_is_removed() -> None:
    assert DevelopmentConfig({"APP_BASE_URL": "https://sotd.ca/"}).APP_BASE_URL == "https://sotd.ca"


def test_empty_values_count_as_unset() -> None:
    config = DevelopmentConfig({"DATABASE_URL": "  ", "LOG_FORMAT": "", "MAIL_BACKEND": ""})
    assert config.SQLALCHEMY_DATABASE_URI == DEFAULT_DATABASE_URL
    assert config.LOG_FORMAT == "text"
    assert config.MAIL_BACKEND == "console"


# --- Cookies ------------------------------------------------------------------------------


@pytest.mark.parametrize("config_class", [DevelopmentConfig, config_module.TestingConfig])
def test_cookies_outside_production(config_class: type[Config]) -> None:
    config = config_class({})
    assert config.SESSION_COOKIE_NAME == "sotd_session"
    assert config.REMEMBER_COOKIE_NAME == "sotd_remember"
    assert config.SESSION_COOKIE_SECURE is False
    assert config.REMEMBER_COOKIE_SECURE is False


def test_cookies_in_production() -> None:
    config = production()
    assert config.SESSION_COOKIE_NAME == "__Host-sotd_session"
    assert config.REMEMBER_COOKIE_NAME == "__Host-sotd_remember"
    assert config.SESSION_COOKIE_SECURE is True
    assert config.REMEMBER_COOKIE_SECURE is True


def test_production_cookies_without_secure_drop_the_host_prefix() -> None:
    # Browsers reject "__Host-" cookies without Secure (the e2e stack runs over http).
    config = production(SESSION_COOKIE_SECURE="false")
    assert config.SESSION_COOKIE_SECURE is False
    assert config.REMEMBER_COOKIE_SECURE is False
    assert config.SESSION_COOKIE_NAME == "sotd_session"
    assert config.REMEMBER_COOKIE_NAME == "sotd_remember"


def test_secure_cookies_in_development_keep_plain_names() -> None:
    config = DevelopmentConfig({"SESSION_COOKIE_SECURE": "true"})
    assert config.SESSION_COOKIE_SECURE is True
    assert config.REMEMBER_COOKIE_SECURE is True
    assert config.SESSION_COOKIE_NAME == "sotd_session"


@pytest.mark.parametrize(
    "config_class", [DevelopmentConfig, config_module.TestingConfig, ProductionConfig]
)
def test_cookie_flags_and_lifetimes(config_class: type[Config]) -> None:
    config = config_class(VALID_PRODUCTION_ENV)
    for prefix in ("SESSION", "REMEMBER"):
        assert getattr(config, f"{prefix}_COOKIE_HTTPONLY") is True
        assert getattr(config, f"{prefix}_COOKIE_SAMESITE") == "Lax"
        assert getattr(config, f"{prefix}_COOKIE_PATH") == "/"
        assert getattr(config, f"{prefix}_COOKIE_DOMAIN") is None
    assert timedelta(days=30) == config.REMEMBER_COOKIE_DURATION
    assert config.REMEMBER_COOKIE_REFRESH_EACH_REQUEST is True
    assert timedelta(days=30) == config.PERMANENT_SESSION_LIFETIME


# --- Mail settings ---------------------------------------------------------------------------


def test_mail_settings() -> None:
    config = DevelopmentConfig(
        {
            "MAIL_BACKEND": "SMTP",
            "MAIL_SERVER": "smtp.example.com",
            "MAIL_USERNAME": "user",
            "MAIL_PASSWORD": "pw",
            "MAIL_FROM": "hi@sotd.ca",
            "MAIL_USE_TLS": "yes",
            "MAIL_TIMEOUT": "2.5",
        }
    )
    assert config.MAIL_BACKEND == "smtp"
    assert config.MAIL_USE_TLS is True
    assert config.MAIL_USE_SSL is False
    assert config.MAIL_PORT == 587
    assert config.MAIL_TIMEOUT == 2.5
    assert (config.MAIL_USERNAME, config.MAIL_PASSWORD, config.MAIL_FROM) == (
        "user",
        "pw",
        "hi@sotd.ca",
    )


def test_mail_port_defaults_to_465_with_ssl() -> None:
    assert DevelopmentConfig({"MAIL_USE_SSL": "on"}).MAIL_PORT == 465


def test_mail_port_can_be_set() -> None:
    assert DevelopmentConfig({"MAIL_PORT": "2525"}).MAIL_PORT == 2525


# --- Parse problems (every environment) ---------------------------------------------------------


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"RATELIMIT_ENABLED": "maybe"}, "RATELIMIT_ENABLED must be true or false"),
        ({"TRUSTED_PROXY_COUNT": "two"}, "TRUSTED_PROXY_COUNT must be a non-negative integer"),
        ({"TRUSTED_PROXY_COUNT": "-1"}, "TRUSTED_PROXY_COUNT must be a non-negative integer"),
        ({"MAIL_TIMEOUT": "soon"}, "MAIL_TIMEOUT must be a positive number"),
        ({"MAIL_TIMEOUT": "0"}, "MAIL_TIMEOUT must be a positive number"),
        ({"MAIL_TIMEOUT": "nan"}, "MAIL_TIMEOUT must be a positive number"),
        ({"LOG_LEVEL": "verbose"}, "LOG_LEVEL must be one of"),
        ({"LOG_FORMAT": "xml"}, "LOG_FORMAT must be one of"),
        ({"MAIL_BACKEND": "pigeon"}, "MAIL_BACKEND must be one of"),
    ],
)
def test_invalid_values_fail_validation(env: dict[str, str], message: str) -> None:
    assert message in problems_of(DevelopmentConfig(env))


def test_invalid_values_fall_back_to_defaults() -> None:
    config = DevelopmentConfig(
        {"RATELIMIT_ENABLED": "maybe", "MAIL_TIMEOUT": "x", "MAIL_PORT": "y"}
    )
    assert config.RATE_LIMITS_ENABLED is True
    assert config.MAIL_TIMEOUT == 10.0
    assert config.MAIL_PORT == 587


# --- ProductionConfig.validate ---------------------------------------------------------------


def test_valid_production_config_passes() -> None:
    config = production()
    config.validate()
    assert config.SQLALCHEMY_DATABASE_URI == "postgresql+psycopg://sotd:pw@db:5432/sotd"
    assert config.LOG_FORMAT == "json"


def test_production_forces_debug_and_testing_off() -> None:
    config = production()
    config.DEBUG = True
    config.TESTING = True
    config.validate()
    assert config.DEBUG is False
    assert config.TESTING is False


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"SECRET_KEY": None}, "SECRET_KEY is required."),
        ({"SECRET_KEY": "too-short-secret"}, "SECRET_KEY must be at least 32 characters."),
        (
            {"SECRET_KEY": DevelopmentConfig({}).SECRET_KEY},
            "SECRET_KEY is a known placeholder",
        ),
        ({"SECRET_KEY": "CHANGE-ME"}, "SECRET_KEY is a known placeholder"),
        ({"DATABASE_URL": None}, "DATABASE_URL is required."),
        ({"APP_BASE_URL": None}, "APP_BASE_URL is required."),
        ({"APP_BASE_URL": "http://sotd.ca"}, "APP_BASE_URL must start with https://"),
        ({"MAIL_BACKEND": None}, "MAIL_BACKEND must be smtp"),
        ({"MAIL_BACKEND": "console"}, "MAIL_BACKEND must be smtp"),
        ({"MAIL_BACKEND": "memory"}, "MAIL_BACKEND must be smtp"),
        ({"MAIL_SERVER": None}, "MAIL_SERVER is required when MAIL_BACKEND=smtp."),
        ({"MAIL_FROM": None}, "MAIL_FROM is required when MAIL_BACKEND=smtp."),
        ({"MAIL_USE_TLS": None}, "Set MAIL_USE_TLS or MAIL_USE_SSL"),
        ({"MAIL_USE_TLS": "false"}, "Set MAIL_USE_TLS or MAIL_USE_SSL"),
        ({"RATELIMIT_STORAGE_URI": "memory://"}, "RATELIMIT_STORAGE_URI must point at shared"),
        ({"RATELIMIT_STORAGE_URI": None}, "RATELIMIT_STORAGE_URI must point at shared"),
        ({"TRUSTED_PROXY_COUNT": None}, "TRUSTED_PROXY_COUNT must be set explicitly"),
    ],
)
def test_production_rules(changes: dict[str, str | None], message: str) -> None:
    assert message in problems_of(production(**changes))


@pytest.mark.parametrize(
    "changes",
    [
        {"APP_BASE_URL": "http://localhost:8080"},
        {"MAIL_BACKEND": "console", "ALLOW_CONSOLE_MAIL": "true", "MAIL_SERVER": None},
        {"MAIL_USE_TLS": None, "MAIL_USE_SSL": "true"},
        {"RATELIMIT_STORAGE_URI": "memory://", "RATELIMIT_ENABLED": "false"},
        {"TRUSTED_PROXY_COUNT": "0"},
        {"TRUSTED_PROXY_COUNT": "2"},
    ],
)
def test_production_allowed_variations(changes: dict[str, str | None]) -> None:
    production(**changes).validate()


def test_production_lists_every_problem() -> None:
    message = problems_of(ProductionConfig({}))
    assert message.startswith("Invalid production configuration:")
    for expected in (
        "SECRET_KEY is required.",
        "DATABASE_URL is required.",
        "APP_BASE_URL is required.",
        "MAIL_BACKEND must be smtp",
        "RATELIMIT_STORAGE_URI must point at shared",
        "TRUSTED_PROXY_COUNT must be set explicitly",
    ):
        assert expected in message
    assert message.count("\n  - ") == 6


def test_production_reports_short_placeholder_twice() -> None:
    message = problems_of(production(SECRET_KEY="secret"))
    assert "at least 32 characters" in message
    assert "known placeholder" in message


def test_production_parse_problem_for_proxy_count_is_not_duplicated() -> None:
    message = problems_of(production(TRUSTED_PROXY_COUNT="lots"))
    assert "TRUSTED_PROXY_COUNT must be a non-negative integer" in message
    assert "must be set explicitly" not in message
