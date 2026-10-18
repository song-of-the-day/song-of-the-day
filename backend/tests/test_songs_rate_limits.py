"""Rate limits of ``GET /api/songs/youtube-match``: 30/hour and 200/day per user.

One uncached lookup can consume up to 101 units of the shared YouTube Data API quota
, so every request counts, cache hits included. The tests run on the
key-less rate-limited app, where every answer is ``disabled``; only the counters matter.
The app trusts one proxy: ``X-Forwarded-For`` sets the client IP the key is checked from.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta

import pytest
import time_machine
from flask import Flask
from werkzeug.test import TestResponse

from tests.clients import CsrfClient, csrf_client, error_code, log_in
from tests.factories import UserFactory

URL = "/api/songs/youtube-match"
PARAMS = {"title": "Gosh", "artist": "Jamie xx"}
#: Enough to cross a fixed-window boundary of the hourly limit.
NEXT_HOUR = timedelta(hours=1, seconds=1)


@pytest.fixture
def make_client(rate_limited_app: Flask, user_factory: UserFactory) -> Callable[[], CsrfClient]:
    """Return a function that logs a new user in on the rate-limited app."""

    def make() -> CsrfClient:
        client = csrf_client(rate_limited_app)
        log_in(client, user_factory().email)
        return client

    return make


def lookup(client: CsrfClient, address: str) -> TestResponse:
    return client.get(URL, query_string=PARAMS, headers={"X-Forwarded-For": address})


def assert_allowed(response: TestResponse) -> None:
    assert response.status_code == 200
    assert response.get_json() == {"match": None, "reason": "disabled"}


def assert_rate_limited(response: TestResponse, max_retry_after: int) -> None:
    assert response.status_code == 429
    assert response.get_json() == {
        "error": {"code": "rate_limited", "message": "Too many requests. Please try again later."}
    }
    assert response.headers["Cache-Control"] == "no-store"
    assert 0 < int(response.headers["Retry-After"]) <= max_retry_after


def test_thirty_lookups_per_hour_per_user(
    make_client: Callable[[], CsrfClient], frozen_time: time_machine.Traveller
) -> None:
    client = make_client()
    for _ in range(30):
        assert_allowed(lookup(client, "203.0.113.1"))
    # The limit follows the user to another address; other users are unaffected.
    assert_rate_limited(lookup(client, "203.0.113.2"), 3600 + 1)
    assert_allowed(lookup(make_client(), "203.0.113.1"))
    frozen_time.shift(NEXT_HOUR)
    assert_allowed(lookup(client, "203.0.113.1"))


def test_requests_refused_by_validation_count(
    make_client: Callable[[], CsrfClient], frozen_time: time_machine.Traveller
) -> None:
    client = make_client()
    for _ in range(30):
        response = client.get(URL, query_string={"title": "Gosh"})  # No artist: 422.
        assert response.status_code == 422
        assert error_code(response) == "validation_error"
    assert_rate_limited(lookup(client, "203.0.113.1"), 3600 + 1)
    frozen_time.shift(NEXT_HOUR)
    assert_allowed(lookup(client, "203.0.113.1"))


def test_two_hundred_lookups_per_day_per_user(
    make_client: Callable[[], CsrfClient], frozen_time: time_machine.Traveller
) -> None:
    client = make_client()
    for hour in range(6):
        if hour:
            frozen_time.shift(NEXT_HOUR)  # Stay under the hourly limit.
        for _ in range(30):
            assert_allowed(lookup(client, "203.0.113.1"))
    frozen_time.shift(NEXT_HOUR)
    for _ in range(20):  # 200 lookups on the day: the daily limit is spent.
        assert_allowed(lookup(client, "203.0.113.1"))
    response = lookup(client, "203.0.113.1")
    assert_rate_limited(response, 24 * 3600 + 1)
    assert int(response.headers["Retry-After"]) > 3600  # Only the daily window is left.
    assert_allowed(lookup(make_client(), "203.0.113.1"))  # Other users are fine.


def test_anonymous_requests_are_rejected_before_counting(rate_limited_app: Flask) -> None:
    anonymous = csrf_client(rate_limited_app)
    for _ in range(31):
        response = anonymous.get(URL, query_string=PARAMS)
        assert response.status_code == 401
        assert error_code(response) == "unauthorized"
