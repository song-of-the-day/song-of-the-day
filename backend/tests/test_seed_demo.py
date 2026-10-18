"""``flask sotd seed-demo``: the seeded history, idempotent resets and the production guard."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from click.testing import Result
from flask import Flask
from flask.testing import FlaskCliRunner
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sotd.demo import load_demo_entries
from sotd.models import Entry, User
from sotd.services.demo import (
    DEMO_BIO,
    DEMO_DISPLAY_NAME,
    DEMO_EMAIL,
    DEMO_PASSWORD,
    DEMO_USERNAME,
    ENTRY_SPACING_DAYS,
)
from sotd.theme import note_color_keys
from tests.clients import csrf_client, log_in
from tests.factories import EntryFactory
from tests.support import FROZEN_NOW

TODAY = FROZEN_NOW.date()
SEED_DEMO_ARGS = ["sotd", "seed-demo"]


def run_seed(cli_runner: FlaskCliRunner) -> Result:
    """Invoke ``flask sotd seed-demo`` and require success."""
    result = cli_runner.invoke(args=SEED_DEMO_ARGS)
    assert result.exit_code == 0, result.output
    return result


def demo_user(db_session: Session) -> User:
    """Return the seeded demo account, reloading it from the database."""
    db_session.expire_all()
    user = db_session.scalar(select(User).where(User.email == DEMO_EMAIL))
    assert user is not None
    return user


def demo_entries(db_session: Session, user: User) -> list[Entry]:
    """Return all of the demo account's entries, newest first."""
    db_session.expire_all()
    statement = select(Entry).where(Entry.user_id == user.id).order_by(Entry.entry_date.desc())
    return list(db_session.scalars(statement))


def test_bundled_demo_data_is_complete() -> None:
    entries = load_demo_entries()
    assert len(entries) == 45  # ~45 entries, one every two days, is 88 days of history.
    assert all(entry["title"] and entry["artist"] and entry["album"] for entry in entries)
    assert all(
        entry["artwork_url"] and entry["preview_url"] and entry["duration_ms"] > 0
        for entry in entries
    )
    assert len(
        {(entry["title"].casefold(), entry["artist"].casefold()) for entry in entries}
    ) == len(entries)
    # The garnish stays within the documented ranges.
    assert 15 <= sum("note" in entry for entry in entries) <= 20
    assert sum("youtube_video_id" in entry for entry in entries) == 6
    assert sum("annotations" in entry for entry in entries) == 8
    for entry in entries:
        assert all(annotation["body"] for annotation in entry.get("annotations", ()))
        assert all(
            annotation["color"] in note_color_keys() for annotation in entry.get("annotations", ())
        )


def test_seed_demo_creates_the_bundled_history(
    app: Flask, cli_runner: FlaskCliRunner, db_session: Session, frozen_time: object
) -> None:
    bundled = load_demo_entries()

    result = run_seed(cli_runner)

    assert result.output == f"Seeded {len(bundled)} entries for {DEMO_USERNAME} ({DEMO_EMAIL}).\n"

    user = demo_user(db_session)
    assert user.username == DEMO_USERNAME
    assert user.display_name == DEMO_DISPLAY_NAME
    assert user.bio == DEMO_BIO
    assert user.theme == {}
    assert user.autoplay_previews is True
    # The seeded credentials must pass the API's own email validation, not just the model.
    log_in(csrf_client(app), DEMO_EMAIL, DEMO_PASSWORD)

    entries = demo_entries(db_session, user)
    assert len(entries) == len(bundled)
    assert [entry.entry_date for entry in entries] == [
        TODAY - timedelta(days=ENTRY_SPACING_DAYS * offset) for offset in range(len(bundled))
    ]
    assert [(entry.title, entry.note, entry.youtube_video_id) for entry in entries] == [
        (song["title"], song.get("note"), song.get("youtube_video_id")) for song in bundled
    ]
    assert all(entry.source == "itunes" for entry in entries)
    for entry, song in zip(entries, bundled, strict=True):
        assert entry.duration_ms == song["duration_ms"]
        assert [annotation.start_ms for annotation in entry.annotations] == [
            annotation["start_ms"] for annotation in song.get("annotations", ())
        ]
        for annotation in entry.annotations:
            assert annotation.end_ms is None or (
                annotation.start_ms < annotation.end_ms <= (entry.duration_ms or 0)
            )


def test_seed_demo_refuses_in_production(
    app: Flask, cli_runner: FlaskCliRunner, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(app.config, "APP_ENV", "production")

    result = cli_runner.invoke(args=SEED_DEMO_ARGS)

    assert result.exit_code != 0
    assert "production" in result.output + result.stderr
    assert db_session.scalar(select(func.count()).select_from(User)) == 0
    assert db_session.scalar(select(func.count()).select_from(Entry)) == 0


def test_seed_demo_rerun_resets_without_duplicating(
    cli_runner: FlaskCliRunner,
    db_session: Session,
    entry_factory: EntryFactory,
    frozen_time: object,
) -> None:
    run_seed(cli_runner)
    user = demo_user(db_session)
    first = {(entry.entry_date, entry.title) for entry in demo_entries(db_session, user)}

    sentinel = entry_factory(user=user, entry_date=date(2025, 7, 4), title="Sentinel")
    sentinel_id = sentinel.id

    run_seed(cli_runner)

    user = demo_user(db_session)
    assert {(entry.entry_date, entry.title) for entry in demo_entries(db_session, user)} == first
    assert db_session.scalar(select(Entry.id).where(Entry.id == sentinel_id)) is None


def test_seed_demo_rerun_restores_the_demo_identity(
    app: Flask, cli_runner: FlaskCliRunner, db_session: Session, frozen_time: object
) -> None:
    run_seed(cli_runner)

    # A demo account whose email is invalid (as an older version of the seed left it): the
    # rerun must restore the canonical address, so the credentials it prints can log in.
    user = demo_user(db_session)
    user.email = "demo@sotd.test"
    db_session.commit()
    run_seed(cli_runner)
    assert demo_user(db_session).email == DEMO_EMAIL

    # A drifted handle: matched by the canonical email, the rerun restores the username too.
    user = demo_user(db_session)
    user.username = "demo-old"
    db_session.commit()
    run_seed(cli_runner)
    user = demo_user(db_session)
    assert (user.email, user.username) == (DEMO_EMAIL, DEMO_USERNAME)

    log_in(csrf_client(app), DEMO_EMAIL, DEMO_PASSWORD)
