"""Songs: the YouTube auto-match lookup.

``GET /api/songs/youtube-match`` requires a login and is limited to 30 requests per hour
and 200 per day per user (a lookup can cost up to 101 YouTube quota units). The scoring
and upstream calls live in :mod:`sotd.services.youtube_match`.
"""

from __future__ import annotations

from typing import Final

from flask import Blueprint, Response, current_app

from sotd import clock
from sotd.api.utils import json_response, parse_query, user_rate_limit_key
from sotd.extensions import limiter
from sotd.schemas.song import (
    YouTubeMatchOut,
    YouTubeMatchQuery,
    YouTubeMatchResponse,
)
from sotd.services import sessions, youtube_match
from sotd.services.youtube_match import Track

bp = Blueprint("songs", __name__, url_prefix="/songs")

YOUTUBE_MATCH_PER_HOUR_LIMIT: Final = "30/hour"
YOUTUBE_MATCH_PER_DAY_LIMIT: Final = "200/day"


@bp.get("/youtube-match")
@sessions.login_required
@limiter.limit(YOUTUBE_MATCH_PER_HOUR_LIMIT, key_func=user_rate_limit_key)
@limiter.limit(YOUTUBE_MATCH_PER_DAY_LIMIT, key_func=user_rate_limit_key)
def get_youtube_match() -> Response:
    """Suggest a YouTube video for a song, or answer why there is none.

    A cache hit is free; a miss calls the YouTube Data API v3 when a key is configured.
    Upstream failures are reported in the body (``reason``), never as a 5xx status.
    """
    query = parse_query(YouTubeMatchQuery)
    result = youtube_match.find_match(
        Track(
            title=query.title,
            artist=query.artist,
            album=query.album,
            duration_ms=query.duration_ms,
            source_id=query.source_id,
            country=query.country,
        ),
        now=clock.utcnow(),
        api_key=current_app.config["YOUTUBE_API_KEY"],
    )
    match = None
    if result.match is not None:
        match = YouTubeMatchOut(
            video_id=result.match.video_id,
            title=result.match.title,
            channel_title=result.match.channel_title,
            duration_ms=result.match.duration_ms,
            score=result.match.score,
            confidence=result.match.confidence,
        )
    return json_response(YouTubeMatchResponse(match=match, reason=result.reason))
