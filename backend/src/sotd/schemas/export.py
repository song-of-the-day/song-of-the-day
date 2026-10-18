"""The data export document of ``GET /api/account/export``.

The document has no database ids: entries are identified by their date, and an
annotation by its position within its entry.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Final, Literal

from pydantic import BeforeValidator

from sotd.schemas.common import ResponseModel, UtcDateTime
from sotd.theme import normalize_theme

EXPORT_FORMAT: Final = "sotd-export"
EXPORT_VERSION: Final = 1


class ExportAnnotation(ResponseModel):
    """An annotation, without ids."""

    start_ms: int
    end_ms: int | None
    body: str
    color: str
    created_at: UtcDateTime


class ExportEntry(ResponseModel):
    """An entry's fields except ``id`` and ``annotation_count``, with its annotations."""

    entry_date: date
    title: str
    artist: str
    album: str | None
    artwork_url: str | None
    preview_url: str | None
    external_url: str | None
    youtube_video_id: str | None
    duration_ms: int | None
    source: str
    source_id: str | None
    note: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime
    annotations: list[ExportAnnotation]


class ExportUser(ResponseModel):
    """The account's profile; the theme is fully populated, as in the ``User`` resource."""

    email: str
    username: str
    display_name: str
    bio: str
    theme: Annotated[dict[str, Any], BeforeValidator(normalize_theme)]
    autoplay_previews: bool
    created_at: UtcDateTime


class ExportDocument(ResponseModel):
    """Everything a user owns, as JSON (uploaded images are referenced, not included)."""

    format: Literal["sotd-export"] = EXPORT_FORMAT
    version: Literal[1] = EXPORT_VERSION
    exported_at: UtcDateTime
    user: ExportUser
    entries: list[ExportEntry]
