"""Logged songs (one per user per calendar day) and their annotations."""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING, Final

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Identity,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from sotd.extensions import Base
from sotd.models.base import TimestampMixin

if TYPE_CHECKING:
    from sotd.models.user import User

#: Longest allowed song duration and annotation timestamp: 24 hours, in milliseconds.
MAX_SONG_MS: Final = 86_400_000


class Entry(TimestampMixin, Base):
    """A user's song for one calendar day."""

    __tablename__ = "entries"
    __table_args__ = (
        UniqueConstraint("user_id", "entry_date"),
        CheckConstraint("source IN ('itunes', 'manual')", name="source_valid"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    entry_date: Mapped[date]
    title: Mapped[str] = mapped_column(String(300))
    artist: Mapped[str] = mapped_column(String(300))
    album: Mapped[str | None] = mapped_column(String(300))
    artwork_url: Mapped[str | None] = mapped_column(String(1000))
    preview_url: Mapped[str | None] = mapped_column(String(1000))
    external_url: Mapped[str | None] = mapped_column(String(1000))
    youtube_video_id: Mapped[str | None] = mapped_column(String(11))
    duration_ms: Mapped[int | None]
    source: Mapped[str] = mapped_column(String(16))
    source_id: Mapped[str | None] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text)

    user: Mapped[User] = relationship(back_populates="entries")
    annotations: Mapped[list[Annotation]] = relationship(
        back_populates="entry",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="(Annotation.start_ms, Annotation.id)",
    )


class Annotation(TimestampMixin, Base):
    """A time-stamped sticky note on an entry's song: a point or a range."""

    __tablename__ = "annotations"
    __table_args__ = (
        CheckConstraint(f"start_ms BETWEEN 0 AND {MAX_SONG_MS}", name="start_ms_range"),
        CheckConstraint(
            f"end_ms IS NULL OR (end_ms > start_ms AND end_ms <= {MAX_SONG_MS})",
            name="end_after_start",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("entries.id", ondelete="CASCADE"), index=True)
    start_ms: Mapped[int]
    end_ms: Mapped[int | None]
    body: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(16), server_default="yellow")

    entry: Mapped[Entry] = relationship(back_populates="annotations")
