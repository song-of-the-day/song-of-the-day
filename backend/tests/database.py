"""Create and drop throwaway PostgreSQL databases for the test run."""

from __future__ import annotations

import os
import secrets

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.pool import NullPool

from sotd.config import DEFAULT_TEST_DATABASE_URL, normalize_database_url


def server_url_from_env() -> URL:
    """Return ``TEST_DATABASE_URL`` (or its default); its database name is the prefix."""
    raw = os.environ.get("TEST_DATABASE_URL", "").strip() or DEFAULT_TEST_DATABASE_URL
    return make_url(normalize_database_url(raw))


def _maintenance_engine(url: URL) -> Engine:
    return create_engine(
        url.set(database="postgres"), isolation_level="AUTOCOMMIT", poolclass=NullPool
    )


def create_test_database(server_url: URL) -> URL:
    """Create ``<dbname>_<worker>_<8 hex>`` on the server and return its URL."""
    worker = os.environ.get("PYTEST_XDIST_WORKER", "main")
    name = f"{server_url.database}_{worker}_{secrets.token_hex(4)}"
    engine = _maintenance_engine(server_url)
    try:
        with engine.connect() as connection:
            quoted = engine.dialect.identifier_preparer.quote(name)
            connection.execute(text(f"CREATE DATABASE {quoted}"))
    finally:
        engine.dispose()
    return server_url.set(database=name)


def drop_test_database(url: URL) -> None:
    """Drop the database at ``url``, terminating any remaining connections."""
    engine = _maintenance_engine(url)
    try:
        with engine.connect() as connection:
            quoted = engine.dialect.identifier_preparer.quote(str(url.database))
            connection.execute(text(f"DROP DATABASE IF EXISTS {quoted} WITH (FORCE)"))
    finally:
        engine.dispose()
