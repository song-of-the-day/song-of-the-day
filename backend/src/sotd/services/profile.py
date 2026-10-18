"""Profile updates: username, display name, bio, theme and preferences (``PATCH /api/profile``)."""

from __future__ import annotations

from typing import Final

from sqlalchemy.exc import IntegrityError

from sotd import clock
from sotd.errors import validation_error
from sotd.extensions import db
from sotd.models import User
from sotd.services.auth import (
    USERNAME_UNIQUE_CONSTRAINT,
    username_in_use,
    username_taken,
    violated_constraint,
)
from sotd.services.housekeeping import UNREFERENCED_UPLOAD_GRACE, delete_unreferenced_uploads
from sotd.services.uploads import lock_owner, owns_upload
from sotd.theme import ThemeIn

#: Error key and message for a theme that references an upload the user doesn't own.
IMAGE_UPLOAD_FIELD: Final = "theme.background.image_upload_id"
MISSING_IMAGE_MESSAGE: Final = "This image is no longer available; upload it again."


def update_profile(
    user_id: int,
    *,
    username: str | None = None,
    display_name: str | None = None,
    bio: str | None = None,
    theme: ThemeIn | None = None,
    autoplay_previews: bool | None = None,
) -> User:
    """Apply a partial profile update, then delete uploads the profile no longer uses.

    The user's row is locked first (the lock new uploads take), so the referenced
    upload can't be evicted between the ownership check and the commit. After saving,
    unreferenced uploads older than :data:`UNREFERENCED_UPLOAD_GRACE` are deleted; newer
    ones may be drafts in progress. Commits.

    Args:
        user_id: The logged-in account.
        username: The new, validated and lower-cased username; ``None`` leaves it
            unchanged.
        display_name: The new display name; ``None`` leaves it unchanged.
        bio: The new bio (possibly empty); ``None`` leaves it unchanged.
        theme: The new, complete theme, stored as validated (colors upper-cased);
            ``None`` leaves it unchanged.
        autoplay_previews: The new preference; ``None`` leaves it unchanged.

    Returns:
        The updated user.

    Raises:
        ApiError: ``422 validation_error`` on :data:`IMAGE_UPLOAD_FIELD` if the theme
            references an upload that doesn't exist or isn't the user's;
            ``409 username_taken`` if another account has ``username``.
    """
    user = lock_owner(user_id)
    if username is not None and username_in_use(username, exclude_user_id=user_id):
        db.session.rollback()
        raise username_taken(username)
    if theme is not None:
        image_upload_id = theme.background.image_upload_id
        if image_upload_id is not None and not owns_upload(user_id, image_upload_id):
            db.session.rollback()  # Releases the row lock right away.
            raise validation_error({IMAGE_UPLOAD_FIELD: MISSING_IMAGE_MESSAGE})
        # A new dict: JSONB columns don't track in-place changes.
        user.theme = theme.model_dump(mode="json")
    if display_name is not None:
        user.display_name = display_name
    if bio is not None:
        user.bio = bio
    if username is not None:
        user.username = username
    if autoplay_previews is not None:
        user.autoplay_previews = autoplay_previews
    try:
        db.session.flush()  # The cleanup reads the saved theme from the database.
    except IntegrityError as exc:  # A concurrent update or signup took the username.
        db.session.rollback()
        if username is not None and violated_constraint(exc) == USERNAME_UNIQUE_CONSTRAINT:
            raise username_taken(username) from None
        raise
    delete_unreferenced_uploads(
        older_than=clock.utcnow() - UNREFERENCED_UPLOAD_GRACE, user_id=user_id
    )
    db.session.commit()
    return user
