"""Password-reset tokens (``sotd.security``)."""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from datetime import timedelta

import pytest
import time_machine
from flask import Flask
from itsdangerous import URLSafeTimedSerializer

from sotd.security import (
    PasswordResetClaims,
    generate_password_reset_token,
    load_password_reset_token,
    password_fingerprint,
)

PASSWORD_HASH = "$argon2id$v=19$m=8,t=1,p=1$c2FsdHNhbHQ$aGFzaA"


@pytest.fixture(autouse=True)
def app_context(app: Flask) -> Iterator[None]:
    with app.app_context():
        yield


def sign(app: Flask, payload: object) -> str:
    return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="password-reset").dumps(payload)


def test_fingerprint_is_a_32_character_sha256_prefix() -> None:
    expected = hashlib.sha256(PASSWORD_HASH.encode()).hexdigest()[:32]
    assert password_fingerprint(PASSWORD_HASH) == expected
    assert len(expected) == 32


def test_round_trip() -> None:
    claims = load_password_reset_token(generate_password_reset_token(7, PASSWORD_HASH))
    assert claims == PasswordResetClaims(
        user_id=7, password_fingerprint=password_fingerprint(PASSWORD_HASH)
    )
    assert claims.matches(PASSWORD_HASH)
    assert not claims.matches(PASSWORD_HASH + "x")


def test_token_is_url_safe_and_carries_no_password_hash() -> None:
    token = generate_password_reset_token(7, PASSWORD_HASH)
    assert all(character.isalnum() or character in "-_." for character in token)
    assert PASSWORD_HASH not in token


@pytest.mark.parametrize(("age", "valid"), [(3600, True), (3601, False)])
def test_token_lifetime_is_one_hour(
    frozen_time: time_machine.Traveller, age: int, valid: bool
) -> None:
    token = generate_password_reset_token(7, PASSWORD_HASH)
    frozen_time.shift(timedelta(seconds=age))
    assert (load_password_reset_token(token) is not None) is valid


@pytest.mark.parametrize(
    "payload",
    [
        [7, "ph"],
        {"uid": "7", "ph": "0" * 32},
        {"uid": True, "ph": "0" * 32},
        {"uid": 7},
        {"uid": 7, "ph": 12},
    ],
)
def test_malformed_payloads_are_rejected(app: Flask, payload: object) -> None:
    assert load_password_reset_token(sign(app, payload)) is None


@pytest.mark.parametrize("token", ["", "garbage", "a.b.c", "eyJ1aWQiOjd9.AAAAAA.forged"])
def test_garbage_is_rejected(token: str) -> None:
    assert load_password_reset_token(token) is None
