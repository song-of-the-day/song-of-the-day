from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from typing import Annotated

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from sotd.api.utils import validation_error_from
from sotd.models import User
from sotd.schemas.common import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    ApiModel,
    MultiLineStr,
    NewPasswordStr,
    PasswordStr,
    ResponseModel,
    SingleLineStr,
    Text,
    UtcDateTime,
    format_utc_timestamp,
)
from sotd.schemas.user import UserOut
from tests.factories import UserFactory

INVALID_CHARACTERS = "Contains characters that aren't allowed."


class Strings(ApiModel):
    single: SingleLineStr | None = None
    multi: MultiLineStr | None = None
    password: PasswordStr | None = None
    new_password: NewPasswordStr | None = None
    bounded: Annotated[str, Text(min_length=1, max_length=5)] | None = None
    optional: Annotated[str, Text(max_length=5, blank_to_none=True)] | None = None


def errors_for(**fields: object) -> dict[str, str]:
    with pytest.raises(ValidationError) as excinfo:
        Strings.model_validate(fields)
    result: dict[str, str] = validation_error_from(excinfo.value).fields or {}
    return result


FORBIDDEN = [
    pytest.param("a\x00b", id="NUL"),
    pytest.param("a\ud800b", id="lone-high-surrogate"),
    pytest.param("a\udfffb", id="lone-low-surrogate"),
    pytest.param("a\x01b", id="C0-SOH"),
    pytest.param("a\x1bb", id="C0-ESC"),
    pytest.param("a\x0bb", id="C0-VT"),
    pytest.param("a\x0cb", id="C0-FF"),
    pytest.param("a\x7fb", id="DEL"),
    pytest.param("a\x80b", id="C1-PAD"),
    pytest.param("a\x85b", id="C1-NEL"),
    pytest.param("a\x9fb", id="C1-APC"),
]


# --- Forbidden characters ---------------------------------------------------------------


@pytest.mark.parametrize("value", FORBIDDEN)
@pytest.mark.parametrize("field", ["single", "multi", "password", "new_password", "optional"])
def test_forbidden_characters_are_rejected_everywhere(field: str, value: str) -> None:
    # The character check runs first, so it is the only error even for a short password.
    assert errors_for(**{field: value}) == {field: INVALID_CHARACTERS}


@pytest.mark.parametrize("value", ["\x0bAda", "Ada\x0c", "\x85Ada", " Ada\x1c"])
def test_control_characters_are_checked_before_trimming(value: str) -> None:
    # str.strip() treats these as whitespace; they must not be silently trimmed away.
    assert errors_for(single=value) == {"single": INVALID_CHARACTERS}


def test_tab_is_allowed() -> None:
    assert Strings(single="a\tb", multi="a\tb").model_dump(exclude_none=True) == {
        "single": "a\tb",
        "multi": "a\tb",
    }


def test_valid_surrogate_pairs_and_unicode_are_allowed() -> None:
    value = "Björk \U0001f3b5 ✦ 東京"
    assert Strings(single=value).single == value


# --- Line breaks -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value", ["a\nb", "a\rb", "a\r\nb", "a\N{LINE SEPARATOR}b", "a\N{PARAGRAPH SEPARATOR}b"]
)
def test_line_breaks_are_rejected_in_single_line_fields(value: str) -> None:
    assert errors_for(single=value) == {"single": "Must be a single line."}


@pytest.mark.parametrize("value", ["a\nb", "a\r\nb", "line one\n\nline three"])
def test_line_breaks_are_allowed_in_multi_line_fields(value: str) -> None:
    assert Strings(multi=value).multi == value


def test_surrounding_line_breaks_are_trimmed_in_single_line_fields() -> None:
    assert Strings(single=" \r\nAda\n ").single == "Ada"


# --- Trimming and lengths ------------------------------------------------------------------


def test_text_is_trimmed() -> None:
    model = Strings(single="  Ada  ", multi="\n  note \n", bounded=" abcde ")
    assert (model.single, model.multi, model.bounded) == ("Ada", "note", "abcde")


def test_lengths_are_checked_after_trimming() -> None:
    assert errors_for(bounded="   ") == {"bounded": "Must not be blank."}
    assert errors_for(bounded="abcdef") == {"bounded": "Must be at most 5 characters."}


def test_blank_optional_text_becomes_none() -> None:
    assert Strings(optional="   ").optional is None
    assert Strings(optional=" x ").optional == "x"


def test_null_is_accepted_for_optional_fields() -> None:
    assert Strings(single=None).single is None


def test_non_strings_are_rejected() -> None:
    assert errors_for(single=5, multi=["a"]) == {
        "single": "Must be a string.",
        "multi": "Must be a string.",
    }


