from __future__ import annotations

import io
import json
import logging
from collections.abc import Iterator
from typing import Annotated, Any, NoReturn

import pytest
from flask import Blueprint, Flask, Response, abort, request
from flask.testing import FlaskClient
from flask_wtf.csrf import generate_csrf
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import HTTPException
from werkzeug.test import encode_multipart

from sotd.api.utils import accepts, json_response, parse_body
from sotd.errors import ApiError
from sotd.extensions import csrf, limiter
from sotd.schemas.common import ApiModel, Text
from tests.support import AppFactory

KIB = 1024


class InnerIn(ApiModel):
    color: Annotated[str, Text(max_length=7)]


class EchoIn(ApiModel):
    name: Annotated[str, Text(min_length=1, max_length=20)]
    inner: InnerIn | None = None


class _UnknownStatus(HTTPException):
    code = 599
    description = "Unknown status."


open_bp = Blueprint("test_open", __name__, url_prefix="/api/_test")
csrf.exempt(open_bp)


@open_bp.post("/echo")
def echo() -> Response:
    return json_response(parse_body(EchoIn))


@open_bp.get("/boom")
def boom() -> NoReturn:
    raise RuntimeError("database password is hunter2")


@open_bp.get("/abort-500")
def abort_500() -> NoReturn:
    abort(500)


@open_bp.get("/conflict")
def conflict() -> NoReturn:
    raise ApiError(
        409, "entry_exists", "You already logged a song for that day.", existing_entry_id=42
    )


@open_bp.get("/teapot")
def teapot() -> NoReturn:
    abort(418)


@open_bp.get("/unknown-status")
def unknown_status() -> NoReturn:
    raise _UnknownStatus


@open_bp.delete("/thing")
def delete_thing() -> Response:
    return Response(status=204)


@open_bp.get("/limited")
@limiter.limit("2/minute")
def limited() -> Response:
    return json_response({"ok": True})


protected_bp = Blueprint("test_protected", __name__, url_prefix="/api/_test/protected")


@protected_bp.get("/csrf")
def csrf_token() -> Response:
    return json_response({"csrf_token": generate_csrf()})


@protected_bp.post("/echo")
def protected_echo() -> Response:
    return json_response(parse_body(EchoIn))


@protected_bp.post("/upload")
@accepts("multipart/form-data", max_content_length=1024 * KIB)
def upload() -> Response:
    return json_response({"size": len(request.files["file"].read())})


@pytest.fixture(scope="module")
def error_app(app_factory: AppFactory) -> Iterator[Flask]:
    with app_factory(RATE_LIMITS_ENABLED=True) as test_app:
        test_app.register_blueprint(open_bp)
        test_app.register_blueprint(protected_bp)
        yield test_app


@pytest.fixture
def test_client(error_app: Flask) -> FlaskClient:
    return error_app.test_client()


def error_of(response: Any) -> dict[str, Any]:
    body = response.get_json()
    assert set(body) == {"error"}
    error: dict[str, Any] = body["error"]
    return error


def assert_api_headers(response: Any) -> None:
    assert response.mimetype == "application/json"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-Request-ID"]


def multipart_file(size: int) -> dict[str, Any]:
    """Return ``post()`` arguments for a multipart body holding a ``size``-byte file.

    The body is encoded up front so the test client sends it from memory; letting the
    client encode large files spools them to temporary files it never closes.
    """
    file = FileStorage(io.BytesIO(b"x" * size), filename="photo.jpg", content_type="image/jpeg")
    boundary, body = encode_multipart({"file": file})
    return {"data": body, "content_type": f"multipart/form-data; boundary={boundary}"}


def csrf_headers(client: FlaskClient) -> dict[str, str]:
    token = client.get("/api/_test/protected/csrf").get_json()["csrf_token"]
    return {"X-CSRFToken": token}


# --- Routing errors ------------------------------------------------------------------


def test_unknown_api_route_is_json_404(client: FlaskClient) -> None:
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert error_of(response) == {"code": "not_found", "message": "Not found."}
    assert_api_headers(response)


def test_unknown_route_outside_api_is_json_404(client: FlaskClient) -> None:
    response = client.get("/nope")
    assert response.status_code == 404
    assert error_of(response)["code"] == "not_found"


