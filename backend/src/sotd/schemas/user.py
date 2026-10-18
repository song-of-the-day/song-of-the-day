"""User response schemas: the owner's ``User`` and everyone else's ``PublicProfile``."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BeforeValidator

from sotd.schemas.common import ResponseModel, UtcDateTime
from sotd.theme import normalize_theme


class UserOut(ResponseModel):
    """The ``User`` resource; the theme is always fully populated."""

    id: int
    email: str
    username: str
    display_name: str
    bio: str
    theme: Annotated[dict[str, Any], BeforeValidator(normalize_theme)]
    autoplay_previews: bool
    created_at: UtcDateTime


class PublicProfileOut(ResponseModel):
    """The ``PublicProfile`` resource: what anyone with the link sees (never the email)."""

    username: str
    display_name: str
    bio: str
    theme: Annotated[dict[str, Any], BeforeValidator(normalize_theme)]
    created_at: UtcDateTime


class PublicProfileResponse(ResponseModel):
    """``{"profile": PublicProfile}`` (``GET /api/users/<username>``)."""

    profile: PublicProfileOut
