"""Column mixins shared by the models.

Timestamps are ``timestamptz`` with a ``now()`` server default (so raw SQL inserts get
one too). ORM writes use :func:`sotd.clock.utcnow` instead, which keeps the values
consistent with the rest of the application and lets tests freeze time.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from sotd import clock


class CreatedAtMixin:
    """Adds ``created_at``."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=clock.utcnow, server_default=func.now(), sort_order=100
    )


class TimestampMixin(CreatedAtMixin):
    """Adds ``created_at`` and ``updated_at`` (refreshed on every ORM update)."""

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=clock.utcnow,
        onupdate=clock.utcnow,
        server_default=func.now(),
        sort_order=101,
    )
