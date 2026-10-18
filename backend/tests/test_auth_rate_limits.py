"""Rate limits of the auth and account endpoints.

The app trusts one proxy, so ``X-Forwarded-For`` picks the client IP; per-IP limits use
that ProxyFix-corrected address.
"""

from __future__ import annotations

import io
import json
import logging
from datetime import timedelta
from typing import Any

import pytest
import time_machine
from flask import Flask
from werkzeug.test import TestResponse

from sotd.models import User
from tests.clients import CsrfClient, csrf_client, error_code, log_in
from tests.factories import DEFAULT_PASSWORD, UserFactory

NEW_PASSWORD = "a brand new passphrase"
NEXT_MINUTE = timedelta(seconds=61)


@pytest.fixture
def limited(rate_limited_app: Flask) -> CsrfClient:
    return csrf_client(rate_limited_app)


def ip(address: str) -> dict[str, Any]:
    return {"headers": {"X-Forwarded-For": address}}


def login(client: CsrfClient, email: str, password: str, address: str) -> TestResponse:
    return client.post(
        "/api/auth/login", json={"email": email, "password": password}, **ip(address)
    )


def assert_rate_limited(response: TestResponse, max_retry_after: int) -> None:
    assert response.status_code == 429
    assert response.get_json() == {
        "error": {"code": "rate_limited", "message": "Too many requests. Please try again later."}
    }
    assert 0 < int(response.headers["Retry-After"]) <= max_retry_after
    assert response.headers["Cache-Control"] == "no-store"


# --- Login --------------------------------------------------------------------------------


def test_login_allows_ten_attempts_per_minute_per_ip(limited: CsrfClient) -> None:
    for attempt in range(10):
        response = login(limited, f"u{attempt}@example.com", "wrong-password", "203.0.113.1")
        assert response.status_code == 401
    assert_rate_limited(login(limited, "x@example.com", "wrong-password", "203.0.113.1"), 60)
    # Another client IP has its own bucket.
    assert login(limited, "x@example.com", "wrong-password", "203.0.113.2").status_code == 401


def test_login_allows_a_hundred_attempts_per_day_per_ip(
    limited: CsrfClient, frozen_time: time_machine.Traveller
) -> None:
    for attempt in range(100):
        if attempt and attempt % 10 == 0:
            frozen_time.shift(NEXT_MINUTE)
        response = login(limited, f"u{attempt}@example.com", "wrong-password", "203.0.113.1")
        assert response.status_code == 401
    frozen_time.shift(NEXT_MINUTE)
    response = login(limited, "x@example.com", "wrong-password", "203.0.113.1")
    assert_rate_limited(response, 24 * 3600)
    assert int(response.headers["Retry-After"]) > 60


def test_failed_logins_are_limited_per_email(
    limited: CsrfClient, user_factory: UserFactory
) -> None:
    user_factory(email="ada@example.com")
    user_factory(email="bob@example.com")
    variants = ["ada@example.com", "ADA@example.com", "  Ada@Example.COM "]
    for attempt in range(10):
        email = variants[attempt % len(variants)]
        response = login(limited, email, "wrong-password", f"203.0.113.{attempt}")
        assert response.status_code == 401
    # Even the right password is refused for that email now, from any IP.
    response = login(limited, "ada@example.com", DEFAULT_PASSWORD, "198.51.100.1")
    assert_rate_limited(response, 15 * 60)
    assert login(limited, "bob@example.com", DEFAULT_PASSWORD, "198.51.100.2").status_code == 200


def test_only_rejected_credentials_count_against_the_email(
    limited: CsrfClient, user_factory: UserFactory
) -> None:
    user_factory(email="ada@example.com")
    for attempt in range(12):
        response = login(limited, "ada@example.com", DEFAULT_PASSWORD, f"203.0.113.{attempt}")
        assert response.status_code == 200
        response = login(limited, "ada@example.com", "x" * 129, f"198.51.100.{attempt}")
        assert response.status_code == 422
    assert login(limited, "ada@example.com", "wrong-password", "192.0.2.1").status_code == 401