def test_method_not_allowed(client: FlaskClient) -> None:
    response = client.post("/api/health", json={})
    assert response.status_code == 405
    assert error_of(response) == {"code": "method_not_allowed", "message": "Method not allowed."}
    assert "GET" in response.headers["Allow"]
    assert_api_headers(response)


def test_other_http_errors_get_codes_from_their_status(test_client: FlaskClient) -> None:
    response = test_client.get("/api/_test/teapot")
    assert response.status_code == 418
    error = error_of(response)
    assert error["code"] == "im_a_teapot"
    assert error["message"].endswith(".")


def test_nonstandard_status_gets_generic_code(test_client: FlaskClient) -> None:
    response = test_client.get("/api/_test/unknown-status")
    assert response.status_code == 599
    assert error_of(response) == {"code": "http_error", "message": "The request failed."}


# --- Application errors -----------------------------------------------------------------


def test_api_error_carries_extra_details(test_client: FlaskClient) -> None:
    response = test_client.get("/api/_test/conflict")
    assert response.status_code == 409
    assert error_of(response) == {
        "code": "entry_exists",
        "message": "You already logged a song for that day.",
        "existing_entry_id": 42,
    }
    assert_api_headers(response)


def test_unexpected_exception_is_500_with_request_id(
    test_client: FlaskClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR):
        response = test_client.get("/api/_test/boom", headers={"X-Request-ID": "trace-123"})
    assert response.status_code == 500
    assert error_of(response) == {
        "code": "internal_error",
        "message": "Something went wrong. Please try again.",
        "request_id": "trace-123",
    }
    assert response.headers["X-Request-ID"] == "trace-123"
    assert "hunter2" not in response.get_data(as_text=True)
    assert_api_headers(response)
    errors = [record for record in caplog.records if record.levelno >= logging.ERROR]
    assert len(errors) == 1
    assert errors[0].name == "sotd.errors"
    assert errors[0].exc_info is not None
    assert isinstance(errors[0].exc_info[1], RuntimeError)


def test_generated_request_id_is_returned_in_500_body(test_client: FlaskClient) -> None:
    response = test_client.get("/api/_test/boom")
    assert error_of(response)["request_id"] == response.headers["X-Request-ID"]


def test_abort_500_is_internal_error(
    test_client: FlaskClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR):
        response = test_client.get("/api/_test/abort-500")
    assert response.status_code == 500
    assert error_of(response)["code"] == "internal_error"
    assert len([r for r in caplog.records if r.levelno >= logging.ERROR]) == 1


# --- Request bodies -----------------------------------------------------------------------


def test_valid_json_body(test_client: FlaskClient) -> None:
    response = test_client.post("/api/_test/echo", json={"name": "  Ada  "})
    assert response.status_code == 200
    assert response.get_json() == {"name": "Ada", "inner": None}
    assert_api_headers(response)


def test_json_with_charset_is_accepted(test_client: FlaskClient) -> None:
    response = test_client.post(
        "/api/_test/echo", data=b'{"name": "Ada"}', content_type="application/json; charset=utf-8"
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "body",
    [b"{not json", b'{"name": "Ada"', b'{"name": NaN}', b'{"name": Infinity}', b"\xff\xfe"],
)
def test_invalid_json(test_client: FlaskClient, body: bytes) -> None:
    response = test_client.post("/api/_test/echo", data=body, content_type="application/json")
    assert response.status_code == 400
    assert error_of(response) == {
        "code": "invalid_json",
        "message": "The request body is not valid JSON.",
    }


def test_invalid_utf8_is_invalid_json(test_client: FlaskClient) -> None:
    response = test_client.post(
        "/api/_test/echo", data=b'{"name": "\xff"}', content_type="application/json"
    )
    assert response.status_code == 400
    assert error_of(response)["code"] == "invalid_json"


def test_deeply_nested_json_is_invalid(test_client: FlaskClient) -> None:
    depth = 100_000
    body = b"[" * depth + b"]" * depth
    response = test_client.post("/api/_test/echo", data=body, content_type="application/json")
    assert response.status_code == 400
    assert error_of(response)["code"] == "invalid_json"


@pytest.mark.parametrize("body", ["[]", '["name"]', '"Ada"', "1", "null", "true"])
def test_json_that_is_not_an_object(test_client: FlaskClient, body: str) -> None:
    response = test_client.post("/api/_test/echo", data=body, content_type="application/json")
    assert response.status_code == 400
    assert error_of(response) == {
        "code": "invalid_json",
        "message": "The request body must be a JSON object.",
    }


