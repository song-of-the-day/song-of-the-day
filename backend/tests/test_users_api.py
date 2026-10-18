"""Public profiles: ``GET /api/users/<username>``, its entries and entry details."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pytest
import time_machine
from flask import Flask
from flask.testing import FlaskClient
from werkzeug.test import TestResponse

from sotd.models import User
from sotd.schemas.common import format_utc_timestamp
from sotd.theme import normalize_theme
from tests.clients import CsrfClient
from tests.factories import AnnotationFactory, EntryFactory, UserFactory

THEME = {"preset": "bubblegum", "colors": {"accent": "#abcdef"}}


def assert_not_found(response: TestResponse) -> None:
    assert response.status_code == 404
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json()["error"]["code"] == "not_found"


@pytest.fixture
def ada(user_factory: UserFactory) -> User:
    return user_factory(
        email="ada@example.com", username="ada", display_name="Ada", bio="breaks", theme=THEME
    )


# --- Profile -------------------------------------------------------------------------------


def test_anyone_gets_the_public_profile(client: FlaskClient, ada: User) -> None:
    response = client.get("/api/users/ada")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.get_json() == {
        "profile": {
            "username": "ada",
            "display_name": "Ada",
            "bio": "breaks",
            "theme": normalize_theme(THEME),
            "created_at": format_utc_timestamp(ada.created_at),
        }
    }
    assert "ada@example.com" not in response.get_data(as_text=True)


def test_the_owner_gets_the_same_public_profile(
    auth_client: CsrfClient, client: FlaskClient, auth_user: User
) -> None:
    owner = auth_client.get("/api/users/ada").get_json()
    assert owner == client.get("/api/users/ada").get_json()
    assert set(owner["profile"]) == {"username", "display_name", "bio", "theme", "created_at"}


@pytest.mark.parametrize("path", ["ADA", "Ada", "aDa"])
def test_the_username_lookup_is_case_insensitive(client: FlaskClient, ada: User, path: str) -> None:
    assert client.get(f"/api/users/{path}").get_json()["profile"]["username"] == "ada"


def test_a_reserved_name_taken_before_it_was_reserved_still_resolves(
    client: FlaskClient, user_factory: UserFactory
) -> None:
    user_factory(username="admin")
    assert client.get("/api/users/admin").status_code == 200


@pytest.mark.parametrize(
    "path",
    [
        "grace",
        "ab",
        "a" * 31,
        "zo%C3%AB",
        "a%00b",
        "-ada",
        "ada%0A",
        "%ED%A0%80",
        "x" * 5000,
    ],
    ids=["unknown", "short", "long", "non-ascii", "nul", "pattern", "newline", "bad-utf8", "huge"],
)
def test_unknown_or_impossible_usernames_are_404(client: FlaskClient, ada: User, path: str) -> None:
    assert_not_found(client.get(f"/api/users/{path}"))
    assert_not_found(client.get(f"/api/users/{path}/entries"))
    assert_not_found(client.get(f"/api/users/{path}/entries/1"))


def test_public_endpoints_are_read_only(auth_client: CsrfClient) -> None:
    for path in ("/api/users/ada", "/api/users/ada/entries", "/api/users/ada/entries/1"):
        response = auth_client.post(path, json={})
        assert response.status_code == 405
        assert response.get_json()["error"]["code"] == "method_not_allowed"


# --- Entries --------------------------------------------------------------------------------


def test_entries_match_the_owners_list(
    auth_client: CsrfClient,
    client: FlaskClient,
    auth_user: User,
    entry_factory: EntryFactory,
    annotation_factory: AnnotationFactory,
    user_factory: UserFactory,
) -> None:
    first = entry_factory(user=auth_user, note="the build")
    annotation_factory(entry=first)
    entry_factory(user=auth_user)
    entry_factory(user=user_factory())  # Someone else's entry never shows up.

    public = client.get("/api/users/ada/entries")
    assert public.status_code == 200
    assert public.headers["Cache-Control"] == "no-store"
    body = public.get_json()
    assert body == auth_client.get("/api/entries").get_json()
    assert [entry["annotation_count"] for entry in body["entries"]] == [1, 0]
    assert body["next_before"] is None


def test_entries_paginate_with_the_same_cursor(
    client: FlaskClient, ada: User, entry_factory: EntryFactory
) -> None:
    days = [date(2026, 10, 11) - timedelta(days=offset) for offset in range(3)]
    for day in days:
        entry_factory(user=ada, entry_date=day)

    first = client.get("/api/users/ada/entries?limit=2").get_json()
    assert [entry["entry_date"] for entry in first["entries"]] == ["2026-10-11", "2026-10-10"]
    assert first["next_before"] == "2026-10-10"
    second = client.get(f"/api/users/ADA/entries?limit=2&before={first['next_before']}")
    assert [entry["entry_date"] for entry in second.get_json()["entries"]] == ["2026-10-09"]
    assert second.get_json()["next_before"] is None
    month = client.get("/api/users/ada/entries?start=2026-10-10&end=2026-10-10&limit=31")
    assert [entry["entry_date"] for entry in month.get_json()["entries"]] == ["2026-10-10"]


def test_entries_for_a_user_without_any_are_empty(client: FlaskClient, ada: User) -> None:
    assert client.get("/api/users/ada/entries").get_json() == {"entries": [], "next_before": None}


@pytest.mark.parametrize(
    ("query", "field"),
    [
        ("limit=0", "limit"),
        ("start=2026-10-11&end=2026-10-01", "end"),
        ("before=yesterday", "before"),
    ],
)
def test_invalid_entry_queries_are_422(
    client: FlaskClient, auth_client: CsrfClient, query: str, field: str
) -> None:
    response = client.get(f"/api/users/ada/entries?{query}")
    assert response.status_code == 422
    assert (
        response.get_json()["error"] == auth_client.get(f"/api/entries?{query}").get_json()["error"]
    )
    assert set(response.get_json()["error"]["fields"]) == {field}


# --- Entry details ---------------------------------------------------------------------------


def test_an_entry_detail_matches_the_owners_view(
    auth_client: CsrfClient,
    client: FlaskClient,
    auth_user: User,
    entry_factory: EntryFactory,
    annotation_factory: AnnotationFactory,
) -> None:
    entry = entry_factory(user=auth_user, note="the build at 2:30")
    annotation_factory(entry=entry, start_ms=1000, end_ms=2000, body="here", color="pink")

    response = client.get(f"/api/users/ada/entries/{entry.id}")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    body: dict[str, Any] = response.get_json()
    assert body == auth_client.get(f"/api/entries/{entry.id}").get_json()
    assert body["entry"]["note"] == "the build at 2:30"
    assert [note["body"] for note in body["entry"]["annotations"]] == ["here"]


def test_another_users_entry_is_404_under_this_username(
    client: FlaskClient, ada: User, user_factory: UserFactory, entry_factory: EntryFactory
) -> None:
    grace = user_factory(username="grace")
    theirs = entry_factory(user=grace)
    assert_not_found(client.get(f"/api/users/ada/entries/{theirs.id}"))
    assert client.get(f"/api/users/grace/entries/{theirs.id}").status_code == 200


@pytest.mark.parametrize("entry_id", ["999999", "9" * 30, "abc", "-1"])
def test_unknown_or_malformed_entry_ids_are_404(
    client: FlaskClient, ada: User, entry_id: str
) -> None:
    assert_not_found(client.get(f"/api/users/ada/entries/{entry_id}"))


# --- Rate limit -----------------------------------------------------------------------------


def test_public_reads_share_300_per_minute_per_ip(
    rate_limited_app: Flask, ada: User, frozen_time: time_machine.Traveller
) -> None:
    visitor = rate_limited_app.test_client()

    def read(path: str, address: str = "203.0.113.1") -> TestResponse:
        return visitor.get(path, headers={"X-Forwarded-For": address})

    paths = ["/api/users/ada", "/api/users/ada/entries", "/api/users/nobody"]
    for attempt in range(300):
        assert read(paths[attempt % len(paths)]).status_code in {200, 404}
    limited = read("/api/users/ada/entries/1")
    assert limited.status_code == 429
    assert limited.get_json()["error"]["code"] == "rate_limited"
    assert 0 < int(limited.headers["Retry-After"]) <= 61
    assert read("/api/users/ada", "203.0.113.2").status_code == 200

    frozen_time.shift(timedelta(minutes=1, seconds=1))
    assert read("/api/users/ada").status_code == 200
