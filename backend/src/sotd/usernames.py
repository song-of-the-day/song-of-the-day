"""Username rules: loading ``shared/usernames.json`` and validation.

The rules file (``shared/usernames.json``, or ``USERNAMES_PATH``) is the single source of
truth for the API and the web app: length bounds, the allowed pattern, the reserved names
(every top-level web route) and the exact error sentences. It is loaded once per process.
"""

from __future__ import annotations

import json
import os
import re
import string
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Final

from pydantic import BaseModel, ConfigDict, Field
from pydantic_core import PydanticCustomError

USERNAMES_ENV: Final = "USERNAMES_PATH"
#: Default rules path; valid only in a source checkout (images set USERNAMES_PATH).
DEFAULT_USERNAMES_PATH: Final = Path(__file__).resolve().parents[3] / "shared" / "usernames.json"

#: The placeholders each message may use; anything else is a rules error.
MESSAGE_PLACEHOLDERS: Final[dict[str, frozenset[str]]] = {
    "length": frozenset({"min_length", "max_length"}),
    "pattern": frozenset(),
    "reserved": frozenset({"username"}),
    "taken": frozenset({"username"}),
}


class UsernameRulesError(ValueError):
    """The username rules file is missing, unreadable or inconsistent."""


@dataclass(frozen=True, slots=True)
class UsernameMessages:
    """The exact error sentences shown by the API and the web app.

    Attributes:
        length: ``fields.username`` for a wrong length (``{min_length}``, ``{max_length}``).
        pattern: ``fields.username`` for a value outside the allowed pattern.
        reserved: ``fields.username`` for a reserved name (``{username}``).
        taken: The ``409 username_taken`` message (``{username}``).
    """

    length: str
    pattern: str
    reserved: str
    taken: str


@dataclass(frozen=True, slots=True)
class UsernameRules:
    """The validated contents of the username rules file.

    Attributes:
        min_length: Shortest allowed username.
        max_length: Longest allowed username (``users.username`` is ``varchar(30)``).
        pattern: The allowed form, matched against the whole lower-cased username.
        pattern_description: Human-readable form of ``pattern``, for the rules file's readers.
        reserved: Names nobody can take (lower case).
        messages: The error sentences, shared with the web app.
    """

    min_length: int
    max_length: int
    pattern: re.Pattern[str]
    pattern_description: str
    reserved: frozenset[str]
    messages: UsernameMessages

    def check_constraint_sql(self, column: str = "username") -> str:
        """Return the SQL condition of the ``username_format`` CHECK constraint."""
        quoted = self.pattern.pattern.replace("'", "''")
        return (
            f"char_length({column}) BETWEEN {self.min_length} AND {self.max_length} "
            f"AND {column} ~ '{quoted}'"
        )