def test_login_bodies_without_an_email_share_a_harmless_bucket(limited: CsrfClient) -> None:
    for attempt in range(12):
        response = limited.post(
            "/api/auth/login", json={"password": "x"}, **ip(f"203.0.113.{attempt}")
        )
        assert response.status_code == 422
    response = login(limited, "not-an-email", "x", "198.51.100.1")
    assert error_code(response) == "validation_error"
    response = limited.post(
        "/api/auth/login",
        data="not json",
        content_type="application/json",
        **ip("198.51.100.1"),
    )
    assert error_code(response) == "invalid_json"


def test_deeply_nested_login_bodies_still_count_against_the_ip(
    limited: CsrfClient, caplog: pytest.LogCaptureFixture
) -> None:
    # The per-email key function must not fail on such a body: Flask-Limiter would skip
    # every limit of the request and switch to its per-process fallback storage.
    nested = '{"email": ' + "[" * 100_000 + "]" * 100_000 + "}"
    for _ in range(10):
        response = limited.post(
            "/api/auth/login", data=nested, content_type="application/json", **ip("203.0.113.1")
        )
        assert error_code(response) == "invalid_json"
    response = limited.post(
        "/api/auth/login", data=nested, content_type="application/json", **ip("203.0.113.1")
    )
    assert_rate_limited(response, 60)
    assert not limiter_warnings(caplog)


def test_login_emails_that_cannot_be_hashed_still_count_against_the_ip(
    limited: CsrfClient, caplog: pytest.LogCaptureFixture
) -> None:
    # A lone surrogate survives JSON decoding but can't be encoded for the email digest.
    body = '{"email": "ada\\ud800@example.com", "password": "wrong-password"}'
    for _ in range(10):
        response = limited.post(
            "/api/auth/login", data=body, content_type="application/json", **ip("203.0.113.1")
        )
        assert error_code(response) == "validation_error"
    response = limited.post(
        "/api/auth/login", data=body, content_type="application/json", **ip("203.0.113.1")
    )
    assert_rate_limited(response, 60)
    assert not limiter_warnings(caplog)


