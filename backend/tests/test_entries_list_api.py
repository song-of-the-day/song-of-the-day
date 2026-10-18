"""``GET /api/entries``: filters, cursor pagination and annotation counts."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, timedelta
from typing import Any

import pytest
from flask import Flask
from sqlalchemy import event
from sqlalchemy.orm import Session

from sotd.extensions import db
from sotd.models import Annotation, Entry, User
from tests.clients import CsrfClient, csrf_client, error_code
from tests.factories import AnnotationFactory, EntryFactory

pytestmark = pytest.mark.usefixtures("frozen_time")  # 2026-10-11T12:00:00Z

ENTRIES_URL = "/api/entries"
DATE_FORMAT = "Must be a date in YYYY-MM-DD format."
LIMIT_MESSAGE = "Must be an integer from 1 to 366."


def add_entries(db_session: Session, user: User, dates: list[date]) -> list[Entry]:
    """Insert one entry per date in a single transaction."""
    rows = [
        Entry(user=user, entry_date=day, title=f"Song {day}", artist="Artist", source="manual")
        for day in dates
    ]
    db_session.add_all(rows)
    db_session.commit()
    return rows


def days_back(count: int, *, start: date = date(2026, 10, 11), step: int = 1) -> list[date]:
    return [start - timedelta(days=step * index) for index in range(count)]


def list_entries(client: CsrfClient, **params: Any) -> dict[str, Any]:
    response = client.get(ENTRIES_URL, query_string=params)
    assert response.status_code == 200, response.get_json()
    assert response.headers["Cache-Control"] == "no-store"
    body: dict[str, Any] = response.get_json()
    return body


def listed_dates(body: dict[str, Any]) -> list[str]:
    return [entry["entry_date"] for entry in body["entries"]]


def iso(days: list[date]) -> list[str]:
    return [day.isoformat() for day in days]


@contextmanager
def count_queries(app: Flask) -> Iterator[list[str]]:
    """Collect the SQL statements the app runs inside the block."""
    with app.app_context():
        engine = db.engine
    statements: list[str] = []

    def record(*args: Any) -> None:
        statements.append(args[2])

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


# --- Shape --------------------------------------------------------------------------------


def test_an_empty_journal_lists_nothing(auth_client: CsrfClient) -> None:
    assert list_entries(auth_client) == {"entries": [], "next_before": None}


def test_entries_are_listed_newest_first_without_annotations(
    auth_client: CsrfClient, auth_user: User, entry_factory: EntryFactory
) -> None:
    older = entry_factory(user=auth_user, entry_date=date(2026, 10, 1), album="In Colour")
    newer = entry_factory(user=auth_user, entry_date=date(2026, 10, 9), note="loud")

    body = list_entries(auth_client)

    assert body["next_before"] is None
    assert [entry["id"] for entry in body["entries"]] == [newer.id, older.id]
    assert body["entries"][0] == {
        "id": newer.id,
        "entry_date": "2026-10-09",
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
        "note": "loud",
        "annotation_count": 0,
        "created_at": "2026-10-11T12:00:00Z",
        "updated_at": "2026-10-11T12:00:00Z",
    }


def test_only_the_users_own_entries_are_listed(
    auth_client: CsrfClient, auth_user: User, entry_factory: EntryFactory
) -> None:
    mine = entry_factory(user=auth_user, entry_date=date(2026, 10, 10))
    entry_factory(entry_date=date(2026, 10, 11))  # Someone else's, newer.
    entry_factory(entry_date=date(2026, 10, 10))  # Someone else's, same day.

    body = list_entries(auth_client)

    assert [entry["id"] for entry in body["entries"]] == [mine.id]


def test_annotation_counts_are_per_entry(
    auth_client: CsrfClient,
    auth_user: User,
    entry_factory: EntryFactory,
    annotation_factory: AnnotationFactory,
    db_session: Session,
) -> None:
    three = entry_factory(user=auth_user, entry_date=date(2026, 10, 11))
    none = entry_factory(user=auth_user, entry_date=date(2026, 10, 10))
    one = entry_factory(user=auth_user, entry_date=date(2026, 10, 9))
    db_session.add_all(
        [Annotation(entry=three, start_ms=ms, body="x", color="yellow") for ms in (0, 0, 5)]
    )
    db_session.commit()
    annotation_factory(entry=one)
    annotation_factory()  # On someone else's entry.

    counts = {
        entry["id"]: entry["annotation_count"] for entry in list_entries(auth_client)["entries"]
    }

    assert counts == {three.id: 3, none.id: 0, one.id: 1}


def test_listing_costs_the_same_queries_for_any_page_size(
    app: Flask,
    auth_client: CsrfClient,
    auth_user: User,
    db_session: Session,
) -> None:
    entries = add_entries(db_session, auth_user, days_back(30))
    db_session.add_all(
        [Annotation(entry=entry, start_ms=0, body="x", color="yellow") for entry in entries]
    )
    db_session.commit()

    with count_queries(app) as small_page:
        assert len(list_entries(auth_client, limit=1)["entries"]) == 1
    with count_queries(app) as full_page:
        body = list_entries(auth_client, limit=30)

    assert len(full_page) == len(small_page)
    assert {entry["annotation_count"] for entry in body["entries"]} == {1}
    assert sum("FROM annotations" in statement for statement in full_page) == 1


# --- Pagination ---------------------------------------------------------------------------


def test_the_default_page_holds_60_entries(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    dates = days_back(61)
    add_entries(db_session, auth_user, dates)

    body = list_entries(auth_client)

    assert listed_dates(body) == iso(dates[:60])
    assert body["next_before"] == dates[59].isoformat()


def test_walking_the_cursor_visits_every_entry_once(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    dates = days_back(25, step=3)  # Gaps between days don't matter.
    add_entries(db_session, auth_user, dates)

    pages: list[list[str]] = []
    cursors: list[str | None] = []
    params: dict[str, Any] = {"limit": 10}
    while True:
        body = list_entries(auth_client, **params)
        pages.append(listed_dates(body))
        cursors.append(body["next_before"])
        if body["next_before"] is None:
            break
        params["before"] = body["next_before"]

    assert [len(page) for page in pages] == [10, 10, 5]
    assert [day for page in pages for day in page] == iso(dates)
    assert cursors == [dates[9].isoformat(), dates[19].isoformat(), None]


def test_a_full_last_page_has_no_cursor(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    dates = days_back(20)
    add_entries(db_session, auth_user, dates)

    first = list_entries(auth_client, limit=10)
    last = list_entries(auth_client, limit=10, before=first["next_before"])

    assert first["next_before"] == dates[9].isoformat()
    assert listed_dates(last) == iso(dates[10:])
    assert last["next_before"] is None


def test_a_cursor_past_the_oldest_entry_lists_nothing(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    add_entries(db_session, auth_user, days_back(3))
    assert list_entries(auth_client, before="2026-10-09") == {"entries": [], "next_before": None}


@pytest.mark.parametrize(("limit", "expected"), [(1, 1), (366, 366)])
def test_limit_bounds_are_accepted(
    auth_client: CsrfClient, auth_user: User, db_session: Session, limit: int, expected: int
) -> None:
    add_entries(db_session, auth_user, days_back(367))

    body = list_entries(auth_client, limit=limit)

    assert len(body["entries"]) == expected
    assert body["next_before"] == body["entries"][-1]["entry_date"]


# --- Filters ------------------------------------------------------------------------------


def test_a_month_is_loaded_with_start_end_and_limit(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    september = [date(2026, 9, 30), date(2026, 9, 15), date(2026, 9, 1)]
    add_entries(db_session, auth_user, [date(2026, 10, 1), *september, date(2026, 8, 31)])

    body = list_entries(auth_client, start="2026-09-01", end="2026-09-30", limit=31)

    assert listed_dates(body) == iso(september)
    assert body["next_before"] is None


def test_today_is_loaded_with_start_equal_to_end(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    add_entries(db_session, auth_user, days_back(3))

    today = list_entries(auth_client, start="2026-10-11", end="2026-10-11", limit=1)
    nothing = list_entries(auth_client, start="2026-10-12", end="2026-10-12", limit=1)

    assert listed_dates(today) == ["2026-10-11"]
    assert today["next_before"] is None  # No other entry matches the filters.
    assert nothing == {"entries": [], "next_before": None}


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"start": "2026-10-05"}, ["2026-10-11", "2026-10-08", "2026-10-05"]),
        ({"end": "2026-10-08"}, ["2026-10-08", "2026-10-05", "2026-10-02"]),
        ({"before": "2026-10-08"}, ["2026-10-05", "2026-10-02"]),
        ({"end": "2026-10-07"}, ["2026-10-05", "2026-10-02"]),
        # The upper bound is the earlier of end (inclusive) and before (exclusive).
        ({"end": "2026-10-08", "before": "2026-10-11"}, ["2026-10-08", "2026-10-05", "2026-10-02"]),
        ({"end": "2026-10-11", "before": "2026-10-08"}, ["2026-10-05", "2026-10-02"]),
        (
            {"start": "2026-10-05", "end": "2026-10-10", "before": "2026-10-09"},
            ["2026-10-08", "2026-10-05"],
        ),
        ({"start": "2026-10-09", "before": "2026-10-09"}, []),
        ({"start": "2026-10-12"}, []),
    ],
)
def test_filters_combine(
    auth_client: CsrfClient,
    auth_user: User,
    db_session: Session,
    params: dict[str, str],
    expected: list[str],
) -> None:
    add_entries(db_session, auth_user, days_back(4, step=3))  # 10-11, 10-08, 10-05, 10-02

    body = list_entries(auth_client, **params)

    assert listed_dates(body) == expected
    assert body["next_before"] is None


def test_the_cursor_respects_the_other_filters(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    add_entries(db_session, auth_user, days_back(10))  # 10-11 back to 10-02

    first = list_entries(auth_client, start="2026-10-07", limit=3)
    second = list_entries(auth_client, start="2026-10-07", limit=3, before=first["next_before"])

    assert listed_dates(first) == ["2026-10-11", "2026-10-10", "2026-10-09"]
    assert first["next_before"] == "2026-10-09"
    assert listed_dates(second) == ["2026-10-08", "2026-10-07"]
    assert second["next_before"] is None  # Older entries exist, but none on or after start.


# --- Errors -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("params", "fields"),
    [
        ({"start": "2026-02-30"}, {"start": DATE_FORMAT}),
        ({"end": "2026/10/11"}, {"end": DATE_FORMAT}),
        ({"before": "yesterday"}, {"before": DATE_FORMAT}),
        ({"before": ""}, {"before": DATE_FORMAT}),
        ({"start": "2026-10-12", "end": "2026-10-11"}, {"end": "Must not be before start."}),
        ({"limit": "0"}, {"limit": LIMIT_MESSAGE}),
        ({"limit": "367"}, {"limit": LIMIT_MESSAGE}),
        ({"limit": "ten"}, {"limit": LIMIT_MESSAGE}),
        ({"limit": "1.5"}, {"limit": LIMIT_MESSAGE}),
        ({"limit": ["1", "2"]}, {"limit": LIMIT_MESSAGE}),
        ({"start": ["2026-10-01", "2026-10-02"]}, {"start": DATE_FORMAT}),
        ({"page": "2"}, {"page": "Unknown field."}),
        ({"start": "x", "limit": "0"}, {"start": DATE_FORMAT, "limit": LIMIT_MESSAGE}),
    ],
)
def test_invalid_query_parameters_are_422(
    auth_client: CsrfClient, params: dict[str, Any], fields: dict[str, str]
) -> None:
    response = auth_client.get(ENTRIES_URL, query_string=params)

    assert response.status_code == 422
    assert response.get_json()["error"] == {
        "code": "validation_error",
        "message": "Some fields are invalid.",
        "fields": fields,
    }


def test_listing_needs_a_login(app: Flask) -> None:
    response = csrf_client(app).get(ENTRIES_URL)
    assert response.status_code == 401
    assert error_code(response) == "unauthorized"
