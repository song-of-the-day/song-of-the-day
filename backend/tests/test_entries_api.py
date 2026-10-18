"""``POST/GET/PATCH/DELETE /api/entries[/<id>]``."""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

import pytest
import time_machine
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from sotd.api.entries import MAX_ID, IdConverter
from sotd.extensions import db
from sotd.models import Annotation, Entry, User
from sotd.schemas.entry import EntryCreateIn
from sotd.services import entries
from tests.clients import CSRF_HEADER, CsrfClient, csrf_client, log_in
from tests.factories import AnnotationFactory, EntryFactory, UserFactory

pytestmark = pytest.mark.usefixtures("frozen_time")  # 2026-10-11T12:00:00Z

ENTRIES_URL = "/api/entries"
NOW = "2026-10-11T12:00:00Z"
ARTWORK = "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b9/dc/ce/600x600bb.jpg"
PREVIEW = "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/mzaf_1.plus.aac.p.m4a"
#: Every optional song field, set (as the factory takes them).
SONG_FIELDS: dict[str, Any] = {
    "album": "In Colour",
    "artwork_url": ARTWORK,
    "preview_url": PREVIEW,
    "external_url": "https://music.apple.com/us/album/gosh/1525506447?i=1525506452",
    "youtube_video_id": "dQw4w9WgXcQ",
    "duration_ms": 290_973,
    "source_id": "1525506452",
    "note": "the build at 2:30 lives in my head rent free",
}
FULL_INPUT: dict[str, Any] = {
    "entry_date": "2026-10-11",
    "title": "Gosh",
    "artist": "Jamie xx",
    "source": "itunes",
    **SONG_FIELDS,
}
OPTIONAL_FIELDS = list(SONG_FIELDS)
REQUIRED_FIELDS = ["entry_date", "title", "artist", "source"]


def entry_url(entry_id: int) -> str:
    return f"{ENTRIES_URL}/{entry_id}"


def assert_error(response: TestResponse, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.get_json()
    assert response.headers["Cache-Control"] == "no-store"
    error: dict[str, Any] = response.get_json()["error"]
    assert error["code"] == code
    return error


def stored_entries(db_session: Session) -> list[Entry]:
    db_session.expire_all()
    return list(db_session.scalars(select(Entry).order_by(Entry.id)))


def annotation_total(db_session: Session) -> int:
    return db_session.scalar(select(func.count()).select_from(Annotation)) or 0


def full_entry(entry_factory: EntryFactory, user: User, **fields: Any) -> Entry:
    return entry_factory(user=user, source="itunes", **{**SONG_FIELDS, **fields})


# --- Create -------------------------------------------------------------------------------


def test_create_returns_the_entry_detail(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    response = auth_client.post(ENTRIES_URL, json=FULL_INPUT)

    assert response.status_code == 201, response.get_json()
    assert response.headers["Cache-Control"] == "no-store"
    [row] = stored_entries(db_session)
    assert response.get_json() == {
        "entry": {
            "id": row.id,
            **FULL_INPUT,
            "annotation_count": 0,
            "annotations": [],
            "created_at": NOW,
            "updated_at": NOW,
        }
    }
    assert row.user_id == auth_user.id
    assert row.entry_date == date(2026, 10, 11)
    assert row.preview_url == PREVIEW


def test_create_applies_the_defaults_and_trims(
    auth_client: CsrfClient, db_session: Session
) -> None:
    response = auth_client.post(
        ENTRIES_URL,
        json={"entry_date": "2026-10-10", "title": " Gosh ", "artist": "Jamie xx", "note": "  "},
    )

    assert response.status_code == 201, response.get_json()
    entry = response.get_json()["entry"]
    assert entry["title"] == "Gosh"
    assert entry["source"] == "manual"
    assert all(entry[field] is None for field in OPTIONAL_FIELDS)
    assert stored_entries(db_session)[0].note is None


@pytest.mark.parametrize(
    ("entry_date", "status"),
    [
        ("1899-12-31", 422),
        ("1900-01-01", 201),
        ("2026-10-11", 201),
        ("2026-10-12", 201),  # today_utc + 1 day
        ("2026-10-13", 422),  # today_utc + 2 days
    ],
)
def test_create_checks_the_date_range(
    auth_client: CsrfClient, entry_date: str, status: int
) -> None:
    response = auth_client.post(ENTRIES_URL, json={**FULL_INPUT, "entry_date": entry_date})
    assert response.status_code == status, response.get_json()


def test_the_date_limit_follows_the_utc_clock(
    auth_client: CsrfClient, frozen_time: time_machine.Traveller
) -> None:
    body = {**FULL_INPUT, "entry_date": "2026-10-13"}
    assert auth_client.post(ENTRIES_URL, json=body).status_code == 422
    frozen_time.shift(timedelta(hours=12))  # 2026-10-12T00:00:00Z
    assert auth_client.post(ENTRIES_URL, json=body).status_code == 201


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        (
            "artwork_url",
            "http://is1-ssl.mzstatic.com/a.jpg",
            "Must be an https link on mzstatic.com.",
        ),
        ("artwork_url", "https://notmzstatic.com/a.jpg", "Must be an https link on mzstatic.com."),
        (
            "preview_url",
            "https://evilapple.com/a.m4a",
            "Must be an https link on itunes.apple.com or mzstatic.com.",
        ),
        (
            "preview_url",
            "https://apple.com.evil.net/a.m4a",
            "Must be an https link on itunes.apple.com or mzstatic.com.",
        ),
        ("external_url", "javascript:alert(1)", "Must be an http or https link."),
        ("youtube_video_id", "dQw4w9WgXc", "Must be an 11-character YouTube video id."),
        ("duration_ms", 86_400_001, "Must be at most 86400000."),
        ("duration_ms", "290973", "Must be an integer."),
        ("source", "spotify", "Must be one of: itunes, manual."),
        ("source_id", "9" * 65, "Must be at most 64 characters."),
        ("title", "Go\x00sh", "Contains characters that aren't allowed."),
        ("artist", "Jamie\nxx", "Must be a single line."),
        ("album", "x" * 301, "Must be at most 300 characters."),
        ("note", "bell\x07", "Contains characters that aren't allowed."),
        ("note", "x" * 5001, "Must be at most 5000 characters."),
        ("entry_date", "10/11/2026", "Must be a date in YYYY-MM-DD format."),
        ("user_id", 2, "Unknown field."),
    ],
)
def test_create_rejects_invalid_fields(
    auth_client: CsrfClient, db_session: Session, field: str, value: object, message: str
) -> None:
    response = auth_client.post(ENTRIES_URL, json={**FULL_INPUT, field: value})

    error = assert_error(response, 422, "validation_error")
    assert error["fields"] == {field: message}
    assert stored_entries(db_session) == []


