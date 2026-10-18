"""Unit tests of the YouTube auto-match algorithm.

The scoring is a pure function, so these tests pin the normalization, the cache keys, the
score components and the accept/reject decision against realistic video fixtures: a Topic
art track next to an official video, a lyric video, a live take, a cover, a sped-up edit
and the artist's other songs.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from sotd.models.youtube_match import MAX_KEY_BYTES
from sotd.services.youtube_match import (
    Track,
    Video,
    cache_key,
    clean_track_title,
    clean_video_title,
    next_quota_reset,
    normalize,
    parse_duration,
    score_candidate,
    select_match,
)
from tests.support import FROZEN_NOW


def track(**overrides: Any) -> Track:
    values: dict[str, Any] = {
        "title": "Gosh",
        "artist": "Jamie xx",
        "duration_ms": 290_000,
        "source_id": "1440833098",
    }
    values.update(overrides)
    return Track(**values)


def video(**overrides: Any) -> Video:
    values: dict[str, Any] = {
        "video_id": "dQw4w9WgXcQ",
        "title": "Jamie xx - Gosh",
        "channel_title": "Jamie xx - Topic",
        "description": "Provided to YouTube by Young Turks",
        "duration_ms": 290_000,
        "view_count": 1_000_000,
        "embeddable": True,
        "live_broadcast_content": "none",
        "blocked_countries": frozenset(),
        "allowed_countries": None,
    }
    values.update(overrides)
    return Video(**values)


# --- Normalization and cleaning -----------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Beyoncé – Déjà Vu", "beyonce deja vu"),
        ("AC/DC & Friends!", "acdc and friends"),
        ("  Elvis   Presley  ", "elvis presley"),
        ("ＭＩＬＫ", "milk"),
        ("Don’t Stop (2003)", "dont stop 2003"),
        ("R.E.M.: Nightswimming", "rem nightswimming"),
    ],
)
def test_normalize(raw: str, expected: str) -> None:
    assert normalize(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Gosh (feat. Someone)", "Gosh"),
        ("Gosh [feat. Someone]", "Gosh"),
        ("Gosh (ft. Someone)", "Gosh"),
        ("Song - Remastered 2011", "Song"),
        ("Song - 2011 Remaster", "Song"),
        ("Song (2015 Remaster)", "Song"),
        ("Song (Remastered)", "Song"),
        ("Song - Single Version", "Song"),
        ("Song (Deluxe Edition)", "Song"),
        ("Song (Deluxe Edition) [Remastered]", "Song"),
        ("Song", "Song"),
        ("Gosh (feat. Someone) - Remastered", "Gosh"),
    ],
)
def test_clean_track_title(raw: str, expected: str) -> None:
    assert clean_track_title(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Jamie xx - Gosh", "Gosh"),
        ("Jamie xx - Gosh (Official Music Video)", "Gosh"),
        ("Jamie xx – Gosh [Official Audio]", "Gosh"),
        ("Gosh (Official Lyric Video) 4K", "Gosh"),
        ("Gosh | Lyrics", "Gosh"),
        ("Gosh (Visualizer)", "Gosh"),
        ("Jamie xx - Gosh (Official Video) HD", "Gosh"),
    ],
)
def test_clean_video_title(raw: str, expected: str) -> None:
    assert clean_video_title(raw, "Jamie xx") == expected


# --- Cache keys ---------------------------------------------------------------------------


def test_cache_key_prefers_the_itunes_track_id() -> None:
    assert cache_key(track(source_id="1440833098")) == "itunes:1440833098"


def test_cache_key_normalizes_and_rounds_the_duration() -> None:
    key = cache_key(
        track(source_id=None, title="Gosh (feat. X)", artist="Jamie xx", duration_ms=287_000)
    )
    assert key == "q:jamie xx|gosh|285"


def test_cache_key_without_a_duration() -> None:
    key = cache_key(track(source_id=None, title="Gosh", artist="Jamie xx", duration_ms=None))
    assert key == "q:jamie xx|gosh|0"


def test_cache_key_is_capped_at_max_key_bytes() -> None:
    key = cache_key(track(source_id=None, title="é" * 300, artist="é" * 300, duration_ms=None))
    assert len(key.encode("utf-8")) <= MAX_KEY_BYTES
    assert len(key) < 610  # The 600-byte cap cuts into the multibyte text.


# --- Duration parsing ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("PT3M20S", 200_000),
        ("PT45S", 45_000),
        ("PT1H2M3S", 3_723_000),
        ("P1DT2S", 86_402_000),
        ("PT0S", 0),
        ("P", None),
        ("PT", None),
        ("3:20", None),
        ("", None),
    ],
)
def test_parse_duration(raw: str, expected: int | None) -> None:
    assert parse_duration(raw) == expected


# --- Scoring ------------------------------------------------------------------------------


def test_exact_topic_art_track_scores_at_the_top() -> None:
    parsed = score_candidate(track(), video())
    assert (parsed.title, parsed.artist, parsed.duration) == (1.0, 1.0, 1.0)
    assert parsed.bonuses == pytest.approx(0.15 + 0.03)  # Topic plus 10^6 views
    assert parsed.penalties == 0.0
    assert parsed.total == 1.0  # Clamped from 1.08.


def test_official_video_on_the_artist_channel() -> None:
    candidate = video(
        title="Jamie xx - Gosh (Official Video)",
        channel_title="Jamie xx",
        description="",
        view_count=None,
    )
    parsed = score_candidate(track(), candidate)
    assert (parsed.title, parsed.artist, parsed.duration) == (1.0, 1.0, 1.0)
    assert parsed.bonuses == pytest.approx(0.05)
    assert parsed.total == pytest.approx(0.95)


def test_topic_bonus_comes_from_the_description_too() -> None:
    candidate = video(
        channel_title="Young Turks",
        description="Provided to YouTube by Young Turks",
        view_count=None,
    )
    assert score_candidate(track(), candidate).bonuses == pytest.approx(0.15)


def test_vevo_and_fan_channels_score_by_containment() -> None:
    vevo = video(channel_title="Jamie xx VEVO", view_count=None)
    assert score_candidate(track(), vevo).artist == 0.9
    fan = video(channel_title="Jamie xx Archive", view_count=None)
    assert score_candidate(track(), fan).artist == 0.9
    fan_missing_a_token = video(
        title="Gosh (audio)", channel_title="Jamie Archive", view_count=None
    )
    assert score_candidate(track(), fan_missing_a_token).artist == 0.0


def test_single_word_artist_vevo_channel() -> None:
    adele = track(title="Easy On Me", artist="Adele", source_id=None)
    candidate = video(title="Adele - Easy On Me (Official Video)", channel_title="AdeleVEVO")
    assert score_candidate(adele, candidate).artist == 0.9


def test_artist_mentioned_only_in_the_title_scores_lower() -> None:
    candidate = video(title="Jamie xx - Gosh", channel_title="Some Uploader", view_count=None)
    assert score_candidate(track(), candidate).artist == 0.7


def test_lyric_video_of_the_right_song() -> None:
    candidate = video(
        title="Gosh (Official Lyric Video)",
        channel_title="Indie Vibes",
        description="",
        view_count=1_000,
    )
    parsed = score_candidate(track(), candidate)
    assert parsed.title == 1.0
    assert parsed.artist == 0.0
    assert parsed.bonuses == pytest.approx(0.05 + 0.015, rel=1e-3)  # Official, plus views.
    assert parsed.penalties == 0.0
    assert parsed.total == pytest.approx(0.40 + 0.25 + 0.065, rel=1e-3)


def test_live_version_is_penalized() -> None:
    candidate = video(
        title="Jamie xx - Gosh (Live at Primavera)",
        channel_title="Jamie xx",
        description="",
        view_count=None,
    )
    parsed = score_candidate(track(), candidate)
    assert parsed.penalties == pytest.approx(0.25)
    assert parsed.total == pytest.approx(0.65)


def test_cover_from_an_unrelated_channel_is_rejected() -> None:
    candidate = video(
        title="Gosh (Cover)", channel_title="Random Guy", description="", view_count=None
    )
    parsed = score_candidate(track(), candidate)
    assert parsed.artist == 0.0
    assert parsed.penalties == pytest.approx(0.25)
    assert parsed.total == pytest.approx(0.40)
    assert select_match(track(), [candidate]) is None


def test_sped_up_version_is_rejected() -> None:
    candidate = video(
        title="Gosh (Sped Up)",
        channel_title="Random Guy",
        description="",
        duration_ms=250_000,
        view_count=None,
    )
    parsed = score_candidate(track(), candidate)
    assert parsed.duration == 0.4
    assert parsed.penalties == pytest.approx(0.25)
    assert parsed.total == pytest.approx(0.25)
    assert select_match(track(), [candidate]) is None


def test_track_variant_missing_from_the_video_is_penalized() -> None:
    parsed = score_candidate(
        track(title="Gosh (Live)"),
        video(title="Jamie xx - Gosh", channel_title="Jamie xx", view_count=None),
    )
    assert parsed.penalties == pytest.approx(0.20)


def test_lyrics_reupload_from_an_unrelated_channel_is_rejected() -> None:
    candidate = video(
        title="Gosh (Lyrics)", channel_title="Random Guy", description="", view_count=None
    )
    parsed = score_candidate(track(), candidate)
    assert parsed.total == pytest.approx(0.65)
    assert select_match(track(), [candidate]) is None


def test_a_different_song_by_the_same_artist_is_rejected() -> None:
    candidate = video(title="Jamie xx - Loud Places", duration_ms=240_000, view_count=None)
    parsed = score_candidate(track(), candidate)
    assert parsed.total < 0.70
    assert select_match(track(), [candidate]) is None


def test_the_exact_track_wins_over_a_different_song() -> None:
    wrong = video(
        video_id="aaaaaaaaaaa",
        title="Jamie xx - Loud Places",
        duration_ms=240_000,
        view_count=None,
    )
    right = video()
    selected = select_match(track(), [wrong, right])
    assert selected is not None
    assert selected.video.video_id == right.video_id


def test_candidates_below_the_threshold_are_rejected() -> None:
    weak = video(
        title="Gosh",
        channel_title="Some Uploader",
        description="",
        duration_ms=320_000,
        view_count=None,
    )
    parsed = score_candidate(track(), weak)
    assert (parsed.title, parsed.artist, parsed.duration) == (1.0, 0.0, 0.4)
    assert parsed.total == pytest.approx(0.50)
    assert select_match(track(), [weak]) is None


def test_unknown_track_duration_scores_neutral() -> None:
    parsed = score_candidate(
        track(duration_ms=None),
        video(duration_ms=600_000, title="Jamie xx - Gosh", channel_title="Jamie xx"),
    )
    assert parsed.duration == 0.5


# --- Decision rules -----------------------------------------------------------------------


def test_ambiguous_tie_is_rejected() -> None:
    first = video(
        video_id="aaaaaaaaaaa",
        title="Jamie xx - Gosh (Official Video)",
        channel_title="Jamie xx",
        description="",
    )
    second = video(
        video_id="bbbbbbbbbbb",
        title="Jamie xx - Gosh (Official Video)",
        channel_title="Jamie xx",
        description="",
    )
    assert select_match(track(), [first, second]) is None


def test_exact_topic_track_wins_despite_a_close_runner_up() -> None:
    topic = video(view_count=None)  # 1.0 with the Topic bonus.
    official = video(
        video_id="bbbbbbbbbbb",
        title="Jamie xx - Gosh (Official Video)",
        channel_title="Jamie xx",
        description="",
        view_count=10**9,  # 0.995: closer than the acceptance margin.
    )
    selected = select_match(track(), [official, topic])
    assert selected is not None
    assert selected.video.video_id == topic.video_id


def test_clear_margin_accepts_the_leader() -> None:
    leader = video(
        video_id="aaaaaaaaaaa",
        title="Jamie xx - Gosh (Official Video)",
        channel_title="Jamie xx",
        description="",
        view_count=10**12,
    )
    runner_up = video(
        video_id="bbbbbbbbbbb",
        title="Jamie xx - Gosh (Official Video)",
        channel_title="Jamie xx",
        description="",
        view_count=None,
    )
    selected = select_match(track(), [leader, runner_up])
    assert selected is not None
    assert selected.video.video_id == leader.video_id


# --- Hard filters -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"embeddable": False},
        {"live_broadcast_content": "live"},
        {"live_broadcast_content": "upcoming"},
    ],
)
def test_unusable_candidates_are_dropped(overrides: dict[str, Any]) -> None:
    assert select_match(track(), [video(**overrides)]) is None


def test_region_blocked_candidate_is_dropped_only_for_that_country() -> None:
    blocked = video(blocked_countries=frozenset({"US"}))
    assert select_match(track(country="US"), [blocked]) is None
    assert select_match(track(country="CA"), [blocked]) is not None


def test_allowed_country_list_excludes_everything_else() -> None:
    candidate = video(allowed_countries=frozenset({"CA"}))
    assert select_match(track(country="US"), [candidate]) is None
    assert select_match(track(country="CA"), [candidate]) is not None


@pytest.mark.parametrize("duration_ms", [181_000, 590_000])
def test_implausible_durations_are_dropped(duration_ms: int) -> None:
    # More than 90 s off, or more than twice the track.
    assert select_match(track(), [video(duration_ms=duration_ms)]) is None


def test_durations_at_the_filter_boundaries_pass() -> None:
    assert select_match(track(), [video(duration_ms=380_000)]) is not None
    assert select_match(track(duration_ms=60_000), [video(duration_ms=120_000)]) is not None


def test_twice_the_track_is_dropped_even_within_the_delta() -> None:
    assert select_match(track(duration_ms=60_000), [video(duration_ms=130_000)]) is None


# --- Quota reset --------------------------------------------------------------------------


def test_next_quota_reset_is_midnight_in_los_angeles() -> None:
    # 2026-10-11T12:00Z is 05:00 in Los Angeles (PDT, UTC-7).
    assert next_quota_reset(FROZEN_NOW) == datetime(2026, 10, 12, 7, 0, tzinfo=UTC)
