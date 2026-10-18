from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Iterator

import pytest
from argon2 import PasswordHasher, profiles
from flask import Flask

from sotd.security import (
    generate_session_token,
    hash_password,
    hash_token,
    password_needs_rehash,
    verify_dummy_password,
    verify_password,
)
from tests.support import AppFactory

PASSWORD = "correct horse battery staple"


@pytest.fixture
def app_context(app: Flask) -> Iterator[None]:
    with app.app_context():
        yield


# --- Password hashing --------------------------------------------------------------------


@pytest.mark.usefixtures("app_context")
def test_hash_is_argon2id_with_the_configured_profile() -> None:
    password_hash = hash_password(PASSWORD)
    assert password_hash.startswith("$argon2id$")
    cheapest = profiles.CHEAPEST
    assert f"m={cheapest.memory_cost},t={cheapest.time_cost},p={cheapest.parallelism}" in (
        password_hash
    )


@pytest.mark.usefixtures("app_context")
def test_hashes_are_salted() -> None:
    assert hash_password(PASSWORD) != hash_password(PASSWORD)


@pytest.mark.usefixtures("app_context")
def test_verify_password() -> None:
    password_hash = hash_password(PASSWORD)
    assert verify_password(password_hash, PASSWORD) is True
    assert verify_password(password_hash, PASSWORD.upper()) is False
    assert verify_password(password_hash, f" {PASSWORD}") is False


@pytest.mark.usefixtures("app_context")
@pytest.mark.parametrize("stored", ["", "not-a-hash", "$argon2id$v=19$m=8,t=1,p=1$broken"])
def test_malformed_stored_hash_is_a_mismatch(stored: str, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger="sotd.security"):
        assert verify_password(stored, PASSWORD) is False
    assert [r.getMessage() for r in caplog.records] == [
        "A stored password hash could not be verified"
    ]


@pytest.mark.usefixtures("app_context")
def test_dummy_verification_does_real_work(monkeypatch: pytest.MonkeyPatch) -> None:
    verified: list[str] = []
    original = PasswordHasher.verify

    def spy(self: PasswordHasher, stored: str, password: str | bytes) -> bool:
        verified.append(stored)
        return original(self, stored, password)

    monkeypatch.setattr(PasswordHasher, "verify", spy)
    verify_dummy_password(PASSWORD)
    assert len(verified) == 1
    assert verified[0].startswith("$argon2id$")


@pytest.mark.usefixtures("app_context")
def test_current_hashes_do_not_need_rehash() -> None:
    assert password_needs_rehash(hash_password(PASSWORD)) is False


@pytest.mark.usefixtures("app_context")
def test_hashes_with_other_parameters_need_rehash() -> None:
    stronger = PasswordHasher.from_parameters(profiles.RFC_9106_LOW_MEMORY)
    assert password_needs_rehash(stronger.hash(PASSWORD)) is True


def test_production_profile_is_stronger_than_the_testing_one(app_factory: AppFactory) -> None:
    with app_factory(ARGON2_PROFILE="RFC_9106_LOW_MEMORY") as strong_app, strong_app.app_context():
        password_hash = hash_password(PASSWORD)
        assert verify_password(password_hash, PASSWORD)
    low = profiles.RFC_9106_LOW_MEMORY
    assert f"m={low.memory_cost},t={low.time_cost},p={low.parallelism}" in password_hash


@pytest.mark.parametrize("profile", ["NOPE", "Parameters", "get_default_parameters"])
def test_unknown_argon2_profile_fails_fast(app_factory: AppFactory, profile: str) -> None:
    with (
        pytest.raises(RuntimeError, match=f"Unknown ARGON2_PROFILE '{profile}'"),
        app_factory(ARGON2_PROFILE=profile),
    ):
        pass


# --- Session tokens ----------------------------------------------------------------------------


def test_session_tokens_are_random_and_url_safe() -> None:
    tokens = {generate_session_token() for _ in range(50)}
    assert len(tokens) == 50
    for token in tokens:
        assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)


def test_hash_token_is_sha256_hex() -> None:
    token = "abc-123_XYZ"
    digest = hash_token(token)
    assert digest == hashlib.sha256(token.encode()).hexdigest()
    assert re.fullmatch(r"[0-9a-f]{64}", digest)
    assert hash_token(token) == digest
    assert hash_token(token + "x") != digest
