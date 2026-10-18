"""Entries: one logged song per user and calendar day.

Every function is scoped to the owner: another user's entry is reported exactly like a
missing one (``404 not_found``). Functions that write commit their own unit of work.
Taking a day that already has an entry, on create or by moving an entry, raises
``409 entry_exists`` with the id of the entry that holds it; the unique constraint
decides, so concurrent requests can't both succeed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Final

from psycopg.errors import UniqueViolation
from sqlalchemy import Select, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from sotd.errors import ApiError
from sotd.extensions import db
from sotd.models import Annotation, Entry
from sotd.schemas.entry import EntryCreateIn, EntryPatchIn

#: The ``UNIQUE (user_id, entry_date)`` constraint of ``entries``.
ENTRY_DATE_CONSTRAINT: Final = "uq_entries_user_id_entry_date"


@dataclass(frozen=True, slots=True)
class EntrySummary:
    """An entry as listed, with the number of its annotations.

    Attributes:
        entry: The entry (its annotations are not loaded).
        annotation_count: How many annotations it has.
    """

    entry: Entry
    annotation_count: int


@dataclass(frozen=True, slots=True)
class EntryPage:
    """One page of :func:`list_entries`.

    Attributes:
        entries: Up to ``limit`` entries, newest first.
        next_before: The cursor for the next page (the date of the last entry), or
            ``None`` when no further entry matches the filters.
    """

    entries: list[EntrySummary]
    next_before: date | None


def entry_not_found() -> ApiError:
    """Return the ``404 not_found`` error for an entry that isn't the user's."""
    return ApiError(404, "not_found", "This entry doesn't exist.")


def entry_exists(existing_entry_id: int) -> ApiError:
    """Return the ``409 entry_exists`` error naming the entry that holds the day."""
    return ApiError(
        409,
        "entry_exists",
        "You already logged a song for this day.",
        existing_entry_id=existing_entry_id,
    )


def owned_entry_query(user_id: int, entry_id: int) -> Select[Entry]:
    """Return a query for the entry ``entry_id`` if ``user_id`` owns it."""
    return select(Entry).where(Entry.id == entry_id, Entry.user_id == user_id)


def list_entries(
    user_id: int,
    *,
    start: date | None = None,
    end: date | None = None,
    before: date | None = None,
    limit: int,
) -> EntryPage:
    """Return a page of the user's entries, newest first, with their annotation counts.

    The counts come from a correlated subquery, so a page costs one query. One row more
    than ``limit`` is fetched to tell whether another page exists.

    Args:
        user_id: The owner.
        start: Inclusive lower bound on ``entry_date``.
        end: Inclusive upper bound on ``entry_date``.
        before: Exclusive upper bound on ``entry_date`` (the pagination cursor).
        limit: The page size.
    """
    annotation_count = (
        select(func.count(Annotation.id))
        .where(Annotation.entry_id == Entry.id)
        .correlate(Entry)
        .scalar_subquery()
    )
    statement = select(Entry, annotation_count).where(Entry.user_id == user_id)
    if start is not None:
        statement = statement.where(Entry.entry_date >= start)
    if end is not None:
        statement = statement.where(Entry.entry_date <= end)
    if before is not None:
        statement = statement.where(Entry.entry_date < before)
    statement = statement.order_by(Entry.entry_date.desc()).limit(limit + 1)
    rows = db.session.execute(statement).all()
    entries = [EntrySummary(entry, count) for entry, count in rows[:limit]]
    next_before = entries[-1].entry.entry_date if len(rows) > limit else None
    return EntryPage(entries=entries, next_before=next_before)


def get_entry(user_id: int, entry_id: int) -> Entry:
    """Return one of the user's entries with its annotations loaded (sorted).

    Raises:
        ApiError: ``404 not_found`` unless ``user_id`` owns the entry.
    """
    statement = owned_entry_query(user_id, entry_id).options(selectinload(Entry.annotations))
    entry = db.session.scalar(statement)
    if entry is None:
        raise entry_not_found()
    return entry


def create_entry(user_id: int, fields: EntryCreateIn) -> Entry:
    """Log a song for a day.

    Args:
        user_id: The owner.
        fields: The validated entry fields.

    Returns:
        The new, committed entry.

    Raises:
        ApiError: ``409 entry_exists`` if the user already has an entry for that day.
    """
    entry = Entry(user_id=user_id, **fields.model_dump())
    db.session.add(entry)
    _commit_entry(user_id, fields.entry_date)
    return entry


def update_entry(user_id: int, entry_id: int, changes: EntryPatchIn) -> Entry:
    """Apply a ``PATCH`` to one of the user's entries; omitted fields stay unchanged.

    Args:
        user_id: The owner.
        entry_id: The entry to change.
        changes: The validated fields to set (``None`` clears an optional field).

    Returns:
        The updated, committed entry.

    Raises:
        ApiError: ``404 not_found`` unless ``user_id`` owns the entry, ``409
            entry_exists`` if it is moved to a day that already has an entry.
    """
    entry = db.session.scalar(owned_entry_query(user_id, entry_id))
    if entry is None:
        raise entry_not_found()
    for name, value in changes.model_dump().items():
        setattr(entry, name, value)
    _commit_entry(user_id, entry.entry_date)
    return entry


def delete_entry(user_id: int, entry_id: int) -> None:
    """Delete one of the user's entries; the database cascades to its annotations.

    Raises:
        ApiError: ``404 not_found`` unless ``user_id`` owns the entry.
    """
    statement = (
        delete(Entry)
        .where(Entry.id == entry_id, Entry.user_id == user_id)
        .returning(Entry.id)
        .execution_options(synchronize_session=False)
    )
    if db.session.scalar(statement) is None:
        db.session.rollback()
        raise entry_not_found()
    db.session.commit()


def _commit_entry(user_id: int, entry_date: date) -> None:
    """Commit a new or changed entry dated ``entry_date``.

    Raises:
        ApiError: ``409 entry_exists`` when the user's day is already taken.
    """
    try:
        db.session.commit()
    except IntegrityError as exc:
        db.session.rollback()
        if not _is_entry_date_conflict(exc):
            raise
        existing_id = db.session.scalars(
            select(Entry.id).where(Entry.user_id == user_id, Entry.entry_date == entry_date)
        ).one()  # Fails (500) only if the conflicting entry was deleted in the meantime.
        raise entry_exists(existing_id) from None


def _is_entry_date_conflict(exc: IntegrityError) -> bool:
    error = exc.orig
    return (
        isinstance(error, UniqueViolation) and error.diag.constraint_name == ENTRY_DATE_CONSTRAINT
    )
