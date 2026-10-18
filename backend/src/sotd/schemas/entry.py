"""Request and response bodies of the entry endpoints.

Song fields are re-validated here even when they come from the iTunes Search API: URLs
must be absolute, use only RFC 3986 characters (so browsers and :func:`urlsplit` agree
on the host) and name a bare host, without credentials or a port. Artwork and preview
URLs must also be ``https`` on an allowed host (:data:`ARTWORK_HOSTS`,
:data:`PREVIEW_HOSTS`).
"""

from __future__ import annotations

import contextlib
import re
from datetime import date, timedelta
from typing import Annotated, Final, Self
from urllib.parse import urlsplit

from pydantic import (
    MISSING,
    AfterValidator,
    BeforeValidator,
    Field,
    Strict,
    ValidationInfo,
    field_validator,
)
from pydantic_core import PydanticCustomError

from sotd import clock
from sotd.models import Entry
from sotd.models.entry import MAX_SONG_MS
from sotd.schemas.annotation import AnnotationOut
from sotd.schemas.common import ApiModel, ResponseModel, Text, UtcDateTime

#: Hosts that may serve album artwork (``https`` only). A hostname ``h`` matches an
#: allowed host ``H`` when ``h == H`` or ``h`` ends with ``"." + H``.
ARTWORK_HOSTS: Final = ("mzstatic.com",)
#: Hosts that may serve 30-second previews (``https`` only), matched like
#: :data:`ARTWORK_HOSTS`.
PREVIEW_HOSTS: Final = ("itunes.apple.com", "mzstatic.com")

#: Longest ``title``, ``artist`` and ``album``.
SONG_TEXT_MAX_LENGTH: Final = 300
#: Longest URL in any URL field.
URL_MAX_LENGTH: Final = 1000
#: Longest ``source_id`` (an iTunes ``trackId``).
SOURCE_ID_MAX_LENGTH: Final = 64
#: Longest ``note``.
NOTE_MAX_LENGTH: Final = 5000
#: Earliest allowed ``entry_date``.
EARLIEST_ENTRY_DATE: Final = date(1900, 1, 1)
#: ``entry_date`` may be this far past today in UTC: the client logs its own local date,
#: which is ahead of UTC in eastern time zones.
ENTRY_DATE_LEEWAY: Final = timedelta(days=1)
#: Allowed ``source`` values: picked from the iTunes Search API, or typed in.
ENTRY_SOURCES: Final = frozenset({"itunes", "manual"})
#: ``source`` of an entry created without one.
DEFAULT_ENTRY_SOURCE: Final = "manual"
#: ``GET /api/entries`` page sizes.
LIST_LIMIT_DEFAULT: Final = 60
LIST_LIMIT_MAX: Final = 366

DATE_FORMAT_MESSAGE: Final = "Must be a date in YYYY-MM-DD format."

_ISO_DATE: Final = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_URL_CHARACTERS: Final = re.compile(r"[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+")
#: Dot-separated labels of letters, digits, ``-`` and ``_`` (an optional root dot): no
#: percent-encoding or sub-delimiters, which browsers would decode or keep.
_HOSTNAME: Final = re.compile(r"[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?")
_YOUTUBE_VIDEO_ID: Final = re.compile(r"[A-Za-z0-9_-]{11}")
_LIST_LIMIT: Final = re.compile(r"[0-9]{1,3}")

_HTTPS: Final = frozenset({"https"})
_HTTP_OR_HTTPS: Final = frozenset({"http", "https"})


# --- Dates --------------------------------------------------------------------------------


def _parse_iso_date(value: object) -> object:
    """Accept only ``YYYY-MM-DD`` strings; lax mode would also take numbers and datetimes.

    ``None`` is passed on, to be accepted or reported as "Cannot be null." by the field.
    """
    if value is None:
        return value
    if isinstance(value, str) and _ISO_DATE.fullmatch(value):
        with contextlib.suppress(ValueError):  # Well-formed but impossible, e.g. Feb 30.
            return date.fromisoformat(value)
    raise PydanticCustomError("date_format", DATE_FORMAT_MESSAGE)


def _check_entry_date(value: date) -> date:
    if value < EARLIEST_ENTRY_DATE:
        raise PydanticCustomError("date_too_early", "Must be on or after 1900-01-01.")
    if value > clock.today_utc() + ENTRY_DATE_LEEWAY:
        raise PydanticCustomError("date_in_future", "Must not be in the future.")
    return value


