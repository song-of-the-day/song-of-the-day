"""Request and response bodies of the song endpoints.

``GET /api/songs/youtube-match`` reads its input from the query string, where every
value arrives as text, so the strict body rules are re-applied here: ``duration_ms``
must be a plain integer (not ``"5.0"`` or ``"5 s"``) and ``country`` an upper-case
ISO 3166-1 alpha-2 code.
"""

from __future__ import annotations

import re
from typing import Annotated, Final, Literal

from pydantic import AfterValidator, BeforeValidator, Field, Strict
from pydantic_core import PydanticCustomError

from sotd.models.entry import MAX_SONG_MS
from sotd.schemas.common import ApiModel, ResponseModel, Text
from sotd.schemas.entry import Album, SongText, SourceId

_DURATION_MS: Final = re.compile(r"[0-9]{1,10}")
_COUNTRY: Final = re.compile(r"[A-Z]{2}")


def _parse_duration_ms(value: object) -> object:
    """Convert a digit-only duration string to an ``int``; anything else is invalid."""
    if isinstance(value, str) and _DURATION_MS.fullmatch(value):
        return int(value)
    raise PydanticCustomError("invalid_duration", "Must be an integer number of milliseconds.")


def _check_country(value: str) -> str:
    if _COUNTRY.fullmatch(value) is None:
        raise PydanticCustomError("invalid_country", "Must be a two-letter country code.")
    return value


#: ``duration_ms`` from a query string: ASCII digits, then the strict 1 ms-24 h range.
QueryDurationMs = (
    Annotated[
        int,
        BeforeValidator(_parse_duration_ms),
        Strict(),
        Field(ge=1, le=MAX_SONG_MS),
    ]
    | None
)
#: ``country``: an upper-case ISO 3166-1 alpha-2 code such as ``US``.
CountryCode = (
    Annotated[str, Text(min_length=2, max_length=2), AfterValidator(_check_country)] | None
)

#: Why the endpoint answered with ``match: null``.
MatchReason = Literal["matched", "no_match", "disabled", "quota_exhausted", "upstream_error"]
#: Confidence of an accepted match.
MatchConfidence = Literal["high", "medium"]


class YouTubeMatchQuery(ApiModel):
    """Query string of ``GET /api/songs/youtube-match``."""

    title: SongText
    artist: SongText
    album: Album = None
    duration_ms: QueryDurationMs = None
    source_id: SourceId = None
    country: CountryCode = None


class YouTubeMatchOut(ResponseModel):
    """The ``YouTubeMatch`` resource: a suggested video and how sure the server is."""

    video_id: str
    title: str
    channel_title: str
    duration_ms: int | None
    score: float
    confidence: MatchConfidence


class YouTubeMatchResponse(ResponseModel):
    """``GET /api/songs/youtube-match``: a suggestion, or ``null`` with a reason."""

    match: YouTubeMatchOut | None
    reason: MatchReason
