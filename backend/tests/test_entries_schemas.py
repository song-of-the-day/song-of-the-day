"""Validation of the entry request bodies and the entry list query."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

import pytest
import time_machine
from pydantic import BaseModel, ValidationError

from sotd.api.utils import validation_error_from
from sotd.schemas.entry import (
    ARTWORK_HOSTS,
    PREVIEW_HOSTS,
    EntryCreateIn,
    EntryListQuery,
    EntryPatchIn,
    host_is_allowed,
)

pytestmark = pytest.mark.usefixtures("frozen_time")  # Today (UTC) is 2026-10-11.

REQUIRED: dict[str, Any] = {"entry_date": "2026-10-11", "title": "Gosh", "artist": "Jamie xx"}
INVALID_CHARACTERS = "Contains characters that aren't allowed."
SINGLE_LINE = "Must be a single line."
CANNOT_BE_NULL = "Cannot be null."
DATE_FORMAT = "Must be a date in YYYY-MM-DD format."
NOT_AN_INTEGER = "Must be an integer."
ARTWORK_MESSAGE = "Must be an https link on mzstatic.com."
PREVIEW_MESSAGE = "Must be an https link on itunes.apple.com or mzstatic.com."
EXTERNAL_MESSAGE = "Must be an http or https link."
YOUTUBE_MESSAGE = "Must be an 11-character YouTube video id."
LIMIT_MESSAGE = "Must be an integer from 1 to 366."

OPTIONAL_FIELDS = [
    "album",
    "artwork_url",
    "preview_url",
    "external_url",
    "youtube_video_id",
    "duration_ms",
    "source_id",
    "note",
]
OPTIONAL_STRING_FIELDS = [field for field in OPTIONAL_FIELDS if field != "duration_ms"]
SINGLE_LINE_FIELDS = [
    "title",
    "artist",
    "album",
    "artwork_url",
    "preview_url",
    "external_url",
    "youtube_video_id",
    "source_id",
]
STRING_FIELDS = [*SINGLE_LINE_FIELDS, "note"]
ARTWORK = "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b9/dc/ce/600x600bb.jpg"
PREVIEW = "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/mzaf_1.plus.aac.p.m4a"


def errors(model: type[BaseModel], data: dict[str, Any]) -> dict[str, str]:
    with pytest.raises(ValidationError) as excinfo:
        model.model_validate(data)
    return validation_error_from(excinfo.value).fields or {}


def create(**fields: Any) -> EntryCreateIn:
    return EntryCreateIn.model_validate({**REQUIRED, **fields})


def create_errors(**fields: Any) -> dict[str, str]:
    return errors(EntryCreateIn, {**REQUIRED, **fields})


# --- Create: shape and defaults ---------------------------------------------------------


def test_a_minimal_entry_gets_the_defaults() -> None:
    assert create().model_dump() == {
        "entry_date": date(2026, 10, 11),
        "title": "Gosh",
        "artist": "Jamie xx",
        "album": None,
        "artwork_url": None,
        "preview_url": None,
        "external_url": None,
        "youtube_video_id": None,
        "duration_ms": None,
        "source": "manual",
        "source_id": None,
        "note": None,
    }


def test_a_full_entry_is_trimmed() -> None:
    entry = create(
        title="  Gosh ",
        artist=" Jamie xx\t",
        album=" In Colour ",
        artwork_url=f" {ARTWORK} ",
        preview_url=f"{PREVIEW}\n",
        external_url=" https://music.apple.com/us/album/gosh/1525506447?i=1525506452 ",
        youtube_video_id=" dQw4w9WgXcQ ",
        duration_ms=290_973,
        source="itunes",
        source_id=" 1525506452 ",
        note="  the build at 2:30\nlives in my head  ",
    )
    assert entry.model_dump() == {
        "entry_date": date(2026, 10, 11),
        "title": "Gosh",
        "artist": "Jamie xx",
        "album": "In Colour",
        "artwork_url": ARTWORK,
        "preview_url": PREVIEW,
        "external_url": "https://music.apple.com/us/album/gosh/1525506447?i=1525506452",
        "youtube_video_id": "dQw4w9WgXcQ",
        "duration_ms": 290_973,
        "source": "itunes",
        "source_id": "1525506452",
        "note": "the build at 2:30\nlives in my head",
    }


@pytest.mark.parametrize("field", OPTIONAL_STRING_FIELDS)
@pytest.mark.parametrize("value", ["", "   ", "\t\n"])
def test_blank_optional_strings_are_stored_as_null(field: str, value: str) -> None:
    assert getattr(create(**{field: value}), field) is None


@pytest.mark.parametrize("field", OPTIONAL_FIELDS)
def test_optional_fields_accept_null(field: str) -> None:
    assert getattr(create(**{field: None}), field) is None


def test_required_fields() -> None:
    assert errors(EntryCreateIn, {}) == {
        "entry_date": "This field is required.",
        "title": "This field is required.",
        "artist": "This field is required.",
    }


@pytest.mark.parametrize("field", ["entry_date", "title", "artist", "source"])
def test_required_fields_cannot_be_null(field: str) -> None:
    assert create_errors(**{field: None}) == {field: CANNOT_BE_NULL}


@pytest.mark.parametrize(
    "field", ["id", "user_id", "annotation_count", "annotations", "created_at", "updated_at"]
)
def test_unknown_and_server_owned_fields_are_rejected(field: str) -> None:
    assert create_errors(**{field: 1}) == {field: "Unknown field."}


# --- Strings ----------------------------------------------------------------------------


@pytest.mark.parametrize("field", ["title", "artist"])
@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("", "Must not be blank."),
        ("   ", "Must not be blank."),
        ("x" * 301, "Must be at most 300 characters."),
        (5, "Must be a string."),
    ],
)
def test_title_and_artist_rules(field: str, value: object, message: str) -> None:
    assert create_errors(**{field: value}) == {field: message}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("title", "x" * 300),
        ("artist", "x" * 300),
        ("album", "x" * 300),
        ("source_id", "9" * 64),
        ("note", "x" * 5000),
        ("external_url", "https://example.com/" + "a" * 980),
    ],
)
def test_length_limits_accept_the_maximum(field: str, value: str) -> None:
    assert getattr(create(**{field: value}), field) == value


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("album", "x" * 301, "Must be at most 300 characters."),
        ("source_id", "9" * 65, "Must be at most 64 characters."),
        ("note", "x" * 5001, "Must be at most 5000 characters."),
        ("artwork_url", ARTWORK + "a" * 1000, "Must be at most 1000 characters."),
        ("preview_url", PREVIEW + "a" * 1000, "Must be at most 1000 characters."),
        ("external_url", "https://example.com/" + "a" * 981, "Must be at most 1000 characters."),
    ],
)
def test_length_limits_reject_longer_values(field: str, value: str, message: str) -> None:
    assert create_errors(**{field: value}) == {field: message}


@pytest.mark.parametrize("field", SINGLE_LINE_FIELDS)
@pytest.mark.parametrize("line_break", ["\n", "\r", "\u2028", "\u2029"])
def test_single_line_fields_reject_line_breaks(field: str, line_break: str) -> None:
    assert create_errors(**{field: f"dQw4w9{line_break}WgXc"}) == {field: SINGLE_LINE}


def test_the_note_may_span_lines() -> None:
    assert create(note="one\ntwo\r\nthree\u2028four").note == "one\ntwo\r\nthree\u2028four"


@pytest.mark.parametrize("field", STRING_FIELDS)
@pytest.mark.parametrize(
    "character",
    [
        pytest.param("\x00", id="NUL"),
        pytest.param("\x01", id="C0"),
        pytest.param("\x7f", id="DEL"),
        pytest.param("\x85", id="C1"),
        pytest.param("\ud800", id="lone-surrogate"),
    ],
)
def test_control_characters_are_rejected(field: str, character: str) -> None:
    assert create_errors(**{field: f"Gosh{character}"}) == {field: INVALID_CHARACTERS}


# --- Entry date -------------------------------------------------------------------------


@pytest.mark.parametrize("value", ["1900-01-01", "2000-02-29", "2026-10-11", "2026-10-12"])
def test_entry_dates_in_range_are_accepted(value: str) -> None:
    assert create(entry_date=value).entry_date == date.fromisoformat(value)


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("2026-10-13", "Must not be in the future."),  # today_utc + 2 days
        ("2999-01-01", "Must not be in the future."),
        ("1899-12-31", "Must be on or after 1900-01-01."),
        ("0001-01-01", "Must be on or after 1900-01-01."),
    ],
)
def test_entry_dates_out_of_range_are_rejected(value: str, message: str) -> None:
    assert create_errors(entry_date=value) == {"entry_date": message}


def test_the_upper_bound_follows_the_utc_date(frozen_time: time_machine.Traveller) -> None:
    frozen_time.move_to(datetime.fromisoformat("2026-10-11T23:59:59+00:00"))
    assert create_errors(entry_date="2026-10-13") == {"entry_date": "Must not be in the future."}
    frozen_time.move_to(datetime.fromisoformat("2026-10-12T00:00:00+00:00"))
    assert create(entry_date="2026-10-13").entry_date == date(2026, 10, 13)


@pytest.mark.parametrize(
    "value",
    [
        "2026-10-11T00:00:00",
        "2026-10-11 ",
        "20261011",
        "2026-W41-7",
        "2026-284",
        "2026-02-30",
        "2026-13-01",
        "2026-1-01",
        "0000-01-01",
        "today",
        "",
        20261011,
        1_760_140_800,
        1.5,
        True,
        ["2026-10-11"],
    ],
)
def test_entry_dates_must_be_yyyy_mm_dd_strings(value: object) -> None:
    assert create_errors(entry_date=value) == {"entry_date": DATE_FORMAT}


# --- URLs -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        ARTWORK,
        "https://mzstatic.com/a.jpg",
        "https://a.b.mzstatic.com/a.jpg",
        "HTTPS://IS1-SSL.MZSTATIC.COM/a.jpg",
        "https://is1-ssl.mzstatic.com/a%20b.jpg?w=600#top",
    ],
)
def test_artwork_urls_on_mzstatic_are_accepted(url: str) -> None:
    assert create(artwork_url=url).artwork_url == url


REJECTED_ARTWORK_URLS = [
    pytest.param("http://is1-ssl.mzstatic.com/a.jpg", id="http"),
    pytest.param("https://notmzstatic.com/a.jpg", id="suffix-without-dot"),
    pytest.param("https://evilmzstatic.com/a.jpg", id="prefix"),
    pytest.param("https://mzstatic.com.evil.net/a.jpg", id="allowed-host-as-subdomain"),
    pytest.param("https://evil.com/mzstatic.com/a.jpg", id="host-in-path"),
    pytest.param("https://evil.com?.mzstatic.com", id="host-in-query"),
    pytest.param("https://mzstatic.com@evil.com/a.jpg", id="host-as-userinfo"),
    pytest.param("https://user:pw@is1.mzstatic.com/a.jpg", id="credentials"),
    pytest.param("https://evil.com\\@is1.mzstatic.com/a.jpg", id="backslash"),
    pytest.param("https://is1.mzstatic.com:8443/a.jpg", id="port"),
    pytest.param("https://is1.mzstatic.com:99999/a.jpg", id="bad-port"),
    pytest.param("https://is1.mzstatic.com./a.jpg", id="trailing-dot"),
    pytest.param("https://[is1.mzstatic.com/a.jpg", id="unbalanced-bracket"),
    pytest.param("https://evil.com%2f.mzstatic.com/a.jpg", id="percent-encoded-host"),
    pytest.param("https://evil.com&.mzstatic.com/a.jpg", id="sub-delimiter-in-host"),
    pytest.param("https://a..mzstatic.com/a.jpg", id="empty-label"),
    pytest.param("https://is1.mzstatic.com/a b.jpg", id="space"),
    pytest.param("https://is1.mzstatic.com/é.jpg", id="non-ascii"),
    pytest.param("//is1.mzstatic.com/a.jpg", id="scheme-relative"),
    pytest.param("is1.mzstatic.com/a.jpg", id="no-scheme"),
    pytest.param("https:///is1.mzstatic.com/a.jpg", id="empty-host"),
    pytest.param("https:is1.mzstatic.com/a.jpg", id="no-authority"),
    pytest.param("ftp://is1.mzstatic.com/a.jpg", id="ftp"),
    pytest.param("javascript:alert(1)//mzstatic.com", id="javascript"),
    pytest.param("data:image/png;base64,AAAA", id="data"),
    pytest.param("https://itunes.apple.com/a.jpg", id="preview-host"),
]


@pytest.mark.parametrize("url", REJECTED_ARTWORK_URLS)
def test_artwork_urls_elsewhere_are_rejected(url: str) -> None:
    assert create_errors(artwork_url=url) == {"artwork_url": ARTWORK_MESSAGE}


@pytest.mark.parametrize(
    "url",
    [
        PREVIEW,
        "https://itunes.apple.com/a.m4a",
        "https://audio-ssl.itunes.apple.com/a.m4a",
        "https://mzstatic.com/a.m4a",
        "https://audio.mzstatic.com/a.m4a",
    ],
)
def test_preview_urls_on_allowed_hosts_are_accepted(url: str) -> None:
    assert create(preview_url=url).preview_url == url


@pytest.mark.parametrize(
    "url",
    [
        pytest.param("http://audio-ssl.itunes.apple.com/a.m4a", id="http"),
        pytest.param("https://apple.com/a.m4a", id="parent-domain"),
        pytest.param("https://evilapple.com/a.m4a", id="lookalike"),
        pytest.param("https://evilitunes.apple.com/a.m4a", id="suffix-without-dot"),
        pytest.param("https://music.apple.com/a.m4a", id="sibling"),
        pytest.param("https://apple.com.evil.net/a.m4a", id="apple-as-subdomain"),
        pytest.param("https://itunes.apple.com.evil.net/a.m4a", id="itunes-as-subdomain"),
        pytest.param("https://notmzstatic.com/a.m4a", id="mzstatic-lookalike"),
        pytest.param("https://itunes.apple.com@evil.net/a.m4a", id="userinfo"),
        pytest.param("https://evil.net\\@itunes.apple.com/a.m4a", id="backslash"),
    ],
)
def test_preview_urls_elsewhere_are_rejected(url: str) -> None:
    assert create_errors(preview_url=url) == {"preview_url": PREVIEW_MESSAGE}


@pytest.mark.parametrize(
    "url",
    [
        "https://music.apple.com/us/album/gosh/1525506447?i=1525506452",
        "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc",
        "https://jamiexx.bandcamp.com/track/gosh",
        "http://example.com",
        "HTTP://EXAMPLE.COM/Gosh",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s",
        "https://xn--bcher-kva.example/",
    ],
)
def test_external_urls_with_http_or_https_are_accepted(url: str) -> None:
    assert create(external_url=url).external_url == url


@pytest.mark.parametrize(
    "url",
    [
        pytest.param("javascript:alert(document.cookie)", id="javascript"),
        pytest.param("data:text/html,hello", id="data"),
        pytest.param("mailto:ada@example.com", id="mailto"),
        pytest.param("ftp://example.com/gosh.mp3", id="ftp"),
        pytest.param("https://", id="no-host"),
        pytest.param("http:///gosh", id="empty-host"),
        pytest.param("/profile", id="relative"),
        pytest.param("example.com/gosh", id="no-scheme"),
        pytest.param("https://ada@example.com/", id="userinfo"),
        pytest.param("https://example.com:8080/", id="port"),
        pytest.param("https://example.com/a b", id="space"),
        pytest.param("https://example.com\\@evil.com/", id="backslash"),
        pytest.param("https://exa%6dple.com/", id="percent-encoded-host"),
        pytest.param("https://[::1]/", id="ip-literal"),
        pytest.param("https://a!b.com/", id="sub-delimiter-in-host"),
    ],
)
def test_other_external_urls_are_rejected(url: str) -> None:
    assert create_errors(external_url=url) == {"external_url": EXTERNAL_MESSAGE}


@pytest.mark.parametrize(
    ("hostname", "allowed"),
    [
        ("mzstatic.com", True),
        ("is1-ssl.mzstatic.com", True),
        ("notmzstatic.com", False),
        ("mzstatic.com.evil.net", False),
        ("com", False),
    ],
)
def test_host_matching_is_dot_anchored(hostname: str, allowed: bool) -> None:
    assert host_is_allowed(hostname, ARTWORK_HOSTS) is allowed


def test_preview_hosts_include_both_apple_cdns() -> None:
    assert host_is_allowed("audio-ssl.itunes.apple.com", PREVIEW_HOSTS)
    assert host_is_allowed("audio.mzstatic.com", PREVIEW_HOSTS)
    assert not host_is_allowed("evilapple.com", PREVIEW_HOSTS)


# --- Other fields -----------------------------------------------------------------------


@pytest.mark.parametrize("value", ["dQw4w9WgXcQ", "a_b-c_d-e_f", "___________"])
def test_youtube_video_ids_are_accepted(value: str) -> None:
    assert create(youtube_video_id=value).youtube_video_id == value


@pytest.mark.parametrize(
    "value",
    ["dQw4w9WgXc", "dQw4w9WgXcQQ", "dQw4w9WgXc!", "dQw4w9 WgXc", "https://youtu.be/dQw4w9WgXcQ"],
)
def test_malformed_youtube_video_ids_are_rejected(value: str) -> None:
    assert create_errors(youtube_video_id=value) == {"youtube_video_id": YOUTUBE_MESSAGE}


@pytest.mark.parametrize("value", [1, 290_973, 86_400_000])
def test_durations_in_range_are_accepted(value: int) -> None:
    assert create(duration_ms=value).duration_ms == value


@pytest.mark.parametrize(
    ("value", "message"),
    [
        (0, "Must be at least 1."),
        (-1, "Must be at least 1."),
        (86_400_001, "Must be at most 86400000."),
        ("290973", NOT_AN_INTEGER),
        (290_973.0, NOT_AN_INTEGER),
        (1.5, NOT_AN_INTEGER),
        (True, NOT_AN_INTEGER),
    ],
)
def test_durations_must_be_integers_in_range(value: object, message: str) -> None:
    assert create_errors(duration_ms=value) == {"duration_ms": message}


@pytest.mark.parametrize("value", ["itunes", "manual"])
def test_sources_are_accepted(value: str) -> None:
    assert create(source=value).source == value


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("spotify", "Must be one of: itunes, manual."),
        ("ITUNES", "Must be one of: itunes, manual."),
        ("", "Must be one of: itunes, manual."),
        (1, "Must be a string."),
    ],
)
def test_unknown_sources_are_rejected(value: object, message: str) -> None:
    assert create_errors(source=value) == {"source": message}


# --- Patch ------------------------------------------------------------------------------


def test_an_empty_patch_changes_nothing() -> None:
    assert EntryPatchIn.model_validate({}).model_dump() == {}


def test_a_patch_holds_only_the_fields_sent() -> None:
    patch = EntryPatchIn.model_validate({"title": " Loud Places ", "note": "  "})
    assert patch.model_dump() == {"title": "Loud Places", "note": None}


@pytest.mark.parametrize("field", OPTIONAL_FIELDS)
def test_a_patch_clears_optional_fields_with_null(field: str) -> None:
    assert EntryPatchIn.model_validate({field: None}).model_dump() == {field: None}


@pytest.mark.parametrize("field", ["entry_date", "title", "artist", "source"])
def test_a_patch_cannot_null_required_fields(field: str) -> None:
    assert errors(EntryPatchIn, {field: None}) == {field: CANNOT_BE_NULL}


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        ({"entry_date": "2026-10-13"}, {"entry_date": "Must not be in the future."}),
        ({"entry_date": "1899-12-31"}, {"entry_date": "Must be on or after 1900-01-01."}),
        ({"entry_date": "10/11/2026"}, {"entry_date": DATE_FORMAT}),
        ({"title": "  "}, {"title": "Must not be blank."}),
        ({"artist": "a\nb"}, {"artist": SINGLE_LINE}),
        ({"artwork_url": "http://is1.mzstatic.com/a.jpg"}, {"artwork_url": ARTWORK_MESSAGE}),
        ({"preview_url": "https://evilapple.com/a.m4a"}, {"preview_url": PREVIEW_MESSAGE}),
        ({"external_url": "javascript:alert(1)"}, {"external_url": EXTERNAL_MESSAGE}),
        ({"youtube_video_id": "short"}, {"youtube_video_id": YOUTUBE_MESSAGE}),
        ({"duration_ms": 0}, {"duration_ms": "Must be at least 1."}),
        ({"source": "spotify"}, {"source": "Must be one of: itunes, manual."}),
        ({"note": "a\x00b"}, {"note": INVALID_CHARACTERS}),
        ({"user_id": 2}, {"user_id": "Unknown field."}),
    ],
)
def test_a_patch_applies_the_create_rules(data: dict[str, Any], expected: dict[str, str]) -> None:
    assert errors(EntryPatchIn, data) == expected


# --- List query -------------------------------------------------------------------------


def test_the_list_query_defaults() -> None:
    query = EntryListQuery.model_validate({})
    assert (query.start, query.end, query.before, query.limit) == (None, None, None, 60)


def test_the_list_query_parses_strings() -> None:
    query = EntryListQuery.model_validate(
        {"start": "2026-10-01", "end": "2026-10-31", "before": "2026-10-15", "limit": "31"}
    )
    assert (query.start, query.end, query.before, query.limit) == (
        date(2026, 10, 1),
        date(2026, 10, 31),
        date(2026, 10, 15),
        31,
    )


@pytest.mark.parametrize(("value", "expected"), [("1", 1), ("366", 366), ("007", 7)])
def test_list_limits_in_range_are_accepted(value: str, expected: int) -> None:
    assert EntryListQuery.model_validate({"limit": value}).limit == expected


@pytest.mark.parametrize(
    "value",
    ["0", "367", "1000", "-1", "+5", "5.0", "1e2", "", " 5", "five", "\u0665", ["5", "6"]],
)
def test_invalid_list_limits_are_rejected(value: object) -> None:
    assert errors(EntryListQuery, {"limit": value}) == {"limit": LIMIT_MESSAGE}


@pytest.mark.parametrize("parameter", ["start", "end", "before"])
@pytest.mark.parametrize(
    "value", ["2026-13-01", "2026-10-1", "2026-10-11T00:00:00", "yesterday", "", ["2026-10-11"]]
)
def test_list_query_dates_must_be_yyyy_mm_dd(parameter: str, value: object) -> None:
    assert errors(EntryListQuery, {parameter: value}) == {parameter: DATE_FORMAT}


def test_the_list_query_rejects_start_after_end() -> None:
    assert errors(EntryListQuery, {"start": "2026-10-12", "end": "2026-10-11"}) == {
        "end": "Must not be before start."
    }


def test_the_list_query_allows_start_equal_to_end_and_any_cursor() -> None:
    query = EntryListQuery.model_validate(
        {"start": "2026-10-11", "end": "2026-10-11", "before": "2026-01-01"}
    )
    assert query.start == query.end == date(2026, 10, 11)


def test_the_list_query_rejects_unknown_parameters() -> None:
    assert errors(EntryListQuery, {"page": "2"}) == {"page": "Unknown field."}
