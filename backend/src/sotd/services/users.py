"""Public profiles: resolving a username from a URL to its account."""

from __future__ import annotations

from sqlalchemy import select

from sotd.errors import ApiError
from sotd.extensions import db
from sotd.models import User
from sotd.usernames import lookup_key


def user_not_found() -> ApiError:
    """Return the ``404 not_found`` error for a username nobody has."""
    return ApiError(404, "not_found", "Nobody has this username.")


def get_public_user(username: str) -> User:
    """Return the account with this username (case-insensitive).

    Args:
        username: The username as it appears in the URL.

    Raises:
        ApiError: ``404 not_found`` if no account has it. Input that can't be a
            username is rejected without a query.
    """
    key = lookup_key(username)
    user = None if key is None else db.session.scalar(select(User).where(User.username == key))
    if user is None:
        raise user_not_found()
    return user
