"""Request body of ``PATCH /api/profile``."""

from __future__ import annotations

from typing import Annotated, Final

from pydantic import BeforeValidator, StrictBool, field_validator
from pydantic_core import PydanticCustomError

from sotd.schemas.auth import DisplayName, Username
from sotd.schemas.common import ApiModel, Text
from sotd.theme import ThemeIn

#: Longest bio, in characters after trimming.
BIO_MAX_LENGTH: Final = 280


#: A bio: up to 280 characters after trimming; line breaks are allowed.
Bio = Annotated[str, Text(max_length=BIO_MAX_LENGTH, multiline=True)]


def _null_to_empty(value: object) -> object:
    return "" if value is None else value


class ProfileUpdateIn(ApiModel):
    """Any subset of the profile fields; an omitted field (``None`` here) is unchanged.

    ``username``, ``display_name``, ``theme`` and ``autoplay_previews`` can't be ``null``;
    a ``null`` or blank ``bio`` clears it to ``""``. ``theme`` must be complete (see
    :class:`sotd.theme.ThemeIn`).
    """

    username: Username | None = None
    display_name: DisplayName | None = None
    bio: Annotated[Bio | None, BeforeValidator(_null_to_empty)] = None
    theme: ThemeIn | None = None
    autoplay_previews: StrictBool | None = None

    @field_validator("username", "display_name", "theme", "autoplay_previews", mode="before")
    @classmethod
    def _reject_null(cls, value: object) -> object:
        if value is None:
            raise PydanticCustomError("null_not_allowed", "Cannot be null.")
        return value
