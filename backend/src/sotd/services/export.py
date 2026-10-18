"""The data export: everything a user owns as one JSON document (``GET /api/account/export``)."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from sotd.extensions import db
from sotd.models import Entry, User
from sotd.schemas.export import ExportDocument, ExportEntry, ExportUser


def export_filename(day: date) -> str:
    """Return the download filename of an export made on ``day``."""
    return f"sotd-export-{day.isoformat()}.json"


def build_export(user: User, *, now: datetime) -> ExportDocument:
    """Collect a user's profile, entries and annotations.

    Entries are newest first; each entry's annotations are ordered by ``start_ms``, then
    creation (``id``). Two queries, whatever the number of entries.

    Args:
        user: The logged-in account.
        now: The export time (``exported_at``).

    Returns:
        The export document.
    """
    entries = db.session.scalars(
        select(Entry)
        .where(Entry.user_id == user.id)
        .order_by(Entry.entry_date.desc())
        .options(selectinload(Entry.annotations))
    ).all()
    return ExportDocument(
        exported_at=now,
        user=ExportUser.model_validate(user),
        entries=[ExportEntry.model_validate(entry) for entry in entries],
    )
