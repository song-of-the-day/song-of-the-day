"""Test clients and helpers for authenticated requests."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Final

from flask import Flask
from flask.testing import FlaskClient
from werkzeug.datastructures import Headers
from werkzeug.test import TestResponse

from sotd.api.utils import UNSAFE_METHODS
from tests.factories import DEFAULT_PASSWORD

CSRF_HEADER: Final = "X-CSRFToken"
CSRF_URL: Final = "/api/auth/csrf"
SESSION_COOKIE: Final = "sotd_session"
REMEMBER_COOKIE: Final = "sotd_remember"


@dataclass(frozen=True)
class SetCookie:
    """One parsed ``Set-Cookie`` header; attribute names are lower-cased."""

    name: str
    value: str
    attributes: dict[str, str] = field(default_factory=dict)

    @property
    def deletes(self) -> bool:
        """Whether the header deletes the cookie."""
        return self.attributes.get("max-age") == "0"


def set_cookies(response: TestResponse) -> dict[str, SetCookie]:
    """Return the response's ``Set-Cookie`` headers by cookie name."""
    cookies: dict[str, SetCookie] = {}
    for header in response.headers.getlist("Set-Cookie"):
        pair, *parts = header.split("; ")
        name, _, value = pair.partition("=")
        attributes: dict[str, str] = {}
        for part in parts:
            key, _, attribute_value = part.partition("=")
            attributes[key.lower()] = attribute_value
        cookies[name] = SetCookie(name, value, attributes)
    return cookies


def cookie_value(client: FlaskClient, name: str) -> str:
    """Return the value of a cookie the client holds (it must exist)."""
    cookie = client.get_cookie(name)
    assert cookie is not None, f"no {name} cookie"
    return cookie.value


def error_code(response: TestResponse) -> str:
    """Return ``error.code`` of a JSON error response."""
    code: str = response.get_json()["error"]["code"]
    return code


def csrf_token(client: FlaskClient, **kwargs: Any) -> str:
    """Fetch the client's current CSRF token (it rotates on login, signup and logout)."""
    response = client.get(CSRF_URL, **kwargs)
    assert response.status_code == 200
    token: str = response.get_json()["csrf_token"]
    return token


class CsrfClient(FlaskClient):
    """A test client whose unsafe requests carry a fresh ``X-CSRFToken`` header.

    The token is fetched right before each unsafe request unless the caller passes the
    header, so rotation after login or logout is handled automatically.
    """

    def open(
        self,
        *args: Any,
        buffered: bool = False,
        follow_redirects: bool = False,
        **kwargs: Any,
    ) -> TestResponse:
        method = str(kwargs.get("method", "GET")).upper()
        if method in UNSAFE_METHODS:
            headers = Headers(kwargs.pop("headers", None))
            if CSRF_HEADER not in headers:
                headers[CSRF_HEADER] = csrf_token(self)
            kwargs["headers"] = headers
        return super().open(*args, buffered=buffered, follow_redirects=follow_redirects, **kwargs)


def csrf_client(app: Flask) -> CsrfClient:
    """Return a new, anonymous :class:`CsrfClient` for ``app``."""
    return CsrfClient(app, app.response_class, use_cookies=True)


def log_in(
    client: FlaskClient,
    email: str,
    password: str = DEFAULT_PASSWORD,
    *,
    remember: bool = True,
) -> TestResponse:
    """Log ``client`` in through the API and assert that it worked."""
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password, "remember": remember},
        headers={CSRF_HEADER: csrf_token(client)},
    )
    assert response.status_code == 200, response.get_json()
    return response
