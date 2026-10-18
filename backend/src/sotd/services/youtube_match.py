"""YouTube auto-match: find a track's music video.

``find_match`` answers one request: a fresh cache hit is returned as is, otherwise the
YouTube Data API v3 is asked (``search.list`` for candidates, ``videos.list`` for their
details) and the best acceptable candidate is cached. Precision beats recall: a wrong
video would put every annotation on the wrong timeline, so candidates are hard-filtered
(embeddability, live streams, regional blocks, implausible duration), scored with
:func:`score_candidate` and accepted only at ``0.70`` with a clear margin.

Upstream problems never raise to the caller: they come back as a ``None`` match with a
reason. A ``quotaExceeded`` 403 stops the calls in this process until the next quota
reset (midnight America/Los_Angeles), which is logged once.

The cache table is shared by all users (``youtube_matches``); positive rows live 30 days
(YouTube's cap for stored API data), negative rows 3.
"""

from __future__ import annotations

import difflib
import logging
import math
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import Any, Final, Literal
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.exc import IntegrityError

from sotd.extensions import db
from sotd.models import YouTubeMatch
from sotd.models.youtube_match import MAX_KEY_BYTES

logger = logging.getLogger(__name__)

#: YouTube Data API v3 endpoints.
SEARCH_URL: Final = "https://www.googleapis.com/youtube/v3/search"
VIDEOS_URL: Final = "https://www.googleapis.com/youtube/v3/videos"
#: Timeout of every YouTube call, in seconds.
HTTP_TIMEOUT: Final = 4.0
#: ``search.list`` results examined per lookup (the call costs 100 quota units anyway).
MAX_RESULTS: Final = 10
#: YouTube's category id for Music.
MUSIC_CATEGORY: Final = "10"

#: How long a positive (matched) result is cached.
POSITIVE_TTL: Final = timedelta(days=30)
#: How long a negative (no match) result is cached.
NEGATIVE_TTL: Final = timedelta(days=3)

#: Lowest score of an accepted match.
ACCEPT_SCORE: Final = 0.70
#: How much the best candidate must beat the runner-up by.
ACCEPT_MARGIN: Final = 0.05
#: Tolerance for both thresholds: their sums are floats, so exact boundaries would
#: otherwise depend on rounding noise.
DECISION_EPSILON: Final = 1e-9
#: Score at which an accepted match is reported as ``high`` confidence.
HIGH_CONFIDENCE: Final = 0.85

TOPIC_BONUS: Final = 0.15
OFFICIAL_BONUS: Final = 0.05
POPULARITY_BONUS: Final = 0.05
VIDEO_VARIANT_PENALTY: Final = 0.25
TRACK_VARIANT_PENALTY: Final = 0.20

#: Time zone of the YouTube quota reset (midnight there ends a quota day).
QUOTA_TIME_ZONE: Final = ZoneInfo("America/Los_Angeles")

#: Transport used for the YouTube calls. Tests put an ``httpx.MockTransport`` here;
#: production keeps the default.
_transport: httpx.BaseTransport | None = None

#: Process-local end of the quota blackout, set when the API answers ``quotaExceeded``.
_quota_exhausted_until: datetime | None = None

#: Why the endpoint answered with ``match: null``.
Reason = Literal["matched", "no_match", "disabled", "quota_exhausted", "upstream_error"]


class _UpstreamError(Exception):
    """The YouTube API was unreachable or answered something unusable."""


class _QuotaExceededError(Exception):
    """The YouTube API refused a call because the daily quota ran out."""


@dataclass(frozen=True, slots=True)
class Track:
    """The song to match, as sent by the client.

    Attributes:
        title: The track title (raw, as the user sees it).
        artist: The track artist.
        album: Accepted but unused in matching (kept for symmetry with the entry API).
        duration_ms: The track's length, when known.
        source_id: The iTunes ``trackId``, when the song came from the iTunes search.
        country: ISO 3166-1 alpha-2 code of the listener, for regional blocks.
    """

    title: str
    artist: str
    album: str | None = None
    duration_ms: int | None = None
    source_id: str | None = None
    country: str | None = None


