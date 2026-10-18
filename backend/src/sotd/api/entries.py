"""Entries: one logged song per calendar day.

Every route requires a login; unsafe methods also need the CSRF header (``CSRFProtect``).
"""

from __future__ import annotations

from typing import Final

from flask import Blueprint, Response
from flask.blueprints import BlueprintSetupState
from werkzeug.routing import BaseConverter

from sotd.api.utils import json_response, parse_body, parse_query
from sotd.models import Entry
from sotd.schemas.entry import (
    EntryCreateIn,
    EntryDetailOut,
    EntryListQuery,
    EntryListResponse,
    EntryOut,
    EntryPatchIn,
    EntryResponse,
)
from sotd.services import entries, sessions

#: Largest ``bigint``, the type of every row id.
MAX_ID: Final = 2**63 - 1


def _decimal_at_most(maximum: int) -> str:
    """Return a regex matching ASCII decimal numbers from 0 to ``maximum``.

    Numbers with fewer digits than ``maximum`` always fit. One with as many digits fits
    when it has a smaller digit at the first position where the two differ (or is
    ``maximum`` itself). Leading zeros count as digits.

    Args:
        maximum: The largest number to match (non-negative).
    """
    digits = str(maximum)
    width = len(digits)
    alternatives = [f"[0-9]{{1,{width - 1}}}"] if width > 1 else []
    for position, digit in enumerate(digits):
        if digit != "0":
            rest = width - position - 1
            alternatives.append(f"{digits[:position]}[0-{int(digit) - 1}][0-9]{{{rest}}}")
    alternatives.append(digits)
    return "|".join(alternatives)


class IdConverter(BaseConverter):
    """URL converter for row ids: ASCII digits whose value fits a ``bigint``.

    A larger number can't name a row, and as a bound parameter it would fail in the
    database instead of matching nothing. The range is enforced by the regex alone:
    werkzeug's ``int(max=...)`` rejects values only after picking a rule by method, so
    an out-of-range id would get ``405`` instead of ``404`` on all but one method.
    """

    regex = _decimal_at_most(MAX_ID)

    def to_python(self, value: str) -> int:
        """Return the id as an ``int``."""
        return int(value)


#: Name under which :class:`IdConverter` is registered: ``<id:entry_id>``.
ID_CONVERTER: Final = "id"


def register_id_converter(state: BlueprintSetupState) -> None:
    """Add :class:`IdConverter` to the app's URL map (a blueprint ``record_once`` hook).

    Blueprints that use :data:`ID_CONVERTER` must record it before adding their routes.
    """
    state.app.url_map.converters.setdefault(ID_CONVERTER, IdConverter)


bp = Blueprint("entries", __name__, url_prefix="/entries")
bp.record_once(register_id_converter)


@bp.get("")
@sessions.login_required
def list_entries() -> Response:
    """List the user's entries, newest first, one page at a time."""
    return json_response(entry_list_response(sessions.current_account().id))


@bp.post("")
@sessions.login_required
def create_entry() -> Response:
    """Log a song for a day."""
    body = parse_body(EntryCreateIn)
    entry = entries.create_entry(sessions.current_account().id, body)
    return json_response(entry_response(entry), status=201)


@bp.get(f"/<{ID_CONVERTER}:entry_id>")
@sessions.login_required
def get_entry(entry_id: int) -> Response:
    """Return one entry with its annotations."""
    entry = entries.get_entry(sessions.current_account().id, entry_id)
    return json_response(entry_response(entry))


@bp.patch(f"/<{ID_CONVERTER}:entry_id>")
@sessions.login_required
def update_entry(entry_id: int) -> Response:
    """Change some fields of an entry; ``null`` clears an optional field."""
    body = parse_body(EntryPatchIn)
    entry = entries.update_entry(sessions.current_account().id, entry_id, body)
    return json_response(entry_response(entry))


@bp.delete(f"/<{ID_CONVERTER}:entry_id>")
@sessions.login_required
def delete_entry(entry_id: int) -> Response:
    """Delete an entry and its annotations."""
    entries.delete_entry(sessions.current_account().id, entry_id)
    return Response(status=204)


def entry_list_response(user_id: int) -> EntryListResponse:
    """Return the page of ``user_id``'s entries that the request's query string selects.

    Shared by ``GET /api/entries`` and the public ``GET /api/users/<username>/entries``.

    Raises:
        ApiError: ``422 validation_error`` for invalid query parameters.
    """
    query = parse_query(EntryListQuery)
    page = entries.list_entries(
        user_id, start=query.start, end=query.end, before=query.before, limit=query.limit
    )
    listed = [
        EntryOut.from_entry(item.entry, annotation_count=item.annotation_count)
        for item in page.entries
    ]
    return EntryListResponse(entries=listed, next_before=page.next_before)


def entry_response(entry: Entry) -> EntryResponse:
    """Return ``{"entry": EntryDetail}`` for an entry with its annotations loaded."""
    detail = EntryDetailOut.from_entry(entry, annotation_count=len(entry.annotations))
    return EntryResponse(entry=detail)
