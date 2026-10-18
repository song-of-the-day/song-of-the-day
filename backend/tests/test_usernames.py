"""Username rules: loading ``shared/usernames.json`` and validating usernames."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from flask import Flask
from pydantic_core import PydanticCustomError
from sqlalchemy import text

from sotd.extensions import db
from sotd.usernames import (
    DEFAULT_USERNAMES_PATH,
    UsernameMessages,
    UsernameRules,
    UsernameRulesError,
    get_username_rules,
    load_username_rules,
    lookup_key,
    normalize_username,
    username_taken_message,
    usernames_path,
)

RAW_RULES: dict[str, Any] = json.loads(DEFAULT_USERNAMES_PATH.read_text(encoding="utf-8"))
MESSAGES: dict[str, str] = RAW_RULES["messages"]
LENGTH_MESSAGE = "Username must be between 3 and 30 characters."
PATTERN_MESSAGE: str = MESSAGES["pattern"]


def write_rules(tmp_path: Path, **changes: Any) -> Path:
    path = tmp_path / "usernames.json"
    path.write_text(json.dumps({**RAW_RULES, **changes}), encoding="utf-8")
    return path


def test_the_shared_file_is_loaded_and_cached() -> None:
    rules = get_username_rules()
    assert get_username_rules() is rules
    assert (rules.min_length, rules.max_length) == (3, 30)
    assert rules.pattern.pattern == RAW_RULES["pattern"]
    assert rules.pattern_description == RAW_RULES["pattern_description"]
    assert rules.reserved == frozenset(RAW_RULES["reserved"])
    assert rules.messages == UsernameMessages(
        length=MESSAGES["length"],
        pattern=MESSAGES["pattern"],
        reserved=MESSAGES["reserved"],
        taken=MESSAGES["taken"],
    )
    assert {"profile", "login", "signup", "api", "settings"} <= rules.reserved


def test_path_defaults_to_the_shared_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("USERNAMES_PATH", raising=False)
    assert usernames_path() == DEFAULT_USERNAMES_PATH
    assert DEFAULT_USERNAMES_PATH.parts[-2:] == ("shared", "usernames.json")


def test_path_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    path = write_rules(tmp_path, min_length=4)
    monkeypatch.setenv("USERNAMES_PATH", f" {path} ")
    assert usernames_path() == path
    assert load_username_rules(usernames_path()).min_length == 4


@pytest.mark.parametrize(
    ("changes", "problem"),
    [
        ({"min_length": 0}, "min_length"),
        ({"max_length": 31}, "max_length"),
        ({"min_length": "3"}, "min_length"),
        ({"pattern": "(unclosed"}, "Cannot load"),
        ({"pattern_description": ""}, "pattern_description"),
        ({"reserved": "admin"}, "reserved"),
        ({"min_length": 10, "max_length": 5}, "min_length > max_length"),
        ({"reserved": ["Admin", "ok"]}, "reserved names must be lower case: ['Admin']"),
        ({"messages": {}}, "messages"),
        ({"messages": {**MESSAGES, "length": ""}}, "length"),
        ({"messages": {**MESSAGES, "reserved": "{name} is unavailable."}}, "unknown placeholders"),
        ({"messages": {**MESSAGES, "taken": "} broken"}}, "malformed"),
    ],
)
def test_invalid_rules_are_reported(tmp_path: Path, changes: dict[str, Any], problem: str) -> None:
    with pytest.raises(UsernameRulesError, match=re.escape(problem)):
        load_username_rules(write_rules(tmp_path, **changes))


def test_missing_or_malformed_files_are_reported(tmp_path: Path) -> None:
    with pytest.raises(UsernameRulesError, match="Cannot load username rules"):
        load_username_rules(tmp_path / "missing.json")
    broken = tmp_path / "broken.json"
    broken.write_text("{", encoding="utf-8")
    with pytest.raises(UsernameRulesError, match="Cannot load username rules"):
        load_username_rules(broken)


@pytest.mark.parametrize(
    ("value", "expected"),
    [("ada", "ada"), ("ADA", "ada"), ("a_b-c", "a_b-c"), ("x" * 30, "x" * 30), ("007", "007")],
)
def test_valid_usernames_are_lower_cased(value: str, expected: str) -> None:
    assert normalize_username(value) == expected


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("ab", LENGTH_MESSAGE),
        ("", LENGTH_MESSAGE),
        ("x" * 31, LENGTH_MESSAGE),
        ("-ab", PATTERN_MESSAGE),
        ("ab-", PATTERN_MESSAGE),
        ("a b", PATTERN_MESSAGE),
        ("abc\n", PATTERN_MESSAGE),
        ("ünï", PATTERN_MESSAGE),
        ("login", "Username login is unavailable."),
        ("SignUp", "Username signup is unavailable."),
    ],
)
def test_invalid_usernames_are_rejected(value: str, message: str) -> None:
    with pytest.raises(PydanticCustomError) as excinfo:
        normalize_username(value)
    assert excinfo.value.message() == message


def test_the_shared_file_drives_every_message() -> None:
    rules = get_username_rules()
    assert rules.messages.length == MESSAGES["length"]
    assert rules.messages.reserved == MESSAGES["reserved"]
    assert username_taken_message("ada") == "Username ada is already taken."


def test_custom_rules_drive_the_messages() -> None:
    rules = UsernameRules(
        min_length=2,
        max_length=4,
        pattern=re.compile("[a-z]+"),
        pattern_description="letters",
        reserved=frozenset({"me"}),
        messages=UsernameMessages(
            length="between {min_length} and {max_length} characters, please",
            pattern="only letters, please",
            reserved="{username} is mine",
            taken="{username} is gone",
        ),
    )
    assert normalize_username("AB", rules) == "ab"
    with pytest.raises(PydanticCustomError, match=r"only letters, please"):
        normalize_username("a1", rules)
    with pytest.raises(PydanticCustomError, match="between 2 and 4 characters, please"):
        normalize_username("abcde", rules)
    with pytest.raises(PydanticCustomError, match="me is mine"):
        normalize_username("me", rules)
    assert username_taken_message("me", rules) == "me is gone"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("Ada", "ada"),
        ("admin", "admin"),  # Reserved names are looked up (they may predate the reservation).
        ("ab", None),
        ("x" * 31, None),
        ("a.b", None),
        ("a\x00b", None),
    ],
)
def test_lookup_key(value: str, expected: str | None) -> None:
    assert lookup_key(value) == expected


def test_the_database_check_constraint_follows_the_rules(app: Flask) -> None:
    rules = get_username_rules()
    assert rules.check_constraint_sql("name") == (
        f"char_length(name) BETWEEN 3 AND 30 AND name ~ '{RAW_RULES['pattern']}'"
    )
    with app.app_context():
        definition = db.session.execute(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conname = 'ck_users_username_format'"
            )
        ).scalar_one()
    assert ">= 3" in definition
    assert "<= 30" in definition
    assert RAW_RULES["pattern"] in definition


def test_quotes_in_a_pattern_are_escaped() -> None:
    rules = UsernameRules(
        min_length=1,
        max_length=2,
        pattern=re.compile("[a']+"),
        pattern_description="a or '",
        reserved=frozenset(),
        messages=UsernameMessages(
            length="length", pattern="pattern", reserved="reserved", taken="taken"
        ),
    )
    assert rules.check_constraint_sql() == (
        "char_length(username) BETWEEN 1 AND 2 AND username ~ '[a'']+'"
    )
