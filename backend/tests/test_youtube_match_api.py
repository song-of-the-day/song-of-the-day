"""Endpoint tests of ``GET /api/songs/youtube-match``.

The YouTube Data API is stubbed with an ``httpx.MockTransport``. These tests cover the
answer shapes, the query validation, caching (positive and negative, with expiry), the
quota blackout until midnight America/Los_Angeles, and the promise that upstream failures
are ``200`` bodies with a reason, never a 5xx.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import httpx
import pytest
import time_machine
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from sotd.models import User, YouTubeMatch
from sotd.services import youtube_match
from tests.clients import CsrfClient, csrf_client, error_code, log_in
from tests.support import FROZEN_NOW

URL = "/api/songs/youtube-match"
#: An 11-character video id.
VIDEO_ID = "dQw4w9WgXcQ"
PARAMS: dict[str, Any] = {
    "title": "Gosh",
    "artist": "Jamie xx",
    "duration_ms": 290_000,
    "source_id": "1440833098",
}


def video_item(**overrides: Any) -> dict[str, Any]:
    """Return one ``videos.list`` item, ready to be served by the fake.

    The keyword arguments override the matching field (``id``, ``title``,
    ``channel_title``, ``description``, ``duration``, ``view_count``, ``embeddable``,
    ``live_broadcast_content``); any other keyword replaces its top-level item key.
    """
    video_id = overrides.pop("id", VIDEO_ID)
    title = overrides.pop("title", "Jamie xx - Gosh (Official Video)")
    channel = overrides.pop("channel_title", "Jamie xx")
    description = overrides.pop("description", "")
    duration = overrides.pop("duration", "PT4M50S")  # 290 s, the track's length.
    views = overrides.pop("view_count", "1000000000")
    embeddable = overrides.pop("embeddable", True)
    live = overrides.pop("live_broadcast_content", "none")
    item: dict[str, Any] = {
        "id": video_id,
        "snippet": {
            "title": title,
            "channelTitle": channel,
            "description": description,
            "liveBroadcastContent": live,
        },
        "contentDetails": {"duration": duration},
        "status": {"embeddable": embeddable},
        "statistics": {"viewCount": views},
    }
    item.update(overrides)
    return item


class FakeYouTube:
    """A configurable stand-in for the two YouTube endpoints.

    By default the search call returns the ids of :attr:`items` and ``videos.list``
    returns the items themselves. Set :attr:`response` to answer every call with one raw
    response, or :attr:`error` to make the transport fail.
    """

    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []
        self.response: httpx.Response | None = None
        self.error: Exception | None = None
        self.requests: list[httpx.Request] = []

    @property
    def calls(self) -> int:
        """How many HTTP calls were made."""
        return len(self.requests)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        if self.response is not None:
            return self.response
        if request.url.path.endswith("/search"):
            items = [{"id": {"videoId": item["id"]}} for item in self.items]
            return httpx.Response(200, json={"items": items})
        return httpx.Response(200, json={"items": self.items})


@pytest.fixture(autouse=True)
def fake_youtube(monkeypatch: pytest.MonkeyPatch) -> FakeYouTube:
    """Route every YouTube call of a test through :class:`FakeYouTube`."""
    fake = FakeYouTube()
    monkeypatch.setattr(youtube_match, "_transport", httpx.MockTransport(fake))
    return fake


@pytest.fixture(autouse=True)
def _reset_quota_blackout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(youtube_match, "_quota_exhausted_until", None)


@pytest.fixture(scope="module")
def match_app(app_factory: Any) -> Iterator[Flask]:
    """An app with a YouTube API key configured."""
    with app_factory(YOUTUBE_API_KEY="test-key") as application:
        yield application


@pytest.fixture
def match_client(match_app: Flask, auth_user: User) -> CsrfClient:
    client = csrf_client(match_app)
    log_in(client, auth_user.email)
    return client


def get(client: CsrfClient, **overrides: Any) -> TestResponse:
    """GET the endpoint with the standard track, overridden by keyword."""
    return client.get(URL, query_string={**PARAMS, **overrides})


# --- Auth and validation ------------------------------------------------------------------


def test_requires_login(client: Any) -> None:
    response = client.get(URL, query_string={"title": "Gosh", "artist": "Jamie xx"})
    assert response.status_code == 401
    assert error_code(response) == "unauthorized"


@pytest.mark.parametrize(
    ("params", "fields"),
    [
        ({}, {"title", "artist"}),
        ({"artist": "A"}, {"title"}),
        ({"title": "T"}, {"artist"}),
        ({"title": "", "artist": "A"}, {"title"}),
        ({"title": "T", "artist": "A", "duration_ms": "5.5"}, {"duration_ms"}),
        ({"title": "T", "artist": "A", "duration_ms": "-5"}, {"duration_ms"}),
        ({"title": "T", "artist": "A", "duration_ms": "1e5"}, {"duration_ms"}),
        ({"title": "T", "artist": "A", "duration_ms": "0"}, {"duration_ms"}),
        ({"title": "T", "artist": "A", "duration_ms": "86400001"}, {"duration_ms"}),
        ({"title": "T", "artist": "A", "country": "us"}, {"country"}),
        ({"title": "T", "artist": "A", "country": "USA"}, {"country"}),
        ({"title": "T", "artist": "A", "unknown": "1"}, {"unknown"}),
    ],
)
def test_query_validation(
    match_client: CsrfClient, params: dict[str, Any], fields: set[str]
) -> None:
    response = match_client.get(URL, query_string=params)
    assert response.status_code == 422
    error = response.get_json()["error"]
    assert error["code"] == "validation_error"
    assert fields <= set(error["fields"])


def test_a_repeated_parameter_is_rejected(match_client: CsrfClient) -> None:
    response = match_client.get(URL, query_string=[("title", "a"), ("title", "b"), ("artist", "x")])
    assert response.status_code == 422
    assert response.get_json()["error"]["fields"]["title"] == "Must be a string."


def test_album_is_accepted_and_unused(match_client: CsrfClient, fake_youtube: FakeYouTube) -> None:
    fake_youtube.items = [video_item()]
    response = get(match_client, album="In Colour")
    assert response.status_code == 200
    assert response.get_json()["reason"] == "matched"
    assert "album" not in fake_youtube.requests[0].url.params


# --- Disabled, matched and cached ---------------------------------------------------------


def test_disabled_without_an_api_key(app: Flask, auth_client: CsrfClient) -> None:
    # The session app has no YOUTUBE_API_KEY in its environment.
    assert app.config["YOUTUBE_API_KEY"] is None
    response = auth_client.get(URL, query_string={"title": "Gosh", "artist": "Jamie xx"})
    assert response.status_code == 200
    assert response.get_json() == {"match": None, "reason": "disabled"}


def test_matched_video_is_returned_and_cached(
    match_client: CsrfClient,
    fake_youtube: FakeYouTube,
    db_session: Session,
    frozen_time: time_machine.Traveller,
) -> None:
    fake_youtube.items = [video_item()]

    response = get(match_client)

    assert response.status_code == 200
    body = response.get_json()
    assert body["reason"] == "matched"
    assert body["match"] == {
        "video_id": VIDEO_ID,
        "title": "Jamie xx - Gosh (Official Video)",
        "channel_title": "Jamie xx",
        "duration_ms": 290_000,
        "score": pytest.approx(0.995),  # 0.90 base + 0.05 official + 0.045 views.
        "confidence": "high",
    }
    assert fake_youtube.calls == 2
    search, videos = fake_youtube.requests
    assert search.url.path.endswith("/search")
    assert search.url.params["q"] == "Jamie xx Gosh"
    assert search.url.params["videoCategoryId"] == "10"
    assert search.url.params["videoEmbeddable"] == "true"
    assert search.url.params["maxResults"] == "10"
    assert search.url.params["key"] == "test-key"
    assert videos.url.params["id"] == VIDEO_ID
    assert videos.url.params["part"] == "snippet,contentDetails,status,statistics"

    row = db_session.get(YouTubeMatch, "itunes:1440833098")
    assert row is not None
    assert row.video_id == VIDEO_ID
    assert row.score == pytest.approx(0.995)
    assert row.details["channel_title"] == "Jamie xx"
    assert row.expires_at == FROZEN_NOW + timedelta(days=30)

    # The second lookup is served from the cache: same answer, no more API calls.
    fake_youtube.items = []
    again = get(match_client)
    assert again.get_json() == body
    assert fake_youtube.calls == 2


def test_country_selects_the_search_region(
    match_client: CsrfClient, fake_youtube: FakeYouTube
) -> None:
    fake_youtube.items = [video_item()]
    assert get(match_client, country="US").status_code == 200
    assert fake_youtube.requests[0].url.params["regionCode"] == "US"


def test_tracks_without_an_itunes_id_use_the_text_key(
    match_client: CsrfClient, fake_youtube: FakeYouTube, db_session: Session
) -> None:
    fake_youtube.items = [video_item()]
    response = get(match_client, source_id=None, title="Gosh (feat. X)", artist="Jamie  XX")
    assert response.get_json()["reason"] == "matched"
    row = db_session.get(YouTubeMatch, "q:jamie xx|gosh|290")
    assert row is not None
    assert row.video_id == VIDEO_ID


def test_expired_positive_cache_is_refreshed(
    match_client: CsrfClient,
    fake_youtube: FakeYouTube,
    db_session: Session,
    frozen_time: time_machine.Traveller,
) -> None:
    fake_youtube.items = [video_item()]
    get(match_client)

    frozen_time.shift(timedelta(days=31))
    fake_youtube.items = [video_item(id="aaaaaaaaaaa", title="Jamie xx - Gosh")]
    response = get(match_client)

    assert response.get_json()["match"]["video_id"] == "aaaaaaaaaaa"
    assert fake_youtube.calls == 4
    row = db_session.get(YouTubeMatch, "itunes:1440833098")
    assert row is not None
    assert row.expires_at == FROZEN_NOW + timedelta(days=61)


def test_no_match_is_cached_negatively(
    match_client: CsrfClient,
    fake_youtube: FakeYouTube,
    db_session: Session,
    frozen_time: time_machine.Traveller,
) -> None:
    fake_youtube.items = []
    first = get(match_client)
    assert first.get_json() == {"match": None, "reason": "no_match"}
    assert fake_youtube.calls == 1  # Fewer ids means no videos.list call.

    row = db_session.get(YouTubeMatch, "itunes:1440833098")
    assert row is not None
    assert row.video_id is None
    assert row.score is None
    assert row.expires_at == FROZEN_NOW + timedelta(days=3)

    # Even a failing API is not consulted while the negative cache is fresh.
    fake_youtube.response = httpx.Response(500)
    assert get(match_client).get_json() == {"match": None, "reason": "no_match"}
    assert fake_youtube.calls == 1


def test_unusable_candidates_answer_no_match(
    match_client: CsrfClient, fake_youtube: FakeYouTube
) -> None:
    fake_youtube.items = [video_item(status={"embeddable": False})]
    assert get(match_client).get_json() == {"match": None, "reason": "no_match"}


# --- Upstream failures --------------------------------------------------------------------


def test_upstream_error_status_is_reported(
    match_client: CsrfClient, fake_youtube: FakeYouTube
) -> None:
    fake_youtube.response = httpx.Response(500, json={"error": {"message": "boom"}})
    response = get(match_client)
    assert response.status_code == 200
    assert response.get_json() == {"match": None, "reason": "upstream_error"}


def test_upstream_timeout_is_reported(match_client: CsrfClient, fake_youtube: FakeYouTube) -> None:
    fake_youtube.error = httpx.ConnectTimeout("timed out")
    response = get(match_client)
    assert response.status_code == 200
    assert response.get_json() == {"match": None, "reason": "upstream_error"}


def test_upstream_invalid_json_is_reported(
    match_client: CsrfClient, fake_youtube: FakeYouTube
) -> None:
    fake_youtube.response = httpx.Response(
        200, content=b"not json", headers={"Content-Type": "application/json"}
    )
    assert get(match_client).get_json() == {"match": None, "reason": "upstream_error"}


def test_a_403_that_is_not_a_quota_error_is_an_upstream_error(
    match_client: CsrfClient, fake_youtube: FakeYouTube
) -> None:
    fake_youtube.response = httpx.Response(
        403, json={"error": {"errors": [{"reason": "keyInvalid"}]}}
    )
    response = get(match_client)
    assert response.status_code == 200
    assert response.get_json() == {"match": None, "reason": "upstream_error"}


def test_quota_exceeded_disables_matching_until_the_la_reset(
    match_client: CsrfClient,
    fake_youtube: FakeYouTube,
    frozen_time: time_machine.Traveller,
    caplog: pytest.LogCaptureFixture,
) -> None:
    quota = httpx.Response(
        403,
        json={"error": {"code": 403, "errors": [{"reason": "quotaExceeded"}]}},
    )
    fake_youtube.response = quota

    with caplog.at_level(logging.WARNING, logger="sotd.services.youtube_match"):
        first = get(match_client)
    assert first.get_json() == {"match": None, "reason": "quota_exhausted"}
    assert fake_youtube.calls == 1
    assert "quota" in caplog.text

    # Calls are skipped while the blackout lasts, even though the API would answer.
    fake_youtube.response = None
    fake_youtube.items = [video_item()]
    assert get(match_client).get_json() == {"match": None, "reason": "quota_exhausted"}
    assert fake_youtube.calls == 1

    # Midnight in Los Angeles is 19 hours after noon UTC; matching resumes there.
    frozen_time.shift(timedelta(hours=19))
    resumed = get(match_client)
    assert resumed.get_json()["reason"] == "matched"
    assert fake_youtube.calls == 3
