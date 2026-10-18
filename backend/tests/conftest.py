"""Shared fixtures.

Each test run (each xdist worker) gets its own PostgreSQL database, migrated with
``alembic upgrade head`` and dropped at the end. After every test the tables are
truncated, the scoped session is removed and rate-limit counters are reset.

``db_session`` is an independent SQLAlchemy session for arranging and asserting database
state. Requests made with ``client`` get their own app context (and scoped session), so
don't keep an app context pushed around client calls.

Auth fixtures: ``auth_client`` is logged in as ``auth_user`` and attaches the CSRF header
to unsafe requests (see ``tests.clients``, which also has ``log_in`` for any client);
``outbox`` collects the emails sent by the memory mail backend; ``rate_limited_app`` is a
module-scoped app with rate limits on (memory storage) behind one trusted proxy, so
tests can pick the client IP with ``X-Forwarded-For``.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import pytest
import time_machine
from flask import Flask
from flask.testing import FlaskClient, FlaskCliRunner
from flask_migrate import upgrade
from sqlalchemy import text
from sqlalchemy.orm import Session

from sotd import create_app
from sotd.extensions import db, limiter
from sotd.models import User
from sotd.services.mail import OUTBOX_EXTENSION_KEY, OutgoingEmail
from tests.clients import CsrfClient, csrf_client, log_in
from tests.database import create_test_database, drop_test_database, server_url_from_env
from tests.factories import AnnotationFactory, EntryFactory, UploadFactory, UserFactory
from tests.support import FROZEN_NOW, MIGRATIONS_DIR, AppFactory


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """Create and migrate the run's database; drop it after the session."""
    url = create_test_database(server_url_from_env())
    rendered = url.render_as_string(hide_password=False)
    try:
        migration_app = create_app("testing", {"SQLALCHEMY_DATABASE_URI": rendered})
        with migration_app.app_context():
            upgrade(directory=MIGRATIONS_DIR)
            db.engine.dispose()
        yield rendered
    finally:
        drop_test_database(url)


@pytest.fixture(scope="session")
def app_factory(database_url: str) -> AppFactory:
    """Build extra apps with different settings (e.g. rate limits on)."""

    @contextmanager
    def make_app(**overrides: Any) -> Iterator[Flask]:
        app = create_app("testing", {"SQLALCHEMY_DATABASE_URI": database_url, **overrides})
        try:
            yield app
        finally:
            with app.app_context():
                db.engine.dispose()

    return make_app


@pytest.fixture(scope="session")
def app(app_factory: AppFactory) -> Iterator[Flask]:
    """The session-wide testing app."""
    with app_factory() as application:
        yield application


@pytest.fixture(autouse=True)
def _isolate(app: Flask) -> Iterator[None]:
    yield
    with app.app_context():
        # Release the scoped session first so TRUNCATE can't wait on its locks.
        db.session.remove()
        preparer = db.engine.dialect.identifier_preparer
        tables = ", ".join(preparer.format_table(table) for table in db.metadata.sorted_tables)
        with db.engine.begin() as connection:
            connection.execute(text("SET LOCAL lock_timeout = '5s'"))
            connection.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        db.session.remove()
    limiter.reset()


@pytest.fixture
def client(app: Flask) -> FlaskClient:
    return app.test_client()


@pytest.fixture
def cli_runner(app: Flask) -> FlaskCliRunner:
    return app.test_cli_runner()


@pytest.fixture
def db_session(app: Flask) -> Iterator[Session]:
    with app.app_context():
        engine = db.engine
    session = Session(engine, expire_on_commit=False)
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def frozen_time() -> Iterator[time_machine.Traveller]:
    """Freeze the clock at 2026-10-11T12:00:00Z (``shift``/``move_to`` move it)."""
    with time_machine.travel(FROZEN_NOW, tick=False) as traveller:
        yield traveller


@pytest.fixture
def user_factory(app: Flask, db_session: Session) -> UserFactory:
    return UserFactory(app, db_session)


@pytest.fixture
def entry_factory(db_session: Session, user_factory: UserFactory) -> EntryFactory:
    return EntryFactory(db_session, user_factory)


@pytest.fixture
def annotation_factory(db_session: Session, entry_factory: EntryFactory) -> AnnotationFactory:
    return AnnotationFactory(db_session, entry_factory)


@pytest.fixture
def upload_factory(db_session: Session, user_factory: UserFactory) -> UploadFactory:
    return UploadFactory(db_session, user_factory)


# --- Auth ---------------------------------------------------------------------------


@pytest.fixture
def auth_user(user_factory: UserFactory) -> User:
    """The account ``auth_client`` is logged in as (``ada``, password ``DEFAULT_PASSWORD``)."""
    return user_factory(email="ada@example.com", username="ada", display_name="Ada")


@pytest.fixture
def auth_client(app: Flask, auth_user: User) -> CsrfClient:
    """A client logged in as ``auth_user`` (remember-me) that sends CSRF tokens itself."""
    client = csrf_client(app)
    log_in(client, auth_user.email)
    return client


@pytest.fixture
def outbox(app: Flask) -> Iterator[list[OutgoingEmail]]:
    """Emails sent through the memory mail backend during the test."""
    messages: list[OutgoingEmail] = app.extensions.setdefault(OUTBOX_EXTENSION_KEY, [])
    messages.clear()
    yield messages
    messages.clear()


@pytest.fixture(scope="module")
def rate_limited_app(app_factory: AppFactory) -> Iterator[Flask]:
    """An app with rate limits on (in-memory counters, reset after every test).

    It trusts one reverse proxy, so ``X-Forwarded-For`` sets the client IP that the
    per-IP limits use. Its engine is disposed at the end of the module.
    """
    with app_factory(
        RATE_LIMITS_ENABLED=True, RATELIMIT_STORAGE_URI="memory://", TRUSTED_PROXY_COUNT=1
    ) as application:
        yield application