@dataclass(frozen=True, slots=True)
class Video:
    """A candidate video as returned by ``videos.list``."""

    video_id: str
    title: str
    channel_title: str
    description: str
    duration_ms: int | None
    view_count: int | None
    embeddable: bool
    live_broadcast_content: str
    blocked_countries: frozenset[str]
    allowed_countries: frozenset[str] | None


@dataclass(frozen=True, slots=True)
class ScoreBreakdown:
    """The components of a candidate's score (each 0-1 except bonuses and penalties)."""

    title: float
    artist: float
    duration: float
    bonuses: float
    penalties: float

    @property
    def total(self) -> float:
        """Return ``0.40·title + 0.25·artist + 0.25·duration + bonuses - penalties``.

        The result is clamped to ``[0, 1]``.
        """
        base = 0.40 * self.title + 0.25 * self.artist + 0.25 * self.duration
        return min(1.0, max(0.0, base + self.bonuses - self.penalties))


@dataclass(frozen=True, slots=True)
class ScoredCandidate:
    """A candidate that passed the hard filters, with its score breakdown."""

    video: Video
    score: ScoreBreakdown


@dataclass(frozen=True, slots=True)
class MatchCandidate:
    """An accepted match, ready to serialize as ``YouTubeMatch``."""

    video_id: str
    title: str
    channel_title: str
    duration_ms: int | None
    score: float

    @property
    def confidence(self) -> Literal["high", "medium"]:
        """Return ``"high"`` for a score of at least 0.85, else ``"medium"``."""
        return "high" if self.score >= HIGH_CONFIDENCE else "medium"


@dataclass(frozen=True, slots=True)
class MatchResult:
    """The endpoint's answer: a match, or ``None`` with the reason why not."""

    match: MatchCandidate | None
    reason: Reason


# --- Text normalization and cleaning ------------------------------------------------------


def normalize(text: str) -> str:
    """Return the comparison form of ``text``.

    NFKC, case-folded, diacritics stripped, ``&`` read as ``and``, punctuation dropped
    and whitespace collapsed.
    """
    text = unicodedata.normalize("NFKC", text).casefold()
    text = "".join(
        char for char in unicodedata.normalize("NFKD", text) if not unicodedata.combining(char)
    )
    text = text.replace("&", " and ")
    text = "".join(char for char in text if not unicodedata.category(char).startswith("P"))
    return " ".join(text.split())


#: ``(feat. …)``/``(ft. …)``/``(featuring …)`` credits, bracketed or parenthesized.
_FEAT_GROUP: Final = re.compile(
    r"\s*[(\[]\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]", re.IGNORECASE
)
#: Remaster/edition suffixes such as ``- Remastered 2011``, ``(2015 Remaster)``,
#: ``- Single Version`` and ``(Deluxe Edition)``.
_TRACK_EDITION_SUFFIX: Final = re.compile(
    r"(?i)\s*(?:"
    r"[(\[]\s*(?:\d{4}\s+)?"
    r"(?:remaster(?:ed)?|deluxe(?:\s+edition)?|single(?:\s+version)?|album(?:\s+version)?"
    r"|radio(?:\s+edit)?|bonus(?:\s+track)?|special(?:\s+edition)?|edition|version)"
    r"(?:\s+\d{4})?\s*[)\]]"
    r"|[-–—]\s*(?:\d{4}\s+)?"  # noqa: RUF001 - `-`, en dash and em dash are separators
    r"(?:remaster(?:ed)?|deluxe(?:\s+edition)?|single(?:\s+version)?|album(?:\s+version)?"
    r"|radio(?:\s+edit)?|bonus(?:\s+track)?|special(?:\s+edition)?|edition|version)"
    r"(?:\s+\d{4})?"
    r")\s*$"
)

