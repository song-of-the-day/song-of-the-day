"""``PATCH /api/profile``: display name, bio and theme."""

from __future__ import annotations

import copy
import uuid
from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from sotd.models import Upload, User
from sotd.schemas.common import format_utc_timestamp
from sotd.theme import get_theme_options, normalize_theme
from tests import image_samples as samples
from tests.clients import CSRF_HEADER, CsrfClient, csrf_client
from tests.factories import UploadFactory, UserFactory
from tests.sql_recorder import first_index, recorded_sql
from tests.support import FROZEN_NOW

PROFILE_URL = "/api/profile"
MISSING_IMAGE = {
    "theme.background.image_upload_id": "This image is no longer available; upload it again."
}
HOUR = timedelta(hours=1)

Theme = dict[str, Any]


def chrome() -> Theme:
    """A complete, valid theme (the default preset) to modify."""
    return get_theme_options().preset_theme("chrome")


def with_image(upload_id: object) -> Theme:
    theme = chrome()
    theme["preset"] = "custom"
    theme["background"]["image_upload_id"] = str(upload_id)
    return theme


def patch(client: CsrfClient, body: object) -> TestResponse:
    return client.patch(PROFILE_URL, json=body)


def assert_invalid(response: TestResponse, fields: dict[str, str]) -> None:
    assert response.status_code == 422, response.get_json()
    assert response.get_json() == {
        "error": {
            "code": "validation_error",
            "message": "Some fields are invalid.",
            "fields": fields,
        }
    }


def reload(db_session: Session, user: User) -> User:
    db_session.expire_all()
    fresh = db_session.get(User, user.id)
    assert fresh is not None
    return fresh


def remaining_uploads(db_session: Session) -> set[uuid.UUID]:
    db_session.expire_all()
    return set(db_session.scalars(select(Upload.id)))


def reference(db_session: Session, user: User, upload_id: uuid.UUID) -> None:
    user.theme = with_image(upload_id)
    db_session.commit()


# --- Display name and bio ---------------------------------------------------------------


