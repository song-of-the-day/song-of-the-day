"""Public profiles: read-only views of anyone's profile.

Every route is public (no session; GETs need no CSRF token) and returns only public
shapes: ``PublicProfile``, ``Entry`` and ``EntryDetail``, never the email or preferences.
The routes share one limit of 300 requests per minute per client IP.
"""

from __future__ import annotations

from typing import Final

from flask import Blueprint, Response

from sotd.api.entries import (
    ID_CONVERTER,
    entry_list_response,
    entry_response,
    register_id_converter,
)
from sotd.api.utils import json_response
from sotd.extensions import limiter
from sotd.schemas.user import PublicProfileOut, PublicProfileResponse
from sotd.services import entries, users

PUBLIC_READS_LIMIT: Final = "300/minute"

bp = Blueprint("users", __name__, url_prefix="/users")
bp.record_once(register_id_converter)

_public_reads = limiter.shared_limit(PUBLIC_READS_LIMIT, scope="public-profile")


@bp.get("/<username>")
@_public_reads
def get_profile(username: str) -> Response:
    """Return a user's public profile."""
    user = users.get_public_user(username)
    return json_response(PublicProfileResponse(profile=PublicProfileOut.model_validate(user)))


@bp.get("/<username>/entries")
@_public_reads
def list_entries(username: str) -> Response:
    """List a user's entries, newest first, with the same query as ``GET /api/entries``."""
    user = users.get_public_user(username)
    return json_response(entry_list_response(user.id))


@bp.get(f"/<username>/entries/<{ID_CONVERTER}:entry_id>")
@_public_reads
def get_entry(username: str, entry_id: int) -> Response:
    """Return one of the user's entries with its annotations."""
    user = users.get_public_user(username)
    return json_response(entry_response(entries.get_entry(user.id, entry_id)))
