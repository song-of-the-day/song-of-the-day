"""Constants and types shared by the fixtures and the tests."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from pathlib import Path

from flask import Flask

MIGRATIONS_DIR = str(Path(__file__).resolve().parents[1] / "migrations")
#: The instant the ``frozen_time`` fixture freezes the clock at.
FROZEN_NOW = datetime(2026, 10, 11, 12, 0, 0, tzinfo=UTC)

#: ``app_factory(**overrides)`` returns a context manager yielding a testing app bound to
#: the run's database; its engine is disposed on exit.
AppFactory = Callable[..., AbstractContextManager[Flask]]

STRONG_SECRET = "Zq4t7w!z%C*F-JaNdRgUkXp2s5v8y/B?"

#: An environment that passes ``ProductionConfig.validate()``.
VALID_PRODUCTION_ENV: dict[str, str] = {
    "SECRET_KEY": STRONG_SECRET,
    "DATABASE_URL": "postgres://sotd:pw@db:5432/sotd",
    "APP_BASE_URL": "https://sotd.ca/",
    "MAIL_BACKEND": "smtp",
    "MAIL_SERVER": "smtp.example.com",
    "MAIL_FROM": "hello@sotd.ca",
    "MAIL_USE_TLS": "true",
    "RATELIMIT_STORAGE_URI": "redis://redis:6379/0",
    "TRUSTED_PROXY_COUNT": "1",
}