#: Noise phrases removed from a video title before comparing it to a track title.
_NOISE_PHRASES: Final = (
    "official music video",
    "official lyric video",
    "official video",
    "official audio",
    "lyric video",
    "visualizer",
    "lyrics",
    "audio",
    "video",
    "remastered",
    "hd",
    "hq",
    "4k",
    "mv",
    "m/v",
)
_NOISE: Final = re.compile(
    r"(?i)(?<![a-z0-9])(?:"
    + "|".join(re.escape(phrase) for phrase in _NOISE_PHRASES)
    + r")(?![a-z0-9])"
)
_SEPARATORS: Final = re.compile(r"[-–—|:~]")  # noqa: RUF001 - `-`, en dash and em dash
#: Brackets left empty after a noise phrase was removed, e.g. ``Song ( )``.
_EMPTY_BRACKETS: Final = re.compile(r"[(\[]\s*[)\]]")


def clean_track_title(title: str) -> str:
    """Strip ``(feat. …)`` credits and remaster/edition suffixes from a track title."""
    text = _FEAT_GROUP.sub(" ", title)
    while True:
        cleaned = _TRACK_EDITION_SUFFIX.sub("", text)
        if cleaned == text:
            return " ".join(cleaned.split())
        text = cleaned


def clean_video_title(title: str, artist: str) -> str:
    """Strip the artist name, separators and noise phrases from a video title."""
    text = title
    if artist.strip():
        text = re.sub(re.escape(artist), " ", text, flags=re.IGNORECASE)
    text = _NOISE.sub(" ", text)
    text = _EMPTY_BRACKETS.sub(" ", text)
    text = _SEPARATORS.sub(" ", text)
    return " ".join(text.split())


def _tokens(text: str) -> set[str]:
    return set(text.split())


# --- Cache key ----------------------------------------------------------------------------


def cache_key(track: Track) -> str:
    """Return the cache key of ``track``: ``itunes:<trackId>`` or a normalized ``q:`` key.

    The ``q:`` form is ``q:<normalized artist>|<normalized title>|<duration in 5 s
    steps>``; an unknown duration is ``0``. The key is capped at :data:`MAX_KEY_BYTES`
    (UTF-8) so it always fits the primary-key index.
    """
    if track.source_id:
        key = f"itunes:{track.source_id}"
    else:
        duration = round(track.duration_ms / 5000) * 5 if track.duration_ms is not None else 0
        key = f"q:{normalize(track.artist)}|{normalize(clean_track_title(track.title))}|{duration}"
    encoded = key.encode("utf-8")
    if len(encoded) <= MAX_KEY_BYTES:
        return key
    return encoded[:MAX_KEY_BYTES].decode("utf-8", "ignore")


# --- Scoring ------------------------------------------------------------------------------

#: ISO 8601 duration of a video (``PT3M20S``); YouTube never returns weeks.
_ISO_DURATION: Final = re.compile(
    r"P(?:(?P<days>[0-9]+)D)?"
    r"(?:T(?:(?P<hours>[0-9]+)H)?(?:(?P<minutes>[0-9]+)M)?(?:(?P<seconds>[0-9]+)S)?)?"
)


def parse_duration(value: str) -> int | None:
    """Parse an ISO 8601 duration (``PT3M20S``) into milliseconds, or ``None``."""
    match = _ISO_DURATION.fullmatch(value)
    if match is None:
        return None
    raw = match.groupdict()
    if all(part is None for part in raw.values()):
        return None
    days = int(raw["days"] or 0)
    seconds = days * 86_400
    seconds += int(raw["hours"] or 0) * 3_600
    seconds += int(raw["minutes"] or 0) * 60
    seconds += int(raw["seconds"] or 0)
    return seconds * 1000


def _title_score(track: Track, video: Video) -> float:
    """Return how well the cleaned track title matches the cleaned video title.

    The higher of the ``difflib`` ratio on the sorted token sets and token containment
    (1.0 when every track-title token appears in the video title).
    """
    track_tokens = _tokens(normalize(clean_track_title(track.title)))
    video_tokens = _tokens(normalize(clean_video_title(video.title, track.artist)))
    if not track_tokens or not video_tokens:
        return 0.0
    ratio = difflib.SequenceMatcher(
        None, " ".join(sorted(track_tokens)), " ".join(sorted(video_tokens))
    ).ratio()
    containment = 1.0 if track_tokens <= video_tokens else 0.0
    return max(ratio, containment)


