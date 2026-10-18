from __future__ import annotations

import importlib.util
import re
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from types import ModuleType

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from flask import Flask
from flask_migrate import downgrade, upgrade
from sqlalchemy import Engine, inspect, text

from sotd.extensions import db
from sotd.usernames import get_username_rules, normalize_username
from tests.database import create_test_database, drop_test_database, server_url_from_env
from tests.support import MIGRATIONS_DIR, AppFactory

APP_TABLES = {"users", "user_sessions", "entries", "annotations", "uploads", "youtube_matches"}


def named_constraints(engine: Engine) -> set[str]:
    """Return the CHECK, FOREIGN KEY, PRIMARY KEY and UNIQUE constraint names in ``public``."""
    # Restricting contype keeps this stable across versions (PostgreSQL 18 also lists
    # NOT NULL constraints in pg_constraint).
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT conname FROM pg_constraint c "
                "JOIN pg_namespace n ON n.oid = c.connamespace "
                "WHERE n.nspname = 'public' AND c.contype IN ('c', 'f', 'p', 'u')"
            )
        )
        return {row.conname for row in rows}


def metadata_constraint_names() -> set[str]:
    names: set[str] = set()
    for table in db.metadata.sorted_tables:
        names.update(str(constraint.name) for constraint in table.constraints)
    return names


def table_names(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names())


@pytest.fixture
def fresh_app(app_factory: AppFactory) -> Iterator[Flask]:
    """An app bound to a brand-new, empty database (dropped afterwards)."""
    url = create_test_database(server_url_from_env())
    try:
        with app_factory(SQLALCHEMY_DATABASE_URI=url.render_as_string(hide_password=False)) as app:
            yield app
    finally:
        drop_test_database(url)


def test_models_match_the_migrated_schema(app: Flask) -> None:
    with app.app_context(), db.engine.connect() as connection:
        context = MigrationContext.configure(
            connection, opts={"compare_type": True, "compare_server_default": True}
        )
        assert compare_metadata(context, db.metadata) == []


def test_every_named_constraint_exists_in_the_database(app: Flask) -> None:
    # Autogenerate can't compare CHECK constraints, so compare the names instead.
    with app.app_context():
        expected = metadata_constraint_names()
        assert {
            "ck_entries_source_valid",
            "ck_annotations_start_ms_range",
            "ck_annotations_end_after_start",
            "uq_entries_user_id_entry_date",
            "uq_users_username",
            "ck_users_username_format",
            "ck_youtube_matches_key_length",
            "ck_youtube_matches_score_range",
        } <= expected
        assert expected <= named_constraints(db.engine)


@pytest.mark.slow
def test_upgrade_downgrade_upgrade_on_a_fresh_database(fresh_app: Flask) -> None:
    with fresh_app.app_context():
        engine = db.engine
        upgrade(directory=MIGRATIONS_DIR)
        assert table_names(engine) == APP_TABLES | {"alembic_version"}

        downgrade(directory=MIGRATIONS_DIR, revision="base")
        assert table_names(engine) == {"alembic_version"}
        assert named_constraints(engine) == {"alembic_version_pkc"}

        upgrade(directory=MIGRATIONS_DIR)
        assert table_names(engine) == APP_TABLES | {"alembic_version"}
        with engine.connect() as connection:
            context = MigrationContext.configure(
                connection, opts={"compare_type": True, "compare_server_default": True}
            )
            assert compare_metadata(context, db.metadata) == []


# --- Usernames backfill (7c3e5a91d2b4) ------------------------------------------------------

BEFORE_USERNAMES = "419e8fc1e9c6"
USERNAMES_REVISION = "7c3e5a91d2b4"