def test_create_reports_every_invalid_field(auth_client: CsrfClient) -> None:
    response = auth_client.post(ENTRIES_URL, json={"title": "", "source": None})

    assert assert_error(response, 422, "validation_error")["fields"] == {
        "entry_date": "This field is required.",
        "title": "Must not be blank.",
        "artist": "This field is required.",
        "source": "Cannot be null.",
    }


def test_create_on_a_taken_day_is_409_with_the_existing_id(
    auth_client: CsrfClient, auth_user: User, entry_factory: EntryFactory, db_session: Session
) -> None:
    existing = entry_factory(user=auth_user, entry_date=date(2026, 10, 11))

    response = auth_client.post(ENTRIES_URL, json=FULL_INPUT)

    error = assert_error(response, 409, "entry_exists")
    assert error["existing_entry_id"] == existing.id
    assert [row.id for row in stored_entries(db_session)] == [existing.id]


def test_another_users_entry_does_not_take_the_day(
    auth_client: CsrfClient, entry_factory: EntryFactory
) -> None:
    entry_factory(entry_date=date(2026, 10, 11))  # Someone else's.
    assert auth_client.post(ENTRIES_URL, json=FULL_INPUT).status_code == 201


def test_other_integrity_errors_are_not_reported_as_a_taken_day(app: Flask) -> None:
    fields = EntryCreateIn.model_validate(FULL_INPUT)
    with app.app_context():
        with pytest.raises(IntegrityError, match="fk_entries_user_id_users"):
            entries.create_entry(999, fields)  # No such user.
        assert not db.session.new  # Rolled back.


def test_create_needs_a_json_body(auth_client: CsrfClient) -> None:
    assert_error(
        auth_client.post(ENTRIES_URL, data="x", content_type="text/plain"),
        415,
        "unsupported_media_type",
    )
    assert_error(
        auth_client.post(ENTRIES_URL, data="{", content_type="application/json"),
        400,
        "invalid_json",
    )


# --- Read ---------------------------------------------------------------------------------


