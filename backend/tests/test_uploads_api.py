"""``POST /api/uploads`` and ``GET /api/uploads/<id>``."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
import time_machine
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from sotd.errors import ApiError
from sotd.models import Upload, User
from sotd.schemas.upload import upload_url
from sotd.services.uploads import lock_owner
from tests import image_samples as samples
from tests.clients import CSRF_HEADER, CsrfClient, csrf_client, log_in
from tests.factories import UploadFactory, UserFactory
from tests.sql_recorder import first_index, recorded_sql
from tests.support import FROZEN_NOW

UPLOADS_URL = "/api/uploads"
MIB = 1024 * 1024


def upload(client: CsrfClient, *files: bytes | tuple[str, bytes], **kwargs: Any) -> TestResponse:
    fields = kwargs.pop("fields", None)
    return client.post(UPLOADS_URL, **samples.multipart(*files, fields=fields), **kwargs)


def stored_uploads(db_session: Session) -> dict[uuid.UUID, Upload]:
    db_session.expire_all()
    return {row.id: row for row in db_session.scalars(select(Upload))}


def reference(db_session: Session, user: User, upload_id: uuid.UUID) -> None:
    user.theme = {"preset": "custom", "background": {"image_upload_id": str(upload_id)}}
    db_session.commit()


def assert_error(response: TestResponse, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.get_json()
    assert response.headers["Cache-Control"] == "no-store"
    error: dict[str, Any] = response.get_json()["error"]
    assert error["code"] == code
    return error


# --- Creating uploads ---------------------------------------------------------------------


def test_upload_returns_the_stored_webp(
    auth_client: CsrfClient, auth_user: User, db_session: Session, frozen_time: object
) -> None:
    response = upload(auth_client, samples.jpeg((40, 20), orientation=6))

    assert response.status_code == 201
    assert response.headers["Cache-Control"] == "no-store"
    body = response.get_json()
    assert set(body) == {"upload"}
    stored = stored_uploads(db_session)
    assert len(stored) == 1
    row = next(iter(stored.values()))
    assert body["upload"] == {
        "id": str(row.id),
        "url": f"/api/uploads/{row.id}",
        "content_type": "image/webp",
        "byte_size": len(row.data),
        "width": 20,
        "height": 40,
        "created_at": "2026-10-11T12:00:00Z",
    }
    assert row.user_id == auth_user.id
    assert row.sha256 == hashlib.sha256(row.data).hexdigest()
    assert (row.width, row.height, row.content_type) == (20, 40, "image/webp")
    decoded = samples.open_webp(row.data)
    assert decoded.size == (20, 40)
    assert not decoded.getexif()


@pytest.mark.parametrize(
    "make",
    [
        samples.mpo,
        lambda: samples.animated("GIF"),
        lambda: samples.animated("WEBP"),
        lambda: samples.png(mode="RGBA"),
    ],
    ids=["mpo", "gif", "webp", "png"],
)
def test_every_accepted_format_is_stored_as_webp(
    auth_client: CsrfClient, make: Callable[[], bytes]
) -> None:
    response = upload(auth_client, make())
    assert response.status_code == 201, response.get_json()
    assert response.get_json()["upload"]["content_type"] == "image/webp"


@pytest.mark.parametrize(
    "data",
    [
        samples.SVG,
        samples.PSD_HEADER,
        samples.HEIC_HEADER,
        samples.encode(samples.solid((8, 8)), "TGA"),
        samples.encode(samples.solid((8, 8)), "EPS"),
        samples.random_bytes(),
    ],
    ids=["svg", "psd", "heic", "tga", "eps", "random"],
)
def test_unsupported_formats_are_415(
    auth_client: CsrfClient, db_session: Session, data: bytes
) -> None:
    assert_error(upload(auth_client, data), 415, "unsupported_media_type")
    assert stored_uploads(db_session) == {}


@pytest.mark.parametrize(
    "data",
    [
        samples.png_header_only(20_000, 20_000),
        samples.png_header_only(7000, 7000),
        samples.jpeg((64, 64))[:300],
    ],
    ids=["header-only-20000", "7000x7000", "truncated-jpeg"],
)
def test_undecodable_or_oversized_images_are_422(
    auth_client: CsrfClient, db_session: Session, data: bytes
) -> None:
    assert_error(upload(auth_client, data), 422, "invalid_image")
    assert stored_uploads(db_session) == {}


def test_file_over_10_mib_is_413(auth_client: CsrfClient, db_session: Session) -> None:
    data = samples.png() + bytes(10 * MIB)  # Trailing bytes keep the PNG decodable.
    error = assert_error(upload(auth_client, data), 413, "payload_too_large")
    assert error["message"] == "The image must be 10 MiB or smaller."
    assert stored_uploads(db_session) == {}


def test_file_of_exactly_10_mib_is_accepted(auth_client: CsrfClient) -> None:
    data = samples.png()
    assert upload(auth_client, data + bytes(10 * MIB - len(data))).status_code == 201


def test_body_over_11_mib_is_413(auth_client: CsrfClient) -> None:
    assert_error(upload(auth_client, bytes(11 * MIB)), 413, "payload_too_large")


@pytest.mark.parametrize(
    ("files", "fields", "expected"),
    [
        ((), None, {"file": "This field is required."}),
        ((), {"file": "not a file"}, {"file": "This field is required."}),
        ((b"",), None, {"file": "The file is empty."}),
        ((samples.png(), samples.png()), None, {"file": "Send a single file."}),
        ((samples.png(),), {"caption": "hi"}, {"caption": "Unknown field."}),
        ((samples.png(), ("image", samples.png())), None, {"image": "Unknown field."}),
    ],
    ids=["missing", "text-field", "empty", "two-files", "extra-field", "extra-file"],
)
def test_invalid_form_is_422(
    auth_client: CsrfClient,
    files: tuple[bytes | tuple[str, bytes], ...],
    fields: dict[str, str] | None,
    expected: dict[str, str],
) -> None:
    error = assert_error(upload(auth_client, *files, fields=fields), 422, "validation_error")
    assert error["fields"] == expected


def test_json_body_is_415(auth_client: CsrfClient) -> None:
    response = auth_client.post(UPLOADS_URL, json={"file": "x"})
    assert_error(response, 415, "unsupported_media_type")


def test_raw_image_body_is_415(auth_client: CsrfClient) -> None:
    response = auth_client.post(UPLOADS_URL, data=samples.png(), content_type="image/png")
    assert_error(response, 415, "unsupported_media_type")


@pytest.mark.parametrize(
    ("body", "content_type"),
    [
        (b"--x\r\nnot a part\r\n--x--\r\n", "multipart/form-data; boundary=x"),
        (b"no boundary at all", "multipart/form-data"),
        (b"", "multipart/form-data; boundary=x"),
    ],
    ids=["garbage-part", "no-boundary", "empty"],
)
def test_malformed_multipart_is_a_missing_file(
    auth_client: CsrfClient, body: bytes, content_type: str
) -> None:
    response = auth_client.post(UPLOADS_URL, data=body, content_type=content_type)
    error = assert_error(response, 422, "validation_error")
    assert error["fields"] == {"file": "This field is required."}


def test_upload_requires_a_login(app: Flask) -> None:
    response = upload(csrf_client(app), samples.png())
    assert_error(response, 401, "unauthorized")


def test_upload_requires_a_csrf_token(auth_client: CsrfClient, db_session: Session) -> None:
    response = upload(auth_client, samples.png(), headers={CSRF_HEADER: "forged"})
    assert_error(response, 403, "csrf_failed")
    assert stored_uploads(db_session) == {}


# --- Housekeeping ----------------------------------------------------------------------------


def test_upload_deletes_the_users_other_unreferenced_uploads(
    auth_client: CsrfClient,
    auth_user: User,
    user_factory: UserFactory,
    upload_factory: UploadFactory,
    db_session: Session,
    frozen_time: object,
) -> None:
    saved = upload_factory(user=auth_user, created_at=FROZEN_NOW - timedelta(days=30)).id
    upload_factory(user=auth_user, created_at=FROZEN_NOW - timedelta(days=1))  # Old draft.
    upload_factory(user=auth_user)  # A draft from the same instant as the new upload.
    reference(db_session, auth_user, saved)
    someone_else = upload_factory(user=user_factory(), created_at=FROZEN_NOW - timedelta(days=1))

    response = upload(auth_client, samples.png())

    assert response.status_code == 201
    new_id = uuid.UUID(response.get_json()["upload"]["id"])
    assert set(stored_uploads(db_session)) == {saved, new_id, someone_else.id}


def test_a_user_holds_at_most_the_saved_upload_and_the_newest_draft(
    auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    ids = [uuid.UUID(upload(auth_client, samples.png()).get_json()["upload"]["id"])]
    reference(db_session, auth_user, ids[0])
    for _ in range(3):
        ids.append(uuid.UUID(upload(auth_client, samples.png()).get_json()["upload"]["id"]))
    assert set(stored_uploads(db_session)) == {ids[0], ids[-1]}


def test_upload_locks_the_owner_before_writing(
    app: Flask, auth_client: CsrfClient, auth_user: User
) -> None:
    with recorded_sql(app) as statements:
        assert upload(auth_client, samples.png()).status_code == 201
    lock = first_index(statements, "FROM USERS", "FOR UPDATE")
    assert lock < first_index(statements, "INSERT INTO UPLOADS")
    assert lock < first_index(statements, "DELETE FROM UPLOADS")
    # The response is built without reading the stored bytes back.
    assert not [sql for sql in statements if "UPLOADS.DATA" in sql]


def test_locking_a_deleted_account_is_401(app: Flask) -> None:
    with app.app_context(), pytest.raises(ApiError) as excinfo:
        lock_owner(12345)
    assert (excinfo.value.status, excinfo.value.code) == (401, "unauthorized")


def test_a_rejected_upload_deletes_nothing(
    auth_client: CsrfClient, auth_user: User, upload_factory: UploadFactory, db_session: Session
) -> None:
    draft = upload_factory(user=auth_user)
    assert upload(auth_client, samples.SVG).status_code == 415
    assert set(stored_uploads(db_session)) == {draft.id}


# --- Downloading -----------------------------------------------------------------------------


@pytest.fixture
def stored(auth_client: CsrfClient) -> dict[str, Any]:
    response = upload(auth_client, samples.png())
    assert response.status_code == 201
    created: dict[str, Any] = response.get_json()["upload"]
    return created


def test_owner_downloads_the_image_with_caching_and_hardening_headers(
    auth_client: CsrfClient, stored: dict[str, Any], db_session: Session
) -> None:
    response = auth_client.get(stored["url"])

    assert response.status_code == 200
    row = stored_uploads(db_session)[uuid.UUID(stored["id"])]
    assert response.data == row.data
    assert response.headers["Content-Type"] == "image/webp"
    assert response.headers["Content-Length"] == str(stored["byte_size"])
    assert response.headers["Cache-Control"] == "private, max-age=31536000, immutable"
    assert response.headers["ETag"] == f'"{row.sha256}"'
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Content-Security-Policy"] == "default-src 'none'"


def test_only_a_full_download_loads_the_bytes(
    app: Flask, auth_client: CsrfClient, stored: dict[str, Any]
) -> None:
    with recorded_sql(app) as full:
        etag = auth_client.get(stored["url"]).headers["ETag"]
    with recorded_sql(app) as revalidated:
        response = auth_client.get(stored["url"], headers={"If-None-Match": etag})
    assert response.status_code == 304
    assert [sql for sql in full if "UPLOADS.DATA" in sql]
    assert not [sql for sql in revalidated if "UPLOADS.DATA" in sql]


@pytest.mark.parametrize("weak", [False, True])
def test_matching_if_none_match_is_304(
    auth_client: CsrfClient, stored: dict[str, Any], weak: bool
) -> None:
    etag = auth_client.get(stored["url"]).headers["ETag"]
    response = auth_client.get(
        stored["url"], headers={"If-None-Match": f"W/{etag}" if weak else f'"other", {etag}'}
    )
    assert response.status_code == 304
    assert response.data == b""
    assert response.headers["ETag"] == etag
    assert response.headers["Cache-Control"] == "private, max-age=31536000, immutable"


def test_stale_if_none_match_gets_the_image(
    auth_client: CsrfClient, stored: dict[str, Any]
) -> None:
    response = auth_client.get(stored["url"], headers={"If-None-Match": '"stale"'})
    assert response.status_code == 200
    assert response.data


def test_another_users_upload_is_404(
    app: Flask, stored: dict[str, Any], user_factory: UserFactory
) -> None:
    other = csrf_client(app)
    log_in(other, user_factory(email="bob@example.com").email)
    assert_error(other.get(stored["url"]), 404, "not_found")


@pytest.mark.parametrize(
    "url",
    [upload_url(uuid.UUID(int=0)), "/api/uploads/not-a-uuid", "/api/uploads/12345"],
    ids=["unknown", "malformed", "number"],
)
def test_unknown_or_malformed_ids_are_404(auth_client: CsrfClient, url: str) -> None:
    assert_error(auth_client.get(url), 404, "not_found")


def test_a_draft_is_404_for_anonymous_visitors(app: Flask, stored: dict[str, Any]) -> None:
    assert_error(app.test_client().get(stored["url"]), 404, "not_found")


@pytest.mark.parametrize("upper_case", [False, True])
def test_a_saved_background_is_public(
    app: Flask,
    auth_user: User,
    stored: dict[str, Any],
    db_session: Session,
    user_factory: UserFactory,
    upper_case: bool,
) -> None:
    upload_id = stored["id"].upper() if upper_case else stored["id"]
    auth_user.theme = {"preset": "custom", "background": {"image_upload_id": upload_id}}
    db_session.commit()

    anonymous = app.test_client().get(stored["url"])
    assert anonymous.status_code == 200
    row = stored_uploads(db_session)[uuid.UUID(stored["id"])]
    assert anonymous.data == row.data
    assert anonymous.headers["Content-Type"] == "image/webp"
    assert anonymous.headers["Cache-Control"] == "private, max-age=31536000, immutable"
    assert anonymous.headers["Content-Security-Policy"] == "default-src 'none'"
    revalidated = app.test_client().get(
        stored["url"], headers={"If-None-Match": anonymous.headers["ETag"]}
    )
    assert revalidated.status_code == 304

    other = csrf_client(app)
    log_in(other, user_factory(email="bob@example.com").email)
    assert other.get(stored["url"]).status_code == 200


def test_only_the_saved_background_is_public(
    app: Flask, auth_client: CsrfClient, auth_user: User, db_session: Session
) -> None:
    saved = upload(auth_client, samples.png()).get_json()["upload"]
    reference(db_session, auth_user, uuid.UUID(saved["id"]))
    draft = upload(auth_client, samples.png(size=(30, 20))).get_json()["upload"]

    visitor = app.test_client()
    assert visitor.get(saved["url"]).status_code == 200
    assert_error(visitor.get(draft["url"]), 404, "not_found")
    assert auth_client.get(draft["url"]).status_code == 200


def test_another_users_theme_cannot_publish_an_upload(
    app: Flask, stored: dict[str, Any], db_session: Session, user_factory: UserFactory
) -> None:
    bob = user_factory(email="bob@example.com")
    reference(db_session, bob, uuid.UUID(stored["id"]))  # Bob's theme names Ada's draft.
    assert_error(app.test_client().get(stored["url"]), 404, "not_found")


def test_upload_survives_until_the_user_uploads_again(
    auth_client: CsrfClient, stored: dict[str, Any], frozen_time: time_machine.Traveller
) -> None:
    frozen_time.shift(timedelta(days=2))
    assert auth_client.get(stored["url"]).status_code == 200
    upload(auth_client, samples.png())
    assert_error(auth_client.get(stored["url"]), 404, "not_found")
