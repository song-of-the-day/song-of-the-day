"""Password reset: request (email after the response) and confirm."""

from __future__ import annotations

import logging
import re
from datetime import timedelta
from types import SimpleNamespace
from typing import Any

import pytest
import time_machine
from flask import Flask
from itsdangerous import URLSafeTimedSerializer
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from sotd.api import auth as auth_api
from sotd.models import User, UserSession
from sotd.security import generate_password_reset_token
from sotd.services.mail import OUTBOX_EXTENSION_KEY, MailError, OutgoingEmail
from tests.clients import CSRF_HEADER, CsrfClient, csrf_client, csrf_token, error_code, log_in
from tests.factories import DEFAULT_PASSWORD, UserFactory

REQUEST_URL = "/api/auth/password-reset/request"
CONFIRM_URL = "/api/auth/password-reset/confirm"
NEW_PASSWORD = "a brand new passphrase"
LINK_PATTERN = re.compile(r"(?P<base>\S+)/reset-password#token=(?P<token>[A-Za-z0-9_.-]+)")


@pytest.fixture
def anon(app: Flask) -> CsrfClient:
    return csrf_client(app)


def request_reset(client: CsrfClient, email: str, **kwargs: Any) -> TestResponse:
    """POST a reset request and close the response, which runs the deferred send."""
    response = client.post(REQUEST_URL, json={"email": email}, **kwargs)
    response.close()
    return response


def token_in(text: str) -> str:
    match = LINK_PATTERN.search(text)
    assert match is not None, text
    return match["token"]


def reset_token_for(app: Flask, user: User) -> str:
    with app.app_context():
        return generate_password_reset_token(user.id, user.password_hash)


def session_count(db_session: Session) -> int:
    return db_session.scalar(select(func.count()).select_from(UserSession)) or 0


# --- Request ----------------------------------------------------------------------------


def test_request_emails_a_link_after_the_response(
    anon: CsrfClient, user_factory: UserFactory, outbox: list[OutgoingEmail], app: Flask
) -> None:
    user_factory(email="ada@example.com", display_name="Ada")
    response = anon.post(REQUEST_URL, json={"email": "ada@example.com"})
    assert response.status_code == 202
    assert response.get_json() == {}
    assert outbox == []  # Nothing is sent until the response has been written.
    response.close()

    [email] = outbox
    assert email.to == "ada@example.com"
    assert email.subject == "Reset your Song of the Day password"
    assert email.text.startswith("Hi Ada,")
    match = LINK_PATTERN.search(email.text)
    assert match is not None
    assert match["base"] == app.config["APP_BASE_URL"] == "http://localhost:5173"
    assert "expires in 1 hour" in email.text


def test_request_link_ignores_the_request_host(
    app: Flask, user_factory: UserFactory, outbox: list[OutgoingEmail]
) -> None:
    user_factory(email="ada@example.com")
    client = app.test_client()
    evil = {"base_url": "http://evil.example"}
    token = csrf_token(client, **evil)
    with client.post(
        REQUEST_URL,
        json={"email": "ada@example.com"},
        headers={CSRF_HEADER: token, "X-Forwarded-Host": "evil.example"},
        **evil,
    ) as response:
        assert response.status_code == 202
    [email] = outbox
    assert "evil.example" not in email.text
    assert "http://localhost:5173/reset-password#token=" in email.text


def test_request_normalizes_the_email(
    anon: CsrfClient, user_factory: UserFactory, outbox: list[OutgoingEmail]
) -> None:
    user_factory(email="ada@example.com")
    assert request_reset(anon, "  ADA@Example.com ").status_code == 202
    assert [email.to for email in outbox] == ["ada@example.com"]


def test_request_for_an_unknown_email_looks_the_same(
    anon: CsrfClient, user_factory: UserFactory, outbox: list[OutgoingEmail]
) -> None:
    user_factory(email="ada@example.com")
    known = request_reset(anon, "ada@example.com")
    unknown = request_reset(anon, "nobody@example.com")
    assert (unknown.status_code, unknown.get_data()) == (known.status_code, known.get_data())
    assert [email.to for email in outbox] == ["ada@example.com"]


def test_request_validates_the_email(anon: CsrfClient, outbox: list[OutgoingEmail]) -> None:
    response = anon.post(REQUEST_URL, json={"email": "nope"})
    assert response.status_code == 422
    assert response.get_json()["error"]["fields"] == {"email": "Enter a valid email address."}
    assert outbox == []


