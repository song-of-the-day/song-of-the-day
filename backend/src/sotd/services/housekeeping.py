"""Cleanup of expired sessions, unreferenced uploads and expired YouTube matches.

Used by ``flask sotd prune``, by new uploads and by profile updates.
The functions only stage deletes in the current transaction; callers commit.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any, Final, cast

from sqlalchemy import ColumnElement, CursorResult, String, delete, func, select
from sqlalchemy import cast as sql_cast

from sotd.extensions import db
from sotd.models import Upload, User, UserSession, YouTubeMatch

#: How long an upload may stay unreferenced (e.g. an unsaved draft) before it is pruned.
UNREFERENCED_UPLOAD_GRACE: Final = timedelta(hours=1)


def delete_expired_sessions(*, now: datetime, user_id: int | None = None) -> int:
    """Delete sessions whose ``expires_at`` has passed.

    Args:
        now: The current time.
        user_id: Only delete this user's sessions.

    Returns:
        The number of deleted sessions.
    """
    statement = delete(UserSession).where(UserSession.expires_at <= now)
    if user_id is not None:
        statement = statement.where(UserSession.user_id == user_id)
    return _rowcount(db.session.execute(statement))


def delete_unreferenced_uploads(
    *,
    older_than: datetime | None = None,
    user_id: int | None = None,
    keep: uuid.UUID | None = None,
) -> int:
    """Delete uploads that their owner's theme doesn't use.

    The owners' rows are locked (``SELECT ... FOR UPDATE``, the lock taken by profile
    updates and new uploads), so a concurrent ``PATCH /api/profile`` that starts
    referencing an upload either commits first and is seen here, or waits.

    Args:
        older_than: Only uploads created strictly before this time are candidates;
            ``None`` considers uploads of any age.
        user_id: Only consider this user's uploads.
        keep: An upload that is never deleted (the one a new upload just inserted).

    Returns:
        The number of deleted uploads.
    """
    candidate: list[ColumnElement[bool]] = []
    if older_than is not None:
        candidate.append(Upload.created_at < older_than)
    if keep is not None:
        candidate.append(Upload.id != keep)
    owners = select(User.id, User.theme).where(
        User.id.in_(select(Upload.user_id).where(*candidate))
    )
    if user_id is not None:
        owners = owners.where(User.id == user_id)
    locked = owners.with_for_update().cte("locked_owners")
    referenced_id = func.lower(locked.c.theme["background"]["image_upload_id"].astext)
    statement = delete(Upload).where(
        Upload.user_id == locked.c.id,
        referenced_id.is_distinct_from(sql_cast(Upload.id, String)),
        *candidate,
    )
    result = db.session.execute(statement, execution_options={"synchronize_session": False})
    return _rowcount(result)


def delete_expired_youtube_matches(*, now: datetime) -> int:
    """Delete YouTube match cache rows whose ``expires_at`` has passed.

    Args:
        now: The current time.

    Returns:
        The number of deleted rows.
    """
    statement = delete(YouTubeMatch).where(YouTubeMatch.expires_at <= now)
    return _rowcount(db.session.execute(statement))


def _rowcount(result: object) -> int:
    return cast(CursorResult[Any], result).rowcount
