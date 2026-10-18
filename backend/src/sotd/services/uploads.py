"""Stored background images: creation, ownership lookups and the per-user row lock.

New uploads and profile updates serialize on the owner's ``users`` row
(``SELECT ... FOR UPDATE``, see :func:`lock_owner`), so the housekeeping that deletes
unreferenced uploads never races a profile update that starts referencing one.
"""

from __future__ import annotations

import hashlib
import uuid

from sqlalchemy import func, or_, select

from sotd.errors import ApiError
from sotd.extensions import db
from sotd.models import Upload, User
from sotd.services.housekeeping import delete_unreferenced_uploads
from sotd.services.images import EncodedImage


def lock_owner(user_id: int) -> User:
    """Lock a user's row for the rest of the transaction and return it, refreshed.

    The returned object is the session's instance of the user (the logged-in user, when
    it is loaded), with every column re-read under the lock.

    Args:
        user_id: The account to lock.

    Raises:
        ApiError: ``401 unauthorized`` if the account no longer exists.
    """
    statement = (
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    user = db.session.scalars(statement).one_or_none()
    if user is None:
        raise ApiError(401, "unauthorized", "Log in to continue.")
    return user


def owns_upload(user_id: int, upload_id: uuid.UUID) -> bool:
    """Return whether ``upload_id`` exists and belongs to ``user_id``."""
    statement = select(Upload.id).where(Upload.id == upload_id, Upload.user_id == user_id)
    return db.session.scalar(statement) is not None


def create_upload(user_id: int, image: EncodedImage) -> Upload:
    """Store an image and delete the user's other uploads that their theme doesn't use.

    The insert and the cleanup run in one transaction under the owner's row lock, so a
    user holds at most two uploads: the one the saved theme references and this new
    draft. Commits.

    Args:
        user_id: The owner.
        image: The processed image.

    Returns:
        The new upload (its ``data`` is not loaded again).
    """
    lock_owner(user_id)
    upload = Upload(
        user_id=user_id,
        content_type=image.content_type,
        data=image.data,
        byte_size=len(image.data),
        width=image.width,
        height=image.height,
        sha256=hashlib.sha256(image.data).hexdigest(),
    )
    db.session.add(upload)
    db.session.flush()
    delete_unreferenced_uploads(user_id=user_id, keep=upload.id)
    db.session.commit()
    return upload


def find_visible_upload(viewer_id: int | None, upload_id: uuid.UUID) -> Upload | None:
    """Return an upload the viewer may download, or ``None``.

    The owner sees every upload of theirs; anyone else (including anonymous visitors)
    only the one that is the owner's saved background (``theme.background.image_upload_id``).
    Drafts stay private. ``data`` stays deferred.

    Args:
        viewer_id: The logged-in account, or ``None`` for an anonymous request.
        upload_id: The requested upload.
    """
    saved_id = func.lower(User.theme["background"]["image_upload_id"].astext)
    visible = saved_id == str(upload_id)
    if viewer_id is not None:
        visible = or_(Upload.user_id == viewer_id, visible)
    statement = (
        select(Upload).join(User, User.id == Upload.user_id).where(Upload.id == upload_id, visible)
    )
    return db.session.scalar(statement)