def load_usernames_migration() -> ModuleType:
    """Import the usernames migration (its file name isn't a valid module name)."""
    (path,) = Path(MIGRATIONS_DIR, "versions").glob(f"*_{USERNAMES_REVISION}_*.py")
    spec = importlib.util.spec_from_file_location("usernames_migration", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    ("email", "expected"),
    [
        ("ada@example.com", "ada"),
        ("Ada.Lovelace@example.com", "ada-lovelace"),
        ("ada+sotd@example.com", "ada-sotd"),
        ("__a..b__@example.com", "a-b"),
        ("a_-_b@example.com", "a_b"),
        ("zoë@exämple.com", "zoe"),
        ("jo@example.com", "jo0"),
        ("x@example.com", "x00"),
        ("+++@example.com", "user"),
        ("李@example.com", "user"),
        (f"{'a' * 29}.b@example.com", "a" * 29),
        ("\u210cello@example.com", "hello"),  # NFKD folds the black-letter H.
    ],
)
def test_base_usernames_come_from_the_local_part(email: str, expected: str) -> None:
    migration = load_usernames_migration()
    assert migration.base_username(email, get_username_rules()) == expected


def test_derived_usernames_are_unique_valid_and_not_reserved() -> None:
    migration = load_usernames_migration()
    rules = get_username_rules()
    emails = [
        "ada@a.com",
        "ADA@b.com",
        "ada@c.com",
        "admin@a.com",
        "profile@a.com",
        f"{'z' * 40}@a.com",
        f"{'z' * 40}@b.com",
        "ada2@a.com",
    ]
    usernames = migration.derive_usernames(emails, rules)
    assert usernames == [
        "ada",
        "ada2",
        "ada3",
        "admin2",
        "profile2",
        "z" * 30,
        "z" * 29 + "2",
        "ada22",  # "ada2" was taken by the second account.
    ]
    for username in usernames:
        assert normalize_username(username) == username


def test_a_derivation_that_breaks_the_rules_fails_loudly() -> None:
    migration = load_usernames_migration()
    strict = replace(get_username_rules(), pattern=re.compile("[a-z]+"))
    with pytest.raises(RuntimeError, match="doesn't match the rules"):
        migration.derive_usernames(["a1b@example.com"], strict)


@pytest.mark.slow
def test_upgrade_backfills_usernames_for_existing_users(fresh_app: Flask) -> None:
    emails = ["ada@example.com", "Ada@example.org", "login@example.com", "x@example.com"]
    with fresh_app.app_context():
        engine = db.engine
        upgrade(directory=MIGRATIONS_DIR, revision=BEFORE_USERNAMES)
        with engine.begin() as connection:
            for email in emails:
                connection.execute(
                    text(
                        "INSERT INTO users (email, password_hash, display_name) "
                        "VALUES (:email, 'x', 'Someone')"
                    ),
                    {"email": email.lower()},
                )

        upgrade(directory=MIGRATIONS_DIR, revision=USERNAMES_REVISION)
        with engine.connect() as connection:
            rows = connection.execute(
                text("SELECT email, username, autoplay_previews FROM users ORDER BY id")
            ).all()
        assert [(row.username, row.autoplay_previews) for row in rows] == [
            ("ada", True),
            ("ada2", True),
            ("login2", True),
            ("x00", True),
        ]
        assert {"uq_users_username", "ck_users_username_format"} <= named_constraints(engine)

        downgrade(directory=MIGRATIONS_DIR, revision=BEFORE_USERNAMES)
        columns = {column["name"] for column in inspect(engine).get_columns("users")}
        assert {"username", "autoplay_previews"}.isdisjoint(columns)
        assert "uq_users_username" not in named_constraints(engine)
        with engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM users")).scalar_one() == 4


@pytest.mark.slow
def test_upgrade_on_an_empty_users_table(fresh_app: Flask) -> None:
    with fresh_app.app_context():
        upgrade(directory=MIGRATIONS_DIR, revision=BEFORE_USERNAMES)
        upgrade(directory=MIGRATIONS_DIR, revision=USERNAMES_REVISION)
        assert "ck_users_username_format" in named_constraints(db.engine)