def _artist_score(track: Track, video: Video) -> float:
    """Return how clearly the video belongs to the track's artist.

    1.0 for the artist's own or Topic channel, 0.9 for ``<artist>VEVO`` or a channel
    carrying every artist token, 0.7 for the artist appearing only in the title.
    """
    artist = normalize(track.artist)
    artist_tokens = _tokens(artist)
    if not artist_tokens:
        return 0.0
    channel = normalize(video.channel_title)
    channel_tokens = _tokens(channel)
    if channel in (artist, f"{artist} topic"):
        return 1.0
    if channel in (f"{artist}vevo", f"{artist} vevo") or artist_tokens <= channel_tokens:
        return 0.9
    if artist_tokens <= _tokens(normalize(video.title)):
        return 0.7
    return 0.0


def _duration_score(track: Track, video: Video) -> float:
    """Return how close the video's length is to the track's."""
    if track.duration_ms is None or video.duration_ms is None:
        return 0.5
    delta = abs(video.duration_ms - track.duration_ms)
    if delta <= 2_000:
        return 1.0
    if delta <= 5_000:
        return 0.9
    if delta <= 15_000:
        return 0.7
    if delta <= 40_000:
        return 0.4
    return 0.0


#: Channels of YouTube's auto-generated art tracks end with this.
_TOPIC_CHANNEL: Final = re.compile(r"[-–—]\s*topic$", re.IGNORECASE)  # noqa: RUF001 - dashes
#: Art tracks' descriptions start with this.
_TOPIC_DESCRIPTION: Final = re.compile(r"^provided to youtube by\b", re.IGNORECASE)
#: Video-title phrases that mark an official upload.
_OFFICIAL_PHRASES: Final = (
    "official audio",
    "official video",
    "official music video",
    "official lyric video",
)


def is_topic_track(video: Video) -> bool:
    """Return whether ``video`` is a Topic art track (channel name or description)."""
    channel = video.channel_title.strip()
    description = video.description.lstrip()
    return bool(_TOPIC_CHANNEL.search(channel) or _TOPIC_DESCRIPTION.match(description))


def _bonuses(video: Video) -> float:
    """Return the candidate's bonuses: Topic, official/VEVO and popularity."""
    bonus = TOPIC_BONUS if is_topic_track(video) else 0.0
    title = video.title.casefold()
    channel = video.channel_title.strip().casefold()
    if channel.endswith("vevo") or any(phrase in title for phrase in _OFFICIAL_PHRASES):
        bonus += OFFICIAL_BONUS
    if video.view_count:
        bonus += min(POPULARITY_BONUS, math.log10(video.view_count + 1) / 200)
    return bonus


#: Version keywords that must not differ between the track and the video.
_VARIANT_KEYWORDS: Final = (
    "live",
    "cover",
    "remix",
    "karaoke",
    "instrumental",
    "acoustic",
    "sped up",
    "slowed",
    "reverb",
    "nightcore",
    "8d",
    "extended",
    "mashup",
    "reaction",
    "tutorial",
    "lesson",
    "piano",
    "1 hour",
    "loop",
    "full album",
    "demo",
    "edit",
)


def _contains_phrase(tokens: list[str], phrase: str) -> bool:
    """Return whether the token list contains ``phrase`` as a contiguous run."""
    phrase_tokens = phrase.split()
    width = len(phrase_tokens)
    return any(
        tokens[index : index + width] == phrase_tokens for index in range(len(tokens) - width + 1)
    )


def _penalties(track: Track, video: Video) -> float:
    """Return the variant penalties of the raw track and video titles.

    A variant keyword in only one of the two titles marks the wrong version: -0.25 per
    keyword found only in the video, -0.20 per keyword found only in the track.
    """
    track_tokens = normalize(track.title).split()
    video_tokens = normalize(video.title).split()
    penalty = 0.0
    for keyword in _VARIANT_KEYWORDS:
        in_video = _contains_phrase(video_tokens, keyword)
        in_track = _contains_phrase(track_tokens, keyword)
        if in_video and not in_track:
            penalty += VIDEO_VARIANT_PENALTY
        elif in_track and not in_video:
            penalty += TRACK_VARIANT_PENALTY
    return penalty