def test_request_still_succeeds_when_sending_fails(
    anon: CsrfClient,
    user_factory: UserFactory,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    app: Flask,
    frozen_time: time_machine.Traveller,
) -> None:
    user = user_factory(email="ada@example.com")
    sent: list[tuple[str, str, str]] = []

    def failing_send(to: str, subject: str, text: str) -> None:
        sent.append((to, subject, text))
        raise MailError("SMTP delivery failed (SMTPServerDisconnected).")

    monkeypatch.setattr(auth_api, "send_email", failing_send)
    with caplog.at_level(logging.ERROR, logger="sotd.api.auth"):
        response = request_reset(anon, "ada@example.com", headers={"X-Request-ID": "req-123"})
    assert response.status_code == 202
    assert response.get_json() == {}

    [(_, _, text)] = sent
    token = token_in(text)
    assert token == reset_token_for(app, user)  # Frozen time makes the token deterministic.
    [record] = caplog.records
    assert record.getMessage() == "Password reset email could not be sent"
    assert getattr(record, "request_id", None) == "req-123"
    assert token not in caplog.text


def test_request_without_rate_limits_never_skips(
    anon: CsrfClient, user_factory: UserFactory, outbox: list[OutgoingEmail]
) -> None:
    user_factory(email="ada@example.com")
    for _ in range(5):
        request_reset(anon, "ada@example.com")
    assert len(outbox) == 5


# --- Confirm ----------------------------------------------------------------------------


def test_confirm_sets_the_password_and_revokes_every_session(
    anon: CsrfClient,
    auth_client: CsrfClient,
    auth_user: User,
    app: Flask,
    outbox: list[OutgoingEmail],
    db_session: Session,
) -> None:
    second = csrf_client(app)
    log_in(second, auth_user.email, remember=False)
    request_reset(anon, auth_user.email)
    token = token_in(outbox[0].text)

    response = anon.post(CONFIRM_URL, json={"token": token, "password": NEW_PASSWORD})
    assert response.status_code == 204
    assert anon.get("/api/auth/me").status_code == 401  # Confirming doesn't log in.
    assert session_count(db_session) == 0
    assert auth_client.get("/api/auth/me").status_code == 401
    assert second.get("/api/auth/me").status_code == 401

    login = {"email": auth_user.email, "password": DEFAULT_PASSWORD}
    assert anon.post("/api/auth/login", json=login).status_code == 401
    login["password"] = NEW_PASSWORD
    assert anon.post("/api/auth/login", json=login).status_code == 200


def test_confirm_token_works_only_once(
    anon: CsrfClient, user_factory: UserFactory, app: Flask
) -> None:
    token = reset_token_for(app, user_factory(email="ada@example.com"))
    first = anon.post(CONFIRM_URL, json={"token": token, "password": NEW_PASSWORD})
    assert first.status_code == 204
    second = anon.post(CONFIRM_URL, json={"token": token, "password": "yet another one!"})
    assert second.status_code == 400
    assert second.get_json() == {
        "error": {
            "code": "invalid_token",
            "message": "This reset link is invalid or has expired.",
        }
    }


def test_token_dies_when_the_password_changes(
    auth_client: CsrfClient, auth_user: User, app: Flask, anon: CsrfClient
) -> None:
    token = reset_token_for(app, auth_user)
    change = auth_client.post(
        "/api/account/password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert change.status_code == 204
    response = anon.post(CONFIRM_URL, json={"token": token, "password": "yet another one!"})
    assert error_code(response) == "invalid_token"


@pytest.mark.parametrize(
    ("age", "status"), [(timedelta(seconds=3599), 204), (timedelta(hours=1, seconds=1), 400)]
)
def test_token_expires_after_one_hour(
    anon: CsrfClient,
    user_factory: UserFactory,
    app: Flask,
    frozen_time: time_machine.Traveller,
    age: timedelta,
    status: int,
) -> None:
    token = reset_token_for(app, user_factory(email="ada@example.com"))
    frozen_time.shift(age)
    response = anon.post(CONFIRM_URL, json={"token": token, "password": NEW_PASSWORD})
    assert response.status_code == status


def _tampered(token: str) -> str:
    payload, timestamp, signature = token.split(".")
    flipped = "A" if signature[0] != "A" else "B"
    return f"{payload}.{timestamp}.{flipped}{signature[1:]}"


@pytest.mark.parametrize(
    "make_token",
    [
        pytest.param(lambda app, user: _tampered(reset_token_for(app, user)), id="tampered"),
        pytest.param(
            lambda app, user: URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="other").dumps(
                {"uid": user.id, "ph": "0" * 32}
            ),
            id="other-salt",
        ),
        pytest.param(
            lambda app, user: URLSafeTimedSerializer("x" * 40, salt="password-reset").dumps(
                {"uid": user.id, "ph": "0" * 32}
            ),
            id="other-secret",
        ),
        pytest.param(lambda app, user: "not-a-token", id="garbage"),
    ],
)
def test_invalid_tokens_are_rejected(
    anon: CsrfClient,
    user_factory: UserFactory,
    app: Flask,
    db_session: Session,
    make_token: Any,
) -> None:
    user = user_factory(email="ada@example.com")
    original_hash = user.password_hash
    response = anon.post(
        CONFIRM_URL, json={"token": make_token(app, user), "password": NEW_PASSWORD}
    )
    assert response.status_code == 400
    assert error_code(response) == "invalid_token"
    db_session.refresh(user)
    assert user.password_hash == original_hash