def test_empty_body_is_an_empty_object(test_client: FlaskClient) -> None:
    response = test_client.post("/api/_test/echo")
    assert response.status_code == 422
    assert error_of(response)["fields"] == {"name": "This field is required."}


def test_validation_errors_use_dotted_paths(test_client: FlaskClient) -> None:
    response = test_client.post(
        "/api/_test/echo",
        json={"name": "   ", "inner": {"color": "#123456789", "shade": 1}, "extra": True},
    )
    assert response.status_code == 422
    assert error_of(response) == {
        "code": "validation_error",
        "message": "Some fields are invalid.",
        "fields": {
            "name": "Must not be blank.",
            "inner.color": "Must be at most 7 characters.",
            "inner.shade": "Unknown field.",
            "extra": "Unknown field.",
        },
    }


@pytest.mark.parametrize(
    ("data", "content_type"),
    [
        (b"name=Ada", "application/x-www-form-urlencoded"),
        (b'{"name": "Ada"}', "text/plain"),
        (b'{"name": "Ada"}', "application/vnd.api+json"),
        (b'{"name": "Ada"}', None),
    ],
)
def test_non_json_body_is_415(
    test_client: FlaskClient, data: bytes, content_type: str | None
) -> None:
    response = test_client.post("/api/_test/echo", data=data, content_type=content_type)
    assert response.status_code == 415
    assert error_of(response) == {
        "code": "unsupported_media_type",
        "message": "Content type must be application/json.",
    }


def test_multipart_body_to_json_endpoint_is_415(test_client: FlaskClient) -> None:
    response = test_client.post("/api/_test/echo", **multipart_file(10 * KIB))
    assert response.status_code == 415


def test_oversized_body_is_413_before_the_content_type_check(test_client: FlaskClient) -> None:
    response = test_client.post("/api/_test/echo", **multipart_file(300 * KIB))
    assert response.status_code == 413


def test_415_applies_to_views_that_ignore_the_body(test_client: FlaskClient) -> None:
    response = test_client.delete("/api/_test/thing", data=b"x", content_type="text/plain")
    assert response.status_code == 415
    assert test_client.delete("/api/_test/thing").status_code == 204


def test_json_body_over_256_kib_is_413(test_client: FlaskClient) -> None:
    body = json.dumps({"name": "x" * (256 * KIB)})
    response = test_client.post("/api/_test/echo", data=body, content_type="application/json")
    assert response.status_code == 413
    assert error_of(response) == {
        "code": "payload_too_large",
        "message": "The request body is too large.",
    }
    assert_api_headers(response)


def post_chunked(test_client: FlaskClient, body: bytes) -> Any:
    return test_client.post(
        "/api/_test/echo",
        input_stream=io.BytesIO(body),
        content_type="application/json",
        headers={"Transfer-Encoding": "chunked"},
        environ_overrides={"wsgi.input_terminated": True},
    )


def test_chunked_json_body_over_256_kib_is_413(test_client: FlaskClient) -> None:
    # Werkzeug cuts a body without a Content-Length off at the limit; it must not be
    # parsed as (truncated) JSON.
    response = post_chunked(test_client, json.dumps({"name": "x" * (256 * KIB)}).encode())
    assert response.status_code == 413
    assert error_of(response)["code"] == "payload_too_large"


def test_chunked_json_body_under_the_limit_is_read(test_client: FlaskClient) -> None:
    response = post_chunked(test_client, b'{"name": "Ada"}')
    assert response.status_code == 200
    assert response.get_json() == {"name": "Ada", "inner": None}


def test_json_body_at_the_limit_is_read(test_client: FlaskClient) -> None:
    padding = 256 * KIB - len(b'{"name": ""}')
    body = '{"name": "' + "x" * padding + '"}'
    response = test_client.post("/api/_test/echo", data=body, content_type="application/json")
    assert response.status_code == 422
    assert error_of(response)["fields"] == {"name": "Must be at most 20 characters."}


# --- CSRF ----------------------------------------------------------------------------------


def test_missing_csrf_token_is_json_403(test_client: FlaskClient) -> None:
    response = test_client.post("/api/_test/protected/echo", json={"name": "Ada"})
    assert response.status_code == 403
    assert error_of(response)["code"] == "csrf_failed"
    assert_api_headers(response)


