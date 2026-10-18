"""Request and response bodies of the annotation endpoints.

An annotation is a point (``end_ms`` is ``null``) or a range on the song's timeline.
A new range must end after it starts; for a ``PATCH``, the annotation service checks
that against the stored values the change is merged with.
"""

from __future__ import annotations

from typing import Annotated, Final

from pydantic import MISSING, AfterValidator, Field, Strict, ValidationInfo, field_validator
from pydantic_core import PydanticCustomError

from sotd.models.entry import MAX_SONG_MS
from sotd.schemas.common import ApiModel, ResponseModel, Text, UtcDateTime
from sotd.theme import DEFAULT_NOTE_COLOR, note_color_keys

#: Longest annotation body, after trimming.
BODY_MAX_LENGTH: Final = 1000
#: Reported on ``end_ms`` when a range doesn't end after it starts.
END_NOT_AFTER_START_MESSAGE: Final = "Must be greater than start_ms."


def _known_note_color(value: str) -> str:
    choices = note_color_keys()
    if value not in choices:
        raise PydanticCustomError(
            "invalid_choice", "Must be one of: {choices}.", {"choices": ", ".join(sorted(choices))}
        )
    return value


#: Where the note starts, in milliseconds from the start of the song.
StartMs = Annotated[int, Strict(), Field(ge=0, le=MAX_SONG_MS)]
#: Where a range ends; ``None`` makes the note a point.
EndMs = Annotated[int, Strict(), Field(le=MAX_SONG_MS)] | None
#: The note's text: 1-1000 characters after trimming, line breaks allowed.
Body = Annotated[str, Text(min_length=1, max_length=BODY_MAX_LENGTH, multiline=True)]
#: A ``note_colors[].key`` from the theme options.
NoteColor = Annotated[str, AfterValidator(_known_note_color)]


class AnnotationCreateIn(ApiModel):
    """``POST /api/entries/<entry_id>/annotations``."""

    start_ms: StartMs
    end_ms: EndMs = None
    body: Body
    color: NoteColor = DEFAULT_NOTE_COLOR

    @field_validator("end_ms")
    @classmethod
    def _end_after_start(cls, value: int | None, info: ValidationInfo) -> int | None:
        start_ms = info.data.get("start_ms")  # Absent when start_ms itself is invalid.
        if value is not None and start_ms is not None and value <= start_ms:
            raise PydanticCustomError("end_not_after_start", END_NOT_AFTER_START_MESSAGE)
        return value


class AnnotationPatchIn(ApiModel):
    """``PATCH /api/entries/<entry_id>/annotations/<id>``.

    Omitted fields stay ``MISSING`` and are left out of ``model_dump()``; ``end_ms`` alone
    accepts ``null``, which turns a range into a point.
    """

    start_ms: StartMs | MISSING = MISSING
    end_ms: EndMs | MISSING = MISSING
    body: Body | MISSING = MISSING
    color: NoteColor | MISSING = MISSING


class AnnotationOut(ResponseModel):
    """The ``Annotation`` resource."""

    id: int
    entry_id: int
    start_ms: int
    end_ms: int | None
    body: str
    color: str
    created_at: UtcDateTime
    updated_at: UtcDateTime


class AnnotationResponse(ResponseModel):
    """``{"annotation": Annotation}``."""

    annotation: AnnotationOut


class AnnotationListResponse(ResponseModel):
    """``{"annotations": [Annotation, ...]}``, sorted by ``start_ms`` then ``id``."""

    annotations: list[AnnotationOut]