def test_get_returns_the_entry_with_its_annotations_in_order(
    auth_client: CsrfClient,
    auth_user: User,
    entry_factory: EntryFactory,
    annotation_factory: AnnotationFactory,
) -> None:
    entry = full_entry(entry_factory, auth_user)
    late = annotation_factory(entry=entry, start_ms=5000, body="late")
    early_range = annotation_factory(entry=entry, start_ms=1000, end_ms=2000, color="pink")
    early_point = annotation_factory(entry=entry, start_ms=1000, body="same start")
    annotation_factory(start_ms=0)  # On someone else's entry.

    response = auth_client.get(entry_url(entry.id))

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    body = response.get_json()["entry"]
    assert body["annotation_count"] == 3
    assert [note["id"] for note in body["annotations"]] == [
        early_range.id,
        early_point.id,
        late.id,
    ]
    assert body["annotations"][0] == {
        "id": early_range.id,
        "entry_id": entry.id,
        "start_ms": 1000,
        "end_ms": 2000,
        "body": "the build",
        "color": "pink",
        "created_at": NOW,
        "updated_at": NOW,
    }
    assert {key: body[key] for key in SONG_FIELDS} == SONG_FIELDS
    assert (body["entry_date"], body["source"]) == ("2026-10-11", "itunes")


# --- Update -------------------------------------------------------------------------------


def test_patch_changes_only_the_fields_sent(
    auth_client: CsrfClient,
    auth_user: User,
    entry_factory: EntryFactory,
    annotation_factory: AnnotationFactory,
    frozen_time: time_machine.Traveller,
) -> None:
    entry = full_entry(entry_factory, auth_user)
    annotation_factory(entry=entry)
    frozen_time.shift(timedelta(minutes=5))

    response = auth_client.patch(
        entry_url(entry.id), json={"title": " Loud Places ", "artist": "Jamie xx, Romy"}
    )

    assert response.status_code == 200, response.get_json()
    body = response.get_json()["entry"]
    assert (body["title"], body["artist"]) == ("Loud Places", "Jamie xx, Romy")
    assert {key: body[key] for key in SONG_FIELDS} == SONG_FIELDS
    assert body["source"] == "itunes"  # The create default doesn't apply.
    assert body["annotation_count"] == len(body["annotations"]) == 1
    assert (body["created_at"], body["updated_at"]) == (NOW, "2026-10-11T12:05:00Z")


def test_an_empty_patch_returns_the_entry_unchanged(
    auth_client: CsrfClient, auth_user: User, entry_factory: EntryFactory
) -> None:
    entry = full_entry(entry_factory, auth_user)
    before = auth_client.get(entry_url(entry.id)).get_json()

    response = auth_client.patch(entry_url(entry.id))

    assert response.status_code == 200
    assert response.get_json() == before


@pytest.mark.parametrize("field", OPTIONAL_FIELDS)
def test_patch_null_clears_an_optional_field(
    auth_client: CsrfClient,
    auth_user: User,
    entry_factory: EntryFactory,
    db_session: Session,
    field: str,
) -> None:
    entry = full_entry(entry_factory, auth_user)

    response = auth_client.patch(entry_url(entry.id), json={field: None})

    assert response.status_code == 200, response.get_json()
    body = response.get_json()["entry"]
    assert body[field] is None
    assert {key: body[key] for key in SONG_FIELDS if key != field} == {
        key: value for key, value in SONG_FIELDS.items() if key != field
    }
    assert getattr(stored_entries(db_session)[0], field) is None


@pytest.mark.parametrize("field", ["album", "note", "source_id", "external_url"])
def test_patch_stores_a_blank_optional_string_as_null(
    auth_client: CsrfClient, auth_user: User, entry_factory: EntryFactory, field: str
) -> None:
    entry = full_entry(entry_factory, auth_user)
    response = auth_client.patch(entry_url(entry.id), json={field: "   "})
    assert response.get_json()["entry"][field] is None


@pytest.mark.parametrize("field", REQUIRED_FIELDS)
def test_patch_null_on_a_required_field_is_422(
    auth_client: CsrfClient,
    auth_user: User,
    entry_factory: EntryFactory,
    db_session: Session,
    field: str,
) -> None:
    entry = full_entry(entry_factory, auth_user)

    response = auth_client.patch(entry_url(entry.id), json={field: None})

    assert assert_error(response, 422, "validation_error")["fields"] == {field: "Cannot be null."}
    stored = stored_entries(db_session)[0]
    assert (stored.entry_date, stored.title, stored.artist, stored.source) == (
        date(2026, 10, 11),
        "Gosh",
        "Jamie xx",
        "itunes",
    )