def limiter_warnings(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    """Flask-Limiter warns and errors when a key function fails or storage is lost."""
    return [
        record
        for record in caplog.records
        if record.name == "flask-limiter" and record.levelno >= logging.WARNING
    ]


# --- Signup and password reset ------------------------------------------------------------------


def test_signup_allows_five_per_minute_per_ip(limited: CsrfClient) -> None:
    def signup(email: str, address: str) -> TestResponse:
        body = {
            "email": email,
            "password": DEFAULT_PASSWORD,
            "username": f"{email.partition('@')[0]}-name",
        }
        return limited.post("/api/auth/signup", json=body, **ip(address))

    for attempt in range(5):
        assert signup(f"u{attempt}@example.com", "203.0.113.1").status_code == 201
    assert_rate_limited(signup("x@example.com", "203.0.113.1"), 60)
    assert signup("x@example.com", "203.0.113.2").status_code == 201


def test_signup_allows_twenty_per_day_per_ip(
    limited: CsrfClient, frozen_time: time_machine.Traveller
) -> None:
    def signup(email: str) -> TestResponse:
        body = {
            "email": email,
            "password": DEFAULT_PASSWORD,
            "username": f"{email.partition('@')[0]}-name",
        }
        return limited.post("/api/auth/signup", json=body, **ip("203.0.113.1"))

    for attempt in range(20):
        if attempt and attempt % 5 == 0:
            frozen_time.shift(NEXT_MINUTE)
        assert signup(f"u{attempt}@example.com").status_code == 201
    frozen_time.shift(NEXT_MINUTE)
    response = signup("x@example.com")
    assert_rate_limited(response, 24 * 3600)
    assert int(response.headers["Retry-After"]) > 60


def test_password_reset_requests_allow_five_per_hour_per_ip(limited: CsrfClient) -> None:
    def request_reset(email: str, address: str) -> TestResponse:
        response = limited.post(
            "/api/auth/password-reset/request", json={"email": email}, **ip(address)
        )
        response.close()
        return response

    for attempt in range(5):
        assert request_reset(f"u{attempt}@example.com", "203.0.113.1").status_code == 202
    assert_rate_limited(request_reset("x@example.com", "203.0.113.1"), 3600)
    assert request_reset("x@example.com", "203.0.113.2").status_code == 202


# --- Account ------------------------------------------------------------------------------------


@pytest.fixture
def ada(user_factory: UserFactory) -> User:
    return user_factory(email="ada@example.com")


@pytest.fixture
def ada_client(rate_limited_app: Flask, ada: User) -> CsrfClient:
    client = csrf_client(rate_limited_app)
    log_in(client, ada.email)
    return client


def change_password(client: CsrfClient, current: str, new: str = NEW_PASSWORD) -> TestResponse:
    return client.post(
        "/api/account/password", json={"current_password": current, "new_password": new}
    )


def test_wrong_passwords_on_account_actions_are_limited_per_user(
    ada_client: CsrfClient, rate_limited_app: Flask, user_factory: UserFactory
) -> None:
    for _ in range(5):
        assert change_password(ada_client, "wrong-password").status_code == 401
    assert_rate_limited(change_password(ada_client, DEFAULT_PASSWORD), 15 * 60)

    bob = user_factory(email="bob@example.com")
    bob_client = csrf_client(rate_limited_app)
    log_in(bob_client, bob.email)  # Same IP, different user: its own bucket.
    assert change_password(bob_client, "wrong-password").status_code == 401
    assert change_password(bob_client, DEFAULT_PASSWORD).status_code == 204


def test_password_change_and_deletion_share_the_failure_limit(
    ada_client: CsrfClient, ada: User
) -> None:
    for _ in range(3):
        assert change_password(ada_client, "wrong-password").status_code == 401
    for _ in range(2):
        response = ada_client.delete("/api/account", json={"password": "wrong-password"})
        assert response.status_code == 401
    response = ada_client.delete("/api/account", json={"password": DEFAULT_PASSWORD})
    assert_rate_limited(response, 15 * 60)
    assert ada_client.get("/api/auth/me").status_code == 200


def test_successful_password_changes_do_not_count(ada_client: CsrfClient) -> None:
    passwords = [DEFAULT_PASSWORD, NEW_PASSWORD]
    for attempt in range(6):
        current, new = passwords[attempt % 2], passwords[(attempt + 1) % 2]
        assert change_password(ada_client, current, new).status_code == 204


def test_anonymous_account_requests_are_401_not_limited(limited: CsrfClient) -> None:
    for _ in range(7):
        response = change_password(limited, "wrong-password")
        assert response.status_code == 401
        assert error_code(response) == "unauthorized"


def chunked_login(client: CsrfClient, password: str) -> TestResponse:
    body = json.dumps({"email": "ada@example.com", "password": password}).encode()
    return client.post(
        "/api/auth/login",
        input_stream=io.BytesIO(body),
        content_type="application/json",
        headers={"Transfer-Encoding": "chunked", "X-Forwarded-For": "203.0.113.7"},
        environ_overrides={"wsgi.input_terminated": True},
    )


def test_bodies_without_a_declared_length_share_one_email_bucket(
    limited: CsrfClient, user_factory: UserFactory, frozen_time: time_machine.Traveller
) -> None:
    # The key function doesn't read a chunked body before the view (a read error there
    # couldn't be reported), so such bodies share one failure bucket.
    user_factory(email="ada@example.com")
    assert chunked_login(limited, DEFAULT_PASSWORD).status_code == 200
    for attempt in range(10):
        if attempt == 5:
            frozen_time.shift(NEXT_MINUTE)  # Stay under the per-IP limit.
        assert chunked_login(limited, "wrong-password").status_code == 401
    assert_rate_limited(chunked_login(limited, DEFAULT_PASSWORD), 15 * 60)
    assert login(limited, "ada@example.com", DEFAULT_PASSWORD, "198.51.100.1").status_code == 200


def test_truncated_login_body_is_400(limited: CsrfClient) -> None:
    response = limited.post(
        "/api/auth/login",
        input_stream=io.BytesIO(b'{"email": "ada@'),
        content_type="application/json",
        environ_overrides={"CONTENT_LENGTH": "100"},  # The client hangs up early.
    )
    assert response.status_code == 400
    assert error_code(response) == "bad_request"
