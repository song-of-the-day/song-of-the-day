"""Annotations: time-stamped sticky notes on one of the user's entries.

Ownership follows the entry: an annotation is found only through its own entry, and only
when the user owns that entry (one query). Anything else is reported
as ``404 not_found``. Functions that write commit their own unit of work.
"""

from __future__ import annotations

from typing import Final

from pydantic import MISSING
from sqlalchemy import delete, func, select

from sotd.errors import ApiError, validation_error
from sotd.extensions import db
from sotd.models import Annotation, Entry
from sotd.schemas.annotation import (
    END_NOT_AFTER_START_MESSAGE,
    AnnotationCreateIn,
    AnnotationPatchIn,
)
from sotd.services.entries import entry_not_found, get_entry, owned_entry_query

#: Most annotations one entry may hold.
ANNOTATION_LIMIT: Final = 200


def annotation_not_found() -> ApiError:
    """Return the ``404 not_found`` error for an annotation that isn't the user's."""
    return ApiError(404, "not_found", "This note doesn't exist.")


def list_annotations(user_id: int, entry_id: int) -> list[Annotation]:
    """Return the annotations of one of the user's entries, by ``start_ms`` then ``id``.

    Raises:
        ApiError: ``404 not_found`` unless ``user_id`` owns the entry.
    """
    return get_entry(user_id, entry_id).annotations


def create_annotation(user_id: int, entry_id: int, fields: AnnotationCreateIn) -> Annotation:
    """Add an annotation to one of the user's entries.

    The entry row is locked while its annotations are counted, so concurrent requests
    can't exceed :data:`ANNOTATION_LIMIT`.

    Args:
        user_id: The owner of the entry.
        entry_id: The annotated entry.
        fields: The validated annotation fields.

    Returns:
        The new, committed annotation.

    Raises:
        ApiError: ``404 not_found`` unless ``user_id`` owns the entry, ``422
            annotation_limit_reached`` if the entry already has the maximum.
    """
    locked = owned_entry_query(user_id, entry_id).with_only_columns(Entry.id).with_for_update()
    if db.session.scalar(locked) is None:
        db.session.rollback()
        raise entry_not_found()
    count = db.session.scalar(select(func.count()).where(Annotation.entry_id == entry_id)) or 0
    if count >= ANNOTATION_LIMIT:
        db.session.rollback()
        raise ApiError(
            422,
            "annotation_limit_reached",
            f"A song can hold at most {ANNOTATION_LIMIT} notes.",
        )
    annotation = Annotation(entry_id=entry_id, **fields.model_dump())
    db.session.add(annotation)
    db.session.commit()
    return annotation


def update_annotation(
    user_id: int, entry_id: int, annotation_id: int, changes: AnnotationPatchIn
) -> Annotation:
    """Apply a ``PATCH`` to an annotation; omitted fields stay unchanged.

    The merged ``start_ms``/``end_ms`` must still form a valid point or range.

    Args:
        user_id: The owner of the entry.
        entry_id: The annotated entry.
        annotation_id: The annotation to change.
        changes: The validated fields to set (``end_ms=None`` makes it a point).

    Returns:
        The updated, committed annotation.

    Raises:
        ApiError: ``404 not_found`` unless the annotation belongs to ``entry_id`` and
            ``user_id`` owns that entry; ``422 validation_error`` if the merged
            ``end_ms`` isn't after ``start_ms``.
    """
    annotation = db.session.scalar(
        select(Annotation)
        .join(Annotation.entry)
        .where(
            Annotation.id == annotation_id,
            Annotation.entry_id == entry_id,
            Entry.user_id == user_id,
        )
    )
    if annotation is None:
        raise annotation_not_found()
    start_ms = annotation.start_ms if changes.start_ms is MISSING else changes.start_ms
    end_ms = annotation.end_ms if changes.end_ms is MISSING else changes.end_ms
    _check_range(start_ms, end_ms)
    for name, value in changes.model_dump().items():
        setattr(annotation, name, value)
    db.session.commit()
    return annotation


def delete_annotation(user_id: int, entry_id: int, annotation_id: int) -> None:
    """Delete an annotation of one of the user's entries.

    Raises:
        ApiError: ``404 not_found`` unless the annotation belongs to ``entry_id`` and
            ``user_id`` owns that entry.
    """
    statement = (
        delete(Annotation)
        .where(
            Annotation.id == annotation_id,
            Annotation.entry_id == entry_id,
            Annotation.entry_id == Entry.id,
            Entry.user_id == user_id,
        )
        .returning(Annotation.id)
        .execution_options(synchronize_session=False)
    )
    if db.session.scalar(statement) is None:
        db.session.rollback()
        raise annotation_not_found()
    db.session.commit()


def _check_range(start_ms: int, end_ms: int | None) -> None:
    """Require a range to end after it starts (a point, ``end_ms=None``, always passes).

    Raises:
        ApiError: ``422 validation_error`` on ``end_ms``.
    """
    if end_ms is not None and end_ms <= start_ms:
        raise validation_error({"end_ms": END_NOT_AFTER_START_MESSAGE})