class _MessagesFile(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    length: str = Field(min_length=1)
    pattern: str = Field(min_length=1)
    reserved: str = Field(min_length=1)
    taken: str = Field(min_length=1)


class _RulesFile(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    min_length: int = Field(ge=1)
    max_length: int = Field(ge=1, le=30)
    pattern: str = Field(min_length=1)
    pattern_description: str = Field(min_length=1)
    messages: _MessagesFile
    reserved: list[str]


def _validate_messages(messages: _MessagesFile, path: Path) -> UsernameMessages:
    """Check that every message only uses its allowed placeholders.

    Args:
        messages: The parsed ``messages`` object.
        path: The rules file, for error messages.

    Returns:
        The messages as a frozen dataclass.

    Raises:
        UsernameRulesError: If a message is not a valid format string or uses a placeholder
            that isn't allowed for it.
    """
    texts: dict[str, str] = {
        "length": messages.length,
        "pattern": messages.pattern,
        "reserved": messages.reserved,
        "taken": messages.taken,
    }
    parsed: dict[str, str] = {}
    for name, allowed in MESSAGE_PLACEHOLDERS.items():
        text = texts[name]
        try:
            used = {
                field_name
                for _, field_name, _, _ in string.Formatter().parse(text)
                if field_name is not None
            }
        except ValueError as exc:
            raise UsernameRulesError(
                f"Invalid username rules in {path}: the {name} message is malformed: {exc}"
            ) from exc
        unknown = sorted(used - allowed)
        if unknown:
            raise UsernameRulesError(
                f"Invalid username rules in {path}: the {name} message has unknown "
                f"placeholders: {unknown}"
            )
        parsed[name] = text
    return UsernameMessages(**parsed)


def load_username_rules(path: Path) -> UsernameRules:
    """Read and validate a username rules file.

    Args:
        path: The JSON file to read.

    Returns:
        The validated rules.

    Raises:
        UsernameRulesError: If the file can't be read or is inconsistent.
    """
    try:
        parsed = _RulesFile.model_validate(json.loads(path.read_text(encoding="utf-8")))
        pattern = re.compile(parsed.pattern)
    except (OSError, ValueError, re.error) as exc:  # ValidationError is a ValueError.
        raise UsernameRulesError(f"Cannot load username rules from {path}: {exc}") from exc
    messages = _validate_messages(parsed.messages, path)
    if parsed.min_length > parsed.max_length:
        raise UsernameRulesError(f"Invalid username rules in {path}: min_length > max_length.")
    not_lower = sorted(name for name in parsed.reserved if name != name.lower())
    if not_lower:
        raise UsernameRulesError(
            f"Invalid username rules in {path}: reserved names must be lower case: {not_lower}"
        )
    return UsernameRules(
        min_length=parsed.min_length,
        max_length=parsed.max_length,
        pattern=pattern,
        pattern_description=parsed.pattern_description,
        reserved=frozenset(parsed.reserved),
        messages=messages,
    )


def usernames_path() -> Path:
    """Return the rules file path: ``USERNAMES_PATH`` or the source-checkout default."""
    configured = os.environ.get(USERNAMES_ENV, "").strip()
    return Path(configured) if configured else DEFAULT_USERNAMES_PATH


@cache
def get_username_rules() -> UsernameRules:
    """Return the process-wide username rules, loading them on first use.

    Raises:
        UsernameRulesError: If the file is missing or invalid.
    """
    return load_username_rules(usernames_path())


def normalize_username(value: str, rules: UsernameRules | None = None) -> str:
    """Validate a (trimmed) username and return it in lower case, as stored.

    Checks run in the order length, pattern, reserved; a failure raises the first
    message from the rules file.

    Args:
        value: The username as entered, already trimmed.
        rules: The rules to apply; defaults to :func:`get_username_rules`.

    Returns:
        The lower-cased username.

    Raises:
        PydanticCustomError: If it doesn't match the length, the pattern or the reserved
            list.
    """
    rules = rules or get_username_rules()
    username = value.lower()
    if not rules.min_length <= len(username) <= rules.max_length:
        raise PydanticCustomError(
            "username_length",
            rules.messages.length.format(min_length=rules.min_length, max_length=rules.max_length),
        )
    if not rules.pattern.fullmatch(username):
        raise PydanticCustomError("username_pattern", rules.messages.pattern)
    if username in rules.reserved:
        raise PydanticCustomError(
            "username_reserved", rules.messages.reserved.format(username=username)
        )
    return username


def username_taken_message(username: str, rules: UsernameRules | None = None) -> str:
    """Return the ``409 username_taken`` sentence for a (normalized) username.

    Args:
        username: The lower-cased username that is already in use.
        rules: The rules to apply; defaults to :func:`get_username_rules`.
    """
    rules = rules or get_username_rules()
    return rules.messages.taken.format(username=username)


def lookup_key(value: str, rules: UsernameRules | None = None) -> str | None:
    """Return the stored form of a username from a URL, or ``None`` if none can exist.

    Lookups are case-insensitive. Anything that can't be a stored username (wrong length
    or characters) returns ``None`` so it never reaches the database. Reserved names are
    still looked up: a name reserved after someone took it keeps working.

    Args:
        value: The username as it appears in the URL.
        rules: The rules to apply; defaults to :func:`get_username_rules`.
    """
    rules = rules or get_username_rules()
    username = value.lower()
    if not rules.min_length <= len(username) <= rules.max_length:
        return None
    return username if rules.pattern.fullmatch(username) else None
