"""Rate limits of ``POST /api/uploads``: 30/hour per user and 60/hour per client IP.

Every request counts, whatever its outcome, so most requests here send a file that is
cheaply refused (415). The app trusts one proxy: ``X-Forwarded-For`` sets the client IP.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta

import pytest
import time_machine
from flask import Flask
from werkzeug.test import TestResponse

from sotd.api.utils import user_rate_limit_key
from tests import image_samples as samples
from tests.clients import CsrfClient, csrf_client, log_in
from tests.factories import UserFactory


@pytest.fixture
def make_client(rate_limited_app: Flask, user_factory: UserFactory) -> Callable[[], CsrfClient]:
    """Return a function that logs a new user in on the rate-limited app."""

    def make() -> CsrfClient:
        client = csrf_client(rate_limited_app)
        log_in(client, user_factory().email)
        return client

    return make


def send(client: CsrfClient, address: str, data: bytes = samples.SVG) -> TestResponse:
    return client.post(
        "/api/uploads",
        **samples.multipart(data),
        headers={"X-Forwarded-For": address},
    )


def assert_rate_limited(response: TestResponse) -> None:
    assert response.status_code == 429
    assert response.get_json() == {
        "error": {"code": "rate_limited", "message": "Too many requests. Please try again later."}
    }
    assert response.headers["Cache-Control"] == "no-store"
    # Flask-Limiter rounds the end of the one-hour window up to the next second.
    assert 0 < int(response.headers["Retry-After"]) <= 3600 + 1


def test_thirty_uploads_per_hour_per_user(
    make_client: Callable[[], CsrfClient], frozen_time: time_machine.Traveller
) -> None:
    client = make_client()
    for _ in range(30):
        assert send(client, "203.0.113.1").status_code == 415
    # The limit follows the user to another address, and applies to valid images too.
    assert_rate_limited(send(client, "203.0.113.2", samples.png()))
    assert send(make_client(), "203.0.113.1").status_code == 415  # Other users are fine.
    frozen_time.shift(timedelta(hours=1, seconds=1))
    assert send(client, "203.0.113.1", samples.png()).status_code == 201


def test_sixty_uploads_per_hour_per_ip(make_client: Callable[[], CsrfClient]) -> None:
    first, second, third = make_client(), make_client(), make_client()
    for client in (first, second):
        for _ in range(30):
            assert send(client, "198.51.100.7").status_code == 415
    assert_rate_limited(send(third, "198.51.100.7"))
    assert send(third, "198.51.100.8").status_code == 415


def test_anonymous_requests_are_rejected_before_counting(rate_limited_app: Flask) -> None:
    anonymous = csrf_client(rate_limited_app)
    for _ in range(61):
        assert send(anonymous, "192.0.2.1").status_code == 401


def test_user_key_never_raises(rate_limited_app: Flask) -> None:
    with rate_limited_app.test_request_context("/api/uploads", method="POST"):
        assert user_rate_limit_key() == "user:anonymous"
