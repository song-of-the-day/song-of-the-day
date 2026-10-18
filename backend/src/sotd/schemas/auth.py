"""Request and response bodies of the auth and account endpoints."""

from __future__ import annotations

from typing import Annotated, Final

from email_validator import EmailNotValidError, validate_email
from pydantic import AfterValidator, StrictBool
from pydantic_core import PydanticCustomError

from sotd.schemas.common import (
    ApiModel,
    NewPasswordStr,
    PasswordStr,
    ResponseModel,
    Text,
)
from sotd.schemas.user import UserOut
from sotd.usernames import normalize_username

#: Longest accepted email address (``users.email`` is ``varchar(320)``).
EMAIL_MAX_LENGTH: Final = 320
#: Display name length bounds, after trimming.
DISPLAY_NAME_MAX_LENGTH: Final = 50
#: Generous bound on a password-reset token (they are about 100 characters).
RESET_TOKEN_MAX_LENGTH: Final = 512


def normalize_email(value: str) -> str:
    """Validate an email address and return its normalized, lower-cased form.

    Deliverability (DNS) is not checked. Display names (``Ada <ada@example.com>``),
    quoted local parts and IP-literal domains are rejected.

    Args:
        value: The address as entered (already trimmed).

    Returns:
        The normalized address in lower case, as stored in ``users.email``.

    Raises:
        PydanticCustomError: If the address is invalid.
    """
    try:
        validated = validate_email(value, check_deliverability=False)
    except EmailNotValidError:
        raise PydanticCustomError("invalid_email", "Enter a valid email address.") from None
    return validated.normalized.lower()


#: An email address: trimmed, single line, valid and normalized to lower case.
EmailAddress = Annotated[str, Text(max_length=EMAIL_MAX_LENGTH), AfterValidator(normalize_email)]
#: A display name: 1-50 characters after trimming, single line.
DisplayName = Annotated[str, Text(min_length=1, max_length=DISPLAY_NAME_MAX_LENGTH)]


def _username(value: str) -> str:
    return normalize_username(value)


#: A username: trimmed, lower-cased and checked against ``shared/usernames.json``. An empty
#: value is left to that check, so it fails the length rule like any other too-short name.
Username = Annotated[str, Text(), AfterValidator(_username)]


class SignupIn(ApiModel):
    """``POST /api/auth/signup``; ``display_name`` starts as the username."""

    email: EmailAddress
    password: NewPasswordStr
    username: Username


class LoginIn(ApiModel):
    """``POST /api/auth/login``; ``remember`` defaults to keeping the user logged in."""

    email: EmailAddress
    password: PasswordStr
    remember: StrictBool = True


class PasswordResetRequestIn(ApiModel):
    """``POST /api/auth/password-reset/request``."""

    email: EmailAddress


class PasswordResetConfirmIn(ApiModel):
    """``POST /api/auth/password-reset/confirm``."""

    token: Annotated[str, Text(min_length=1, max_length=RESET_TOKEN_MAX_LENGTH)]
    password: NewPasswordStr


class PasswordChangeIn(ApiModel):
    """``POST /api/account/password``."""

    current_password: PasswordStr
    new_password: NewPasswordStr


class AccountDeleteIn(ApiModel):
    """``DELETE /api/account``: the password confirms the deletion."""

    password: PasswordStr


class CsrfTokenOut(ResponseModel):
    """``GET /api/auth/csrf``."""

    csrf_token: str


class UserResponse(ResponseModel):
    """``{"user": User}``, returned by signup, login, ``me`` and profile updates."""

    user: UserOut
