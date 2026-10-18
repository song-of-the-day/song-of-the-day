"""Changing the password and deleting the account."""

from __future__ import annotations

from typing import Any

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sotd.models import Annotation, Entry, Upload, User, UserSession
from tests.clients import (
    REMEMBER_COOKIE,
    SESSION_COOKIE,
    CsrfClient,
    cookie_value,
    csrf_client,
    error_code,
    log_in,
    set_cookies,
)
from tests.factories import (
    DEFAULT_PASSWORD,
    AnnotationFactory,
    EntryFactory,
    UploadFactory,
    UserFactory,
)

PASSWORD_URL = "/api/account/password"
ACCOUNT_URL = "/api/account"
NEW_PASSWORD = "a brand new passphrase"


def count(db_session: Session, model: type[Any]) -> int:
    return db_session.scalar(select(func.count()).select_from(model)) or 0


def login_status(client: FlaskClient, email: str, password: str) -> int:
    return client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"X-CSRFToken": client.get("/api/auth/csrf").get_json()["csrf_token"]},
    ).status_code


# --- Change password --------------------------------------------------------------------


def test_change_password_revokes_only_the_other_sessions(
    auth_client: CsrfClient, auth_user: User, app: Flask
) -> None:
    other = csrf_client(app)
    log_in(other, auth_user.email)
    remember_cookie = cookie_value(auth_client, REMEMBER_COOKIE)

    response = auth_client.post(
        PASSWORD_URL, json={"current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD}
    )
    assert response.status_code == 204
    assert not any(cookie.deletes for cookie in set_cookies(response).values())
    assert auth_client.get("/api/auth/me").status_code == 200
    assert other.get("/api/auth/me").status_code == 401

    restarted = app.test_client()  # The current remember cookie stays valid too.
    restarted.set_cookie(REMEMBER_COOKIE, remember_cookie)
    assert restarted.get("/api/auth/me").status_code == 200

    fresh = app.test_client()
    assert login_status(fresh, auth_user.email, DEFAULT_PASSWORD) == 401
    assert login_status(fresh, auth_user.email, NEW_PASSWORD) == 200


def test_wrong_current_password_is_401_and_keeps_everything(
    auth_client: CsrfClient, auth_user: User, app: Flask, db_session: Session
) -> None:
    other = csrf_client(app)
    log_in(other, auth_user.email)
    original_hash = auth_user.password_hash

    response = auth_client.post(
        PASSWORD_URL, json={"current_password": "not my password", "new_password": NEW_PASSWORD}
    )
    assert response.status_code == 401
    assert error_code(response) == "invalid_credentials"
    assert auth_client.get("/api/auth/me").status_code == 200  # Not logged out.
    assert other.get("/api/auth/me").status_code == 200
    db_session.refresh(auth_user)
    assert auth_user.password_hash == original_hash


def test_new_password_is_not_trimmed(auth_client: CsrfClient, auth_user: User) -> None:
    padded = "  padded password  "
    response = auth_client.post(
        PASSWORD_URL, json={"current_password": DEFAULT_PASSWORD, "new_password": padded}
    )
    assert response.status_code == 204
    fresh = auth_client.application.test_client()
    assert login_status(fresh, auth_user.email, padded.strip()) == 401
    assert login_status(fresh, auth_user.email, padded) == 200


@pytest.mark.parametrize(
    ("body", "fields"),
    [
        ({"new_password": NEW_PASSWORD}, {"current_password": "This field is required."}),
        (
            {"current_password": DEFAULT_PASSWORD, "new_password": "short"},
            {"new_password": "Must be at least 8 characters."},
        ),
        (
            {"current_password": DEFAULT_PASSWORD, "new_password": " " * 10},
            {"new_password": "Must not be only whitespace."},
        ),
        (
            {"current_password": "", "new_password": NEW_PASSWORD},
            {"current_password": "Must not be blank."},
        ),
        (
            {"current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD, "x": 1},
            {"x": "Unknown field."},
        ),
    ],
)
def test_change_password_validation(
    auth_client: CsrfClient, body: dict[str, object], fields: dict[str, str]
) -> None:
    response = auth_client.post(PASSWORD_URL, json=body)
    assert response.status_code == 422
    assert response.get_json()["error"]["fields"] == fields


def test_change_password_requires_a_login(app: Flask) -> None:
    response = csrf_client(app).post(
        PASSWORD_URL, json={"current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD}
    )
    assert response.status_code == 401
    assert error_code(response) == "unauthorized"


# --- Delete account ---------------------------------------------------------------------


def test_delete_account_cascades_and_clears_the_cookies(
    auth_client: CsrfClient,
    auth_user: User,
    app: Flask,
    db_session: Session,
    user_factory: UserFactory,
    entry_factory: EntryFactory,
    annotation_factory: AnnotationFactory,
    upload_factory: UploadFactory,
) -> None:
    for _ in range(2):
        annotation_factory(entry=entry_factory(user=auth_user))
    upload_factory(user=auth_user)
    other_user = user_factory(email="bob@example.com")
    annotation_factory(entry=entry_factory(user=other_user))
    upload_factory(user=other_user)
    log_in(csrf_client(app), other_user.email)
    second_session = csrf_client(app)
    log_in(second_session, auth_user.email)
    session_cookie = cookie_value(auth_client, SESSION_COOKIE)
    user_id = auth_user.id

    response = auth_client.delete(ACCOUNT_URL, json={"password": DEFAULT_PASSWORD})
    assert response.status_code == 204
    cookies = set_cookies(response)
    assert cookies[SESSION_COOKIE].deletes
    assert cookies[REMEMBER_COOKIE].deletes

    db_session.expire_all()
    assert db_session.get(User, user_id) is None
    assert db_session.scalars(select(User.email)).all() == ["bob@example.com"]
    for model in (Entry, Annotation, Upload, UserSession):
        assert count(db_session, model) == 1  # Only Bob's rows are left.
    assert db_session.scalars(select(Entry.user_id)).all() == [other_user.id]

    assert auth_client.get("/api/auth/me").status_code == 401
    assert second_session.get("/api/auth/me").status_code == 401
    replay = app.test_client()
    replay.set_cookie(SESSION_COOKIE, session_cookie)
    assert replay.get("/api/auth/me").status_code == 401
    assert login_status(app.test_client(), "ada@example.com", DEFAULT_PASSWORD) == 401


def test_delete_account_with_the_wrong_password_is_401(
    auth_client: CsrfClient, auth_user: User, db_session: Session, entry_factory: EntryFactory
) -> None:
    entry_factory(user=auth_user)
    response = auth_client.delete(ACCOUNT_URL, json={"password": "not my password"})
    assert response.status_code == 401
    assert error_code(response) == "invalid_credentials"
    assert auth_client.get("/api/auth/me").status_code == 200
    assert count(db_session, User) == 1
    assert count(db_session, Entry) == 1


@pytest.mark.parametrize(
    ("body", "fields"),
    [
        (None, {"password": "This field is required."}),
        ({"password": None}, {"password": "Cannot be null."}),
        ({"password": DEFAULT_PASSWORD, "confirm": True}, {"confirm": "Unknown field."}),
    ],
)
def test_delete_account_validation(
    auth_client: CsrfClient, db_session: Session, body: object, fields: dict[str, str]
) -> None:
    response = auth_client.delete(ACCOUNT_URL, json=body)
    assert response.status_code == 422
    assert response.get_json()["error"]["fields"] == fields
    assert count(db_session, User) == 1


def test_delete_account_requires_a_login(app: Flask) -> None:
    response = csrf_client(app).delete(ACCOUNT_URL, json={"password": DEFAULT_PASSWORD})
    assert response.status_code == 401
    assert error_code(response) == "unauthorized"
