"""Authentication: CSRF token, signup, login, logout, current user and password reset.

Rate limits are keyed by the client IP (``request.remote_addr``,
corrected by ProxyFix) unless noted:

* login: 10/minute and 100/day, plus 10 failed (401) attempts per 15 minutes per
  normalized email;
* signup: 5/minute and 20/day;
* password-reset request: 5/hour, plus 3 emails per hour per normalized email. Over the
  per-email limit the email is silently not sent; the response is still ``202``.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Final, cast

from flask import Blueprint, Flask, Response, current_app, request
from flask_wtf.csrf import generate_csrf
from limits import parse
from werkzeug.exceptions import HTTPException
from werkzeug.local import LocalProxy

from sotd.api.utils import json_response, parse_body
from sotd.extensions import limiter
from sotd.logging import get_request_id
from sotd.schemas.auth import (
    CsrfTokenOut,
    LoginIn,
    PasswordResetConfirmIn,
    PasswordResetRequestIn,
    SignupIn,
    UserResponse,
    normalize_email,
)
from sotd.schemas.user import UserOut
from sotd.services import auth, sessions
from sotd.services.mail import OutgoingEmail, send_email

logger = logging.getLogger(__name__)

bp = Blueprint("auth", __name__, url_prefix="/auth")

LOGIN_LIMIT: Final = "10/minute;100/day"
LOGIN_FAILED_PER_EMAIL_LIMIT: Final = "10 per 15 minutes"
SIGNUP_LIMIT: Final = "5/minute;20/day"
RESET_REQUEST_LIMIT: Final = "5/hour"
RESET_EMAILS_PER_ADDRESS: Final = parse("3/hour")

_NO_EMAIL_KEY: Final = "email:none"


def is_failed_attempt(response: Response) -> bool:
    """Return whether a response rejected credentials (``deduct_when`` for failure limits)."""
    return response.status_code == 401


def email_digest(email: str) -> str:
    """Return the SHA-256 hex digest of a normalized email (rate-limit keys)."""
    return hashlib.sha256(email.encode()).hexdigest()


def _login_email_key() -> str:
    """Rate-limit key of the normalized email in the login body.

    Runs before the view parses the body, so it is lenient: a body without a valid
    ``email`` shares one key (such requests fail validation and are never counted). A
    body without a declared length (chunked) is not read here, where a read error can't
    be reported; browsers always declare it.
    """
    if request.content_length is None:
        return _NO_EMAIL_KEY
    # Nothing may escape from here: Flask-Limiter would skip every limit of the request
    # and switch to its per-process fallback storage. ``silent`` only covers ValueError.
    try:
        data: object = request.get_json(silent=True)
    except (HTTPException, RecursionError):  # A dropped connection or absurd nesting.
        data = None
    email = data.get("email") if isinstance(data, dict) else None
    if not isinstance(email, str):
        return _NO_EMAIL_KEY
    try:
        normalized = normalize_email(email.strip())
    except ValueError:  # Includes errors on lone surrogates, which can't even be hashed.
        return _NO_EMAIL_KEY
    return f"email:{email_digest(normalized)}"


@bp.get("/csrf")
def csrf_token() -> Response:
    """Return the session's CSRF token for the ``X-CSRFToken`` header."""
    return json_response(CsrfTokenOut(csrf_token=generate_csrf()))


@bp.post("/signup")
@limiter.limit(SIGNUP_LIMIT)
def signup() -> Response:
    """Create an account and log it in (a remember-me session)."""
    body = parse_body(SignupIn)
    user = auth.register_user(
        email=body.email,
        password=body.password,
        username=body.username,
    )
    sessions.log_in(user, remember=True)
    return json_response(UserResponse(user=UserOut.model_validate(user)), status=201)


@bp.post("/login")
@limiter.limit(LOGIN_LIMIT)
@limiter.limit(
    LOGIN_FAILED_PER_EMAIL_LIMIT, key_func=_login_email_key, deduct_when=is_failed_attempt
)
def login() -> Response:
    """Check the credentials and start a new session."""
    body = parse_body(LoginIn)
    user = auth.authenticate(body.email, body.password)
    sessions.log_in(user, remember=body.remember)
    return json_response(UserResponse(user=UserOut.model_validate(user)))


@bp.post("/logout")
def logout() -> Response:
    """Revoke the current session; succeeds when already logged out."""
    sessions.log_out()
    return Response(status=204)


@bp.get("/me")
@sessions.login_required
def me() -> Response:
    """Return the logged-in user."""
    return json_response(UserResponse(user=UserOut.model_validate(sessions.current_account())))


@bp.post("/password-reset/request")
@limiter.limit(RESET_REQUEST_LIMIT)
def request_password_reset() -> Response:
    """Email a reset link if the account exists; the response never says whether it does."""
    body = parse_body(PasswordResetRequestIn)
    response = json_response({}, status=202)
    if not _take_reset_email_quota(body.email):
        logger.info("Password reset email skipped: per-address limit reached")
        return response
    email = auth.prepare_password_reset(body.email, base_url=current_app.config["APP_BASE_URL"])
    if email is not None:
        _send_after_response(response, email)
    return response


@bp.post("/password-reset/confirm")
def confirm_password_reset() -> Response:
    """Set a new password from a reset token; every session of the user is revoked."""
    body = parse_body(PasswordResetConfirmIn)
    auth.confirm_password_reset(body.token, new_password=body.password)
    return Response(status=204)


def _take_reset_email_quota(email: str) -> bool:
    """Count a reset email for ``email``; return whether it is within the hourly quota.

    Storage errors allow the email, like ``RATELIMIT_SWALLOW_ERRORS`` does for the
    decorator limits (the per-IP limit still applies).
    """
    config = current_app.config
    if not config["RATE_LIMITS_ENABLED"]:
        return True
    try:
        return limiter.limiter.hit(
            RESET_EMAILS_PER_ADDRESS,
            config["RATELIMIT_KEY_PREFIX"],
            "password-reset-email",
            email_digest(email),
        )
    except Exception:
        logger.exception("Rate limit storage failed; not limiting this password reset email")
        return True


def _send_after_response(response: Response, email: OutgoingEmail) -> None:
    """Send ``email`` once the response has been written, in a fresh app context.

    Failures are logged (without the message, which holds the reset token) and never
    reach the client.
    """
    app = cast("LocalProxy[Flask]", current_app)._get_current_object()
    request_id = get_request_id()

    def deliver() -> None:
        with app.app_context():
            try:
                send_email(email.to, email.subject, email.text)
            except Exception:
                logger.exception(
                    "Password reset email could not be sent", extra={"request_id": request_id}
                )

    response.call_on_close(deliver)
