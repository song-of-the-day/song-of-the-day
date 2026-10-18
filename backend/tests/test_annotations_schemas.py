"""Validation of the annotation request bodies."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from sotd.api.utils import validation_error_from
from sotd.schemas.annotation import AnnotationCreateIn, AnnotationPatchIn
from sotd.theme import get_theme_options

REQUIRED: dict[str, Any] = {"start_ms": 150_000, "body": "the build"}
NOT_AN_INTEGER = "Must be an integer."
COLOR_MESSAGE = "Must be one of: blue, green, pink, purple, yellow."
END_MESSAGE = "Must be greater than start_ms."


def errors(model: type[BaseModel], data: dict[str, Any]) -> dict[str, str]:
    with pytest.raises(ValidationError) as excinfo:
        model.model_validate(data)
    return validation_error_from(excinfo.value).fields or {}


def create(**fields: Any) -> AnnotationCreateIn:
    return AnnotationCreateIn.model_validate({**REQUIRED, **fields})


def create_errors(**fields: Any) -> dict[str, str]:
    return errors(AnnotationCreateIn, {**REQUIRED, **fields})


# --- Create -----------------------------------------------------------------------------


def test_a_point_note_gets_the_defaults() -> None:
    assert create().model_dump() == {
        "start_ms": 150_000,
        "end_ms": None,
        "body": "the build",
        "color": "yellow",
    }


def test_a_range_note_is_trimmed() -> None:
    note = create(end_ms=171_500, body="  the build\nand the drop  ", color="pink")
    assert note.model_dump() == {
        "start_ms": 150_000,
        "end_ms": 171_500,
        "body": "the build\nand the drop",
        "color": "pink",
    }


def test_required_fields() -> None:
    assert errors(AnnotationCreateIn, {}) == {
        "start_ms": "This field is required.",
        "body": "This field is required.",
    }


@pytest.mark.parametrize("field", ["start_ms", "body", "color"])
def test_fields_other_than_end_ms_cannot_be_null(field: str) -> None:
    assert create_errors(**{field: None}) == {field: "Cannot be null."}


@pytest.mark.parametrize("field", ["id", "entry_id", "created_at", "updated_at"])
def test_unknown_and_server_owned_fields_are_rejected(field: str) -> None:
    assert create_errors(**{field: 1}) == {field: "Unknown field."}


@pytest.mark.parametrize("value", [0, 1, 86_400_000])
def test_start_ms_in_range_is_accepted(value: int) -> None:
    assert create(start_ms=value).start_ms == value


@pytest.mark.parametrize(
    ("value", "message"),
    [
        (-1, "Must be at least 0."),
        (86_400_001, "Must be at most 86400000."),
        ("150000", NOT_AN_INTEGER),
        (150_000.0, NOT_AN_INTEGER),
        (1.5, NOT_AN_INTEGER),
        (True, NOT_AN_INTEGER),
    ],
)
def test_start_ms_must_be_an_integer_in_range(value: object, message: str) -> None:
    assert create_errors(start_ms=value) == {"start_ms": message}


@pytest.mark.parametrize(("start_ms", "end_ms"), [(0, 1), (150_000, 150_001), (0, 86_400_000)])
def test_ranges_that_end_after_they_start_are_accepted(start_ms: int, end_ms: int) -> None:
    assert create(start_ms=start_ms, end_ms=end_ms).end_ms == end_ms


@pytest.mark.parametrize(
    ("end_ms", "message"),
    [
        (150_000, END_MESSAGE),
        (149_999, END_MESSAGE),
        (-5, END_MESSAGE),
        (86_400_001, "Must be at most 86400000."),
        ("171500", NOT_AN_INTEGER),
        (171_500.0, NOT_AN_INTEGER),
        (False, NOT_AN_INTEGER),
    ],
)
def test_invalid_end_ms_is_rejected(end_ms: object, message: str) -> None:
    assert create_errors(end_ms=end_ms) == {"end_ms": message}


def test_a_range_error_is_reported_with_the_other_field_errors() -> None:
    assert errors(AnnotationCreateIn, {"start_ms": 2000, "end_ms": 1000, "body": " "}) == {
        "end_ms": END_MESSAGE,
        "body": "Must not be blank.",
    }


def test_end_ms_is_not_compared_with_an_invalid_start_ms() -> None:
    assert create_errors(start_ms="soon", end_ms=1000) == {"start_ms": NOT_AN_INTEGER}


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("", "Must not be blank."),
        (" \n\t ", "Must not be blank."),
        ("x" * 1001, "Must be at most 1000 characters."),
        ("a\x00b", "Contains characters that aren't allowed."),
        ("a\x1bb", "Contains characters that aren't allowed."),
        ("a\x85b", "Contains characters that aren't allowed."),
        (7, "Must be a string."),
    ],
)
def test_body_rules(value: object, message: str) -> None:
    assert create_errors(body=value) == {"body": message}


def test_the_body_may_hold_the_maximum_and_span_lines() -> None:
    assert create(body="x" * 1000).body == "x" * 1000
    assert create(body="one\r\ntwo\tthree").body == "one\r\ntwo\tthree"


def test_every_note_color_from_the_options_is_accepted() -> None:
    colors = get_theme_options().note_colors
    assert colors == {"yellow", "pink", "blue", "green", "purple"}
    for color in colors:
        assert create(color=color).color == color


@pytest.mark.parametrize("value", ["orange", "Yellow", "#FFF3A3", ""])
def test_unknown_colors_are_rejected(value: str) -> None:
    assert create_errors(color=value) == {"color": COLOR_MESSAGE}


# --- Patch ------------------------------------------------------------------------------


def test_an_empty_patch_changes_nothing() -> None:
    assert AnnotationPatchIn.model_validate({}).model_dump() == {}


def test_a_patch_holds_only_the_fields_sent() -> None:
    patch = AnnotationPatchIn.model_validate({"body": " the drop ", "color": "blue"})
    assert patch.model_dump() == {"body": "the drop", "color": "blue"}


def test_a_patch_turns_a_range_into_a_point_with_null() -> None:
    assert AnnotationPatchIn.model_validate({"end_ms": None}).model_dump() == {"end_ms": None}


@pytest.mark.parametrize("field", ["start_ms", "body", "color"])
def test_a_patch_cannot_null_other_fields(field: str) -> None:
    assert errors(AnnotationPatchIn, {field: None}) == {field: "Cannot be null."}


def test_a_patch_does_not_default_the_color() -> None:
    assert "color" not in AnnotationPatchIn.model_validate({"body": "x"}).model_dump()


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        ({"start_ms": -1}, {"start_ms": "Must be at least 0."}),
        ({"start_ms": "1"}, {"start_ms": NOT_AN_INTEGER}),
        ({"end_ms": 86_400_001}, {"end_ms": "Must be at most 86400000."}),
        ({"body": ""}, {"body": "Must not be blank."}),
        ({"color": "orange"}, {"color": COLOR_MESSAGE}),
        ({"entry_id": 2}, {"entry_id": "Unknown field."}),
    ],
)
def test_a_patch_applies_the_field_rules(data: dict[str, Any], expected: dict[str, str]) -> None:
    assert errors(AnnotationPatchIn, data) == expected
