"""Account management: change password, export data and delete the account.

Wrong passwords on ``POST /api/account/password`` and ``DELETE /api/account`` share one
limit: 5 failed (401) attempts per 15 minutes per user.
"""

from __future__ import annotations

from typing import Final

from flask import Blueprint, Response

from sotd import clock
from sotd.api.auth import is_failed_attempt
from sotd.api.utils import json_response, parse_body
from sotd.extensions import limiter
from sotd.schemas.auth import AccountDeleteIn, PasswordChangeIn
from sotd.services import auth, export, sessions

bp = Blueprint("account", __name__, url_prefix="/account")

FAILED_CONFIRMATION_LIMIT: Final = "5 per 15 minutes"


def _user_key() -> str:
    """Rate-limit key of the logged-in user (the views require a login first)."""
    return f"user:{sessions.current_account().id}"


_failed_password_attempts = limiter.shared_limit(
    FAILED_CONFIRMATION_LIMIT,
    scope="account-password",
    key_func=_user_key,
    deduct_when=is_failed_attempt,
)


@bp.post("/password")
@sessions.login_required
@_failed_password_attempts
def change_password() -> Response:
    """Change the password; every other session is revoked, the current one stays valid."""
    body = parse_body(PasswordChangeIn)
    user = sessions.current_account()
    auth.change_password(
        user,
        current_password=body.current_password,
        new_password=body.new_password,
        keep_token=user.session_token,
    )
    return Response(status=204)


@bp.get("/export")
@sessions.login_required
def export_data() -> Response:
    """Download everything the user owns as a dated JSON attachment."""
    now = clock.utcnow()
    document = export.build_export(sessions.current_account(), now=now)
    response = json_response(document)
    filename = export.export_filename(now.date())
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@bp.delete("")
@sessions.login_required
@_failed_password_attempts
def delete_account() -> Response:
    """Delete the account and everything it owns, then clear the session cookies."""
    body = parse_body(AccountDeleteIn)
    auth.delete_account(sessions.current_account(), password=body.password)
    sessions.clear_login()
    return Response(status=204)