def test_unknown_fields_are_rejected() -> None:
    assert errors_for(single="a", nickname="b") == {"nickname": "Unknown field."}


def test_plain_str_fields_are_trimmed_by_the_base_model() -> None:
    class Plain(ApiModel):
        name: str

    assert Plain(name="  x ").name == "x"


# --- Passwords -------------------------------------------------------------------------------


def test_passwords_are_never_trimmed() -> None:
    model = Strings(password="  secret  ", new_password="  pass word  ")
    assert model.password == "  secret  "
    assert model.new_password == "  pass word  "


def test_existing_password_must_not_be_empty() -> None:
    assert errors_for(password="") == {"password": "Must not be blank."}


def test_existing_password_has_a_maximum_length() -> None:
    assert errors_for(password="x" * (PASSWORD_MAX_LENGTH + 1)) == {
        "password": f"Must be at most {PASSWORD_MAX_LENGTH} characters."
    }


@pytest.mark.parametrize("length", [PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH])
def test_new_password_length_bounds_are_inclusive(length: int) -> None:
    assert Strings(new_password="x" * length).new_password == "x" * length


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("x" * (PASSWORD_MIN_LENGTH - 1), f"Must be at least {PASSWORD_MIN_LENGTH} characters."),
        ("x" * (PASSWORD_MAX_LENGTH + 1), f"Must be at most {PASSWORD_MAX_LENGTH} characters."),
        (" " * PASSWORD_MIN_LENGTH, "Must not be only whitespace."),
        ("\t \n \r  \t ", "Must not be only whitespace."),
    ],
)
def test_new_password_policy(value: str, message: str) -> None:
    assert errors_for(new_password=value) == {"new_password": message}


def test_new_password_counts_surrounding_spaces() -> None:
    # Seven visible characters plus a space reach the minimum because nothing is trimmed.
    assert Strings(new_password=" abcdefg").new_password == " abcdefg"


# --- Timestamps ------------------------------------------------------------------------------


def test_format_utc_timestamp_converts_and_truncates() -> None:
    toronto = timezone(timedelta(hours=-4))
    value = datetime(2026, 10, 11, 14, 4, 5, 987654, tzinfo=toronto)
    assert format_utc_timestamp(value) == "2026-10-11T18:04:05Z"


def test_format_utc_timestamp_rejects_naive_datetimes() -> None:
    with pytest.raises(ValueError, match="naive"):
        format_utc_timestamp(datetime(2026, 10, 11, 18, 4, 5))  # noqa: DTZ001


def test_utc_datetime_serializes_only_in_json_mode() -> None:
    class Stamped(ResponseModel):
        at: UtcDateTime

    value = datetime(2026, 10, 11, 18, 4, 5, tzinfo=UTC)
    model = Stamped(at=value)
    assert model.model_dump(mode="json") == {"at": "2026-10-11T18:04:05Z"}
    assert model.model_dump() == {"at": value}
    assert model.model_dump_json() == '{"at":"2026-10-11T18:04:05Z"}'


# --- UserOut ---------------------------------------------------------------------------------


def test_user_out_from_a_model(
    user_factory: UserFactory, db_session: Session, frozen_time: object
) -> None:
    user = user_factory(
        email="ada@example.com",
        username="ada",
        display_name="Ada",
        bio="breakbeats",
        theme={"preset": "bubblegum", "colors": {"text": "#abcdef"}, "junk": 1},
    )
    db_session.refresh(user)
    dumped = UserOut.model_validate(user).model_dump(mode="json")
    assert set(dumped) == {
        "id",
        "email",
        "username",
        "display_name",
        "bio",
        "theme",
        "autoplay_previews",
        "created_at",
    }
    assert dumped["id"] == user.id
    assert dumped["email"] == "ada@example.com"
    assert dumped["username"] == "ada"
    assert dumped["autoplay_previews"] is True
    assert dumped["bio"] == "breakbeats"
    assert dumped["created_at"] == "2026-10-11T12:00:00Z"
    assert dumped["theme"]["preset"] == "bubblegum"
    assert dumped["theme"]["colors"]["text"] == "#ABCDEF"
    assert dumped["theme"]["fonts"] == {"heading": "pacifico", "body": "comic-neue"}
    assert "junk" not in dumped["theme"]
    assert "password_hash" not in dumped


def test_user_out_fills_an_empty_theme(user_factory: UserFactory) -> None:
    user: User = user_factory()
    theme = UserOut.model_validate(user).model_dump(mode="json")["theme"]
    assert theme["preset"] == "chrome"
    assert set(theme) == {"preset", "colors", "fonts", "background", "card_style", "default_view"}
