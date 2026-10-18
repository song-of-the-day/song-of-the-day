"""``GET /api/account/export``: everything a user owns as a JSON download."""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
import time_machine
from flask import Flask
from sqlalchemy.orm import Session

from sotd.models import User
from sotd.schemas.common import format_utc_timestamp
from sotd.services.export import export_filename
from sotd.theme import get_theme_options
from tests.clients import CsrfClient
from tests.factories import AnnotationFactory, EntryFactory, UserFactory
from tests.sql_recorder import recorded_sql

EXPORT_URL = "/api/account/export"
STAMP = "2026-10-11T12:00:00Z"  # FROZEN_NOW: when the test rows are created.


def export(client: CsrfClient) -> dict[str, Any]:
    response = client.get(EXPORT_URL)
    assert response.status_code == 200, response.get_json()
    document: dict[str, Any] = response.get_json()
    return document


def test_export_contains_the_profile_entries_and_annotations(
    frozen_time: time_machine.Traveller,
    auth_client: CsrfClient,
    auth_user: User,
    user_factory: UserFactory,
    entry_factory: EntryFactory,
    annotation_factory: AnnotationFactory,
    db_session: Session,
) -> None:
    auth_user.bio = "currently obsessed with breakbeats"
    auth_user.theme = {"preset": "paper", "colors": {"accent": "#ff0000"}, "junk": 1}
    db_session.commit()
    older = entry_factory(user=auth_user, entry_date=date(2026, 9, 30), title="Older", artist="A")
    newer = entry_factory(
        user=auth_user,
        entry_date=date(2026, 10, 11),
        album="In Colour",
        artwork_url="https://is1-ssl.mzstatic.com/image/thumb/600x600bb.jpg",
        preview_url="https://audio-ssl.itunes.apple.com/preview.m4a",
        external_url="https://music.apple.com/us/album/gosh/1525506447?i=1525506452",
        youtube_video_id="dQw4w9WgXcQ",
        duration_ms=290_973,
        source="itunes",
        source_id="1525506452",
        note="the build at 2:30",
    )
    annotation_factory(
        entry=newer, start_ms=150_000, end_ms=171_500, body="the build", color="pink"
    )
    annotation_factory(entry=newer, start_ms=1_000, body="intro")
    annotation_factory(entry=newer, start_ms=1_000, body="same instant, added later")
    someone_else = entry_factory(user=user_factory(), entry_date=date(2026, 10, 10), title="Theirs")
    annotation_factory(entry=someone_else, body="not mine")
    frozen_time.shift(3600)

    document = export(auth_client)

    paper = get_theme_options().preset_theme("paper")
    paper["colors"]["accent"] = "#FF0000"

    def entry_fields(**overrides: Any) -> dict[str, Any]:
        fields: dict[str, Any] = {
            "title": "Gosh",
            "artist": "Jamie xx",
            "album": None,
            "artwork_url": None,
            "preview_url": None,
            "external_url": None,
            "youtube_video_id": None,
            "duration_ms": None,
            "source": "manual",
            "source_id": None,
            "note": None,
            "created_at": STAMP,
            "updated_at": STAMP,
        }
        return {**fields, **overrides}

    def note(
        start_ms: int, body: str, end_ms: int | None = None, color: str = "yellow"
    ) -> dict[str, Any]:
        return {
            "start_ms": start_ms,
            "end_ms": end_ms,
            "body": body,
            "color": color,
            "created_at": STAMP,
        }

    assert document == {
        "format": "sotd-export",
        "version": 1,
        "exported_at": "2026-10-11T13:00:00Z",
        "user": {
            "email": "ada@example.com",
            "username": "ada",
            "display_name": "Ada",
            "bio": "currently obsessed with breakbeats",
            "theme": paper,
            "autoplay_previews": True,
            "created_at": format_utc_timestamp(auth_user.created_at),
        },
        "entries": [
            {
                "entry_date": "2026-10-11",
                **entry_fields(
                    album=newer.album,
                    artwork_url=newer.artwork_url,
                    preview_url=newer.preview_url,
                    external_url=newer.external_url,
                    youtube_video_id="dQw4w9WgXcQ",
                    duration_ms=290_973,
                    source="itunes",
                    source_id="1525506452",
                    note="the build at 2:30",
                ),
                "annotations": [
                    note(1_000, "intro"),
                    note(1_000, "same instant, added later"),
                    note(150_000, "the build", end_ms=171_500, color="pink"),
                ],
            },
            {
                "entry_date": "2026-09-30",
                **entry_fields(title=older.title, artist=older.artist),
                "annotations": [],
            },
        ],
    }


def test_export_is_a_dated_attachment_that_is_never_cached(
    auth_client: CsrfClient, frozen_time: time_machine.Traveller
) -> None:
    frozen_time.move_to("2026-10-11T23:59:59Z")
    response = auth_client.get(EXPORT_URL)

    assert response.status_code == 200
    assert response.mimetype == "application/json"
    assert response.headers["Content-Disposition"] == (
        'attachment; filename="sotd-export-2026-10-11.json"'
    )
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.get_json()["exported_at"] == "2026-10-11T23:59:59Z"

    frozen_time.move_to("2026-10-12T00:00:00Z")  # The filename uses the UTC date.
    response = auth_client.get(EXPORT_URL)
    assert response.headers["Content-Disposition"] == (
        'attachment; filename="sotd-export-2026-10-12.json"'
    )


def test_export_of_a_new_account(auth_client: CsrfClient, auth_user: User) -> None:
    document = export(auth_client)
    assert document["user"]["theme"] == get_theme_options().preset_theme("chrome")
    assert document["user"]["bio"] == ""
    assert document["entries"] == []


def test_export_query_count_does_not_grow_with_the_entries(
    app: Flask,
    auth_client: CsrfClient,
    auth_user: User,
    entry_factory: EntryFactory,
    annotation_factory: AnnotationFactory,
) -> None:
    def queries() -> int:
        with recorded_sql(app) as statements:
            export(auth_client)
        return len(statements)

    annotation_factory(entry=entry_factory(user=auth_user))
    baseline = queries()
    for _ in range(5):
        annotation_factory(entry=entry_factory(user=auth_user))
    assert queries() == baseline


def test_export_requires_a_login(app: Flask) -> None:
    response = app.test_client().get(EXPORT_URL)
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "unauthorized"


@pytest.mark.parametrize(
    ("day", "filename"),
    [
        (date(2026, 1, 2), "sotd-export-2026-01-02.json"),
        (date(999, 12, 31), "sotd-export-0999-12-31.json"),
    ],
)
def test_export_filename(day: date, filename: str) -> None:
    assert export_filename(day) == filename
