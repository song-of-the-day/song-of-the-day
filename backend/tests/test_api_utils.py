from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

import pytest
from flask import Flask
from pydantic import Field, ValidationError, field_validator
from pydantic_core import ErrorDetails

from sotd.api.utils import ROOT_FIELD, field_error_message, json_response, validation_error_from
from sotd.schemas.common import ApiModel, ResponseModel


class Sample(ApiModel):
    count: Annotated[int, Field(ge=1, le=10)] = 1
    ratio: Annotated[int, Field(gt=0, lt=5)] = 1
    kind: Literal["itunes", "manual"] = "manual"
    day: date | None = None
    flag: bool = False
    tags: list[str] = Field(default_factory=list)
    code: Annotated[str, Field(pattern=r"^[a-z]+$")] = "abc"
    odd: int = 1

    @field_validator("odd")
    @classmethod
    def _must_be_odd(cls, value: int) -> int:
        if value % 2 == 0:
            raise ValueError("must be odd")
        return value


def messages(data: object) -> dict[str, str]:
    with pytest.raises(ValidationError) as excinfo:
        Sample.model_validate(data)
    error = validation_error_from(excinfo.value)
    assert error.status == 422
    assert error.code == "validation_error"
    return error.fields or {}


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        ({"count": 0}, {"count": "Must be at least 1."}),
        ({"count": 11}, {"count": "Must be at most 10."}),
        ({"ratio": 0}, {"ratio": "Must be greater than 0."}),
        ({"ratio": 5}, {"ratio": "Must be less than 5."}),
        ({"count": "many"}, {"count": "Must be an integer."}),
        ({"count": 1.5}, {"count": "Must be an integer."}),
        ({"count": None}, {"count": "Cannot be null."}),
        ({"kind": "spotify"}, {"kind": "Must be one of: 'itunes' or 'manual'."}),
        ({"day": "11/10/2026"}, {"day": "Must be a date in YYYY-MM-DD format."}),
        ({"flag": "perhaps"}, {"flag": "Must be true or false."}),
        ({"tags": "a,b"}, {"tags": "Must be a list."}),
        ({"tags": ["a", 2]}, {"tags.1": "Must be a string."}),
        ({"code": "ABC"}, {"code": "Has an invalid format."}),
        ({"odd": 2}, {"odd": "Must be odd."}),
    ],
)
def test_field_messages(data: dict[str, object], expected: dict[str, str]) -> None:
    assert messages(data) == expected


def test_a_non_object_body_is_reported_on_the_root() -> None:
    with pytest.raises(ValidationError) as excinfo:
        Sample.model_validate(["not", "an", "object"])
    assert validation_error_from(excinfo.value).fields == {ROOT_FIELD: "Must be an object."}


def error(type_: str, msg: str, **ctx: object) -> ErrorDetails:
    return ErrorDetails(type=type_, loc=("x",), msg=msg, input="v", ctx=ctx)


@pytest.mark.parametrize(
    ("details", "expected"),
    [
        (error("assertion_error", "Assertion failed", error="values differ"), "Values differ."),
        (error("enum", "bad", expected="'a' or 'b'"), "Must be one of: 'a' or 'b'."),
        (error("string_too_short", "short", min_length=3), "Must be at least 3 characters."),
        (error("custom_rule", "already a sentence!"), "Already a sentence!"),
        (error("custom_rule", "no period"), "No period."),
        (error("custom_rule", "   "), "Is invalid."),
    ],
)
def test_field_error_message_fallbacks(details: ErrorDetails, expected: str) -> None:
    assert field_error_message(details) == expected


def test_json_response_serializes_models_and_mappings(app: Flask) -> None:
    class Out(ResponseModel):
        day: date

    with app.test_request_context():
        from_model = json_response(Out(day=date(2026, 10, 11)), status=201)
        from_mapping = json_response({"ok": True})
    assert from_model.status_code == 201
    assert from_model.get_json() == {"day": "2026-10-11"}
    assert from_mapping.status_code == 200
    assert from_mapping.get_json() == {"ok": True}
