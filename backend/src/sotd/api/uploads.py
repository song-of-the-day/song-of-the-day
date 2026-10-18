"""Uploads: background images (multipart in, WebP out).

``POST /api/uploads`` is limited to 30 per hour per user and 60 per hour per client IP.
"""

from __future__ import annotations

import uuid
from typing import Final

from flask import Blueprint, Response, request

from sotd.api.utils import accepts, json_response, user_rate_limit_key
from sotd.errors import ApiError, validation_error
from sotd.extensions import limiter
from sotd.schemas.upload import UploadOut, UploadResponse
from sotd.services import images, sessions, uploads

bp = Blueprint("uploads", __name__, url_prefix="/uploads")

#: The multipart field that carries the image.
FILE_FIELD: Final = "file"
#: Largest accepted file part.
MAX_FILE_BYTES: Final = 10 * 1024 * 1024
#: Body limit of the upload request: the file part plus multipart overhead.
MAX_REQUEST_BYTES: Final = 11 * 1024 * 1024

UPLOADS_PER_USER_LIMIT: Final = "30/hour"
UPLOADS_PER_IP_LIMIT: Final = "60/hour"

#: Uploads never change (a new image gets a new id), so browsers may cache them for good.
CACHE_CONTROL: Final = "private, max-age=31536000, immutable"
CONTENT_SECURITY_POLICY: Final = "default-src 'none'"


@bp.post("")
@accepts("multipart/form-data", max_content_length=MAX_REQUEST_BYTES)
@sessions.login_required
@limiter.limit(UPLOADS_PER_USER_LIMIT, key_func=user_rate_limit_key)
@limiter.limit(UPLOADS_PER_IP_LIMIT)
def create_upload() -> Response:
    """Store an image (re-encoded to WebP) and drop the user's unused older uploads."""
    image = images.process_image(_read_file())
    upload = uploads.create_upload(sessions.current_account().id, image)
    return json_response(UploadResponse(upload=UploadOut.from_upload(upload)), status=201)


def _read_file() -> bytes:
    """Return the bytes of the request's single ``file`` part.

    ``accepts`` raised the body limit before CSRF validation parsed the form, so
    ``request.files`` holds at most :data:`MAX_REQUEST_BYTES` of data here.

    Raises:
        ApiError: ``422 validation_error`` when the part is missing, repeated or empty, or
            other fields are sent; ``413 payload_too_large`` when the file exceeds
            :data:`MAX_FILE_BYTES`.
    """
    unknown = sorted({*request.form, *request.files} - {FILE_FIELD})
    if unknown:
        raise validation_error(dict.fromkeys(unknown, "Unknown field."))
    files = request.files.getlist(FILE_FIELD)
    if not files:
        raise validation_error({FILE_FIELD: "This field is required."})
    if len(files) > 1:
        raise validation_error({FILE_FIELD: "Send a single file."})
    data = files[0].stream.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise ApiError(413, "payload_too_large", "The image must be 10 MiB or smaller.")
    if not data:
        raise validation_error({FILE_FIELD: "The file is empty."})
    return data


@bp.get("/<uuid:upload_id>")
def download_upload(upload_id: uuid.UUID) -> Response:
    """Serve an upload's bytes; ``304`` when the client's copy is current.

    Public: the owner gets any of their uploads, everyone else only an owner's saved
    background. Anything else is ``404``.
    """
    viewer = sessions.optional_account()
    upload = uploads.find_visible_upload(viewer.id if viewer else None, upload_id)
    if upload is None:
        raise ApiError(404, "not_found", "Not found.")
    if request.if_none_match.contains_weak(upload.sha256):
        response = Response(status=304)
    else:
        response = Response(upload.data, mimetype=upload.content_type)
        response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    response.set_etag(upload.sha256)
    response.headers["Cache-Control"] = CACHE_CONTROL
    return response