def score_candidate(track: Track, video: Video) -> ScoreBreakdown:
    """Score one candidate: ``0.40·title + 0.25·artist + 0.25·duration`` and adjustments."""
    return ScoreBreakdown(
        title=_title_score(track, video),
        artist=_artist_score(track, video),
        duration=_duration_score(track, video),
        bonuses=_bonuses(video),
        penalties=_penalties(track, video),
    )


def _passes_filters(track: Track, video: Video) -> bool:
    """Return whether the candidate is usable at all (hard filters)."""
    if not video.embeddable or video.live_broadcast_content != "none":
        return False
    if track.country and (
        track.country in video.blocked_countries
        or (video.allowed_countries is not None and track.country not in video.allowed_countries)
    ):
        return False
    if track.duration_ms is not None and video.duration_ms is not None:
        if video.duration_ms > 2 * track.duration_ms:
            return False
        if abs(video.duration_ms - track.duration_ms) > 90_000:
            return False
    return True


def _is_exact_topic(track: Track, video: Video) -> bool:
    """Return whether ``video`` is a Topic art track with the track's exact timing."""
    if track.duration_ms is None or video.duration_ms is None:
        return False
    return is_topic_track(video) and abs(video.duration_ms - track.duration_ms) <= 2_000


def select_match(track: Track, videos: list[Video]) -> ScoredCandidate | None:
    """Pick the best acceptable candidate, or ``None``.

    The best candidate is accepted when it scores at least :data:`ACCEPT_SCORE` and
    beats the runner-up by at least :data:`ACCEPT_MARGIN`. An exact Topic art track is
    accepted without the margin (the same studio master, whatever else the search found).
    """
    scored = [
        ScoredCandidate(video=video, score=score_candidate(track, video))
        for video in videos
        if _passes_filters(track, video)
    ]
    if not scored:
        return None
    scored.sort(key=lambda candidate: candidate.score.total, reverse=True)
    best = scored[0]
    if best.score.total < ACCEPT_SCORE - DECISION_EPSILON:
        return None
    if (
        len(scored) > 1
        and best.score.total - scored[1].score.total < ACCEPT_MARGIN - DECISION_EPSILON
    ):
        return best if _is_exact_topic(track, best.video) else None
    return best


# --- YouTube API --------------------------------------------------------------------------


