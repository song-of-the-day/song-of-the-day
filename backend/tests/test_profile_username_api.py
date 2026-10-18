"""``PATCH /api/profile``: changing the username and the auto-play previews preference."""

from __future__ import annotations

import pytest
from flask import Flask
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from sotd.models import User
from sotd.services import profile
from tests.clients import CsrfClient
from tests.factories import UserFactory
from tests.test_profile_api import assert_invalid, patch, reload

PATTERN_MESSAGE = (
    "Username may only contain letters, numbers, hyphens or underscores, and cannot begin "
    "or end with a hyphen or underscore."
)
LENGTH_MESSAGE = "Username must be between 3 and 30 characters."


def test_username_is_trimmed_lower_cased_and_saved(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    response = patch(auth_client, {"username": "  Grace_Hopper-1 "})
    assert response.status_code == 200
    assert response.get_json()["user"]["username"] == "grace_hopper-1"
    assert reload(db_session, auth_user).username == "grace_hopper-1"


def test_the_old_link_stops_working(auth_client: CsrfClient) -> None:
    assert patch(auth_client, {"username": "grace"}).status_code == 200
    assert auth_client.get("/api/users/ada").status_code == 404
    assert auth_client.get("/api/users/grace").get_json()["profile"]["username"] == "grace"


def test_keeping_your_own_username_in_another_case_is_allowed(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    response = patch(auth_client, {"username": "ADA", "display_name": "Ada L."})
    assert response.status_code == 200
    assert reload(db_session, auth_user).username == "ada"


def test_a_taken_username_is_409_and_nothing_changes(
    auth_client: CsrfClient, auth_user: User, db_session: Session, user_factory: UserFactory
) -> None:
    user_factory(email="grace@example.com", username="grace")
    response = patch(auth_client, {"username": "Grace", "display_name": "Changed"})
    assert response.status_code == 409
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json() == {
        "error": {"code": "username_taken", "message": "Username grace is already taken."}
    }
    stored = reload(db_session, auth_user)
    assert (stored.username, stored.display_name) == ("ada", "Ada")


def test_a_username_taken_concurrently_is_409(
    auth_client: CsrfClient,
    auth_user: User,
    db_session: Session,
    user_factory: UserFactory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_factory(email="grace@example.com", username="grace")
    # The pre-check misses the other account, as if it committed right after the check.
    monkeypatch.setattr(profile, "username_in_use", lambda *_args, **_kwargs: False)
    response = patch(auth_client, {"username": "grace"})
    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "username_taken"
    assert reload(db_session, auth_user).username == "ada"
    assert patch(auth_client, {"display_name": "Still works"}).status_code == 200


def test_other_integrity_errors_are_reraised(app: Flask, auth_user: User) -> None:
    with app.app_context(), pytest.raises(IntegrityError):
        profile.update_profile(auth_user.id, username="ab")  # Violates the CHECK.


@pytest.mark.parametrize(
    ("username", "message"),
    [
        (None, "Cannot be null."),
        ("", LENGTH_MESSAGE),
        ("ab", LENGTH_MESSAGE),
        ("a" * 31, LENGTH_MESSAGE),
        ("ada!", PATTERN_MESSAGE),
        ("_ada", PATTERN_MESSAGE),
        ("ada\nx", "Must be a single line."),
        ("settings", "Username settings is unavailable."),
        ("API", "Username api is unavailable."),
        (["ada"], "Must be a string."),
    ],
)
def test_invalid_usernames_are_422(
    auth_client: CsrfClient, auth_user: User, db_session: Session, username: object, message: str
) -> None:
    assert_invalid(patch(auth_client, {"username": username}), {"username": message})
    assert reload(db_session, auth_user).username == "ada"


def test_autoplay_previews_can_be_turned_off_and_on(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    response = patch(auth_client, {"autoplay_previews": False})
    assert response.status_code == 200
    assert response.get_json()["user"]["autoplay_previews"] is False
    assert reload(db_session, auth_user).autoplay_previews is False
    assert auth_client.get("/api/auth/me").get_json()["user"]["autoplay_previews"] is False

    assert patch(auth_client, {"autoplay_previews": True}).get_json()["user"]["autoplay_previews"]
    assert reload(db_session, auth_user).autoplay_previews is True


def test_omitting_autoplay_previews_keeps_it(auth_client: CsrfClient) -> None:
    patch(auth_client, {"autoplay_previews": False})
    assert patch(auth_client, {"bio": "hi"}).get_json()["user"]["autoplay_previews"] is False


@pytest.mark.parametrize(
    ("value", "message"),
    [
        (None, "Cannot be null."),
        ("false", "Must be true or false."),
        (0, "Must be true or false."),
        (1, "Must be true or false."),
    ],
)
def test_autoplay_previews_is_a_strict_boolean(
    auth_client: CsrfClient, auth_user: User, db_session: Session, value: object, message: str
) -> None:
    assert_invalid(patch(auth_client, {"autoplay_previews": value}), {"autoplay_previews": message})
    assert reload(db_session, auth_user).autoplay_previews is True
