"""Users and their server-side sessions."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, Final

from sqlalchemy import (
    CHAR,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    String,
    func,
    inspect,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from sotd import clock
from sotd.extensions import Base
from sotd.models.base import CreatedAtMixin, TimestampMixin
from sotd.usernames import get_username_rules

if TYPE_CHECKING:
    from sotd.models.entry import Entry
    from sotd.models.upload import Upload

_SESSION_INFO_KEY: Final = "session_token"


class User(TimestampMixin, Base):
    """An account. ``email`` is stored lower-cased and trimmed by the auth service.

    ``username`` is stored lower-cased; the ``username_format`` CHECK enforces the length
    and pattern of ``shared/usernames.json`` (the reserved list is checked by the API).

    It also implements the user protocol of Flask-Login. Its "user id" is the raw token
    of the server-side session the object was loaded for (see ``sotd.services.sessions``),
    so the cookie identifies a revocable session rather than the account.
    """

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(get_username_rules().check_constraint_sql(), name="username_format"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    username: Mapped[str] = mapped_column(String(30), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(50))
    bio: Mapped[str] = mapped_column(String(280), server_default="")
    #: Raw stored theme; render it through :func:`sotd.theme.normalize_theme`.
    theme: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    #: Auto-play the player when an entry opens or a song is picked.
    autoplay_previews: Mapped[bool] = mapped_column(server_default=text("true"))

    sessions: Mapped[list[UserSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    entries: Mapped[list[Entry]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    uploads: Mapped[list[Upload]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def session_token(self) -> str | None:
        """Raw token of the session this object was loaded for, if any (never persisted)."""
        token = inspect(self).info.get(_SESSION_INFO_KEY)
        return token if isinstance(token, str) else None

    @session_token.setter
    def session_token(self, token: str) -> None:
        inspect(self).info[_SESSION_INFO_KEY] = token

    @property
    def is_active(self) -> bool:
        """Every account can log in (Flask-Login protocol)."""
        return True

    @property
    def is_authenticated(self) -> bool:
        """A ``User`` object always stands for a logged-in session (Flask-Login protocol)."""
        return True

    @property
    def is_anonymous(self) -> bool:
        """Always ``False``; Flask-Login uses its own object for anonymous users."""
        return False

    def get_id(self) -> str:
        """Return the raw session token that Flask-Login keeps in the session cookie.

        Raises:
            RuntimeError: If the object wasn't loaded for, or given, a session.
        """
        token = self.session_token
        if token is None:
            raise RuntimeError("This user object is not bound to a session.")
        return token


class UserSession(CreatedAtMixin, Base):
    """A revocable login session; the cookie holds the raw token, the row its SHA-256."""

    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(CHAR(64), unique=True)
    remember: Mapped[bool]
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=clock.utcnow, server_default=func.now()
    )
    #: Sliding idle expiry, never later than the absolute cap from ``created_at``.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="sessions")