def test_token_of_a_deleted_account_is_rejected(
    anon: CsrfClient, user_factory: UserFactory, app: Flask, db_session: Session
) -> None:
    user = user_factory(email="ada@example.com")
    token = reset_token_for(app, user)
    db_session.delete(user)
    db_session.commit()
    response = anon.post(CONFIRM_URL, json={"token": token, "password": NEW_PASSWORD})
    assert error_code(response) == "invalid_token"


@pytest.mark.parametrize(
    ("body", "fields"),
    [
        ({"password": NEW_PASSWORD}, {"token": "This field is required."}),
        ({"token": "", "password": NEW_PASSWORD}, {"token": "Must not be blank."}),
        (
            {"token": "t" * 513, "password": NEW_PASSWORD},
            {"token": "Must be at most 512 characters."},
        ),
        ({"token": "t", "password": "short"}, {"password": "Must be at least 8 characters."}),
        ({"token": "t", "password": "        "}, {"password": "Must not be only whitespace."}),
    ],
)
def test_confirm_validation(anon: CsrfClient, body: dict[str, str], fields: dict[str, str]) -> None:
    response = anon.post(CONFIRM_URL, json=body)
    assert response.status_code == 422
    assert response.get_json()["error"]["fields"] == fields


def test_confirm_keeps_the_new_password_untrimmed(
    anon: CsrfClient, user_factory: UserFactory, app: Flask
) -> None:
    token = reset_token_for(app, user_factory(email="ada@example.com"))
    password = " padded password "
    assert anon.post(CONFIRM_URL, json={"token": token, "password": password}).status_code == 204
    login = {"email": "ada@example.com", "password": password}
    assert anon.post("/api/auth/login", json=login).status_code == 200


# --- Per-email limit (silent) ---------------------------------------------------------------


@pytest.fixture
def limited_outbox(rate_limited_app: Flask) -> list[OutgoingEmail]:
    messages: list[OutgoingEmail] = rate_limited_app.extensions.setdefault(OUTBOX_EXTENSION_KEY, [])
    messages.clear()
    return messages


def test_per_email_limit_silently_skips_sending(
    rate_limited_app: Flask,
    user_factory: UserFactory,
    limited_outbox: list[OutgoingEmail],
    caplog: pytest.LogCaptureFixture,
) -> None:
    user_factory(email="ada@example.com")
    user_factory(email="bob@example.com")
    client = csrf_client(rate_limited_app)
    responses = []
    for index in range(4):  # Different client IPs: only the per-email limit applies.
        headers = {"X-Forwarded-For": f"203.0.113.{index + 1}"}
        responses.append(request_reset(client, "ada@example.com", headers=headers))
    with caplog.at_level(logging.INFO, logger="sotd.api.auth"):
        skipped = request_reset(
            client, "ADA@example.com", headers={"X-Forwarded-For": "203.0.113.9"}
        )
    assert all(response.status_code == 202 for response in [*responses, skipped])
    assert skipped.get_json() == {}
    # Only the per-IP limit shows in the headers: this was the first request of its IP.
    assert (skipped.headers["X-RateLimit-Limit"], skipped.headers["X-RateLimit-Remaining"]) == (
        "5",
        "4",
    )
    assert [email.to for email in limited_outbox] == ["ada@example.com"] * 3
    assert "per-address limit reached" in caplog.text

    request_reset(client, "bob@example.com", headers={"X-Forwarded-For": "203.0.113.10"})
    assert limited_outbox[-1].to == "bob@example.com"


def test_per_email_limit_counts_unknown_addresses(
    rate_limited_app: Flask, limited_outbox: list[OutgoingEmail], user_factory: UserFactory
) -> None:
    client = csrf_client(rate_limited_app)
    for index in range(3):
        request_reset(
            client, "late@example.com", headers={"X-Forwarded-For": f"198.51.100.{index}"}
        )
    user_factory(email="late@example.com")
    request_reset(client, "late@example.com", headers={"X-Forwarded-For": "198.51.100.9"})
    assert limited_outbox == []


def test_per_email_limit_fails_open_when_storage_fails(
    rate_limited_app: Flask,
    user_factory: UserFactory,
    limited_outbox: list[OutgoingEmail],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def broken_hit(*_args: object, **_kwargs: object) -> bool:
        raise ConnectionError("redis is down")

    monkeypatch.setattr(
        auth_api, "limiter", SimpleNamespace(limiter=SimpleNamespace(hit=broken_hit))
    )
    user_factory(email="ada@example.com")
    with caplog.at_level(logging.ERROR, logger="sotd.api.auth"):
        response = request_reset(csrf_client(rate_limited_app), "ada@example.com")
    assert response.status_code == 202
    assert len(limited_outbox) == 1
    assert "Rate limit storage failed" in caplog.text
