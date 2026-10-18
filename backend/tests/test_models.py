from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

import time_machine
from sqlalchemy import func, inspect, select
from sqlalchemy.orm import Session

from sotd import clock
from sotd.models import Annotation, Entry, Upload, User, UserSession
from sotd.security import hash_token
from tests.factories import AnnotationFactory, EntryFactory, UploadFactory, UserFactory
from tests.support import FROZEN_NOW


def count(session: Session, model: type[object]) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


# --- Clock -----------------------------------------------------------------------------


def test_clock_reads_frozen_time(frozen_time: time_machine.Traveller) -> None:
    assert clock.utcnow() == FROZEN_NOW
    assert clock.utcnow().utcoffset() == timedelta(0)
    assert clock.today_utc() == date(2026, 10, 11)


def test_today_utc_follows_utc_not_local_time(frozen_time: time_machine.Traveller) -> None:
    frozen_time.move_to(datetime.fromisoformat("2026-10-11T23:59:59-04:00"))
    assert clock.today_utc() == date(2026, 10, 12)


# --- Users and sessions ------------------------------------------------------------------


def test_user_defaults(db_session: Session, frozen_time: time_machine.Traveller) -> None:
    user = User(email="ada@example.com", username="ada", password_hash="x", display_name="Ada")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    assert isinstance(user.id, int)
    assert user.bio == ""
    assert user.autoplay_previews is True
    assert user.theme == {}
    assert user.created_at == FROZEN_NOW
    assert user.updated_at == FROZEN_NOW


def test_updated_at_moves_on_update(
    user_factory: UserFactory, db_session: Session, frozen_time: time_machine.Traveller
) -> None:
    user = user_factory()
    frozen_time.shift(timedelta(minutes=5))
    user.display_name = "Grace"
    db_session.commit()
    db_session.refresh(user)
    assert user.created_at == FROZEN_NOW
    assert user.updated_at == FROZEN_NOW + timedelta(minutes=5)


def test_theme_round_trips_as_json(user_factory: UserFactory, db_session: Session) -> None:
    theme = {"preset": "custom", "background": {"image_upload_id": None}, "n": [1, 2]}
    user = user_factory(theme=theme)
    db_session.expire_all()
    assert db_session.get_one(User, user.id).theme == theme


def test_user_session(
    user_factory: UserFactory, db_session: Session, frozen_time: time_machine.Traveller
) -> None:
    user = user_factory()
    session_row = UserSession(
        user=user,
        token_hash=hash_token("raw-token"),
        remember=True,
        expires_at=FROZEN_NOW + timedelta(days=30),
    )
    db_session.add(session_row)
    db_session.commit()
    db_session.refresh(session_row)
    assert session_row.user_id == user.id
    assert session_row.created_at == FROZEN_NOW
    assert session_row.last_seen_at == FROZEN_NOW
    assert user.sessions == [session_row]


# --- Entries and annotations ----------------------------------------------------------------


def test_entry_fields_round_trip(entry_factory: EntryFactory, db_session: Session) -> None:
    entry = entry_factory(
        entry_date=date(2026, 10, 11),
        source="itunes",
        album="In Colour",
        artwork_url="https://is1-ssl.mzstatic.com/image/600x600bb.jpg",
        preview_url="https://audio-ssl.itunes.apple.com/p.m4a",
        external_url="https://music.apple.com/us/album/gosh/1",
        youtube_video_id="dQw4w9WgXcQ",
        duration_ms=290_973,
        source_id="1525506452",
        note="the build at 2:30\nlives in my head",
    )
    db_session.expire_all()
    loaded = db_session.get_one(Entry, entry.id)
    assert loaded.entry_date == date(2026, 10, 11)
    assert loaded.album == "In Colour"
    assert loaded.duration_ms == 290_973
    assert loaded.note == "the build at 2:30\nlives in my head"
    assert loaded.user.entries == [loaded]


def test_annotations_are_ordered_by_start_then_id(
    entry_factory: EntryFactory, annotation_factory: AnnotationFactory, db_session: Session
) -> None:
    entry = entry_factory()
    late = annotation_factory(entry=entry, start_ms=5_000)
    first_tie = annotation_factory(entry=entry, start_ms=1_000, end_ms=2_000)
    second_tie = annotation_factory(entry=entry, start_ms=1_000)
    db_session.expire_all()
    loaded = db_session.get_one(Entry, entry.id)
    assert [a.id for a in loaded.annotations] == [first_tie.id, second_tie.id, late.id]


def test_annotation_color_defaults_to_yellow(
    entry_factory: EntryFactory, db_session: Session
) -> None:
    annotation = Annotation(entry=entry_factory(), start_ms=0, body="hi")
    db_session.add(annotation)
    db_session.commit()
    db_session.refresh(annotation)
    assert annotation.color == "yellow"
    assert annotation.end_ms is None


# --- Uploads -------------------------------------------------------------------------------


def test_upload_ids_are_random_uuids(upload_factory: UploadFactory) -> None:
    first, second = upload_factory(), upload_factory()
    assert isinstance(first.id, uuid.UUID)
    assert first.id.version == 4
    assert first.id != second.id


def test_upload_data_is_deferred(upload_factory: UploadFactory, db_session: Session) -> None:
    upload = upload_factory(data=b"tiny-bytes")
    db_session.expunge_all()
    loaded = db_session.scalars(select(Upload).where(Upload.id == upload.id)).one()
    assert "data" in inspect(loaded).unloaded
    assert loaded.byte_size == len(b"tiny-bytes")
    assert loaded.data == b"tiny-bytes"


# --- ORM cascades -------------------------------------------------------------------------------


def test_deleting_a_user_through_the_orm_cascades(
    user_factory: UserFactory,
    entry_factory: EntryFactory,
    annotation_factory: AnnotationFactory,
    upload_factory: UploadFactory,
    db_session: Session,
) -> None:
    user, other = user_factory(), user_factory()
    annotation_factory(entry=entry_factory(user=user))
    upload_factory(user=user)
    db_session.add(
        UserSession(user=user, token_hash=hash_token("t"), remember=False, expires_at=FROZEN_NOW)
    )
    annotation_factory(entry=entry_factory(user=other))
    db_session.commit()

    db_session.delete(user)
    db_session.commit()

    assert count(db_session, User) == 1
    assert count(db_session, Entry) == 1
    assert count(db_session, Annotation) == 1
    assert count(db_session, Upload) == 0
    assert count(db_session, UserSession) == 0


def test_deleting_an_entry_through_the_orm_cascades(
    entry_factory: EntryFactory, annotation_factory: AnnotationFactory, db_session: Session
) -> None:
    entry = entry_factory()
    annotation_factory(entry=entry)
    annotation_factory(entry=entry, start_ms=10)
    db_session.delete(entry)
    db_session.commit()
    assert count(db_session, Annotation) == 0