def test_update_returns_the_user(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    response = patch(auth_client, {"display_name": "  Grace  ", "bio": "  line one\nline two\n"})

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.get_json() == {
        "user": {
            "id": auth_user.id,
            "email": "ada@example.com",
            "username": "ada",
            "display_name": "Grace",
            "bio": "line one\nline two",
            "theme": chrome(),
            "autoplay_previews": True,
            "created_at": format_utc_timestamp(auth_user.created_at),
        }
    }
    stored = reload(db_session, auth_user)
    assert (stored.display_name, stored.bio, stored.theme) == ("Grace", "line one\nline two", {})


def test_omitted_fields_are_unchanged(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    auth_user.bio = "breakbeats"
    auth_user.theme = {"preset": "paper"}
    db_session.commit()

    assert patch(auth_client, {}).status_code == 200
    assert patch(auth_client, {"display_name": "Grace"}).status_code == 200

    stored = reload(db_session, auth_user)
    assert (stored.display_name, stored.bio, stored.theme) == (
        "Grace",
        "breakbeats",
        {"preset": "paper"},
    )


def test_empty_body_is_a_no_op(auth_client: CsrfClient, auth_user: User) -> None:
    response = auth_client.patch(PROFILE_URL)
    assert response.status_code == 200
    assert response.get_json()["user"]["display_name"] == auth_user.display_name


@pytest.mark.parametrize("bio", [None, "", "  \n\t "], ids=["null", "empty", "blank"])
def test_bio_is_cleared_to_an_empty_string(
    auth_client: CsrfClient, auth_user: User, db_session: Session, bio: str | None
) -> None:
    auth_user.bio = "something"
    db_session.commit()

    response = patch(auth_client, {"bio": bio})

    assert response.status_code == 200
    assert response.get_json()["user"]["bio"] == ""
    assert reload(db_session, auth_user).bio == ""


def test_bio_may_be_280_characters_after_trimming(auth_client: CsrfClient) -> None:
    response = patch(auth_client, {"bio": f"  {'x' * 280}  "})
    assert response.status_code == 200
    assert response.get_json()["user"]["bio"] == "x" * 280


def test_display_name_may_be_50_characters(auth_client: CsrfClient) -> None:
    response = patch(auth_client, {"display_name": "x" * 50})
    assert response.status_code == 200


@pytest.mark.parametrize(
    ("body", "fields"),
    [
        ({"display_name": None}, {"display_name": "Cannot be null."}),
        ({"display_name": ""}, {"display_name": "Must not be blank."}),
        ({"display_name": "   "}, {"display_name": "Must not be blank."}),
        ({"display_name": "x" * 51}, {"display_name": "Must be at most 50 characters."}),
        ({"display_name": "Ada\nLovelace"}, {"display_name": "Must be a single line."}),
        ({"display_name": "Ada\x00"}, {"display_name": "Contains characters that aren't allowed."}),
        ({"display_name": 5}, {"display_name": "Must be a string."}),
        ({"bio": "x" * 281}, {"bio": "Must be at most 280 characters."}),
        ({"bio": "bell\x07"}, {"bio": "Contains characters that aren't allowed."}),
        ({"bio": ["list"]}, {"bio": "Must be a string."}),
        ({"email": "grace@example.com"}, {"email": "Unknown field."}),
    ],
    ids=[
        "name-null",
        "name-empty",
        "name-blank",
        "name-too-long",
        "name-line-break",
        "name-nul",
        "name-number",
        "bio-too-long",
        "bio-control",
        "bio-list",
        "unknown-field",
    ],
)
def test_invalid_name_or_bio_is_422(
    auth_client: CsrfClient,
    auth_user: User,
    db_session: Session,
    body: dict[str, Any],
    fields: dict[str, str],
) -> None:
    assert_invalid(patch(auth_client, body), fields)
    stored = reload(db_session, auth_user)
    assert (stored.display_name, stored.bio) == ("Ada", "")


# --- Theme ------------------------------------------------------------------------------


def test_theme_is_stored_as_sent_with_upper_case_colors(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    theme = chrome()
    theme["colors"]["accent"] = "#abcdef"
    theme["fonts"]["body"] = "space-mono"  # Still "chrome": presets are never re-expanded.

    response = patch(auth_client, {"theme": theme})

    assert response.status_code == 200
    expected = copy.deepcopy(theme)
    expected["colors"]["accent"] = "#ABCDEF"
    assert response.get_json()["user"]["theme"] == expected
    assert reload(db_session, auth_user).theme == expected


def _set(path: str, value: object) -> Callable[[Theme], None]:
    *parents, key = path.split(".")

    def change(theme: Theme) -> None:
        target = theme
        for parent in parents:
            target = target[parent]
        target[key] = value

    return change


def _delete(key: str) -> Callable[[Theme], None]:
    def change(theme: Theme) -> None:
        del theme[key]

    return change


def _choices(*keys: str) -> str:
    return f"Must be one of: {', '.join(sorted(keys))}."


OPTIONS = get_theme_options()


@pytest.mark.parametrize(
    ("change", "fields"),
    [
        (_set("colors.text", "red"), {"theme.colors.text": "Must be a #RRGGBB color."}),
        (_set("colors.surface", "#FFFFFF0"), {"theme.colors.surface": "Must be a #RRGGBB color."}),
        (_set("colors.glow", "#FFFFFF"), {"theme.colors.glow": "Unknown field."}),
        (_set("fonts.heading", "comic-sans"), {"theme.fonts.heading": _choices(*OPTIONS.fonts)}),
        (
            _set("background.pattern", "plaid"),
            {"theme.background.pattern": _choices(*OPTIONS.patterns)},
        ),
        (
            _set("background.image_fit", "stretch"),
            {"theme.background.image_fit": _choices(*OPTIONS.image_fits)},
        ),
        (
            _set("background.image_upload_id", "not-a-uuid"),
            {"theme.background.image_upload_id": "Must be a valid UUID."},
        ),
        (_set("card_style", "fancy"), {"theme.card_style": _choices(*OPTIONS.card_styles)}),
        (_set("default_view", "list"), {"theme.default_view": _choices(*OPTIONS.default_views)}),
        (_set("preset", "vaporwave"), {"theme.preset": _choices(*OPTIONS.presets, "custom")}),
        (_set("extra", True), {"theme.extra": "Unknown field."}),
        (_delete("default_view"), {"theme.default_view": "This field is required."}),
        (_delete("background"), {"theme.background": "This field is required."}),
    ],
    ids=[
        "color",
        "color-length",
        "unknown-color",
        "font",
        "pattern",
        "image-fit",
        "image-id",
        "card-style",
        "default-view",
        "preset",
        "unknown-key",
        "incomplete",
        "missing-section",
    ],
)
def test_invalid_theme_errors_use_dotted_paths(
    auth_client: CsrfClient,
    auth_user: User,
    db_session: Session,
    change: Callable[[Theme], None],
    fields: dict[str, str],
) -> None:
    theme = chrome()
    change(theme)
    assert_invalid(patch(auth_client, {"theme": theme}), fields)
    assert reload(db_session, auth_user).theme == {}


@pytest.mark.parametrize(
    ("theme", "fields"),
    [
        (None, {"theme": "Cannot be null."}),
        ("chrome", {"theme": "Must be an object."}),
        (
            {},
            {
                f"theme.{key}": "This field is required."
                for key in ("preset", "colors", "fonts", "background", "card_style", "default_view")
            },
        ),
    ],
    ids=["null", "string", "empty"],
)
def test_theme_must_be_a_complete_object(
    auth_client: CsrfClient, theme: object, fields: dict[str, str]
) -> None:
    assert_invalid(patch(auth_client, {"theme": theme}), fields)


def test_every_invalid_field_is_reported_and_nothing_is_saved(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    theme = chrome()
    theme["colors"]["text"] = "black"
    response = patch(auth_client, {"display_name": "", "bio": "ok", "theme": theme})
    assert_invalid(
        response,
        {"display_name": "Must not be blank.", "theme.colors.text": "Must be a #RRGGBB color."},
    )
    assert reload(db_session, auth_user).bio == ""


# --- Background images ------------------------------------------------------------------


def test_owned_image_can_be_set_and_cleared(
    auth_client: CsrfClient, auth_user: User, upload_factory: UploadFactory, db_session: Session
) -> None:
    upload = upload_factory(user=auth_user)

    response = patch(auth_client, {"theme": with_image(str(upload.id).upper())})

    assert response.status_code == 200
    assert response.get_json()["user"]["theme"] == with_image(upload.id)
    assert reload(db_session, auth_user).theme["background"]["image_upload_id"] == str(upload.id)

    response = patch(auth_client, {"theme": chrome()})
    assert response.status_code == 200
    assert response.get_json()["user"]["theme"]["background"]["image_upload_id"] is None


@pytest.mark.parametrize("owner", ["someone-else", "nobody"])
def test_image_that_is_not_the_users_is_422(
    auth_client: CsrfClient,
    auth_user: User,
    user_factory: UserFactory,
    upload_factory: UploadFactory,
    db_session: Session,
    owner: str,
) -> None:
    image_id = upload_factory(user=user_factory()).id if owner == "someone-else" else uuid.uuid4()

    response = patch(auth_client, {"display_name": "Grace", "theme": with_image(image_id)})

    assert_invalid(response, MISSING_IMAGE)
    stored = reload(db_session, auth_user)
    assert (stored.display_name, stored.theme) == ("Ada", {})


def test_evicted_draft_image_is_422(auth_client: CsrfClient) -> None:
    def upload_png() -> str:
        response = auth_client.post("/api/uploads", **samples.multipart(samples.png()))
        assert response.status_code == 201
        upload_id: str = response.get_json()["upload"]["id"]
        return upload_id

    first = upload_png()
    second = upload_png()  # Evicts the first, which the saved theme doesn't use.

    assert_invalid(patch(auth_client, {"theme": with_image(first)}), MISSING_IMAGE)
    assert patch(auth_client, {"theme": with_image(second)}).status_code == 200


def test_ownership_is_checked_under_the_user_row_lock(
    app: Flask, auth_client: CsrfClient, auth_user: User, upload_factory: UploadFactory
) -> None:
    upload = upload_factory(user=auth_user)
    with recorded_sql(app) as statements:
        assert patch(auth_client, {"theme": with_image(upload.id)}).status_code == 200
    lock = first_index(statements, "FROM USERS", "FOR UPDATE")
    assert lock < first_index(statements, "SELECT UPLOADS.ID", "FROM UPLOADS")
    assert lock < first_index(statements, "UPDATE USERS")


# --- Cleanup of unreferenced uploads ----------------------------------------------------


def test_saving_deletes_unreferenced_uploads_older_than_an_hour(
    auth_client: CsrfClient,
    auth_user: User,
    user_factory: UserFactory,
    upload_factory: UploadFactory,
    db_session: Session,
    frozen_time: object,
) -> None:
    def make(age: timedelta, user: User = auth_user) -> uuid.UUID:
        return upload_factory(user=user, created_at=FROZEN_NOW - age).id

    previous, chosen = make(2 * HOUR), make(2 * HOUR)
    make(2 * HOUR)  # An old draft: deleted.
    recent_draft, exactly_an_hour = make(HOUR - timedelta(seconds=1)), make(HOUR)
    someone_elses = make(2 * HOUR, user_factory())
    reference(db_session, auth_user, previous)

    assert patch(auth_client, {"theme": with_image(chosen)}).status_code == 200

    assert remaining_uploads(db_session) == {chosen, recent_draft, exactly_an_hour, someone_elses}


def test_any_save_runs_the_cleanup(
    auth_client: CsrfClient,
    auth_user: User,
    upload_factory: UploadFactory,
    db_session: Session,
    frozen_time: object,
) -> None:
    saved = upload_factory(user=auth_user, created_at=FROZEN_NOW - 2 * HOUR).id
    upload_factory(user=auth_user, created_at=FROZEN_NOW - 2 * HOUR)
    reference(db_session, auth_user, saved)

    assert patch(auth_client, {"bio": "still here"}).status_code == 200

    assert remaining_uploads(db_session) == {saved}
    assert normalize_theme(reload(db_session, auth_user).theme) == with_image(saved)


def test_rejected_update_deletes_nothing(
    auth_client: CsrfClient, auth_user: User, upload_factory: UploadFactory, db_session: Session
) -> None:
    old_draft = upload_factory(user=auth_user, created_at=FROZEN_NOW - 2 * HOUR).id
    assert patch(auth_client, {"theme": with_image(uuid.uuid4())}).status_code == 422
    assert patch(auth_client, {"bio": "x" * 281}).status_code == 422
    assert remaining_uploads(db_session) == {old_draft}


# --- Request handling -------------------------------------------------------------------


def test_profile_requires_a_login(app: Flask) -> None:
    response = csrf_client(app).patch(PROFILE_URL, json={"bio": "hi"})
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "unauthorized"


def test_profile_requires_a_csrf_token(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    response = auth_client.patch(PROFILE_URL, json={"bio": "hi"}, headers={CSRF_HEADER: "forged"})
    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "csrf_failed"
    assert reload(db_session, auth_user).bio == ""


@pytest.mark.parametrize(
    ("kwargs", "status", "code"),
    [
        (
            {"data": "bio=hi", "content_type": "application/x-www-form-urlencoded"},
            415,
            "unsupported_media_type",
        ),
        ({"data": "{", "content_type": "application/json"}, 400, "invalid_json"),
        ({"json": ["bio"]}, 400, "invalid_json"),
    ],
    ids=["form", "malformed", "array"],
)
def test_body_must_be_a_json_object(
    auth_client: CsrfClient, kwargs: dict[str, Any], status: int, code: str
) -> None:
    response = auth_client.patch(PROFILE_URL, **kwargs)
    assert response.status_code == status
    assert response.get_json()["error"]["code"] == code
