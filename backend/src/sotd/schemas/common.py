"""Shared Pydantic building blocks for request and response schemas.

String rules:

* Surrounding whitespace is trimmed, except in passwords.
* A string containing U+0000, an unpaired surrogate or any C0/C1 control character
  other than TAB, LF and CR is rejected. DEL (U+007F), the remaining control character,
  is rejected as well. The check runs on the raw input, before trimming, so a control
  character can't be smuggled in as "whitespace".
* Single-line fields also reject line breaks (LF, CR, U+2028, U+2029) that remain after
  trimming.

Every free-text request field must use :class:`Text` (or one of the aliases below) so
these rules apply; Pydantic's plain ``str`` only gets the trimming.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Final

from annotated_types import GroupedMetadata
from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    PlainSerializer,
    StringConstraints,
)
from pydantic_core import PydanticCustomError

_FORBIDDEN_CHARACTERS: Final = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\ud800-\udfff]")
_LINE_BREAKS: Final = re.compile(r"[\n\r\u2028\u2029]")

#: Password length policy (characters).
PASSWORD_MIN_LENGTH: Final = 8
PASSWORD_MAX_LENGTH: Final = 128


def _reject_forbidden_characters(value: object) -> object:
    if isinstance(value, str) and _FORBIDDEN_CHARACTERS.search(value):
        raise PydanticCustomError("invalid_characters", "Contains characters that aren't allowed.")
    return value


def _reject_line_breaks(value: str) -> str:
    if _LINE_BREAKS.search(value):
        raise PydanticCustomError("line_break", "Must be a single line.")
    return value


def _none_if_blank(value: str) -> str | None:
    return value or None


def _reject_blank_password(value: str) -> str:
    if not value.strip():
        raise PydanticCustomError("blank_password", "Must not be only whitespace.")
    return value


@dataclass(frozen=True, slots=True)
class Text(GroupedMetadata):
    """Validation pipeline for a user-supplied string, used as ``Annotated`` metadata.

    Example::

        title: Annotated[str, Text(min_length=1, max_length=300)]
        album: Annotated[str, Text(max_length=300, blank_to_none=True)] | None = None

    Attributes:
        min_length: Minimum length after trimming.
        max_length: Maximum length after trimming.
        multiline: Allow line breaks (``note``, ``bio``, annotation ``body``).
        strip: Trim surrounding whitespace. Overrides the model's ``str_strip_whitespace``.
        blank_to_none: Turn a string that is empty after trimming into ``None``. Combine
            with ``| None`` and leave ``min_length`` unset.
    """

    min_length: int | None = None
    max_length: int | None = None
    multiline: bool = False
    strip: bool = True
    blank_to_none: bool = False

    def __iter__(self) -> Iterator[object]:
        # The constraints must come first: Pydantic then keeps them (including an explicit
        # strip_whitespace=False) in the core string schema, and the BeforeValidator wraps
        # that schema so it sees the raw input.
        yield StringConstraints(
            strip_whitespace=self.strip, min_length=self.min_length, max_length=self.max_length
        )
        yield BeforeValidator(_reject_forbidden_characters)
        if not self.multiline:
            yield AfterValidator(_reject_line_breaks)
        if self.blank_to_none:
            yield AfterValidator(_none_if_blank)


#: Trimmed, single-line text (``email``, ``display_name``, ``title``, URLs, ...).
SingleLineStr = Annotated[str, Text()]
#: Trimmed text that may span lines (``note``, ``bio``, annotation ``body``).
MultiLineStr = Annotated[str, Text(multiline=True)]
#: An existing password as typed (login, confirmations): never trimmed.
PasswordStr = Annotated[
    str, Text(min_length=1, max_length=PASSWORD_MAX_LENGTH, multiline=True, strip=False)
]
#: A new password: 8-128 characters, not all whitespace, never trimmed.
NewPasswordStr = Annotated[
    str,
    Text(
        min_length=PASSWORD_MIN_LENGTH,
        max_length=PASSWORD_MAX_LENGTH,
        multiline=True,
        strip=False,
    ),
    AfterValidator(_reject_blank_password),
]


def format_utc_timestamp(value: datetime) -> str:
    """Format an aware datetime as ``YYYY-MM-DDTHH:MM:SSZ`` in UTC.

    Raises:
        ValueError: If ``value`` is naive (timestamps are always stored as timestamptz).
    """
    if value.utcoffset() is None:
        raise ValueError("Cannot serialize a naive datetime as a UTC timestamp.")
    return value.astimezone(UTC).replace(microsecond=0, tzinfo=None).isoformat() + "Z"


#: A datetime that serializes to JSON as ``2026-10-11T18:04:05Z``.
UtcDateTime = Annotated[datetime, PlainSerializer(format_utc_timestamp, when_used="json")]


class ApiModel(BaseModel):
    """Base for request bodies: unknown fields are rejected and strings are trimmed."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ResponseModel(BaseModel):
    """Base for response bodies; instances can be built straight from ORM objects."""

    model_config = ConfigDict(from_attributes=True)
