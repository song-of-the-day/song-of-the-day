from __future__ import annotations

from datetime import datetime, timedelta

import time_machine
from flask import Flask
from flask.testing import FlaskCliRunner
from sqlalchemy import select
from sqlalchemy.orm import Session

from sotd.extensions import db
from sotd.models import Upload, User, UserSession, YouTubeMatch
from sotd.security import generate_session_token, hash_token
from sotd.services.housekeeping import (
    delete_expired_sessions,
    delete_unreferenced_uploads,
)
from tests.factories import UploadFactory, UserFactory
from tests.support import FROZEN_NOW

HOUR = timedelta(hours=1)


def add_session(session: Session, user: User, expires_at: datetime) -> UserSession:
    row = UserSession(
        user=user,
        token_hash=hash_token(generate_session_token()),
        remember=False,
        expires_at=expires_at,
    )
    session.add(row)
    session.commit()
    return row


def reference(session: Session, user: User, upload_id: str) -> None:
    user.theme = {"preset": "custom", "background": {"image_upload_id": upload_id}}
    session.commit()


def remaining_sessions(session: Session) -> set[int]:
    session.expire_all()
    return set(session.scalars(select(UserSession.id)))


def remaining_uploads(session: Session) -> set[object]:
    session.expire_all()
    return set(session.scalars(select(Upload.id)))


def add_match(session: Session, key: str, expires_at: datetime) -> YouTubeMatch:
    row = YouTubeMatch(key=key, expires_at=expires_at)
    session.add(row)
    session.commit()
    return row


def remaining_matches(session: Session) -> set[str]:
    session.expire_all()
    return set(session.scalars(select(YouTubeMatch.key)))


def test_prune_command(
    cli_runner: FlaskCliRunner,
    user_factory: UserFactory,
    upload_factory: UploadFactory,
    db_session: Session,
    frozen_time: time_machine.Traveller,
) -> None:
    user, other = user_factory(), user_factory()
    add_session(db_session, user, FROZEN_NOW - timedelta(seconds=1))
    add_session(db_session, other, FROZEN_NOW)  # Expires exactly now: pruned.
    alive = add_session(db_session, user, FROZEN_NOW + timedelta(seconds=1))

    old_orphan = upload_factory(user=user, created_at=FROZEN_NOW - 2 * HOUR)
    old_referenced = upload_factory(user=user, created_at=FROZEN_NOW - 2 * HOUR)
    fresh_orphan = upload_factory(user=user, created_at=FROZEN_NOW - HOUR + timedelta(seconds=1))
    # Only the owner's theme protects an upload.
    referenced_by_someone_else = upload_factory(user=other, created_at=FROZEN_NOW - 2 * HOUR)
    reference(db_session, user, str(old_referenced.id).upper())
    reference(db_session, other, str(old_orphan.id))
    user_factory(theme={"background": {"image_upload_id": str(referenced_by_someone_else.id)}})

    add_match(db_session, "q:old artist|old song|285", FROZEN_NOW - timedelta(seconds=1))
    add_match(db_session, "itunes:42", FROZEN_NOW)  # Expires exactly now: pruned.
    live_match = add_match(db_session, "itunes:43", FROZEN_NOW + timedelta(seconds=1))

    result = cli_runner.invoke(args=["sotd", "prune"])

    assert result.exit_code == 0, result.output
    assert result.output == (
        "Pruned 2 expired session(s), 2 unreferenced upload(s) and 2 expired YouTube match(es).\n"
    )
    assert remaining_sessions(db_session) == {alive.id}
    assert remaining_uploads(db_session) == {old_referenced.id, fresh_orphan.id}
    assert remaining_matches(db_session) == {live_match.key}


def test_prune_with_nothing_to_do(cli_runner: FlaskCliRunner, frozen_time: object) -> None:
    result = cli_runner.invoke(args=["sotd", "prune"])
    assert result.exit_code == 0
    assert result.output == (
        "Pruned 0 expired session(s), 0 unreferenced upload(s) and 0 expired YouTube match(es).\n"
    )


def test_prune_keeps_uploads_of_users_with_malformed_themes(
    cli_runner: FlaskCliRunner,
    user_factory: UserFactory,
    upload_factory: UploadFactory,
    db_session: Session,
    frozen_time: object,
) -> None:
    user = user_factory(theme={"background": "not-an-object"})
    upload = upload_factory(user=user, created_at=FROZEN_NOW - 2 * HOUR)
    result = cli_runner.invoke(args=["sotd", "prune"])
    assert result.exit_code == 0, result.output
    # A theme without a usable reference references nothing, so the upload goes.
    assert upload.id not in remaining_uploads(db_session)


def test_housekeeping_can_be_scoped_to_one_user(
    app: Flask,
    user_factory: UserFactory,
    upload_factory: UploadFactory,
    db_session: Session,
) -> None:
    user, other = user_factory(), user_factory()
    add_session(db_session, user, FROZEN_NOW - HOUR)
    other_session = add_session(db_session, other, FROZEN_NOW - HOUR)
    upload_factory(user=user, created_at=FROZEN_NOW - 2 * HOUR)
    other_upload = upload_factory(user=other, created_at=FROZEN_NOW - 2 * HOUR)

    with app.app_context():
        assert delete_expired_sessions(now=FROZEN_NOW, user_id=user.id) == 1
        assert delete_unreferenced_uploads(older_than=FROZEN_NOW - HOUR, user_id=user.id) == 1
        db.session.commit()

    assert remaining_sessions(db_session) == {other_session.id}
    assert remaining_uploads(db_session) == {other_upload.id}


def test_housekeeping_changes_are_not_committed_by_the_service(
    app: Flask, user_factory: UserFactory, upload_factory: UploadFactory, db_session: Session
) -> None:
    upload = upload_factory(user=user_factory(), created_at=FROZEN_NOW - 2 * HOUR)
    with app.app_context():
        assert delete_unreferenced_uploads(older_than=FROZEN_NOW) == 1
        db.session.rollback()
    assert remaining_uploads(db_session) == {upload.id}
