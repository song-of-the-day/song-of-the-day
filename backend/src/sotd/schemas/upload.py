"""Response bodies of the upload endpoints."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Final

from sotd.schemas.common import ResponseModel, UtcDateTime

if TYPE_CHECKING:
    from sotd.models import Upload

#: Path the API serves an upload's bytes from (``GET /api/uploads/<id>``).
UPLOAD_URL_PREFIX: Final = "/api/uploads/"


def upload_url(upload_id: uuid.UUID) -> str:
    """Return the same-origin URL that serves an upload to its owner."""
    return f"{UPLOAD_URL_PREFIX}{upload_id}"


class UploadOut(ResponseModel):
    """The ``Upload`` resource: metadata of a stored image, never its bytes."""

    id: uuid.UUID
    url: str
    content_type: str
    byte_size: int
    width: int
    height: int
    created_at: UtcDateTime

    @classmethod
    def from_upload(cls, upload: Upload) -> UploadOut:
        """Build the resource from a stored upload (``data`` isn't loaded)."""
        return cls(
            id=upload.id,
            url=upload_url(upload.id),
            content_type=upload.content_type,
            byte_size=upload.byte_size,
            width=upload.width,
            height=upload.height,
            created_at=upload.created_at,
        )


class UploadResponse(ResponseModel):
    """``{"upload": Upload}``, returned by ``POST /api/uploads``."""

    upload: UploadOut
