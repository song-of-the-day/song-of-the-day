"""Password hashing, session tokens and password-reset tokens.

Passwords are hashed with argon2id (``argon2-cffi``). The parameter set comes from the
``ARGON2_PROFILE`` setting: the RFC 9106 low-memory profile normally, and the cheapest
profile in tests. Session tokens are random URL-safe strings; only their SHA-256 digest
is stored (``user_sessions.token_hash``).

Password-reset tokens are signed and timestamped with ``itsdangerous`` (salt
``password-reset``, valid for one hour). They carry the user id and a fingerprint of the
current password hash, so any password change (argon2 re-salts every hash) makes every
outstanding token unusable, including the one just redeemed.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Final

from argon2 import Parameters, PasswordHasher, profiles
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from flask import Flask, current_app
from itsdangerous import BadData, URLSafeTimedSerializer

logger = logging.getLogger(__name__)

#: Bytes of randomness in a session token (``secrets.token_urlsafe(32)``).
SESSION_TOKEN_BYTES: Final = 32

#: How long a password-reset token stays valid.
PASSWORD_RESET_TOKEN_MAX_AGE: Final = timedelta(hours=1)
#: Hex characters of ``sha256(password_hash)`` embedded in a reset token.
PASSWORD_FINGERPRINT_LENGTH: Final = 32

_EXTENSION_KEY: Final = "sotd.security"
_RESET_SERIALIZER_SALT: Final = "password-reset"


@dataclass(frozen=True, slots=True)
class _PasswordContext:
    hasher: PasswordHasher
    dummy_hash: str


def init_app(app: Flask) -> None:
    """Create the app's password hasher and its precomputed dummy hash.

    Raises:
        RuntimeError: If ``ARGON2_PROFILE`` doesn't name an ``argon2.profiles`` entry.
    """
    name = app.config["ARGON2_PROFILE"]
    parameters = getattr(profiles, name, None)
    if not isinstance(parameters, Parameters):
        raise RuntimeError(f"Unknown ARGON2_PROFILE {name!r}.")
    hasher = PasswordHasher.from_parameters(parameters)
    dummy_hash = hasher.hash(secrets.token_urlsafe(16))
    app.extensions[_EXTENSION_KEY] = _PasswordContext(hasher=hasher, dummy_hash=dummy_hash)


def _context() -> _PasswordContext:
    context: _PasswordContext = current_app.extensions[_EXTENSION_KEY]
    return context


def hash_password(password: str) -> str:
    """Return the argon2id hash of ``password``."""
    return _context().hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Return whether ``password`` matches ``password_hash``.

    A malformed stored hash counts as a mismatch (and is logged, without the hash).
    """
    try:
        return _context().hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except (VerificationError, InvalidHashError):
        logger.warning("A stored password hash could not be verified")
        return False


def verify_dummy_password(password: str) -> None:
    """Do the work of a real verification for an unknown account.

    Login calls this when no user matches the email, so both paths take similar time and
    the response doesn't reveal whether the account exists.
    """
    verify_password(_context().dummy_hash, password)


def password_needs_rehash(password_hash: str) -> bool:
    """Return whether ``password_hash`` was made with different argon2 parameters."""
    return _context().hasher.check_needs_rehash(password_hash)


def generate_session_token() -> str:
    """Return a new random session token for a cookie (never stored as-is)."""
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def hash_token(token: str) -> str:
    """Return the SHA-256 hex digest under which a token is stored (64 characters)."""
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class PasswordResetClaims:
    """The verified contents of a password-reset token.

    Attributes:
        user_id: The account the token was issued for.
        password_fingerprint: :func:`password_fingerprint` of the password hash at issue
            time.
    """

    user_id: int
    password_fingerprint: str

    def matches(self, password_hash: str) -> bool:
        """Return whether the token was issued for ``password_hash`` (constant time)."""
        return hmac.compare_digest(self.password_fingerprint, password_fingerprint(password_hash))


def password_fingerprint(password_hash: str) -> str:
    """Return the first 32 hex characters of ``sha256(password_hash)``."""
    return hashlib.sha256(password_hash.encode()).hexdigest()[:PASSWORD_FINGERPRINT_LENGTH]


def _reset_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_RESET_SERIALIZER_SALT)


def generate_password_reset_token(user_id: int, password_hash: str) -> str:
    """Return a signed, timestamped reset token for the user's current password hash.

    Args:
        user_id: The account's id.
        password_hash: The account's current password hash.
    """
    claims = {"uid": user_id, "ph": password_fingerprint(password_hash)}
    return _reset_serializer().dumps(claims)


def load_password_reset_token(token: str) -> PasswordResetClaims | None:
    """Verify a reset token's signature, age and shape.

    Args:
        token: The token from the reset link.

    Returns:
        The claims, or ``None`` when the token is tampered with, expired or malformed.
        The caller must still check :meth:`PasswordResetClaims.matches` against the
        account's current password hash.
    """
    max_age = int(PASSWORD_RESET_TOKEN_MAX_AGE.total_seconds())
    try:
        data: object = _reset_serializer().loads(token, max_age=max_age)
    except BadData:
        return None
    if not isinstance(data, dict):
        return None
    user_id = data.get("uid")
    fingerprint = data.get("ph")
    if type(user_id) is not int or not isinstance(fingerprint, str):
        return None
    return PasswordResetClaims(user_id=user_id, password_fingerprint=fingerprint)
