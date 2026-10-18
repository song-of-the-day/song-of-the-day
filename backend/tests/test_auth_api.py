"""Signup, login, logout, ``me`` and the CSRF token endpoint."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta
from typing import Any
from unittest.mock import Mock

import pytest
from argon2 import PasswordHasher
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from sotd.models import User, UserSession
from sotd.security import (
    hash_password,
    password_needs_rehash,
    verify_dummy_password,
    verify_password,
)
from sotd.services import auth
from sotd.theme import normalize_theme
from tests.clients import (
    CSRF_HEADER,
    REMEMBER_COOKIE,
    SESSION_COOKIE,
    CsrfClient,
    cookie_value,
    csrf_client,
    csrf_token,
    error_code,
    log_in,
    set_cookies,
)
from tests.factories import DEFAULT_PASSWORD, UserFactory
from tests.support import FROZEN_NOW, AppFactory

SIGNUP = {
    "email": "ada@example.com",
    "password": DEFAULT_PASSWORD,
    "username": "ada",
}
USERNAME_LENGTH_MESSAGE = "Username must be between 3 and 30 characters."
USERNAME_PATTERN_MESSAGE = (
    "Username may only contain letters, numbers, hyphens or underscores, and cannot begin "
    "or end with a hyphen or underscore."
)


@pytest.fixture
def anon(app: Flask) -> CsrfClient:
    return csrf_client(app)


def fields_of(response: Any) -> dict[str, str]:
    assert response.status_code == 422, response.get_json()
    error = response.get_json()["error"]
    assert error["code"] == "validation_error"
    fields: dict[str, str] = error["fields"]
    return fields


def session_count(db_session: Session) -> int:
    return db_session.scalar(select(func.count()).select_from(UserSession)) or 0


# --- CSRF token -------------------------------------------------------------------------


def test_csrf_endpoint_returns_a_token(client: FlaskClient) -> None:
    response = client.get("/api/auth/csrf")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    token = response.get_json()["csrf_token"]
    assert isinstance(token, str)
    assert token


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/auth/signup"),
        ("POST", "/api/auth/login"),
        ("POST", "/api/auth/logout"),
        ("POST", "/api/auth/password-reset/request"),
        ("POST", "/api/auth/password-reset/confirm"),
        ("POST", "/api/account/password"),
        ("DELETE", "/api/account"),
    ],
)
def test_unsafe_requests_without_a_csrf_token_are_rejected(
    client: FlaskClient, method: str, path: str
) -> None:
    client.get("/api/auth/csrf")
    response = client.open(path, method=method, json={})
    assert response.status_code == 403
    assert error_code(response) == "csrf_failed"


@pytest.fixture(scope="module")
def proxied_app(app_factory: AppFactory) -> Iterator[Flask]:
    """An app behind one TLS-terminating reverse proxy (like the bundled nginx)."""
    with app_factory(TRUSTED_PROXY_COUNT=1) as application:
        yield application


HTTPS_PROXY_HEADERS = {"X-Forwarded-Proto": "https", "X-Forwarded-Host": "sotd.ca"}


@pytest.mark.parametrize(
    ("referer", "status"),
    [("https://sotd.ca/login", 200), ("https://evil.example/login", 403)],
)
def test_login_over_https_behind_a_proxy_checks_the_referer(
    proxied_app: Flask, user_factory: UserFactory, referer: str, status: int
) -> None:
    user_factory(email="ada@example.com")
    client = proxied_app.test_client()
    token = csrf_token(client, headers=HTTPS_PROXY_HEADERS)
    response = client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": DEFAULT_PASSWORD},
        headers={**HTTPS_PROXY_HEADERS, CSRF_HEADER: token, "Referer": referer},
    )
    assert response.status_code == status
    if status == 403:
        assert error_code(response) == "csrf_failed"


# --- Signup -----------------------------------------------------------------------------


@pytest.mark.usefixtures("frozen_time")
def test_signup_creates_the_account_and_logs_in(anon: CsrfClient, db_session: Session) -> None:
    response = anon.post("/api/auth/signup", json=SIGNUP)
    assert response.status_code == 201
    user = db_session.scalars(select(User)).one()
    assert response.get_json() == {
        "user": {
            "id": user.id,
            "email": "ada@example.com",
            "username": "ada",
            "display_name": "ada",
            "bio": "",
            "theme": normalize_theme({}),
            "autoplay_previews": True,
            "created_at": "2026-10-11T12:00:00Z",
        }
    }
    assert user.password_hash.startswith("$argon2id$")
    cookies = set_cookies(response)
    assert SESSION_COOKIE in cookies
    assert REMEMBER_COOKIE in cookies  # Signup starts a remember-me session.
    assert db_session.scalars(select(UserSession.remember)).one() is True
    assert anon.get("/api/auth/me").get_json()["user"]["id"] == user.id


def test_signup_rotates_the_csrf_token(client: FlaskClient) -> None:
    old_token = csrf_token(client)
    response = client.post("/api/auth/signup", json=SIGNUP, headers={CSRF_HEADER: old_token})
    assert response.status_code == 201

    stale = client.post("/api/auth/logout", headers={CSRF_HEADER: old_token})
    assert stale.status_code == 403
    assert error_code(stale) == "csrf_failed"
    new_token = csrf_token(client)
    assert new_token != old_token
    assert client.post("/api/auth/logout", headers={CSRF_HEADER: new_token}).status_code == 204


def test_signup_normalizes_the_email_and_takes_the_username_as_display_name(
    anon: CsrfClient, db_session: Session
) -> None:
    response = anon.post(
        "/api/auth/signup",
        json={**SIGNUP, "email": "  Ada.Lovelace@Example.COM ", "username": "  Ada_Love  "},
    )
    assert response.status_code == 201
    assert response.get_json()["user"]["email"] == "ada.lovelace@example.com"
    assert response.get_json()["user"]["display_name"] == "ada_love"
    assert db_session.scalars(select(User.email)).one() == "ada.lovelace@example.com"


def test_signup_trims_and_lower_cases_the_username(anon: CsrfClient, db_session: Session) -> None:
    response = anon.post("/api/auth/signup", json={**SIGNUP, "username": "  Ada_Love-Lace9 "})
    assert response.status_code == 201
    assert response.get_json()["user"]["username"] == "ada_love-lace9"
    assert db_session.scalars(select(User.username)).one() == "ada_love-lace9"


def test_signup_accepts_an_internationalized_address(anon: CsrfClient) -> None:
    response = anon.post("/api/auth/signup", json={**SIGNUP, "email": "Zoë@Exämple.com"})
    assert response.status_code == 201
    assert response.get_json()["user"]["email"] == "zoë@exämple.com"


def test_signup_with_a_taken_email_is_409(
    anon: CsrfClient, user_factory: UserFactory, db_session: Session
) -> None:
    user_factory(email="ada@example.com")
    response = anon.post("/api/auth/signup", json={**SIGNUP, "email": "ADA@example.com"})
    assert response.status_code == 409
    assert response.get_json() == {
        "error": {"code": "email_taken", "message": "An account with this email already exists."}
    }
    assert session_count(db_session) == 0
    assert anon.get("/api/auth/me").status_code == 401


def test_signup_with_a_taken_username_is_409(
    anon: CsrfClient, db_session: Session, user_factory: UserFactory
) -> None:
    user_factory(email="grace@example.com", username="ada")
    response = anon.post("/api/auth/signup", json={**SIGNUP, "username": "ADA"})
    assert response.status_code == 409
    assert response.get_json() == {
        "error": {"code": "username_taken", "message": "Username ada is already taken."}
    }
    assert db_session.scalar(select(func.count()).select_from(User)) == 1
    assert anon.get("/api/auth/me").status_code == 401


def test_signup_reports_a_taken_email_before_a_taken_username(
    anon: CsrfClient, user_factory: UserFactory
) -> None:
    user_factory(email="ada@example.com", username="ada")
    assert error_code(anon.post("/api/auth/signup", json=SIGNUP)) == "email_taken"


def test_signup_race_on_the_username_is_409(
    anon: CsrfClient, monkeypatch: pytest.MonkeyPatch, user_factory: UserFactory
) -> None:
    def hash_while_someone_else_signs_up(password: str) -> str:
        user_factory(email="grace@example.com", username="ada")  # Between check and insert.
        return hash_password(password)

    monkeypatch.setattr(auth, "hash_password", hash_while_someone_else_signs_up)
    response = anon.post("/api/auth/signup", json=SIGNUP)
    assert response.status_code == 409
    assert error_code(response) == "username_taken"


def test_signup_race_on_the_email_is_409(
    anon: CsrfClient, monkeypatch: pytest.MonkeyPatch, user_factory: UserFactory
) -> None:
    def hash_while_someone_else_signs_up(password: str) -> str:
        user_factory(email="ada@example.com")  # Commits between the check and the insert.
        return hash_password(password)

    monkeypatch.setattr(auth, "hash_password", hash_while_someone_else_signs_up)
    response = anon.post("/api/auth/signup", json=SIGNUP)
    assert response.status_code == 409
    assert error_code(response) == "email_taken"


def test_register_user_reraises_other_integrity_errors(app: Flask) -> None:
    with app.app_context(), pytest.raises(IntegrityError):
        auth.register_user(
            email="ada@example.com",
            password=DEFAULT_PASSWORD,
            username="ab",  # Violates the CHECK on users.username.
        )


@pytest.mark.parametrize(
    ("changes", "field", "message"),
    [
        ({"email": None}, "email", "Cannot be null."),
        ({"email": 5}, "email", "Must be a string."),
        ({"email": "not-an-email"}, "email", "Enter a valid email address."),
        ({"email": "Ada <ada@example.com>"}, "email", "Enter a valid email address."),
        ({"email": "ada@example.test"}, "email", "Enter a valid email address."),
        ({"email": "ada\x00@example.com"}, "email", "Contains characters that aren't allowed."),
        ({"email": "ada@example.com\nBcc: x@example.com"}, "email", "Must be a single line."),
        ({"email": f"{'a' * 64}@{'b' * 252}.com"}, "email", "Must be at most 320 characters."),
        ({"email": f"{'a' * 64}@{'b' * 200}.com"}, "email", "Enter a valid email address."),
        ({"password": "seven77"}, "password", "Must be at least 8 characters."),
        ({"password": "x" * 129}, "password", "Must be at most 128 characters."),
        ({"password": " \t" * 5}, "password", "Must not be only whitespace."),
        ({"password": "pass\x07word"}, "password", "Contains characters that aren't allowed."),
        ({"display_name": "Ada"}, "display_name", "Unknown field."),
        ({"bio": "hi"}, "bio", "Unknown field."),
        ({"username": None}, "username", "Cannot be null."),
        ({"username": 5}, "username", "Must be a string."),
        ({"username": ""}, "username", USERNAME_LENGTH_MESSAGE),
        ({"username": "   "}, "username", USERNAME_LENGTH_MESSAGE),
        ({"username": "ab"}, "username", USERNAME_LENGTH_MESSAGE),
        ({"username": " ab "}, "username", USERNAME_LENGTH_MESSAGE),
        ({"username": "a" * 31}, "username", USERNAME_LENGTH_MESSAGE),
        ({"username": "-ada"}, "username", USERNAME_PATTERN_MESSAGE),
        ({"username": "ada_"}, "username", USERNAME_PATTERN_MESSAGE),
        ({"username": "ada lovelace"}, "username", USERNAME_PATTERN_MESSAGE),
        ({"username": "ada.lovelace"}, "username", USERNAME_PATTERN_MESSAGE),
        ({"username": "zoë"}, "username", USERNAME_PATTERN_MESSAGE),
        ({"username": "ada\nx"}, "username", "Must be a single line."),
        ({"username": "ada\x00"}, "username", "Contains characters that aren't allowed."),
        ({"username": "admin"}, "username", "Username admin is unavailable."),
        ({"username": "Profile"}, "username", "Username profile is unavailable."),
        ({"username": "robots.txt"}, "username", USERNAME_PATTERN_MESSAGE),
        ({"username": "forgot-password"}, "username", "Username forgot-password is unavailable."),
    ],
)
def test_signup_validation(
    anon: CsrfClient, db_session: Session, changes: dict[str, object], field: str, message: str
) -> None:
    response = anon.post("/api/auth/signup", json={**SIGNUP, **changes})
    assert fields_of(response) == {field: message}
    assert db_session.scalar(select(func.count()).select_from(User)) == 0


def test_signup_requires_every_field(anon: CsrfClient) -> None:
    assert fields_of(anon.post("/api/auth/signup", json={})) == {
        "email": "This field is required.",
        "password": "This field is required.",
        "username": "This field is required.",
    }


def test_signup_accepts_boundary_lengths(anon: CsrfClient) -> None:
    response = anon.post(
        "/api/auth/signup",
        json={**SIGNUP, "password": "x" * 128, "username": "z" * 30},
    )
    assert response.status_code == 201


@pytest.mark.parametrize("username", ["abc", "a-b", "a_b", "123", "a--b", "0-_-9"])
def test_signup_accepts_edge_case_usernames(anon: CsrfClient, username: str) -> None:
    response = anon.post("/api/auth/signup", json={**SIGNUP, "username": username})
    assert response.status_code == 201
    assert response.get_json()["user"]["username"] == username


def test_passwords_are_never_trimmed(anon: CsrfClient) -> None:
    password = "  spaced out  "
    assert anon.post("/api/auth/signup", json={**SIGNUP, "password": password}).status_code == 201
    anon.post("/api/auth/logout")
    login = {"email": SIGNUP["email"], "password": password.strip()}
    assert anon.post("/api/auth/login", json=login).status_code == 401
    login["password"] = password
    assert anon.post("/api/auth/login", json=login).status_code == 200


# --- Login ------------------------------------------------------------------------------


def test_login_returns_the_user_and_starts_a_session(
    anon: CsrfClient, user_factory: UserFactory, db_session: Session
) -> None:
    user = user_factory(email="ada@example.com", display_name="Ada", bio="breakbeats")
    response = anon.post(
        "/api/auth/login", json={"email": "ADA@Example.com ", "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 200
    body = response.get_json()["user"]
    assert (body["id"], body["email"], body["bio"]) == (user.id, "ada@example.com", "breakbeats")
    assert db_session.scalars(select(UserSession.user_id)).all() == [user.id]
    assert anon.get("/api/auth/me").status_code == 200


def test_wrong_password_and_unknown_email_get_the_same_401(
    anon: CsrfClient, user_factory: UserFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    user_factory(email="ada@example.com")
    dummy = Mock(wraps=verify_dummy_password)
    monkeypatch.setattr("sotd.services.auth.verify_dummy_password", dummy)

    wrong = anon.post("/api/auth/login", json={"email": "ada@example.com", "password": "nope-nope"})
    dummy.assert_not_called()
    unknown = anon.post(
        "/api/auth/login", json={"email": "bob@example.com", "password": "nope-nope"}
    )
    dummy.assert_called_once_with("nope-nope")

    for response in (wrong, unknown):
        assert response.status_code == 401
        assert response.get_json() == {
            "error": {
                "code": "invalid_credentials",
                "message": "The email or password is incorrect.",
            }
        }
    assert anon.get("/api/auth/me").status_code == 401


def test_failed_login_creates_no_session(
    anon: CsrfClient, user_factory: UserFactory, db_session: Session
) -> None:
    user_factory(email="ada@example.com")
    response = anon.post("/api/auth/login", json={"email": "ada@example.com", "password": "x"})
    assert response.status_code == 401
    assert session_count(db_session) == 0


@pytest.mark.parametrize(
    ("changes", "field", "message"),
    [
        ({"remember": "yes"}, "remember", "Must be true or false."),
        ({"remember": 1}, "remember", "Must be true or false."),
        ({"remember": None}, "remember", "Cannot be null."),
        ({"password": ""}, "password", "Must not be blank."),
        ({"password": "x" * 129}, "password", "Must be at most 128 characters."),
        ({"email": "nope"}, "email", "Enter a valid email address."),
        ({"extra": True}, "extra", "Unknown field."),
    ],
)
def test_login_validation(
    anon: CsrfClient, changes: dict[str, object], field: str, message: str
) -> None:
    body = {"email": "ada@example.com", "password": DEFAULT_PASSWORD, **changes}
    assert fields_of(anon.post("/api/auth/login", json=body)) == {field: message}


def test_login_clears_the_session_and_rotates_the_csrf_token(
    client: FlaskClient, user_factory: UserFactory
) -> None:
    user_factory(email="ada@example.com")
    old_token = csrf_token(client)
    old_session = cookie_value(client, SESSION_COOKIE)
    log_in(client, "ada@example.com")
    assert cookie_value(client, SESSION_COOKIE) != old_session

    stale = client.post("/api/auth/logout", headers={CSRF_HEADER: old_token})
    assert stale.status_code == 403
    assert error_code(stale) == "csrf_failed"
    new_token = csrf_token(client)
    assert client.post("/api/auth/logout", headers={CSRF_HEADER: new_token}).status_code == 204


def test_logging_in_again_revokes_the_previous_session(
    anon: CsrfClient, user_factory: UserFactory, app: Flask, db_session: Session
) -> None:
    user_factory(email="ada@example.com")
    bob = user_factory(email="bob@example.com")
    log_in(anon, "ada@example.com")
    previous = cookie_value(anon, SESSION_COOKIE)

    log_in(anon, "bob@example.com")
    assert anon.get("/api/auth/me").get_json()["user"]["id"] == bob.id
    assert db_session.scalars(select(UserSession.user_id)).all() == [bob.id]

    replay = app.test_client()
    replay.set_cookie(SESSION_COOKIE, previous)
    assert replay.get("/api/auth/me").status_code == 401


def test_login_purges_only_the_users_expired_sessions(
    anon: CsrfClient, user_factory: UserFactory, db_session: Session
) -> None:
    ada = user_factory(email="ada@example.com")
    bob = user_factory(email="bob@example.com")
    expired = FROZEN_NOW - timedelta(days=400)
    for owner in (ada, bob):
        db_session.add(
            UserSession(
                user_id=owner.id,
                token_hash=f"{owner.id:064d}",
                remember=False,
                created_at=expired,
                last_seen_at=expired,
                expires_at=expired,
            )
        )
    db_session.commit()

    log_in(anon, "ada@example.com")
    owners = db_session.scalars(
        select(UserSession.user_id).order_by(UserSession.user_id, UserSession.id)
    ).all()
    assert owners == [ada.id, bob.id]  # Ada's new session and Bob's expired one.


def test_login_rehashes_a_password_with_outdated_parameters(
    anon: CsrfClient, user_factory: UserFactory, db_session: Session, app: Flask
) -> None:
    user = user_factory(email="ada@example.com")
    outdated = PasswordHasher(time_cost=2, memory_cost=16, parallelism=1).hash(DEFAULT_PASSWORD)
    user.password_hash = outdated
    db_session.commit()

    log_in(anon, "ada@example.com")
    db_session.refresh(user)
    assert user.password_hash != outdated
    with app.app_context():
        assert verify_password(user.password_hash, DEFAULT_PASSWORD)
        assert not password_needs_rehash(user.password_hash)


def test_login_keeps_a_current_hash(
    anon: CsrfClient, user_factory: UserFactory, db_session: Session
) -> None:
    user = user_factory(email="ada@example.com")
    original = user.password_hash
    log_in(anon, "ada@example.com")
    db_session.refresh(user)
    assert user.password_hash == original


# --- Logout -----------------------------------------------------------------------------


def test_logout_revokes_the_session_server_side(
    auth_client: CsrfClient, app: Flask, db_session: Session
) -> None:
    session_cookie = cookie_value(auth_client, SESSION_COOKIE)
    remember_cookie = cookie_value(auth_client, REMEMBER_COOKIE)

    response = auth_client.post("/api/auth/logout")
    assert response.status_code == 204
    cookies = set_cookies(response)
    assert cookies[SESSION_COOKIE].deletes
    assert cookies[REMEMBER_COOKIE].deletes
    assert session_count(db_session) == 0
    assert auth_client.get("/api/auth/me").status_code == 401

    for name, value in ((SESSION_COOKIE, session_cookie), (REMEMBER_COOKIE, remember_cookie)):
        replay = app.test_client()
        replay.set_cookie(name, value)
        response = replay.get("/api/auth/me")
        assert response.status_code == 401
        assert error_code(response) == "unauthorized"


def test_logout_when_logged_out_succeeds(anon: CsrfClient) -> None:
    assert anon.post("/api/auth/logout").status_code == 204


def test_logout_rotates_the_csrf_token(auth_client: CsrfClient) -> None:
    token = csrf_token(auth_client)
    assert auth_client.post("/api/auth/logout", headers={CSRF_HEADER: token}).status_code == 204
    stale = auth_client.post("/api/auth/logout", headers={CSRF_HEADER: token})
    assert stale.status_code == 403
    assert error_code(stale) == "csrf_failed"


def test_logout_keeps_other_sessions(auth_client: CsrfClient, auth_user: User, app: Flask) -> None:
    other = csrf_client(app)
    log_in(other, auth_user.email)
    auth_client.post("/api/auth/logout")
    assert other.get("/api/auth/me").status_code == 200


# --- Me ---------------------------------------------------------------------------------


def test_me_returns_the_logged_in_user(auth_client: CsrfClient, auth_user: User) -> None:
    response = auth_client.get("/api/auth/me")
    assert response.status_code == 200
    user = response.get_json()["user"]
    assert (user["id"], user["email"], user["display_name"]) == (
        auth_user.id,
        "ada@example.com",
        "Ada",
    )
    assert user["theme"] == normalize_theme({})


def test_me_without_a_session_is_401(client: FlaskClient) -> None:
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.get_json() == {
        "error": {"code": "unauthorized", "message": "Log in to continue."}
    }


def test_me_with_a_forged_cookie_is_401(client: FlaskClient) -> None:
    client.set_cookie(SESSION_COOKIE, "forged")
    client.set_cookie(REMEMBER_COOKIE, "forged|0000")
    assert client.get("/api/auth/me").status_code == 401