#: A calendar date given as a ``YYYY-MM-DD`` string.
IsoDate = Annotated[date, BeforeValidator(_parse_iso_date)]
#: An entry's day: ``1900-01-01 <= d <= today_utc + 1 day``.
EntryDate = Annotated[IsoDate, AfterValidator(_check_entry_date)]


# --- URLs ---------------------------------------------------------------------------------


def host_is_allowed(hostname: str, allowed_hosts: tuple[str, ...]) -> bool:
    """Return whether ``hostname`` is one of ``allowed_hosts`` or a subdomain of one.

    Args:
        hostname: A lower-cased hostname.
        allowed_hosts: Lower-cased allowed hosts, e.g. :data:`ARTWORK_HOSTS`.
    """
    return any(hostname == host or hostname.endswith(f".{host}") for host in allowed_hosts)


def _url_hostname(value: str, schemes: frozenset[str]) -> str | None:
    """Return the lower-cased hostname of an absolute URL, or ``None`` if it is invalid.

    The URL must use one of ``schemes``, contain only RFC 3986 characters (no spaces or
    backslashes, which browsers read differently) and have a bare host name as its
    authority (no credentials, port or IP literal).
    """
    if _URL_CHARACTERS.fullmatch(value) is None:
        return None
    try:
        parts = urlsplit(value)
    except ValueError:  # An unbalanced "[" in the authority.
        return None
    hostname = parts.hostname
    if (
        parts.scheme not in schemes
        or not hostname
        or parts.netloc.lower() != hostname
        or _HOSTNAME.fullmatch(hostname) is None
    ):
        return None
    return hostname


def _url_rule(
    *, schemes: frozenset[str], hosts: tuple[str, ...] | None, message: str
) -> AfterValidator:
    """Build the validator of one URL field; every failure is reported with ``message``."""

    def validate(value: str | None) -> str | None:
        if value is None:
            return None
        hostname = _url_hostname(value, schemes)
        if hostname is None or (hosts is not None and not host_is_allowed(hostname, hosts)):
            raise PydanticCustomError("invalid_url", message)
        return value

    return AfterValidator(validate)


_ARTWORK_URL_RULE: Final = _url_rule(
    schemes=_HTTPS, hosts=ARTWORK_HOSTS, message="Must be an https link on mzstatic.com."
)
_PREVIEW_URL_RULE: Final = _url_rule(
    schemes=_HTTPS,
    hosts=PREVIEW_HOSTS,
    message="Must be an https link on itunes.apple.com or mzstatic.com.",
)
_EXTERNAL_URL_RULE: Final = _url_rule(
    schemes=_HTTP_OR_HTTPS, hosts=None, message="Must be an http or https link."
)


# --- Other fields -------------------------------------------------------------------------


def _check_source(value: str) -> str:
    if value not in ENTRY_SOURCES:
        raise PydanticCustomError(
            "invalid_choice",
            "Must be one of: {choices}.",
            {"choices": ", ".join(sorted(ENTRY_SOURCES))},
        )
    return value


def _check_youtube_video_id(value: str | None) -> str | None:
    if value is not None and _YOUTUBE_VIDEO_ID.fullmatch(value) is None:
        raise PydanticCustomError("invalid_youtube_id", "Must be an 11-character YouTube video id.")
    return value


# --- Field types --------------------------------------------------------------------------

#: An optional URL: up to 1000 characters, single line.
_OptionalUrl = Annotated[str, Text(max_length=URL_MAX_LENGTH, blank_to_none=True)]

#: ``title`` and ``artist``: 1-300 characters, single line.
SongText = Annotated[str, Text(min_length=1, max_length=SONG_TEXT_MAX_LENGTH)]
#: ``album``: up to 300 characters, single line.
Album = Annotated[str, Text(max_length=SONG_TEXT_MAX_LENGTH, blank_to_none=True)] | None
#: Album artwork: ``https`` on :data:`ARTWORK_HOSTS`.
ArtworkUrl = Annotated[_OptionalUrl, _ARTWORK_URL_RULE] | None
#: A 30-second preview: ``https`` on :data:`PREVIEW_HOSTS`.
PreviewUrl = Annotated[_OptionalUrl, _PREVIEW_URL_RULE] | None
#: A link to the song elsewhere (Apple Music, Spotify, Bandcamp, ...): ``http(s)``.
ExternalUrl = Annotated[_OptionalUrl, _EXTERNAL_URL_RULE] | None
#: An 11-character YouTube video id.
YoutubeVideoId = (
    Annotated[str, Text(blank_to_none=True), AfterValidator(_check_youtube_video_id)] | None
)
#: Where the song came from: ``"itunes"`` or ``"manual"``.
EntrySource = Annotated[str, AfterValidator(_check_source)]
#: The song's length: 1 ms to 24 hours.
DurationMs = Annotated[int, Strict(), Field(ge=1, le=MAX_SONG_MS)] | None
#: Where the song was picked from (an iTunes ``trackId``), up to 64 characters.
SourceId = Annotated[str, Text(max_length=SOURCE_ID_MAX_LENGTH, blank_to_none=True)] | None
#: The day's note: up to 5000 characters, line breaks allowed.
Note = Annotated[str, Text(max_length=NOTE_MAX_LENGTH, multiline=True, blank_to_none=True)] | None


