"""Server-side sessions: cookies, remember-me, sliding expiry and the absolute cap."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import time_machine
from flask import Flask
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from sotd import create_app
from sotd.errors import ApiError
from sotd.extensions import db
from sotd.logging import configure_logging
from sotd.models import User, UserSession
from sotd.security import hash_token
from sotd.services import sessions
from tests.clients import (
    REMEMBER_COOKIE,
    SESSION_COOKIE,
    CsrfClient,
    cookie_value,
    csrf_client,
    log_in,
    set_cookies,
)
from tests.factories import DEFAULT_PASSWORD, UserFactory
from tests.support import FROZEN_NOW, VALID_PRODUCTION_ENV

THIRTY_DAYS = timedelta(days=30)
TWELVE_HOURS = timedelta(hours=12)
SECOND = timedelta(seconds=1)
COOKIE_EXPIRES_FORMAT = "%a, %d %b %Y %H:%M:%S GMT"


def http_date(moment: datetime) -> str:
    return moment.strftime(COOKIE_EXPIRES_FORMAT)


def only_session(db_session: Session) -> UserSession:
    db_session.expire_all()
    return db_session.scalars(select(UserSession)).one()


@pytest.fixture
def ada(user_factory: UserFactory) -> User:
    return user_factory(email="ada@example.com")


@pytest.fixture
def browser(app: Flask, ada: User) -> CsrfClient:
    return csrf_client(app)


def me_status(client: CsrfClient) -> int:
    return client.get("/api/auth/me").status_code


# --- Cookies ----------------------------------------------------------------------------


@pytest.mark.usefixtures("frozen_time")
def test_remember_me_login_sets_persistent_cookies(browser: CsrfClient) -> None:
    cookies = set_cookies(log_in(browser, "ada@example.com", remember=True))
    # Flask and Flask-Login express the 30-day lifetime (2,592,000 s) as Expires only.
    assert THIRTY_DAYS.total_seconds() == 2_592_000
    for name in (SESSION_COOKIE, REMEMBER_COOKIE):
        attributes = cookies[name].attributes
        assert attributes["expires"] == http_date(FROZEN_NOW + THIRTY_DAYS)
        assert "max-age" not in attributes
        assert "httponly" in attributes
        assert attributes["samesite"] == "Lax"
        assert attributes["path"] == "/"
        assert "secure" not in attributes  # Development and testing run over http.
        assert "domain" not in attributes


@pytest.mark.usefixtures("frozen_time")
def test_login_without_remember_sets_a_browser_session_cookie_only(browser: CsrfClient) -> None:
    cookies = set_cookies(log_in(browser, "ada@example.com", remember=False))
    assert REMEMBER_COOKIE not in cookies
    attributes = cookies[SESSION_COOKIE].attributes
    assert "expires" not in attributes
    assert "max-age" not in attributes
    assert "httponly" in attributes
    assert attributes["samesite"] == "Lax"

    response = browser.get("/api/auth/me")
    assert response.status_code == 200
    assert REMEMBER_COOKIE not in set_cookies(response)
    assert browser.get_cookie(REMEMBER_COOKIE) is None


def test_remember_cookie_restores_the_session_after_a_browser_restart(
    browser: CsrfClient, app: Flask
) -> None:
    log_in(browser, "ada@example.com", remember=True)
    restarted = app.test_client()
    restarted.set_cookie(REMEMBER_COOKIE, cookie_value(browser, REMEMBER_COOKIE))
    assert restarted.get("/api/auth/me").status_code == 200


def test_session_without_remember_ends_with_the_browser(browser: CsrfClient, app: Flask) -> None:
    log_in(browser, "ada@example.com", remember=False)
    restarted = app.test_client()  # No session cookie and no remember cookie.
    assert restarted.get("/api/auth/me").status_code == 401


def test_remember_cookie_is_refreshed_on_each_request(
    browser: CsrfClient, frozen_time: time_machine.Traveller
) -> None:
    log_in(browser, "ada@example.com", remember=True)
    frozen_time.shift(timedelta(days=2))
    cookies = set_cookies(browser.get("/api/auth/me"))
    expected = http_date(FROZEN_NOW + timedelta(days=2) + THIRTY_DAYS)
    assert cookies[REMEMBER_COOKIE].attributes["expires"] == expected
    assert cookies[SESSION_COOKIE].attributes["expires"] == expected


def test_login_without_remember_deletes_a_leftover_remember_cookie(
    browser: CsrfClient, user_factory: UserFactory
) -> None:
    user_factory(email="bob@example.com")
    log_in(browser, "ada@example.com", remember=True)
    cookies = set_cookies(log_in(browser, "bob@example.com", remember=False))
    assert cookies[REMEMBER_COOKIE].deletes
    assert browser.get_cookie(REMEMBER_COOKIE) is None
    assert browser.get("/api/auth/me").get_json()["user"]["email"] == "bob@example.com"


def test_responses_that_change_no_session_state_set_no_cookies(
    browser: CsrfClient, app: Flask
) -> None:
    # A cookie deletion on an anonymous response could clobber the session cookie that
    # a concurrent login or CSRF request has just set.
    anonymous = app.test_client()
    for path in ("/api/health", "/api/auth/me", "/api/unknown"):
        assert "Set-Cookie" not in anonymous.get(path).headers
    log_in(browser, "ada@example.com", remember=False)
    assert "Set-Cookie" not in browser.get("/api/auth/me").headers


def revoke_every_session(db_session: Session) -> None:
    """Delete every session row, as a password reset on another device would."""
    db_session.execute(delete(UserSession))
    db_session.commit()


def test_cookies_of_a_revoked_session_are_dropped_once(
    browser: CsrfClient, db_session: Session
) -> None:
    log_in(browser, "ada@example.com", remember=True)
    revoke_every_session(db_session)

    response = browser.get("/api/auth/me")
    assert response.status_code == 401
    cookies = set_cookies(response)
    assert cookies[SESSION_COOKIE].deletes
    assert cookies[REMEMBER_COOKIE].deletes
    assert browser.get_cookie(SESSION_COOKIE) is None
    assert browser.get_cookie(REMEMBER_COOKIE) is None

    later = browser.get("/api/auth/me")
    assert later.status_code == 401
    assert "Set-Cookie" not in later.headers


def test_a_dead_remember_cookie_alone_is_dropped(
    browser: CsrfClient, app: Flask, db_session: Session
) -> None:
    log_in(browser, "ada@example.com", remember=True)
    remember_cookie = cookie_value(browser, REMEMBER_COOKIE)
    revoke_every_session(db_session)

    restarted = app.test_client()  # Only the remember cookie survived the browser restart.
    restarted.set_cookie(REMEMBER_COOKIE, remember_cookie)
    response = restarted.get("/api/auth/me")
    assert response.status_code == 401
    assert set_cookies(response)[REMEMBER_COOKIE].deletes
    assert restarted.get_cookie(REMEMBER_COOKIE) is None
    assert restarted.get_cookie(SESSION_COOKIE) is None


def test_logging_in_with_the_cookies_of_a_revoked_session_works(
    browser: CsrfClient, db_session: Session
) -> None:
    log_in(browser, "ada@example.com", remember=True)
    revoke_every_session(db_session)

    cookies = set_cookies(log_in(browser, "ada@example.com", remember=True))
    assert not cookies[SESSION_COOKIE].deletes
    assert not cookies[REMEMBER_COOKIE].deletes
    assert me_status(browser) == 200


@pytest.fixture(scope="module")
def production_app(database_url: str, app: Flask) -> Iterator[Flask]:
    """The real production configuration (rate limits off), on the test database."""
    environment = {
        **VALID_PRODUCTION_ENV,
        "DATABASE_URL": database_url,
        "RATELIMIT_ENABLED": "false",
        "RATELIMIT_STORAGE_URI": "memory://",
        "LOG_LEVEL": "WARNING",
    }
    with pytest.MonkeyPatch.context() as patch:
        for name, value in environment.items():
            patch.setenv(name, value)
        production = create_app("production")
    try:
        yield production
    finally:
        with production.app_context():
            db.engine.dispose()
        configure_logging(app.config["LOG_LEVEL"], app.config["LOG_FORMAT"])


HTTPS_BASE_URL = "https://localhost"
HTTPS_REFERER = {"Referer": "https://localhost/login"}


@pytest.mark.usefixtures("ada")
def test_production_cookies_are_host_prefixed_and_secure(production_app: Flask) -> None:
    client = csrf_client(production_app)
    response = client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": DEFAULT_PASSWORD, "remember": True},
        base_url=HTTPS_BASE_URL,
        headers=HTTPS_REFERER,
    )
    assert response.status_code == 200
    cookies = set_cookies(response)
    assert set(cookies) == {"__Host-sotd_session", "__Host-sotd_remember"}
    for cookie in cookies.values():
        assert "secure" in cookie.attributes
        assert "httponly" in cookie.attributes
        assert cookie.attributes["samesite"] == "Lax"
        assert cookie.attributes["path"] == "/"
        assert "domain" not in cookie.attributes

    logout = client.post("/api/auth/logout", base_url=HTTPS_BASE_URL, headers=HTTPS_REFERER)
    assert logout.status_code == 204
    deleted = set_cookies(logout)
    # Browsers ignore a __Host- cookie deletion that lacks the Secure flag.
    for name in ("__Host-sotd_session", "__Host-sotd_remember"):
        assert deleted[name].deletes
        assert "secure" in deleted[name].attributes


# --- Expiry -----------------------------------------------------------------------------


def test_session_expires_after_twelve_idle_hours(
    browser: CsrfClient, frozen_time: time_machine.Traveller
) -> None:
    log_in(browser, "ada@example.com", remember=False)
    frozen_time.shift(TWELVE_HOURS)
    assert me_status(browser) == 401


def test_session_is_valid_until_its_idle_timeout(
    browser: CsrfClient, frozen_time: time_machine.Traveller
) -> None:
    log_in(browser, "ada@example.com", remember=False)
    frozen_time.shift(TWELVE_HOURS - SECOND)
    assert me_status(browser) == 200


def test_remember_session_is_valid_until_its_idle_timeout(
    browser: CsrfClient, frozen_time: time_machine.Traveller
) -> None:
    log_in(browser, "ada@example.com", remember=True)
    frozen_time.shift(THIRTY_DAYS - SECOND)
    assert me_status(browser) == 200


def test_remember_session_expires_after_thirty_idle_days(
    browser: CsrfClient, frozen_time: time_machine.Traveller, app: Flask
) -> None:
    log_in(browser, "ada@example.com", remember=True)
    remember_cookie = cookie_value(browser, REMEMBER_COOKIE)
    frozen_time.shift(THIRTY_DAYS)
    assert me_status(browser) == 401
    restarted = app.test_client()
    restarted.set_cookie(REMEMBER_COOKIE, remember_cookie)
    assert restarted.get("/api/auth/me").status_code == 401


def test_activity_slides_the_idle_timeout(
    browser: CsrfClient, frozen_time: time_machine.Traveller
) -> None:
    log_in(browser, "ada@example.com", remember=False)
    frozen_time.shift(timedelta(hours=6))
    assert me_status(browser) == 200
    frozen_time.shift(TWELVE_HOURS - SECOND)  # 18 hours after login.
    assert me_status(browser) == 200
    frozen_time.shift(TWELVE_HOURS)
    assert me_status(browser) == 401


def test_sessions_never_outlive_ninety_days(
    browser: CsrfClient, frozen_time: time_machine.Traveller, db_session: Session
) -> None:
    log_in(browser, "ada@example.com", remember=True)
    for _ in range(3):  # Active every 29 days: days 29, 58 and 87.
        frozen_time.shift(timedelta(days=29))
        assert me_status(browser) == 200
    row = only_session(db_session)
    assert row.created_at == FROZEN_NOW
    assert row.expires_at == FROZEN_NOW + timedelta(days=90)

    frozen_time.shift(timedelta(days=3))
    assert me_status(browser) == 401


def test_session_writes_are_throttled_to_every_five_minutes(
    browser: CsrfClient, frozen_time: time_machine.Traveller, db_session: Session
) -> None:
    log_in(browser, "ada@example.com", remember=False)
    row = only_session(db_session)
    assert (row.last_seen_at, row.expires_at) == (FROZEN_NOW, FROZEN_NOW + TWELVE_HOURS)

    frozen_time.shift(timedelta(minutes=5) - SECOND)
    assert me_status(browser) == 200
    row = only_session(db_session)
    assert (row.last_seen_at, row.expires_at) == (FROZEN_NOW, FROZEN_NOW + TWELVE_HOURS)

    frozen_time.shift(SECOND)
    assert me_status(browser) == 200
    touched = FROZEN_NOW + timedelta(minutes=5)
    row = only_session(db_session)
    assert (row.last_seen_at, row.expires_at) == (touched, touched + TWELVE_HOURS)


# --- Registry and helpers -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("remember", "used_after", "expected_after_login"),
    [
        (False, timedelta(0), TWELVE_HOURS),
        (True, timedelta(0), THIRTY_DAYS),
        (True, timedelta(days=70), timedelta(days=90)),
        (False, timedelta(days=89, hours=20), timedelta(days=90)),
    ],
)
def test_session_expiry(
    remember: bool, used_after: timedelta, expected_after_login: timedelta
) -> None:
    expiry = sessions.session_expiry(
        created_at=FROZEN_NOW, now=FROZEN_NOW + used_after, remember=remember
    )
    assert expiry == FROZEN_NOW + expected_after_login


def test_load_session_user_rejects_unknown_and_expired_tokens(
    app: Flask, ada: User, db_session: Session
) -> None:
    with app.app_context():
        user = db.session.get(User, ada.id)
        assert user is not None
        token = sessions.create_session(user, remember=False, now=FROZEN_NOW)
        db.session.commit()
        assert sessions.load_session_user("unknown", now=FROZEN_NOW) is None
        loaded = sessions.load_session_user(token, now=FROZEN_NOW)
        assert loaded is not None
        assert loaded.id == ada.id
        assert loaded.session_token == token
        assert sessions.load_session_user(token, now=FROZEN_NOW + TWELVE_HOURS) is None
    assert only_session(db_session).token_hash == hash_token(token)


def test_delete_user_sessions_can_keep_one(app: Flask, ada: User, db_session: Session) -> None:
    with app.app_context():
        user = db.session.get(User, ada.id)
        assert user is not None
        tokens = [sessions.create_session(user, remember=True, now=FROZEN_NOW) for _ in range(3)]
        db.session.commit()
        sessions.delete_user_sessions(ada.id, keep_token=tokens[1])
        db.session.commit()
    assert only_session(db_session).token_hash == hash_token(tokens[1])


def test_current_account_without_a_login_is_401(app: Flask) -> None:
    with app.test_request_context("/api/auth/me"), pytest.raises(ApiError) as excinfo:
        sessions.current_account()
    assert (excinfo.value.status, excinfo.value.code) == (401, "unauthorized")


def test_user_implements_the_flask_login_protocol(ada: User) -> None:
    assert ada.is_active
    assert ada.is_authenticated
    assert not ada.is_anonymous
    assert ada.session_token is None
    with pytest.raises(RuntimeError, match="not bound to a session"):
        ada.get_id()
    ada.session_token = "raw-token"
    assert ada.get_id() == "raw-token"


def test_session_expiry_uses_absolute_time_across_daylight_saving_changes() -> None:
    # 2026-10-11 08:00 in Toronto is EDT; 90 days later Toronto is on EST.
    created_at = FROZEN_NOW.astimezone(ZoneInfo("America/Toronto"))
    expiry = sessions.session_expiry(
        created_at=created_at, now=created_at + timedelta(days=80), remember=True
    )
    assert expiry == FROZEN_NOW + timedelta(days=90)
    assert expiry.utcoffset() == timedelta(0)
