"""Uploaded background images, stored re-encoded as WebP."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CHAR, ForeignKey, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from sotd.extensions import Base
from sotd.models.base import CreatedAtMixin

if TYPE_CHECKING:
    from sotd.models.user import User


class Upload(CreatedAtMixin, Base):
    """An image owned by one user. ``data`` is deferred: only the download route loads it."""

    __tablename__ = "uploads"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content_type: Mapped[str] = mapped_column(String(64))
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    byte_size: Mapped[int]
    width: Mapped[int]
    height: Mapped[int]
    #: Hex SHA-256 of ``data``; doubles as the ETag.
    sha256: Mapped[str] = mapped_column(CHAR(64))

    user: Mapped[User] = relationship(back_populates="uploads")
