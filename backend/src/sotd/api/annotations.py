"""Annotations: time-stamped notes on an entry's song.

Every route requires a login; unsafe methods also need the CSRF header (``CSRFProtect``).
An entry or annotation the user doesn't own is a ``404``.
"""

from __future__ import annotations

from flask import Blueprint, Response

from sotd.api.entries import ID_CONVERTER, register_id_converter
from sotd.api.utils import json_response, parse_body
from sotd.schemas.annotation import (
    AnnotationCreateIn,
    AnnotationListResponse,
    AnnotationOut,
    AnnotationPatchIn,
    AnnotationResponse,
)
from sotd.services import annotations as annotation_service
from sotd.services import sessions

bp = Blueprint(
    "annotations", __name__, url_prefix=f"/entries/<{ID_CONVERTER}:entry_id>/annotations"
)
bp.record_once(register_id_converter)


@bp.get("")
@sessions.login_required
def list_annotations(entry_id: int) -> Response:
    """List an entry's annotations by ``start_ms``, then ``id``."""
    notes = annotation_service.list_annotations(sessions.current_account().id, entry_id)
    return json_response(AnnotationListResponse.model_validate({"annotations": notes}))


@bp.post("")
@sessions.login_required
def create_annotation(entry_id: int) -> Response:
    """Add an annotation (a point, or a range when ``end_ms`` is given)."""
    body = parse_body(AnnotationCreateIn)
    note = annotation_service.create_annotation(sessions.current_account().id, entry_id, body)
    return json_response(AnnotationResponse(annotation=AnnotationOut.model_validate(note)), 201)


@bp.patch(f"/<{ID_CONVERTER}:annotation_id>")
@sessions.login_required
def update_annotation(entry_id: int, annotation_id: int) -> Response:
    """Change some fields of an annotation; ``end_ms: null`` makes it a point."""
    body = parse_body(AnnotationPatchIn)
    note = annotation_service.update_annotation(
        sessions.current_account().id, entry_id, annotation_id, body
    )
    return json_response(AnnotationResponse(annotation=AnnotationOut.model_validate(note)))


@bp.delete(f"/<{ID_CONVERTER}:annotation_id>")
@sessions.login_required
def delete_annotation(entry_id: int, annotation_id: int) -> Response:
    """Delete an annotation."""
    annotation_service.delete_annotation(sessions.current_account().id, entry_id, annotation_id)
    return Response(status=204)