@pytest.mark.parametrize(
    ("changes", "fields"),
    [
        ({"entry_date": "2026-10-13"}, {"entry_date": "Must not be in the future."}),
        ({"entry_date": "1899-12-31"}, {"entry_date": "Must be on or after 1900-01-01."}),
        ({"title": ""}, {"title": "Must not be blank."}),
        (
            {"artwork_url": "https://mzstatic.com.evil.net/a.jpg"},
            {"artwork_url": "Must be an https link on mzstatic.com."},
        ),
        ({"id": 5}, {"id": "Unknown field."}),
    ],
)
def test_patch_rejects_invalid_fields(
    auth_client: CsrfClient,
    auth_user: User,
    entry_factory: EntryFactory,
    changes: dict[str, Any],
    fields: dict[str, str],
) -> None:
    entry = full_entry(entry_factory, auth_user)
    response = auth_client.patch(entry_url(entry.id), json=changes)
    assert assert_error(response, 422, "validation_error")["fields"] == fields


def test_patch_can_move_an_entry_to_a_free_day(
    auth_client: CsrfClient, auth_user: User, entry_factory: EntryFactory, db_session: Session
) -> None:
    entry = entry_factory(user=auth_user, entry_date=date(2026, 10, 11))

    response = auth_client.patch(entry_url(entry.id), json={"entry_date": "2026-10-12"})

    assert response.status_code == 200
    assert response.get_json()["entry"]["entry_date"] == "2026-10-12"
    assert stored_entries(db_session)[0].entry_date == date(2026, 10, 12)


def test_patch_may_resend_the_entrys_own_day(
    auth_client: CsrfClient, auth_user: User, entry_factory: EntryFactory
) -> None:
    entry = entry_factory(user=auth_user, entry_date=date(2026, 10, 11))
    response = auth_client.patch(entry_url(entry.id), json={"entry_date": "2026-10-11"})
    assert response.status_code == 200


def test_patch_onto_a_taken_day_is_409_and_changes_nothing(
    auth_client: CsrfClient, auth_user: User, entry_factory: EntryFactory, db_session: Session
) -> None:
    taken = entry_factory(user=auth_user, entry_date=date(2026, 10, 11))
    moved = entry_factory(user=auth_user, entry_date=date(2026, 10, 10), title="Loud Places")

    response = auth_client.patch(
        entry_url(moved.id), json={"entry_date": "2026-10-11", "title": "Changed"}
    )

    error = assert_error(response, 409, "entry_exists")
    assert error["existing_entry_id"] == taken.id
    rows = {row.id: (row.entry_date, row.title) for row in stored_entries(db_session)}
    assert rows == {
        taken.id: (date(2026, 10, 11), "Gosh"),
        moved.id: (date(2026, 10, 10), "Loud Places"),
    }


# --- Delete -------------------------------------------------------------------------------


def test_delete_removes_the_entry_and_its_annotations(
    auth_client: CsrfClient,
    auth_user: User,
    entry_factory: EntryFactory,
    annotation_factory: AnnotationFactory,
    db_session: Session,
) -> None:
    entry = entry_factory(user=auth_user)
    kept = entry_factory(user=auth_user)
    for start_ms in (0, 1000):
        annotation_factory(entry=entry, start_ms=start_ms)
    annotation_factory(entry=kept)
    url, kept_id = entry_url(entry.id), kept.id

    response = auth_client.delete(url)

    assert response.status_code == 204
    assert response.data == b""
    assert [row.id for row in stored_entries(db_session)] == [kept_id]
    assert annotation_total(db_session) == 1
    assert_error(auth_client.get(url), 404, "not_found")
    assert_error(auth_client.delete(url), 404, "not_found")


# --- Ownership, auth and CSRF ---------------------------------------------------------------

BY_ID_ROUTES = [
    pytest.param("GET", None, id="get"),
    pytest.param("PATCH", {"title": "Mine now"}, id="patch"),
    pytest.param("PATCH", {}, id="patch-empty"),
    pytest.param("DELETE", None, id="delete"),
]


@pytest.mark.parametrize(("method", "body"), BY_ID_ROUTES)
def test_another_users_entry_is_404(
    auth_client: CsrfClient,
    entry_factory: EntryFactory,
    db_session: Session,
    method: str,
    body: dict[str, Any] | None,
) -> None:
    theirs = entry_factory()

    response = auth_client.open(entry_url(theirs.id), method=method, json=body)

    assert_error(response, 404, "not_found")
    [stored] = stored_entries(db_session)
    assert (stored.id, stored.title) == (theirs.id, "Gosh")


