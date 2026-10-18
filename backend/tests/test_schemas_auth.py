"""Auth request schemas (``sotd.schemas.auth``)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from pydantic_core import PydanticCustomError

from sotd.schemas.auth import (
    AccountDeleteIn,
    LoginIn,
    PasswordChangeIn,
    PasswordResetConfirmIn,
    SignupIn,
    normalize_email,
)


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        ("Ada@Example.COM", "ada@example.com"),
        ("ada.lovelace+music@sotd.ca", "ada.lovelace+music@sotd.ca"),
        ("Zoë@Exämple.com", "zoë@exämple.com"),
    ],
)
def test_normalize_email(raw: str, normalized: str) -> None:
    assert normalize_email(raw) == normalized


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "ada",
        "ada@",
        "@example.com",
        "ada@localhost",
        "ada@example.invalid",
        "Ada <ada@example.com>",
        '"ada lovelace"@example.com',
        "ada@[192.0.2.1]",
    ],
)
def test_normalize_email_rejects_invalid_addresses(raw: str) -> None:
    with pytest.raises(PydanticCustomError, match="Enter a valid email address"):
        normalize_email(raw)


def test_login_remember_defaults_to_true_and_is_strict() -> None:
    assert LoginIn.model_validate({"email": "a@sotd.ca", "password": "pw"}).remember is True
    assert (
        LoginIn.model_validate({"email": "a@sotd.ca", "password": "pw", "remember": False}).remember
        is False
    )
    with pytest.raises(ValidationError):
        LoginIn.model_validate({"email": "a@sotd.ca", "password": "pw", "remember": "false"})


def test_signup_trims_everything_but_the_password() -> None:
    body = SignupIn.model_validate(
        {
            "email": " A@SOTD.CA ",
            "password": "  secret pass  ",
            "username": " Ada ",
        }
    )
    assert (body.email, body.password, body.username) == ("a@sotd.ca", "  secret pass  ", "ada")


def test_signup_has_no_display_name_field() -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        SignupIn.model_validate(
            {"email": "a@sotd.ca", "password": "secretpass", "username": "ada", "display_name": "A"}
        )


def test_passwords_are_kept_verbatim_in_every_schema() -> None:
    padded = "\tpadded password "
    assert PasswordChangeIn.model_validate(
        {"current_password": padded, "new_password": padded}
    ).model_dump() == {"current_password": padded, "new_password": padded}
    assert AccountDeleteIn.model_validate({"password": padded}).password == padded
    confirm = PasswordResetConfirmIn.model_validate({"token": " t ", "password": padded})
    assert (confirm.token, confirm.password) == ("t", padded)


def test_password_line_breaks_are_allowed() -> None:
    assert AccountDeleteIn.model_validate({"password": "multi\nline"}).password == "multi\nline"
