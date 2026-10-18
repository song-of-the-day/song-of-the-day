"""Request parsing and response helpers shared by the API blueprints.

* :func:`enforce_body_policy` (a ``before_request`` hook) rejects unsafe requests whose
  body isn't JSON with ``415`` and applies per-view body limits. Views that take another
  content type, such as the multipart upload, declare it with :func:`accepts`.
* :func:`parse_body` decodes a JSON object and validates it with a Pydantic model,
  mapping failures to ``400 invalid_json`` or ``422 validation_error``.
* :func:`json_response` serializes a model or mapping; :func:`apply_api_headers` (an
  ``after_request`` hook) adds the API's caching and hardening headers.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Final, NoReturn

from flask import Response, current_app, jsonify, request
from pydantic import BaseModel, ValidationError
from pydantic_core import ErrorDetails
from werkzeug.exceptions import RequestEntityTooLarge

from sotd.errors import ApiError, validation_error
from sotd.services import sessions

JSON_MIMETYPE: Final = "application/json"
UNSAFE_METHODS: Final = frozenset({"POST", "PUT", "PATCH", "DELETE"})
#: ``fields`` key used for errors that concern the body as a whole.
ROOT_FIELD: Final = "__root__"

_POLICY_ATTRIBUTE: Final = "_sotd_body_policy"


@dataclass(frozen=True, slots=True)
class BodyPolicy:
    """What a view accepts as a request body.

    Attributes:
        mimetype: The only accepted content type for unsafe methods with a body.
        max_content_length: Body limit in bytes for this view, replacing
            ``MAX_CONTENT_LENGTH``; ``None`` keeps the app-wide limit.
    """

    mimetype: str
    max_content_length: int | None = None


def accepts[ViewT: Callable[..., Any]](
    mimetype: str, *, max_content_length: int | None = None
) -> Callable[[ViewT], ViewT]:
    """Declare that a view takes ``mimetype`` bodies instead of JSON.

    The policy is applied by :func:`enforce_body_policy` before CSRF validation or the
    view touch the body, so a raised ``max_content_length`` takes effect in time. Place
    it directly under the route decorator.

    Args:
        mimetype: The accepted content type, e.g. ``"multipart/form-data"``.
        max_content_length: The body limit for this view, in bytes.
    """
    policy = BodyPolicy(mimetype=mimetype, max_content_length=max_content_length)

    def decorator(view: ViewT) -> ViewT:
        setattr(view, _POLICY_ATTRIBUTE, policy)
        return view

    return decorator


def _policy_for(view: Callable[..., Any]) -> BodyPolicy | None:
    current: object = view
    while current is not None:
        policy = getattr(current, _POLICY_ATTRIBUTE, None)
        if isinstance(policy, BodyPolicy):
            return policy
        current = getattr(current, "__wrapped__", None)
    return None


def _has_body() -> bool:
    if request.content_length:
        return True
    return "chunked" in request.headers.get("Transfer-Encoding", "").lower()


def _require_mimetype(expected: str) -> None:
    if request.mimetype != expected:
        raise ApiError(415, "unsupported_media_type", f"Content type must be {expected}.")


def enforce_body_policy() -> None:
    """Apply the matched view's body policy (``before_request`` hook).

    Must run before ``CSRFProtect``'s hook, which may parse form bodies. Requests that
    matched no route are left alone; they fail with 404/405 afterwards.

    Raises:
        RequestEntityTooLarge: The declared ``Content-Length`` exceeds the limit.
        ApiError: ``415`` when an unsafe request has a body of the wrong type.
    """
    endpoint = request.endpoint
    view = current_app.view_functions.get(endpoint) if endpoint else None
    if view is None:
        return
    policy = _policy_for(view)
    if policy is not None and policy.max_content_length is not None:
        request.max_content_length = policy.max_content_length
    limit = request.max_content_length
    if limit is not None and request.content_length is not None and request.content_length > limit:
        raise RequestEntityTooLarge
    if request.method in UNSAFE_METHODS and _has_body():
        _require_mimetype(policy.mimetype if policy is not None else JSON_MIMETYPE)


def parse_body[ModelT: BaseModel](model: type[ModelT]) -> ModelT:
    """Parse the JSON request body and validate it with ``model``.

    An empty body is validated as ``{}``, so it is accepted when no field is required.

    Args:
        model: The Pydantic model describing the body.

    Returns:
        The validated model instance.

    Raises:
        ApiError: ``415`` for a non-JSON body, ``400 invalid_json`` for malformed JSON or
            a body that isn't an object, ``422 validation_error`` with per-field messages.
        RequestEntityTooLarge: The body exceeds the request's size limit.
    """
    raw = _read_body()
    data: object = {}
    if raw:
        _require_mimetype(JSON_MIMETYPE)
        data = _decode_json(raw)
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_json", "The request body must be a JSON object.")
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise validation_error_from(exc) from None


def _read_body() -> bytes:
    raw = request.get_data(cache=True)
    limit = request.max_content_length
    # Werkzeug stops reading a body without a declared length (chunked) at the limit
    # instead of failing, so a body that reaches the limit may have been cut off.
    if request.content_length is None and limit is not None and len(raw) >= limit:
        raise RequestEntityTooLarge
    return raw


def _decode_json(raw: bytes) -> object:
    try:
        return json.loads(raw.decode("utf-8"), parse_constant=_reject_json_constant)
    except (ValueError, RecursionError):  # Includes UnicodeDecodeError and JSONDecodeError.
        raise ApiError(400, "invalid_json", "The request body is not valid JSON.") from None


def _reject_json_constant(name: str) -> NoReturn:
    raise ValueError(f"{name} is not valid JSON")


def validation_error_from(exc: ValidationError) -> ApiError:
    """Convert a Pydantic ``ValidationError`` into ``422 validation_error``.

    Each failing location becomes a dotted path (``theme.colors.text``) with one
    human-friendly message; errors on the body as a whole use :data:`ROOT_FIELD`.
    """
    fields: dict[str, str] = {}
    for error in exc.errors(include_url=False):
        path = ".".join(str(part) for part in error["loc"]) or ROOT_FIELD
        fields.setdefault(path, field_error_message(error))
    return validation_error(fields)


_TYPE_MESSAGES: Final[Mapping[str, str]] = {
    "missing": "This field is required.",
    "extra_forbidden": "Unknown field.",
    "string_type": "Must be a string.",
    "string_pattern_mismatch": "Has an invalid format.",
    "int_type": "Must be an integer.",
    "int_parsing": "Must be an integer.",
    "int_from_float": "Must be an integer.",
    "bool_type": "Must be true or false.",
    "bool_parsing": "Must be true or false.",
    "date_type": "Must be a date in YYYY-MM-DD format.",
    "date_parsing": "Must be a date in YYYY-MM-DD format.",
    "date_from_datetime_parsing": "Must be a date in YYYY-MM-DD format.",
    "date_from_datetime_inexact": "Must be a date in YYYY-MM-DD format.",
    "uuid_type": "Must be a valid UUID.",
    "uuid_parsing": "Must be a valid UUID.",
    "model_type": "Must be an object.",
    "model_attributes_type": "Must be an object.",
    "dict_type": "Must be an object.",
    "list_type": "Must be a list.",
}

_BOUND_MESSAGES: Final[Mapping[str, tuple[str, str]]] = {
    "greater_than_equal": ("ge", "Must be at least {}."),
    "greater_than": ("gt", "Must be greater than {}."),
    "less_than_equal": ("le", "Must be at most {}."),
    "less_than": ("lt", "Must be less than {}."),
    "string_too_long": ("max_length", "Must be at most {} characters."),
}


def field_error_message(error: ErrorDetails) -> str:
    """Return a user-facing message for one Pydantic error."""
    error_type = error["type"]
    ctx = error.get("ctx") or {}
    if error_type.endswith("_type") and error.get("input", ...) is None:
        return "Cannot be null."
    if error_type in _TYPE_MESSAGES:
        return _TYPE_MESSAGES[error_type]
    if error_type in _BOUND_MESSAGES:
        key, template = _BOUND_MESSAGES[error_type]
        return template.format(ctx[key])
    if error_type == "string_too_short":
        minimum = ctx["min_length"]
        return "Must not be blank." if minimum == 1 else f"Must be at least {minimum} characters."
    if error_type in ("literal_error", "enum"):
        return f"Must be one of: {ctx['expected']}."
    if error_type in ("value_error", "assertion_error"):
        return _sentence(str(ctx["error"]))
    return _sentence(error["msg"])


def _sentence(message: str) -> str:
    message = message.strip()
    if not message:
        return "Is invalid."
    message = message[0].upper() + message[1:]
    return message if message.endswith((".", "!", "?")) else f"{message}."


def json_response(body: BaseModel | Mapping[str, Any], status: int = 200) -> Response:
    """Return a JSON response for a Pydantic model (JSON mode) or a plain mapping."""
    payload = body.model_dump(mode="json") if isinstance(body, BaseModel) else body
    response = jsonify(payload)
    response.status_code = status
    return response


def parse_query[ModelT: BaseModel](model: type[ModelT]) -> ModelT:
    """Validate the query string with ``model``.

    A parameter given once arrives as a string, a repeated one as a list of strings
    (which the field types reject).

    Raises:
        ApiError: ``422 validation_error`` with per-parameter messages.
    """
    params = {
        name: values[0] if len(values) == 1 else values for name, values in request.args.lists()
    }
    try:
        return model.model_validate(params)
    except ValidationError as exc:
        raise validation_error_from(exc) from None


def user_rate_limit_key() -> str:
    """Rate-limit key of the logged-in user.

    Limits run inside ``login_required`` (decorator order), so a user is always present;
    the fallback only guarantees that a key function never raises.
    """
    try:
        return f"user:{sessions.current_account().id}"
    except ApiError:
        return "user:anonymous"


def apply_api_headers(response: Response) -> Response:
    """Add the API's response headers (``after_request`` hook).

    ``Cache-Control: no-store`` is the default; views that need caching (such as image
    downloads) set their own header, which is kept.
    """
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response
