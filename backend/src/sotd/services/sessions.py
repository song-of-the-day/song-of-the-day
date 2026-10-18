"""Server-side sessions and their Flask-Login integration.

A login creates a ``user_sessions`` row holding the SHA-256 of a fresh random token; the
raw token lives only in the client's cookies (Flask-Login's "user id", in both the
session and the remember cookie). Every request looks the token up again, so deleting
the row revokes the session immediately, whatever cookies the client still holds.

* **Expiry** slides: 30 days idle for remember-me sessions, 12 hours otherwise, never
  beyond 90 days after the login. ``last_seen_at``/``expires_at`` are written at most
  once every 5 minutes.
* **Registry functions** (:func:`create_session`, :func:`load_session_user`,
  :func:`delete_session`, :func:`delete_user_sessions`) take explicit arguments and only
  stage changes in the current transaction, except where noted.
* **Request glue** (:func:`log_in`, :func:`log_out`, :func:`clear_login`,
  :func:`current_account`, :func:`login_required`) operates on the current request's
  Flask session and Flask-Login state; views use it instead of Flask-Login directly.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Final, cast

import flask_login
from flask import Flask, Response, current_app, g, request, session
from sqlalchemy import delete, select

from sotd import clock
from sotd.errors import ApiError
from sotd.extensions import db, login_manager
from sotd.logging import bind_user_id
from sotd.models import User, UserSession
from sotd.security import generate_session_token, hash_token
from sotd.services.housekeeping import delete_expired_sessions

#: Idle timeout of a session started without "keep me logged in".
SESSION_IDLE_TIMEOUT: Final = timedelta(hours=12)
#: Idle timeout of a remember-me session.
REMEMBER_IDLE_TIMEOUT: Final = timedelta(days=30)
#: No session outlives its login by more than this, however active it is.
SESSION_ABSOLUTE_LIFETIME: Final = timedelta(days=90)
#: Minimum time between two writes of ``last_seen_at``/``expires_at`` for one session.
SESSION_TOUCH_INTERVAL: Final = timedelta(minutes=5)

# Flask-Login's session key for the remember-cookie operation of the current response:
# "set" or "clear" (anything else leaves the cookie alone). It is popped after every
# request, so it never persists.
_REMEMBER_OPERATION_KEY: Final = "_remember"
_LEAVE_REMEMBER_COOKIE: Final = "unchanged"


def session_expiry(*, created_at: datetime, now: datetime, remember: bool) -> datetime:
    """Return when a session used at ``now`` expires if it then stays idle.

    Both arguments must be timezone-aware. They are converted to UTC first: adding a
    timedelta to a datetime in a zone with daylight saving time (as loaded from a
    connection whose time zone isn't UTC) would add wall-clock time instead.

    Args:
        created_at: When the session was created (start of the absolute cap).
        now: The time of the latest activity.
        remember: Whether it is a remember-me session.
    """
    idle_timeout = REMEMBER_IDLE_TIMEOUT if remember else SESSION_IDLE_TIMEOUT
    absolute_cap = created_at.astimezone(UTC) + SESSION_ABSOLUTE_LIFETIME
    return min(now.astimezone(UTC) + idle_timeout, absolute_cap)


def create_session(user: User, *, remember: bool, now: datetime) -> str:
    """Stage a new session for ``user`` and return its raw token.

    Args:
        user: The persisted account.
        remember: Whether the session is a remember-me session.
        now: The creation time.

    Returns:
        The raw token for the cookie; only its hash is stored.
    """
    token = generate_session_token()
    db.session.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            remember=remember,
            created_at=now,
            last_seen_at=now,
            expires_at=session_expiry(created_at=now, now=now, remember=remember),
        )
    )
    return token


def load_session_user(token: str, *, now: datetime) -> User | None:
    """Return the account of a live session and slide the session's expiry.

    The session and its user are loaded with a single query. When the last write is at
    least :data:`SESSION_TOUCH_INTERVAL` old, ``last_seen_at``/``expires_at`` are updated
    and **committed**; Flask-Login loads the user before a view stages any change of its
    own (``login_required`` runs first).

    Args:
        token: The raw token from the client's cookie.
        now: The current time.

    Returns:
        The user, bound to ``token`` (:attr:`User.session_token`), or ``None`` when the
        session doesn't exist or has expired.
    """
    statement = (
        select(UserSession, User)
        .join(UserSession.user)
        .where(UserSession.token_hash == hash_token(token))
    )
    row = db.session.execute(statement).one_or_none()
    if row is None:
        return None
    user_session, user = row
    if user_session.expires_at <= now:
        return None
    user.session_token = token
    if now - user_session.last_seen_at >= SESSION_TOUCH_INTERVAL:
        user_session.last_seen_at = now
        user_session.expires_at = session_expiry(
            created_at=user_session.created_at, now=now, remember=user_session.remember
        )
        db.session.commit()
    return user


def delete_session(token: str) -> None:
    """Stage the deletion of the session identified by a raw token (if it exists)."""
    db.session.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))


def delete_user_sessions(user_id: int, *, keep_token: str | None = None) -> None:
    """Stage the deletion of a user's sessions.

    Args:
        user_id: The account whose sessions are revoked.
        keep_token: The raw token of a session to keep (the current one after a
            password change).
    """
    statement = delete(UserSession).where(UserSession.user_id == user_id)
    if keep_token is not None:
        statement = statement.where(UserSession.token_hash != hash_token(keep_token))
    db.session.execute(statement)


# --- Request glue ----------------------------------------------------------------------


def init_app(app: Flask) -> None:
    """Bind Flask-Login to ``app`` with the session loader and the remember-cookie hooks.

    ``after_request`` hooks run in reverse order of registration, so each response
    passes through :func:`_manage_remember_cookie`, then Flask-Login's remember-cookie
    hook, then :func:`_restore_session_modified`.
    """
    app.after_request(_restore_session_modified)
    login_manager.init_app(app)
    login_manager.user_loader(_load_user)
    app.after_request(_manage_remember_cookie)


def _load_user(token: str) -> User | None:
    user = load_session_user(token, now=clock.utcnow())
    if user is None:
        g.sotd_dead_session = True
    else:
        bind_user_id(user.id)
    return user


def _manage_remember_cookie(response: Response) -> Response:
    """Correct Flask-Login's remember-cookie handling.

    * Cookies naming a revoked or expired session are dropped (once) when the request
      ends up anonymous. Flask-Login would otherwise re-issue both, and refresh the
      remember cookie, on every later request.
    * ``REMEMBER_COOKIE_REFRESH_EACH_REQUEST`` makes it (re)issue the remember cookie on
      every request with a logged-in session, including sessions started without "keep
      me logged in", which would then survive closing the browser. Only a cookie the
      client already has is refreshed; a remember-me login still issues one.
    * It deletes the cookie without the ``Secure`` flag, which browsers ignore for a
      ``__Host-`` cookie. The deletion is done here with the configured flags instead.
    """
    if g.pop("sotd_dead_session", False) and _current_user() is None:
        clear_login()
    g.sotd_session_modified = session.modified
    config = current_app.config
    name: str = config["REMEMBER_COOKIE_NAME"]
    operation = session.get(_REMEMBER_OPERATION_KEY)
    if operation == "clear":
        response.delete_cookie(
            name,
            path=config["REMEMBER_COOKIE_PATH"],
            domain=config["REMEMBER_COOKIE_DOMAIN"],
            secure=config["REMEMBER_COOKIE_SECURE"],
            httponly=config["REMEMBER_COOKIE_HTTPONLY"],
            samesite=config["REMEMBER_COOKIE_SAMESITE"],
        )
        session[_REMEMBER_OPERATION_KEY] = _LEAVE_REMEMBER_COOKIE
    elif operation is None and name not in request.cookies:
        session[_REMEMBER_OPERATION_KEY] = _LEAVE_REMEMBER_COOKIE
    return response


def _restore_session_modified(response: Response) -> Response:
    """Keep the remember-cookie bookkeeping from counting as a change of the session.

    Flask-Login (and :func:`_manage_remember_cookie`) store and pop a session key on
    every response, which leaves the session as it was but marks it modified. Flask would
    then re-send the session cookie with every response, and delete it on every
    anonymous one, which can clobber a cookie that a concurrent login has just set.
    """
    session.modified = g.pop("sotd_session_modified", session.modified)
    return response


def login_required[ViewT: Callable[..., Any]](view: ViewT) -> ViewT:
    """Typed :func:`flask_login.login_required`: anonymous requests get ``401 unauthorized``."""
    return cast(ViewT, flask_login.login_required(view))


def current_account() -> User:
    """Return the logged-in user of the current request.

    Raises:
        ApiError: ``401 unauthorized`` when the request has no live session.
    """
    user = _current_user()
    if user is None:
        raise ApiError(401, "unauthorized", "Log in to continue.")
    return user


def optional_account() -> User | None:
    """Return the logged-in user of the current request, or ``None`` when anonymous."""
    return _current_user()


def _current_user() -> User | None:
    user: object = flask_login.current_user._get_current_object()
    return user if isinstance(user, User) else None


def log_in(user: User, *, remember: bool) -> None:
    """Start a new session for ``user`` in the current request (signup and login).

    The session the request arrived with, if any, is revoked; the user's expired
    sessions are purged. The Flask session is cleared before the new login is stored,
    which also rotates the CSRF token. A remember-me login makes the session cookie
    persistent and issues the remember cookie; otherwise both are browser-session only
    and a leftover remember cookie is deleted.

    Args:
        user: The authenticated account.
        remember: Whether to keep the user logged in across browser restarts.
    """
    now = clock.utcnow()
    _revoke_current_session()
    delete_expired_sessions(now=now, user_id=user.id)
    token = create_session(user, remember=remember, now=now)
    db.session.commit()

    session.clear()
    session.permanent = remember
    user.session_token = token
    flask_login.login_user(user, remember=remember)
    if not remember and current_app.config["REMEMBER_COOKIE_NAME"] in request.cookies:
        session[_REMEMBER_OPERATION_KEY] = "clear"
    bind_user_id(user.id)


def log_out() -> None:
    """Revoke the current session (if any), then :func:`clear_login`."""
    _revoke_current_session()
    db.session.commit()
    clear_login()


def clear_login() -> None:
    """Empty the Flask session and drop the remember cookie, without touching the database.

    Clearing the session rotates the CSRF token; the session cookie is deleted when the
    response is saved.
    """
    session.clear()
    flask_login.logout_user()


def _revoke_current_session() -> None:
    user = _current_user()
    if user is not None and user.session_token is not None:
        delete_session(user.session_token)