def _request(url: str, params: dict[str, str], *, api_key: str) -> dict[str, Any]:
    """Call one YouTube endpoint and return its JSON object.

    Raises:
        _QuotaExceededError: The API answered 403 with ``reason: quotaExceeded``.
        _UpstreamError: Any other failure (network, timeout, non-200, bad JSON).
    """
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT, transport=_transport) as client:
            response = client.get(url, params={**params, "key": api_key})
    except httpx.HTTPError as exc:
        raise _UpstreamError("the YouTube request failed") from exc
    if response.status_code == 403 and _is_quota_error(response):
        raise _QuotaExceededError
    if response.status_code != 200:
        raise _UpstreamError(f"YouTube answered HTTP {response.status_code}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise _UpstreamError("the YouTube response isn't valid JSON") from exc
    if not isinstance(payload, dict):
        raise _UpstreamError("the YouTube response isn't a JSON object")
    return payload


def _is_quota_error(response: httpx.Response) -> bool:
    """Return whether a 403 body says the daily quota ran out."""
    try:
        payload = response.json()
    except ValueError:
        return False
    error = payload.get("error") if isinstance(payload, dict) else None
    errors = error.get("errors") if isinstance(error, dict) else None
    if not isinstance(errors, list):
        return False
    return any(isinstance(item, dict) and item.get("reason") == "quotaExceeded" for item in errors)


def _search_video_ids(track: Track, *, api_key: str) -> list[str]:
    """Run ``search.list`` and return the candidate video ids, in YouTube's order."""
    params = {
        "part": "snippet",
        "type": "video",
        "videoCategoryId": MUSIC_CATEGORY,
        "videoEmbeddable": "true",
        "maxResults": str(MAX_RESULTS),
        "q": f"{track.artist} {clean_track_title(track.title)}".strip(),
    }
    if track.country:
        params["regionCode"] = track.country
    payload = _request(SEARCH_URL, params, api_key=api_key)
    items = payload.get("items")
    if not isinstance(items, list):
        return []
    video_ids: list[str] = []
    for item in items:
        identifier = item.get("id") if isinstance(item, dict) else None
        video_id = identifier.get("videoId") if isinstance(identifier, dict) else None
        if isinstance(video_id, str) and video_id:
            video_ids.append(video_id)
    return video_ids


def _region_restriction(content: dict[str, Any]) -> tuple[frozenset[str], frozenset[str] | None]:
    """Return the video's blocked and allowed country sets from ``contentDetails``."""
    restriction = content.get("regionRestriction")
    if not isinstance(restriction, dict):
        return frozenset(), None
    raw_blocked = restriction.get("blocked")
    blocked = (
        frozenset(item for item in raw_blocked if isinstance(item, str))
        if isinstance(raw_blocked, list)
        else frozenset()
    )
    raw_allowed = restriction.get("allowed")
    allowed = (
        frozenset(item for item in raw_allowed if isinstance(item, str))
        if isinstance(raw_allowed, list)
        else None
    )
    return blocked, allowed


def _video_from_item(item: object) -> Video | None:
    """Build a :class:`Video` from one ``videos.list`` item, or ``None`` if malformed."""
    if not isinstance(item, dict):
        return None
    video_id = item.get("id")
    snippet = item.get("snippet")
    content = item.get("contentDetails")
    status = item.get("status")
    statistics = item.get("statistics")
    if (
        not isinstance(video_id, str)
        or not isinstance(snippet, dict)
        or not isinstance(content, dict)
        or not isinstance(status, dict)
    ):
        return None
    title = snippet.get("title")
    channel = snippet.get("channelTitle")
    live = snippet.get("liveBroadcastContent", "none")
    description = snippet.get("description", "")
    duration = content.get("duration")
    if (
        not isinstance(title, str)
        or not isinstance(channel, str)
        or not isinstance(live, str)
        or not isinstance(description, str)
    ):
        return None
    view_count: int | None = None
    if isinstance(statistics, dict):
        raw_views = statistics.get("viewCount")
        if isinstance(raw_views, str) and raw_views.isdigit():
            view_count = int(raw_views)
    blocked, allowed = _region_restriction(content)
    return Video(
        video_id=video_id,
        title=title,
        channel_title=channel,
        description=description,
        duration_ms=parse_duration(duration) if isinstance(duration, str) else None,
        view_count=view_count,
        embeddable=status.get("embeddable") is True,
        live_broadcast_content=live,
        blocked_countries=blocked,
        allowed_countries=allowed,
    )


def _fetch_videos(video_ids: list[str], *, api_key: str) -> list[Video]:
    """Run ``videos.list`` for ``video_ids`` and return the usable candidates."""
    payload = _request(
        VIDEOS_URL,
        {"part": "snippet,contentDetails,status,statistics", "id": ",".join(video_ids)},
        api_key=api_key,
    )
    items = payload.get("items")
    if not isinstance(items, list):
        return []
    videos: list[Video] = []
    for item in items:
        video = _video_from_item(item)
        if video is not None:
            videos.append(video)
    return videos


# --- Cache and quota state ----------------------------------------------------------------


def _load_cached(key: str, *, now: datetime) -> YouTubeMatch | None:
    """Return the unexpired cache row for ``key``, or ``None``."""
    row = db.session.get(YouTubeMatch, key)
    if row is None or row.expires_at <= now:
        return None
    return row


def _details(candidate: ScoredCandidate) -> dict[str, Any]:
    """Return the display fields stored for a positive cache row."""
    return {
        "title": candidate.video.title,
        "channel_title": candidate.video.channel_title,
        "duration_ms": candidate.video.duration_ms,
    }


def _store_cached(key: str, candidate: ScoredCandidate | None, *, now: datetime) -> None:
    """Cache the outcome of a lookup, refreshing an expired row in place.

    A concurrent writer may win the race for the same key; the row is a cache, so the
    conflict is rolled back and ignored.
    """
    if candidate is None:
        row = YouTubeMatch(
            key=key,
            video_id=None,
            score=None,
            details={},
            created_at=now,
            expires_at=now + NEGATIVE_TTL,
        )
    else:
        row = YouTubeMatch(
            key=key,
            video_id=candidate.video.video_id,
            score=candidate.score.total,
            details=_details(candidate),
            created_at=now,
            expires_at=now + POSITIVE_TTL,
        )
    db.session.merge(row)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()


def _cached_result(row: YouTubeMatch) -> MatchResult:
    """Return the ``MatchResult`` a cache row stands for."""
    if row.video_id is None or row.score is None:
        return MatchResult(match=None, reason="no_match")
    details = row.details if isinstance(row.details, dict) else {}
    title = details.get("title")
    channel = details.get("channel_title")
    duration = details.get("duration_ms")
    return MatchResult(
        match=MatchCandidate(
            video_id=row.video_id,
            title=title if isinstance(title, str) else "",
            channel_title=channel if isinstance(channel, str) else "",
            duration_ms=duration if isinstance(duration, int) else None,
            score=row.score,
        ),
        reason="matched",
    )


def next_quota_reset(now: datetime) -> datetime:
    """Return the next midnight in America/Los_Angeles, when the quota resets."""
    local = now.astimezone(QUOTA_TIME_ZONE)
    return datetime.combine(local.date() + timedelta(days=1), time.min, tzinfo=QUOTA_TIME_ZONE)


def _quota_blackout_active(*, now: datetime) -> bool:
    return _quota_exhausted_until is not None and now < _quota_exhausted_until


def _disable_until_quota_reset(*, now: datetime) -> None:
    global _quota_exhausted_until
    _quota_exhausted_until = next_quota_reset(now)
    logger.warning(
        "YouTube API quota exhausted; auto-match disabled until %s.",
        _quota_exhausted_until.isoformat(),
    )


# --- Entry point --------------------------------------------------------------------------


def find_match(track: Track, *, now: datetime, api_key: str | None) -> MatchResult:
    """Return the cached or freshly matched video for ``track``.

    Args:
        track: The song to match.
        now: The current time (cache TTLs and the quota blackout).
        api_key: The YouTube Data API v3 key, or ``None`` when the feature is disabled.

    Returns:
        A cache hit, a fresh decision, or ``None`` with one of the documented reasons.
        Upstream problems never raise.
    """
    if not api_key:
        return MatchResult(match=None, reason="disabled")
    key = cache_key(track)
    cached = _load_cached(key, now=now)
    if cached is not None:
        return _cached_result(cached)
    if _quota_blackout_active(now=now):
        return MatchResult(match=None, reason="quota_exhausted")
    try:
        video_ids = _search_video_ids(track, api_key=api_key)
        videos = _fetch_videos(video_ids, api_key=api_key) if video_ids else []
    except _QuotaExceededError:
        _disable_until_quota_reset(now=now)
        return MatchResult(match=None, reason="quota_exhausted")
    except _UpstreamError:
        logger.warning("YouTube auto-match failed upstream; answering without a suggestion.")
        return MatchResult(match=None, reason="upstream_error")
    selected = select_match(track, videos)
    _store_cached(key, selected, now=now)
    if selected is None:
        return MatchResult(match=None, reason="no_match")
    return MatchResult(
        match=MatchCandidate(
            video_id=selected.video.video_id,
            title=selected.video.title,
            channel_title=selected.video.channel_title,
            duration_ms=selected.video.duration_ms,
            score=selected.score.total,
        ),
        reason="matched",
    )
