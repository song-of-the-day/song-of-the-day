"""Database-level constraints, exercised with raw SQL (autogenerate can't see CHECKs)."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from flask import Flask
from psycopg import errors as pg_errors
from sqlalchemy import Connection, text
from sqlalchemy.exc import IntegrityError

from sotd.extensions import db

MAX_MS = 86_400_000


@pytest.fixture
def conn(app: Flask) -> Iterator[Connection]:
    """A connection in one transaction, rolled back at the end (tables are truncated anyway)."""
    with app.app_context():
        engine = db.engine
    with engine.connect() as connection:
        yield connection
        connection.rollback()


def execute(conn: Connection, sql: str, params: Mapping[str, Any] | None = None) -> Any:
    return conn.execute(text(sql), dict(params or {}))


def insert_user(
    conn: Connection, email: str = "ada@example.com", username: str | None = None
) -> int:
    """Insert a user; the username defaults to ``u-<local part of the email>``."""
    user_id: int = execute(
        conn,
        "INSERT INTO users (email, username, password_hash, display_name) "
        "VALUES (:email, :username, 'x', 'Ada') RETURNING id",
        {
            "email": email,
            "username": f"u-{email.partition('@')[0]}" if username is None else username,
        },
    ).scalar_one()
    return user_id


def insert_entry(conn: Connection, user_id: int, day: str = "2026-10-11", **values: Any) -> int:
    params = {"source": "manual", **values, "user_id": user_id, "entry_date": day}
    columns = ", ".join(params)
    placeholders = ", ".join(f":{name}" for name in params)
    entry_id: int = execute(
        conn,
        f"INSERT INTO entries (title, artist, {columns}) "  # noqa: S608 (fixed test columns)
        f"VALUES ('Gosh', 'Jamie xx', {placeholders}) RETURNING id",
        params,
    ).scalar_one()
    return entry_id


def insert_annotation(conn: Connection, entry_id: int, start_ms: int, end_ms: int | None) -> int:
    annotation_id: int = execute(
        conn,
        "INSERT INTO annotations (entry_id, start_ms, end_ms, body) "
        "VALUES (:entry_id, :start_ms, :end_ms, 'note') RETURNING id",
        {"entry_id": entry_id, "start_ms": start_ms, "end_ms": end_ms},
    ).scalar_one()
    return annotation_id


def insert_upload(conn: Connection, user_id: int) -> None:
    execute(
        conn,
        "INSERT INTO uploads (id, user_id, content_type, data, byte_size, width, height, sha256) "
        "VALUES (gen_random_uuid(), :user_id, 'image/webp', '\\x00', 1, 1, 1, repeat('a', 64))",
        {"user_id": user_id},
    )


def insert_session(conn: Connection, user_id: int, token_hash: str = "a" * 64) -> None:
    execute(
        conn,
        "INSERT INTO user_sessions (user_id, token_hash, remember, expires_at) "
        "VALUES (:user_id, :token_hash, false, now() + interval '1 day')",
        {"user_id": user_id, "token_hash": token_hash},
    )


def insert_youtube_match(conn: Connection, key: str = "itunes:123", **values: Any) -> None:
    params = {"key": key, **values}
    columns = ", ".join(params)
    placeholders = ", ".join(f":{name}" for name in params)
    execute(
        conn,
        f"INSERT INTO youtube_matches (expires_at, {columns}) "  # noqa: S608 (fixed test columns)
        f"VALUES (now() + interval '30 days', {placeholders})",
        params,
    )


def constraint_violated(error: pytest.ExceptionInfo[IntegrityError]) -> str | None:
    orig = error.value.orig
    assert isinstance(orig, pg_errors.IntegrityError)
    return orig.diag.constraint_name


def count(conn: Connection, table: str) -> int:
    total: int = execute(conn, f"SELECT count(*) FROM {table}").scalar_one()  # noqa: S608
    return total


# --- Defaults --------------------------------------------------------------------------


def test_server_defaults(conn: Connection) -> None:
    user_id = insert_user(conn)
    row = execute(
        conn,
        "SELECT bio, theme, autoplay_previews, created_at, updated_at FROM users WHERE id = :id",
        {"id": user_id},
    ).one()
    assert row.bio == ""
    assert row.autoplay_previews is True
    assert row.theme == {}
    assert row.created_at is not None
    assert row.created_at == row.updated_at
    entry_id = insert_entry(conn, user_id)
    annotation_id = insert_annotation(conn, entry_id, 0, None)
    color = execute(
        conn, "SELECT color FROM annotations WHERE id = :id", {"id": annotation_id}
    ).scalar_one()
    assert color == "yellow"


def test_identity_columns_are_generated(conn: Connection) -> None:
    first, second = insert_user(conn, "a@example.com"), insert_user(conn, "b@example.com")
    assert second == first + 1


# --- CHECK constraints -----------------------------------------------------------------------


@pytest.mark.parametrize("source", ["spotify", "", "ITUNES"])
def test_entry_source_must_be_known(conn: Connection, source: str) -> None:
    user_id = insert_user(conn)
    with pytest.raises(IntegrityError) as excinfo:
        insert_entry(conn, user_id, source=source)
    assert isinstance(excinfo.value.orig, pg_errors.CheckViolation)
    assert constraint_violated(excinfo) == "ck_entries_source_valid"


@pytest.mark.parametrize("source", ["itunes", "manual"])
def test_entry_sources_that_are_allowed(conn: Connection, source: str) -> None:
    insert_entry(conn, insert_user(conn), source=source)


@pytest.mark.parametrize("start_ms", [-1, MAX_MS + 1])
def test_annotation_start_must_be_in_range(conn: Connection, start_ms: int) -> None:
    entry_id = insert_entry(conn, insert_user(conn))
    with pytest.raises(IntegrityError) as excinfo:
        insert_annotation(conn, entry_id, start_ms, None)
    assert constraint_violated(excinfo) == "ck_annotations_start_ms_range"


@pytest.mark.parametrize(
    ("start_ms", "end_ms"), [(1000, 1000), (1000, 999), (0, MAX_MS + 1), (5, 0)]
)
def test_annotation_end_must_follow_start(conn: Connection, start_ms: int, end_ms: int) -> None:
    entry_id = insert_entry(conn, insert_user(conn))
    with pytest.raises(IntegrityError) as excinfo:
        insert_annotation(conn, entry_id, start_ms, end_ms)
    assert constraint_violated(excinfo) == "ck_annotations_end_after_start"


@pytest.mark.parametrize(
    ("start_ms", "end_ms"), [(0, None), (MAX_MS, None), (0, 1), (MAX_MS - 1, MAX_MS)]
)
def test_annotation_boundaries_that_are_allowed(
    conn: Connection, start_ms: int, end_ms: int | None
) -> None:
    insert_annotation(conn, insert_entry(conn, insert_user(conn)), start_ms, end_ms)


# --- UNIQUE constraints ------------------------------------------------------------------------


def test_one_entry_per_user_per_day(conn: Connection) -> None:
    user_id = insert_user(conn)
    insert_entry(conn, user_id, "2026-10-11")
    insert_entry(conn, user_id, "2026-10-10")
    insert_entry(conn, insert_user(conn, "other@example.com"), "2026-10-11")
    with pytest.raises(IntegrityError) as excinfo:
        insert_entry(conn, user_id, "2026-10-11")
    assert isinstance(excinfo.value.orig, pg_errors.UniqueViolation)
    assert constraint_violated(excinfo) == "uq_entries_user_id_entry_date"


def test_emails_are_unique(conn: Connection) -> None:
    insert_user(conn)
    with pytest.raises(IntegrityError) as excinfo:
        insert_user(conn, username="someone-else")
    assert constraint_violated(excinfo) == "uq_users_email"


def test_usernames_are_unique(conn: Connection) -> None:
    insert_user(conn, "a@example.com", username="ada")
    with pytest.raises(IntegrityError) as excinfo:
        insert_user(conn, "b@example.com", username="ada")
    assert constraint_violated(excinfo) == "uq_users_username"


def test_username_is_required(conn: Connection) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        execute(
            conn,
            "INSERT INTO users (email, password_hash, display_name) VALUES ('a@b.co', 'x', 'Ada')",
        )
    assert isinstance(excinfo.value.orig, pg_errors.NotNullViolation)


@pytest.mark.parametrize(
    "username",
    ["", "ab", "Ada", "-ada", "ada-", "_ada", "ada_", "a.da", "a da", "zoë", "ada\n"],
)
def test_username_format_is_checked(conn: Connection, username: str) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        insert_user(conn, username=username)
    assert constraint_violated(excinfo) == "ck_users_username_format"


@pytest.mark.parametrize("username", ["ada", "a" * 30, "a-b_c", "0x1", "a--_b", "123"])
def test_usernames_that_are_allowed(conn: Connection, username: str) -> None:
    insert_user(conn, username=username)


@pytest.mark.parametrize("score", [-0.01, 1.01])
def test_youtube_match_score_must_be_in_range(conn: Connection, score: float) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        insert_youtube_match(conn, score=score)
    assert constraint_violated(excinfo) == "ck_youtube_matches_score_range"


@pytest.mark.parametrize("score", [None, 0.0, 0.7, 1.0])
def test_youtube_match_scores_that_are_allowed(conn: Connection, score: float | None) -> None:
    insert_youtube_match(conn, score=score)


def test_youtube_match_key_is_capped_in_bytes(conn: Connection) -> None:
    # 300 two-byte characters: inside the varchar(600) character limit, at the byte cap.
    insert_youtube_match(conn, key="é" * 300)
    with pytest.raises(IntegrityError) as excinfo:
        insert_youtube_match(conn, key="é" * 301)
    assert constraint_violated(excinfo) == "ck_youtube_matches_key_length"


def test_session_token_hashes_are_unique(conn: Connection) -> None:
    user_id = insert_user(conn)
    insert_session(conn, user_id)
    with pytest.raises(IntegrityError) as excinfo:
        insert_session(conn, user_id)
    assert constraint_violated(excinfo) == "uq_user_sessions_token_hash"


# --- Foreign keys and NOT NULL ---------------------------------------------------------------


def test_entries_need_an_existing_user(conn: Connection) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        insert_entry(conn, 999_999)
    assert constraint_violated(excinfo) == "fk_entries_user_id_users"


def test_annotations_need_an_existing_entry(conn: Connection) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        insert_annotation(conn, 999_999, 0, None)
    assert constraint_violated(excinfo) == "fk_annotations_entry_id_entries"


def test_required_columns_are_not_null(conn: Connection) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        execute(conn, "INSERT INTO users (email, password_hash) VALUES ('a@b.c', 'x')")
    assert isinstance(excinfo.value.orig, pg_errors.NotNullViolation)


# --- ON DELETE CASCADE -------------------------------------------------------------------------


def test_deleting_a_user_cascades_to_everything_they_own(conn: Connection) -> None:
    user_id = insert_user(conn)
    other_id = insert_user(conn, "other@example.com")
    insert_annotation(conn, insert_entry(conn, user_id), 0, None)
    insert_annotation(conn, insert_entry(conn, other_id), 0, None)
    insert_upload(conn, user_id)
    insert_session(conn, user_id)

    execute(conn, "DELETE FROM users WHERE id = :id", {"id": user_id})

    assert count(conn, "users") == 1
    assert count(conn, "entries") == 1
    assert count(conn, "annotations") == 1
    assert count(conn, "uploads") == 0
    assert count(conn, "user_sessions") == 0


def test_deleting_an_entry_cascades_to_its_annotations(conn: Connection) -> None:
    user_id = insert_user(conn)
    entry_id = insert_entry(conn, user_id)
    kept = insert_entry(conn, user_id, "2026-10-10")
    insert_annotation(conn, entry_id, 0, None)
    insert_annotation(conn, entry_id, 10, 20)
    insert_annotation(conn, kept, 0, None)
    execute(conn, "DELETE FROM entries WHERE id = :id", {"id": entry_id})
    assert count(conn, "annotations") == 1
