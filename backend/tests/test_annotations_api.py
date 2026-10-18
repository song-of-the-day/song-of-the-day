"""``/api/entries/<entry_id>/annotations[/<id>]``."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
import time_machine
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from sotd.models import Annotation, Entry, User
from sotd.services.annotations import ANNOTATION_LIMIT
from tests.clients import CSRF_HEADER, CsrfClient, csrf_client, log_in
from tests.factories import AnnotationFactory, EntryFactory

pytestmark = pytest.mark.usefixtures("frozen_time")  # 2026-10-11T12:00:00Z

NOW = "2026-10-11T12:00:00Z"
END_MESSAGE = "Must be greater than start_ms."


def notes_url(entry_id: int) -> str:
    return f"/api/entries/{entry_id}/annotations"


def note_url(entry_id: int, annotation_id: int) -> str:
    return f"{notes_url(entry_id)}/{annotation_id}"


def assert_error(response: TestResponse, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.get_json()
    assert response.headers["Cache-Control"] == "no-store"
    error: dict[str, Any] = response.get_json()["error"]
    assert error["code"] == code
    return error


def stored(db_session: Session) -> dict[int, tuple[int, int | None, str, str]]:
    """Every annotation as ``{id: (start_ms, end_ms, body, color)}``."""
    db_session.expire_all()
    return {
        note.id: (note.start_ms, note.end_ms, note.body, note.color)
        for note in db_session.scalars(select(Annotation))
    }


def count_for(db_session: Session, entry: Entry) -> int:
    statement = select(func.count()).where(Annotation.entry_id == entry.id)
    return db_session.scalar(statement) or 0


@pytest.fixture
def entry(entry_factory: EntryFactory, auth_user: User) -> Entry:
    """An entry of ``auth_user``."""
    return entry_factory(user=auth_user)


@pytest.fixture
def note(annotation_factory: AnnotationFactory, entry: Entry) -> Annotation:
    """A range annotation (1000-2000 ms) on ``entry``."""
    return annotation_factory(entry=entry, start_ms=1000, end_ms=2000, body="the build")


# --- List ---------------------------------------------------------------------------------


def test_an_entry_without_annotations_lists_none(auth_client: CsrfClient, entry: Entry) -> None:
    response = auth_client.get(notes_url(entry.id))

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json() == {"annotations": []}


def test_annotations_are_listed_by_start_then_id(
    auth_client: CsrfClient,
    entry: Entry,
    entry_factory: EntryFactory,
    auth_user: User,
    annotation_factory: AnnotationFactory,
) -> None:
    late = annotation_factory(entry=entry, start_ms=90_000)
    first_at_zero = annotation_factory(entry=entry, start_ms=0, end_ms=5000, color="green")
    second_at_zero = annotation_factory(entry=entry, start_ms=0)
    annotation_factory(entry=entry_factory(user=auth_user), start_ms=1)  # Another entry's.

    body = auth_client.get(notes_url(entry.id)).get_json()

    assert [item["id"] for item in body["annotations"]] == [
        first_at_zero.id,
        second_at_zero.id,
        late.id,
    ]
    assert body["annotations"][0] == {
        "id": first_at_zero.id,
        "entry_id": entry.id,
        "start_ms": 0,
        "end_ms": 5000,
        "body": "the build",
        "color": "green",
        "created_at": NOW,
        "updated_at": NOW,
    }


# --- Create -------------------------------------------------------------------------------


def test_create_a_point_note_with_the_defaults(
    auth_client: CsrfClient, entry: Entry, db_session: Session
) -> None:
    response = auth_client.post(notes_url(entry.id), json={"start_ms": 150_000, "body": " hi "})

    assert response.status_code == 201, response.get_json()
    [(annotation_id, row)] = stored(db_session).items()
    assert row == (150_000, None, "hi", "yellow")
    assert response.get_json() == {
        "annotation": {
            "id": annotation_id,
            "entry_id": entry.id,
            "start_ms": 150_000,
            "end_ms": None,
            "body": "hi",
            "color": "yellow",
            "created_at": NOW,
            "updated_at": NOW,
        }
    }


def test_create_a_range_note_shows_up_on_the_entry(auth_client: CsrfClient, entry: Entry) -> None:
    body = {"start_ms": 150_000, "end_ms": 171_500, "body": "the build\nand drop", "color": "pink"}

    created = auth_client.post(notes_url(entry.id), json=body).get_json()["annotation"]

    assert {key: created[key] for key in body} == body
    detail = auth_client.get(f"/api/entries/{entry.id}").get_json()["entry"]
    assert detail["annotations"] == [created]
    assert detail["annotation_count"] == 1
    listed = auth_client.get("/api/entries").get_json()["entries"]
    assert [item["annotation_count"] for item in listed] == [1]


@pytest.mark.parametrize(
    ("body", "fields"),
    [
        ({}, {"start_ms": "This field is required.", "body": "This field is required."}),
        ({"start_ms": 2000, "end_ms": 2000, "body": "x"}, {"end_ms": END_MESSAGE}),
        ({"start_ms": 2000, "end_ms": 1000, "body": "x"}, {"end_ms": END_MESSAGE}),
        ({"start_ms": -1, "body": "x"}, {"start_ms": "Must be at least 0."}),
        ({"start_ms": 86_400_001, "body": "x"}, {"start_ms": "Must be at most 86400000."}),
        (
            {"start_ms": 0, "end_ms": 86_400_001, "body": "x"},
            {"end_ms": "Must be at most 86400000."},
        ),
        ({"start_ms": "0", "body": "x"}, {"start_ms": "Must be an integer."}),
        ({"start_ms": 0, "body": "   "}, {"body": "Must not be blank."}),
        ({"start_ms": 0, "body": "x" * 1001}, {"body": "Must be at most 1000 characters."}),
        ({"start_ms": 0, "body": "a\x00b"}, {"body": "Contains characters that aren't allowed."}),
        (
            {"start_ms": 0, "body": "x", "color": "orange"},
            {"color": "Must be one of: blue, green, pink, purple, yellow."},
        ),
        ({"start_ms": 0, "body": "x", "color": None}, {"color": "Cannot be null."}),
        ({"start_ms": 0, "body": "x", "entry_id": 9}, {"entry_id": "Unknown field."}),
    ],
)
def test_create_rejects_invalid_fields(
    auth_client: CsrfClient,
    entry: Entry,
    db_session: Session,
    body: dict[str, Any],
    fields: dict[str, str],
) -> None:
    response = auth_client.post(notes_url(entry.id), json=body)

    assert assert_error(response, 422, "validation_error")["fields"] == fields
    assert stored(db_session) == {}


def test_an_entry_holds_at_most_200_annotations(
    auth_client: CsrfClient,
    entry: Entry,
    entry_factory: EntryFactory,
    auth_user: User,
    db_session: Session,
) -> None:
    db_session.add_all(
        [
            Annotation(entry=entry, start_ms=ms, body="x", color="yellow")
            for ms in range(ANNOTATION_LIMIT - 1)
        ]
    )
    db_session.commit()
    payload = {"start_ms": 0, "body": "one more"}

    assert auth_client.post(notes_url(entry.id), json=payload).status_code == 201
    response = auth_client.post(notes_url(entry.id), json=payload)

    error = assert_error(response, 422, "annotation_limit_reached")
    assert "fields" not in error
    assert count_for(db_session, entry) == ANNOTATION_LIMIT == 200
    other = entry_factory(user=auth_user)
    assert auth_client.post(notes_url(other.id), json=payload).status_code == 201


# --- Update -------------------------------------------------------------------------------


def test_patch_changes_only_the_fields_sent(
    auth_client: CsrfClient,
    entry: Entry,
    note: Annotation,
    db_session: Session,
    frozen_time: time_machine.Traveller,
) -> None:
    frozen_time.shift(timedelta(minutes=1))

    response = auth_client.patch(note_url(entry.id, note.id), json={"body": " the drop "})

    assert response.status_code == 200, response.get_json()
    assert response.get_json() == {
        "annotation": {
            "id": note.id,
            "entry_id": entry.id,
            "start_ms": 1000,
            "end_ms": 2000,
            "body": "the drop",
            "color": "yellow",
            "created_at": NOW,
            "updated_at": "2026-10-11T12:01:00Z",
        }
    }
    assert stored(db_session) == {note.id: (1000, 2000, "the drop", "yellow")}


def test_an_empty_patch_changes_nothing(
    auth_client: CsrfClient, entry: Entry, note: Annotation
) -> None:
    response = auth_client.patch(note_url(entry.id, note.id))

    assert response.status_code == 200
    annotation = response.get_json()["annotation"]
    assert (annotation["start_ms"], annotation["end_ms"], annotation["updated_at"]) == (
        1000,
        2000,
        NOW,
    )


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"end_ms": None}, (1000, None)),  # A range becomes a point.
        ({"start_ms": 1999}, (1999, 2000)),
        ({"end_ms": 1001}, (1000, 1001)),
        ({"start_ms": 5000, "end_ms": 6000}, (5000, 6000)),
        ({"start_ms": 5000, "end_ms": None}, (5000, None)),
        ({"start_ms": 0, "color": "purple"}, (0, 2000)),
    ],
)
def test_patch_merges_the_range(
    auth_client: CsrfClient,
    entry: Entry,
    note: Annotation,
    db_session: Session,
    changes: dict[str, Any],
    expected: tuple[int, int | None],
) -> None:
    response = auth_client.patch(note_url(entry.id, note.id), json=changes)

    assert response.status_code == 200, response.get_json()
    annotation = response.get_json()["annotation"]
    assert (annotation["start_ms"], annotation["end_ms"]) == expected
    assert stored(db_session)[note.id][:2] == expected


@pytest.mark.parametrize(
    "changes",
    [
        {"start_ms": 2000},  # Past the stored end.
        {"start_ms": 5000},
        {"end_ms": 1000},  # Not after the stored start.
        {"end_ms": 500},
        {"start_ms": 5000, "end_ms": 4000},
        {"start_ms": 3000, "body": "moved"},
    ],
)
def test_patch_rejects_an_invalid_merged_range(
    auth_client: CsrfClient,
    entry: Entry,
    note: Annotation,
    db_session: Session,
    changes: dict[str, Any],
) -> None:
    response = auth_client.patch(note_url(entry.id, note.id), json=changes)

    assert assert_error(response, 422, "validation_error")["fields"] == {"end_ms": END_MESSAGE}
    assert stored(db_session) == {note.id: (1000, 2000, "the build", "yellow")}


def test_a_point_note_can_move_anywhere_and_become_a_range(
    auth_client: CsrfClient, entry: Entry, annotation_factory: AnnotationFactory
) -> None:
    point = annotation_factory(entry=entry, start_ms=5000)
    url = note_url(entry.id, point.id)

    assert auth_client.patch(url, json={"start_ms": 86_400_000}).status_code == 200
    rejected = auth_client.patch(url, json={"end_ms": 86_400_000})
    assert assert_error(rejected, 422, "validation_error")["fields"] == {"end_ms": END_MESSAGE}
    moved = auth_client.patch(url, json={"start_ms": 10, "end_ms": 20}).get_json()["annotation"]
    assert (moved["start_ms"], moved["end_ms"]) == (10, 20)


@pytest.mark.parametrize(
    ("changes", "fields"),
    [
        ({"start_ms": None}, {"start_ms": "Cannot be null."}),
        ({"body": None}, {"body": "Cannot be null."}),
        ({"color": None}, {"color": "Cannot be null."}),
        ({"body": ""}, {"body": "Must not be blank."}),
        ({"color": "red"}, {"color": "Must be one of: blue, green, pink, purple, yellow."}),
        ({"start_ms": 1.5}, {"start_ms": "Must be an integer."}),
        ({"entry_id": 2}, {"entry_id": "Unknown field."}),
    ],
)
def test_patch_rejects_invalid_fields(
    auth_client: CsrfClient,
    entry: Entry,
    note: Annotation,
    db_session: Session,
    changes: dict[str, Any],
    fields: dict[str, str],
) -> None:
    response = auth_client.patch(note_url(entry.id, note.id), json=changes)

    assert assert_error(response, 422, "validation_error")["fields"] == fields
    assert stored(db_session) == {note.id: (1000, 2000, "the build", "yellow")}


# --- Delete -------------------------------------------------------------------------------


def test_delete_removes_only_that_annotation(
    auth_client: CsrfClient,
    entry: Entry,
    note: Annotation,
    annotation_factory: AnnotationFactory,
    db_session: Session,
) -> None:
    kept = annotation_factory(entry=entry, start_ms=0)
    url = note_url(entry.id, note.id)

    response = auth_client.delete(url)

    assert response.status_code == 204
    assert response.data == b""
    assert list(stored(db_session)) == [kept.id]
    assert_error(auth_client.delete(url), 404, "not_found")
    assert_error(auth_client.patch(url, json={"body": "back"}), 404, "not_found")


# --- Ownership ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "body"),
    [
        pytest.param("GET", None, id="list"),
        pytest.param("POST", {"start_ms": 0, "body": "mine now"}, id="create"),
    ],
)
def test_another_users_entry_is_404_for_the_collection(
    auth_client: CsrfClient,
    annotation_factory: AnnotationFactory,
    db_session: Session,
    method: str,
    body: dict[str, Any] | None,
) -> None:
    theirs = annotation_factory()

    response = auth_client.open(notes_url(theirs.entry_id), method=method, json=body)

    assert_error(response, 404, "not_found")
    assert list(stored(db_session)) == [theirs.id]


ITEM_ROUTES = [
    pytest.param("PATCH", {"body": "mine now"}, id="patch"),
    pytest.param("PATCH", {}, id="patch-empty"),
    pytest.param("DELETE", None, id="delete"),
]


@pytest.mark.parametrize(("method", "body"), ITEM_ROUTES)
def test_another_users_annotation_is_404(
    auth_client: CsrfClient,
    entry: Entry,
    annotation_factory: AnnotationFactory,
    db_session: Session,
    method: str,
    body: dict[str, Any] | None,
) -> None:
    theirs = annotation_factory()
    urls = [
        note_url(theirs.entry_id, theirs.id),  # Their entry and annotation.
        note_url(entry.id, theirs.id),  # My entry, their annotation.
    ]

    for url in urls:
        assert_error(auth_client.open(url, method=method, json=body), 404, "not_found")
    assert stored(db_session) == {theirs.id: (0, None, "the build", "yellow")}


@pytest.mark.parametrize(("method", "body"), ITEM_ROUTES)
def test_an_annotation_is_only_found_through_its_own_entry(
    auth_client: CsrfClient,
    entry: Entry,
    note: Annotation,
    entry_factory: EntryFactory,
    auth_user: User,
    db_session: Session,
    method: str,
    body: dict[str, Any] | None,
) -> None:
    other_entry = entry_factory(user=auth_user)

    response = auth_client.open(note_url(other_entry.id, note.id), method=method, json=body)

    assert_error(response, 404, "not_found")
    assert stored(db_session) == {note.id: (1000, 2000, "the build", "yellow")}


@pytest.mark.parametrize(("method", "body"), ITEM_ROUTES)
@pytest.mark.parametrize(
    "path", ["999", "0", str(2**63), "abc"], ids=["missing", "zero", "too-big", "not-a-number"]
)
def test_unknown_annotation_ids_are_404(
    auth_client: CsrfClient,
    entry: Entry,
    note: Annotation,
    method: str,
    body: dict[str, Any] | None,
    path: str,
) -> None:
    for url in (f"{notes_url(entry.id)}/{path}", f"/api/entries/{path}/annotations/{note.id}"):
        assert_error(auth_client.open(url, method=method, json=body), 404, "not_found")


def test_single_annotations_cannot_be_read_by_id(
    auth_client: CsrfClient, entry: Entry, note: Annotation, annotation_factory: AnnotationFactory
) -> None:
    theirs = annotation_factory()
    for url in (note_url(entry.id, note.id), note_url(theirs.entry_id, theirs.id)):
        assert_error(auth_client.get(url), 405, "method_not_allowed")


# --- Auth and CSRF ------------------------------------------------------------------------

ALL_ROUTES = [
    pytest.param("GET", notes_url(1), None, id="list"),
    pytest.param("POST", notes_url(1), {"start_ms": 0, "body": "x"}, id="create"),
    pytest.param("PATCH", note_url(1, 1), {"body": "changed"}, id="patch"),
    pytest.param("DELETE", note_url(1, 1), None, id="delete"),
]


@pytest.mark.parametrize(("method", "url", "body"), ALL_ROUTES)
def test_every_route_needs_a_login(
    app: Flask,
    annotation_factory: AnnotationFactory,
    db_session: Session,
    method: str,
    url: str,
    body: dict[str, Any] | None,
) -> None:
    annotation_factory()  # Entry 1, annotation 1.

    response = csrf_client(app).open(url, method=method, json=body)

    assert_error(response, 401, "unauthorized")
    assert stored(db_session) == {1: (0, None, "the build", "yellow")}


@pytest.mark.parametrize(
    ("method", "url", "body"), [route for route in ALL_ROUTES if route.values[0] != "GET"]
)
@pytest.mark.parametrize("token", [None, "not-a-token"])
def test_unsafe_routes_need_the_csrf_token(
    client: FlaskClient,
    entry: Entry,
    note: Annotation,
    auth_user: User,
    db_session: Session,
    method: str,
    url: str,
    body: dict[str, Any] | None,
    token: str | None,
) -> None:
    assert (entry.id, note.id) == (1, 1)
    log_in(client, auth_user.email)
    headers = {CSRF_HEADER: token} if token is not None else {}

    response = client.open(url, method=method, json=body, headers=headers)

    assert_error(response, 403, "csrf_failed")
    assert stored(db_session) == {1: (1000, 2000, "the build", "yellow")}