def test_invalid_csrf_token_is_json_403(test_client: FlaskClient) -> None:
    test_client.get("/api/_test/protected/csrf")
    response = test_client.post(
        "/api/_test/protected/echo", json={"name": "Ada"}, headers={"X-CSRFToken": "forged"}
    )
    assert response.status_code == 403
    assert error_of(response)["code"] == "csrf_failed"


def test_valid_csrf_token_is_accepted(test_client: FlaskClient) -> None:
    response = test_client.post(
        "/api/_test/protected/echo", json={"name": "Ada"}, headers=csrf_headers(test_client)
    )
    assert response.status_code == 200


@pytest.fixture(scope="module")
def proxied_client(app_factory: AppFactory) -> Iterator[FlaskClient]:
    """A client for an app behind one TLS-terminating reverse proxy (like nginx)."""
    with app_factory(TRUSTED_PROXY_COUNT=1) as proxied_app:
        proxied_app.register_blueprint(protected_bp)
        yield proxied_app.test_client()


PROXY_HEADERS = {"X-Forwarded-Proto": "https", "X-Forwarded-Host": "sotd.ca"}


@pytest.mark.parametrize(
    ("referer", "status"),
    [
        ("https://sotd.ca/profile", 200),
        ("https://evil.example/profile", 403),
        ("http://sotd.ca/profile", 403),
        (None, 403),
    ],
)
def test_strict_csrf_referer_check_over_https_behind_a_proxy(
    proxied_client: FlaskClient, referer: str | None, status: int
) -> None:
    token = proxied_client.get("/api/_test/protected/csrf", headers=PROXY_HEADERS).get_json()
    headers = {**PROXY_HEADERS, "X-CSRFToken": token["csrf_token"]}
    if referer is not None:
        headers["Referer"] = referer
    response = proxied_client.post(
        "/api/_test/protected/echo", json={"name": "Ada"}, headers=headers
    )
    assert response.status_code == status
    if status == 403:
        assert error_of(response)["code"] == "csrf_failed"


# --- Per-view body policy ---------------------------------------------------------------------


def test_multipart_view_gets_its_raised_limit_before_csrf_parses_the_form(
    test_client: FlaskClient,
) -> None:
    with test_client.post(
        "/api/_test/protected/upload",
        **multipart_file(600 * KIB),
        headers=csrf_headers(test_client),
    ) as response:
        assert response.status_code == 200
        assert response.get_json() == {"size": 600 * KIB}


def test_multipart_view_enforces_its_own_limit(test_client: FlaskClient) -> None:
    with test_client.post(
        "/api/_test/protected/upload",
        **multipart_file(1100 * KIB),
        headers=csrf_headers(test_client),
    ) as response:
        assert response.status_code == 413
        assert error_of(response)["code"] == "payload_too_large"


def test_multipart_view_rejects_json(test_client: FlaskClient) -> None:
    response = test_client.post(
        "/api/_test/protected/upload", json={"file": "x"}, headers=csrf_headers(test_client)
    )
    assert response.status_code == 415
    assert error_of(response)["message"] == "Content type must be multipart/form-data."


# --- Rate limits ------------------------------------------------------------------------------


def test_rate_limited_is_json_429_with_retry_after(test_client: FlaskClient) -> None:
    assert test_client.get("/api/_test/limited").status_code == 200
    assert test_client.get("/api/_test/limited").status_code == 200
    response = test_client.get("/api/_test/limited")
    assert response.status_code == 429
    assert error_of(response) == {
        "code": "rate_limited",
        "message": "Too many requests. Please try again later.",
    }
    assert 0 < int(response.headers["Retry-After"]) <= 60
    assert_api_headers(response)


def test_rate_limits_do_not_apply_to_apps_that_disable_them(
    error_app: Flask, app_factory: AppFactory
) -> None:
    # Flask-Limiter's state is process-wide and error_app enabled limits; an app with
    # RATE_LIMITS_ENABLED=False must still never be limited.
    with app_factory() as disabled_app:
        disabled_app.register_blueprint(open_bp)
        disabled_client = disabled_app.test_client()
        for _ in range(5):
            assert disabled_client.get("/api/_test/limited").status_code == 200
