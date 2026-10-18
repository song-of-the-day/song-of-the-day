"""Cached YouTube auto-match results, shared by all users.

One row per track identity: ``itunes:<trackId>`` when known, else a
``q:<artist>|<title>|<duration>`` key built from the normalized track. ``video_id`` is
``NULL`` for a cached "no match"; ``details`` holds the few display fields of a positive
result (title, channel, duration) so a cache hit needs no upstream call. Positive rows
live 30 days (YouTube's cap for stored API data), negative rows 3; expired rows are
refreshed on demand and deleted by ``flask sotd prune``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from sotd.extensions import Base
from sotd.models.base import CreatedAtMixin

#: Longest cache key, in bytes. The ``q:`` form joins two normalized texts of up to 300
#: characters each, so the byte cap keeps the primary-key index well inside the
#: PostgreSQL btree entry limit whatever the alphabet.
MAX_KEY_BYTES = 600


class YouTubeMatch(CreatedAtMixin, Base):
    """One cached match result; ``expires_at`` decides when it is refreshed."""

    __tablename__ = "youtube_matches"
    __table_args__ = (
        CheckConstraint("score IS NULL OR (score >= 0 AND score <= 1)", name="score_range"),
        CheckConstraint(f"octet_length(key) <= {MAX_KEY_BYTES}", name="key_length"),
    )

    key: Mapped[str] = mapped_column(String(600), primary_key=True)
    #: The matched video id, or ``NULL`` for a cached "no match".
    video_id: Mapped[str | None] = mapped_column(String(11))
    #: Score of the accepted candidate (0-1); ``NULL`` for a negative result.
    score: Mapped[float | None]
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
