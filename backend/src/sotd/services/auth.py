"""Accounts and credentials: signup, login checks, password changes, reset and deletion.

Emails passed in are already normalized (``sotd.schemas.auth.normalize_email``). Each
function commits its own unit of work. Credential failures raise the API's errors
directly: ``401 invalid_credentials`` for a wrong email or password, ``409 email_taken``,
``409 username_taken`` and ``400 invalid_token``.
"""

from __future__ import annotations

from typing import Final

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from sotd.errors import ApiError
from sotd.extensions import db
from sotd.models import User
from sotd.security import (
    generate_password_reset_token,
    hash_password,
    load_password_reset_token,
    password_needs_rehash,
    verify_dummy_password,
    verify_password,
)
from sotd.services.mail import OutgoingEmail
from sotd.services.sessions import delete_user_sessions
from sotd.usernames import username_taken_message

_EMAIL_UNIQUE_CONSTRAINT: Final = "uq_users_email"
#: The unique constraint on ``users.username`` (usernames are stored lower-cased).
USERNAME_UNIQUE_CONSTRAINT: Final = "uq_users_username"

RESET_EMAIL_SUBJECT: Final = "Reset your Song of the Day password"


def invalid_credentials() -> ApiError:
    """Return the ``401 invalid_credentials`` error (wrong email or password)."""
    return ApiError(401, "invalid_credentials", "The email or password is incorrect.")


def _email_taken() -> ApiError:
    return ApiError(409, "email_taken", "An account with this email already exists.")


def username_taken(username: str) -> ApiError:
    """Return the ``409 username_taken`` error (signup and profile updates).

    Args:
        username: The lower-cased username that is already in use.
    """
    return ApiError(409, "username_taken", username_taken_message(username))


def username_in_use(username: str, *, exclude_user_id: int | None = None) -> bool:
    """Return whether another account has ``username`` (already normalized to lower case)."""
    statement = select(User.id).where(User.username == username)
    if exclude_user_id is not None:
        statement = statement.where(User.id != exclude_user_id)
    return db.session.scalar(statement) is not None


def register_user(*, email: str, password: str, username: str) -> User:
    """Create an account; the display name starts as the username.

    Args:
        email: The normalized email address.
        password: The new password, as typed.
        username: The validated, lower-cased username.

    Returns:
        The new, committed user.

    Raises:
        ApiError: ``409 email_taken`` if the email is already registered, else
            ``409 username_taken`` if the username is in use.
    """
    if db.session.scalar(select(User.id).where(User.email == email)) is not None:
        raise _email_taken()
    if username_in_use(username):
        raise username_taken(username)
    user = User(
        email=email,
        username=username,
        password_hash=hash_password(password),
        display_name=username,
    )
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError as exc:  # A concurrent signup won the race.
        db.session.rollback()
        constraint = violated_constraint(exc)
        if constraint == _EMAIL_UNIQUE_CONSTRAINT:
            raise _email_taken() from None
        if constraint == USERNAME_UNIQUE_CONSTRAINT:
            raise username_taken(username) from None
        raise
    return user


def violated_constraint(exc: IntegrityError) -> str | None:
    """Return the name of the constraint an ``IntegrityError`` reports, if any."""
    diagnostics = getattr(exc.orig, "diag", None)
    name = getattr(diagnostics, "constraint_name", None)
    return name if isinstance(name, str) else None


def authenticate(email: str, password: str) -> User:
    """Check a login and return the account.

    An unknown email still costs one password verification (against a dummy hash), so
    the timing doesn't reveal whether the account exists. A hash made with outdated
    argon2 parameters is replaced (and committed) on success.

    Args:
        email: The normalized email address.
        password: The password, as typed.

    Raises:
        ApiError: ``401 invalid_credentials`` for an unknown email or a wrong password.
    """
    user = db.session.scalar(select(User).where(User.email == email))
    if user is None:
        verify_dummy_password(password)
        raise invalid_credentials()
    if not verify_password(user.password_hash, password):
        raise invalid_credentials()
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
        db.session.commit()
    return user


def change_password(
    user: User, *, current_password: str, new_password: str, keep_token: str | None
) -> None:
    """Replace a user's password and revoke their other sessions.

    Args:
        user: The logged-in account.
        current_password: The current password, as typed.
        new_password: The new password, as typed.
        keep_token: The raw token of the current session, which stays valid.

    Raises:
        ApiError: ``401 invalid_credentials`` if ``current_password`` is wrong.
    """
    if not verify_password(user.password_hash, current_password):
        raise invalid_credentials()
    user.password_hash = hash_password(new_password)
    delete_user_sessions(user.id, keep_token=keep_token)
    db.session.commit()


def delete_account(user: User, *, password: str) -> None:
    """Delete an account; the database cascades to its sessions, entries and uploads.

    Args:
        user: The logged-in account.
        password: The password confirming the deletion, as typed.

    Raises:
        ApiError: ``401 invalid_credentials`` if ``password`` is wrong.
    """
    if not verify_password(user.password_hash, password):
        raise invalid_credentials()
    db.session.execute(delete(User).where(User.id == user.id))
    db.session.commit()


def prepare_password_reset(email: str, *, base_url: str) -> OutgoingEmail | None:
    """Build the password-reset email for an account, if one exists.

    Args:
        email: The normalized email address.
        base_url: ``APP_BASE_URL`` (never derived from the request).

    Returns:
        The email to send, or ``None`` when no account uses ``email``.
    """
    user = db.session.scalar(select(User).where(User.email == email))
    if user is None:
        return None
    token = generate_password_reset_token(user.id, user.password_hash)
    # The validity below matches security.PASSWORD_RESET_TOKEN_MAX_AGE.
    text = (
        f"Hi {user.display_name},\n\n"
        "Someone asked to reset the password of your Song of the Day account. To choose "
        "a new password, open this link:\n\n"
        f"{base_url}/reset-password#token={token}\n\n"
        "The link works once and expires in 1 hour. If you didn't ask for this, you can "
        "ignore this email; your password stays the same.\n"
    )
    return OutgoingEmail(to=user.email, subject=RESET_EMAIL_SUBJECT, text=text)


def confirm_password_reset(token: str, *, new_password: str) -> None:
    """Set a new password from a reset token and revoke every session of the user.

    The account row is locked while the token is checked, so a token can't be redeemed
    twice concurrently; afterwards the new password hash invalidates it.

    Args:
        token: The token from the reset link.
        new_password: The new password, as typed.

    Raises:
        ApiError: ``400 invalid_token`` if the token is tampered with, expired, already
            used or its account no longer exists.
    """
    claims = load_password_reset_token(token)
    user = None
    if claims is not None:
        user = db.session.scalar(select(User).where(User.id == claims.user_id).with_for_update())
    if claims is None or user is None or not claims.matches(user.password_hash):
        db.session.rollback()
        raise ApiError(400, "invalid_token", "This reset link is invalid or has expired.")
    user.password_hash = hash_password(new_password)
    delete_user_sessions(user.id)
    db.session.commit()