# --- Requests -----------------------------------------------------------------------------


class EntryCreateIn(ApiModel):
    """``POST /api/entries``."""

    entry_date: EntryDate
    title: SongText
    artist: SongText
    album: Album = None
    artwork_url: ArtworkUrl = None
    preview_url: PreviewUrl = None
    external_url: ExternalUrl = None
    youtube_video_id: YoutubeVideoId = None
    duration_ms: DurationMs = None
    source: EntrySource = DEFAULT_ENTRY_SOURCE
    source_id: SourceId = None
    note: Note = None


class EntryPatchIn(ApiModel):
    """``PATCH /api/entries/<id>``.

    Omitted fields stay ``MISSING`` and are left out of ``model_dump()``. ``null`` clears
    an optional field; for ``entry_date``, ``title``, ``artist`` and ``source`` it is
    rejected with "Cannot be null.".
    """

    entry_date: EntryDate | MISSING = MISSING
    title: SongText | MISSING = MISSING
    artist: SongText | MISSING = MISSING
    album: Album | MISSING = MISSING
    artwork_url: ArtworkUrl | MISSING = MISSING
    preview_url: PreviewUrl | MISSING = MISSING
    external_url: ExternalUrl | MISSING = MISSING
    youtube_video_id: YoutubeVideoId | MISSING = MISSING
    duration_ms: DurationMs | MISSING = MISSING
    source: EntrySource | MISSING = MISSING
    source_id: SourceId | MISSING = MISSING
    note: Note | MISSING = MISSING


def _parse_list_limit(value: object) -> int:
    if isinstance(value, str) and _LIST_LIMIT.fullmatch(value):
        limit = int(value)
        if 1 <= limit <= LIST_LIMIT_MAX:
            return limit
    raise PydanticCustomError(
        "invalid_limit", "Must be an integer from 1 to {maximum}.", {"maximum": LIST_LIMIT_MAX}
    )


class EntryListQuery(ApiModel):
    """Query string of ``GET /api/entries``; values arrive as strings.

    ``start`` is the inclusive lower bound. The upper bound is the earlier of ``end``
    (inclusive) and ``before`` (exclusive, the pagination cursor).
    """

    start: IsoDate | None = None
    end: IsoDate | None = None
    before: IsoDate | None = None
    limit: Annotated[int, BeforeValidator(_parse_list_limit)] = LIST_LIMIT_DEFAULT

    @field_validator("end")
    @classmethod
    def _end_not_before_start(cls, value: date | None, info: ValidationInfo) -> date | None:
        start = info.data.get("start")
        if value is not None and start is not None and value < start:
            raise PydanticCustomError("end_before_start", "Must not be before start.")
        return value


# --- Responses ----------------------------------------------------------------------------


class EntryOut(ResponseModel):
    """The ``Entry`` resource."""

    id: int
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
    annotation_count: int
    created_at: UtcDateTime
    updated_at: UtcDateTime

    @classmethod
    def from_entry(cls, entry: Entry, *, annotation_count: int) -> Self:
        """Serialize an entry; ``annotation_count`` isn't a column, so it is passed in.

        Every other field is read from the attribute of the same name (for
        :class:`EntryDetailOut`, that includes the loaded ``annotations``).
        """
        values = {
            name: getattr(entry, name) for name in cls.model_fields if name != "annotation_count"
        }
        return cls.model_validate({**values, "annotation_count": annotation_count})


class EntryDetailOut(EntryOut):
    """``EntryDetail``: an entry with its annotations, sorted by ``start_ms`` then ``id``."""

    annotations: list[AnnotationOut]


class EntryResponse(ResponseModel):
    """``{"entry": EntryDetail}``, returned by every single-entry endpoint."""

    entry: EntryDetailOut


class EntryListResponse(ResponseModel):
    """``GET /api/entries``: a page of entries, newest first, and the next cursor."""

    entries: list[EntryOut]
    next_before: date | None