@pytest.mark.parametrize(("method", "body"), BY_ID_ROUTES)
@pytest.mark.parametrize(
    "entry_id",
    [
        "0",
        "999",
        str(MAX_ID),
        str(MAX_ID + 1),
        "9" * 5000,
        "-1",
        "abc",
        "1.0",
        "%D9%A1",  # ARABIC-INDIC DIGIT ONE
    ],
)
def test_unknown_entry_ids_are_404(
    auth_client: CsrfClient,
    auth_user: User,
    entry_factory: EntryFactory,
    method: str,
    body: dict[str, Any] | None,
    entry_id: str,
) -> None:
    entry_factory(user=auth_user)  # Id 1.
    response = auth_client.open(f"{ENTRIES_URL}/{entry_id}", method=method, json=body)
    assert_error(response, 404, "not_found")


def test_the_id_converter_matches_exactly_the_bigint_range() -> None:
    pattern = re.compile(IdConverter.regex)
    digits = str(MAX_ID)
    fitting = [0, 1, 9, 10, 10**18 - 1, 10**18, MAX_ID - 1, MAX_ID]
    # Raising any digit of MAX_ID overflows; lowering one fits.
    for position, digit in enumerate(digits):
        if digit != "9":
            raised = int(f"{digits[:position]}{int(digit) + 1}{digits[position + 1 :]}")
            assert pattern.fullmatch(str(raised)) is None, raised
        if digit != "0":
            fitting.append(int(f"{digits[:position]}{int(digit) - 1}{digits[position + 1 :]}"))
    for value in fitting:
        assert pattern.fullmatch(str(value)), value
    for text in [str(MAX_ID + 1), str(10**19), "1" * 20, "", "-1", "+1", "\u0661"]:
        assert pattern.fullmatch(text) is None, text
    assert pattern.fullmatch(f"0{MAX_ID}") is None  # Leading zeros count as digits.


ALL_ROUTES = [
    pytest.param("GET", ENTRIES_URL, None, id="list"),
    pytest.param("POST", ENTRIES_URL, FULL_INPUT, id="create"),
    pytest.param("GET", entry_url(1), None, id="get"),
    pytest.param("PATCH", entry_url(1), {"title": "x"}, id="patch"),
    pytest.param("DELETE", entry_url(1), None, id="delete"),
]


@pytest.mark.parametrize(("method", "url", "body"), ALL_ROUTES)
def test_every_route_needs_a_login(
    app: Flask,
    entry_factory: EntryFactory,
    db_session: Session,
    method: str,
    url: str,
    body: dict[str, Any] | None,
) -> None:
    entry_factory()  # Id 1, so a missing login is the only problem.

    response = csrf_client(app).open(url, method=method, json=body)

    assert_error(response, 401, "unauthorized")
    assert [row.title for row in stored_entries(db_session)] == ["Gosh"]


@pytest.mark.parametrize(
    ("method", "url", "body"), [route for route in ALL_ROUTES if route.values[0] != "GET"]
)
@pytest.mark.parametrize("token", [None, "not-a-token"])
def test_unsafe_routes_need_the_csrf_token(
    client: FlaskClient,
    auth_user: User,
    entry_factory: EntryFactory,
    db_session: Session,
    method: str,
    url: str,
    body: dict[str, Any] | None,
    token: str | None,
) -> None:
    entry_factory(user=auth_user, entry_date=date(2026, 10, 10))  # Id 1.
    log_in(client, auth_user.email)
    headers = {CSRF_HEADER: token} if token is not None else {}

    response = client.open(url, method=method, json=body, headers=headers)

    assert_error(response, 403, "csrf_failed")
    stored = stored_entries(db_session)
    assert [(row.id, row.title) for row in stored] == [(1, "Gosh")]


def test_the_same_user_on_another_session_sees_the_entry(
    app: Flask, auth_client: CsrfClient, auth_user: User, user_factory: UserFactory
) -> None:
    created = auth_client.post(ENTRIES_URL, json=FULL_INPUT).get_json()["entry"]
    other = user_factory()
    second, stranger = csrf_client(app), csrf_client(app)
    log_in(second, auth_user.email)
    log_in(stranger, other.email)

    assert second.get(entry_url(created["id"])).get_json()["entry"] == created
    assert_error(stranger.get(entry_url(created["id"])), 404, "not_found")
