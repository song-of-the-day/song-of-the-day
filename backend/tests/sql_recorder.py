"""Capture the SQL an app sends, to assert on locking and loading behavior."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from flask import Flask
from sqlalchemy import event

from sotd.extensions import db


@contextmanager
def recorded_sql(app: Flask) -> Iterator[list[str]]:
    """Collect every statement ``app``'s engine executes inside the block, in order.

    Statements are normalized to single-spaced upper case, e.g.
    ``"SELECT USERS.ID ... FROM USERS WHERE USERS.ID = %(ID_1)S FOR UPDATE"``.
    """
    with app.app_context():
        engine = db.engine
    statements: list[str] = []

    def record(_connection: Any, _cursor: Any, statement: str, *_context: Any) -> None:
        statements.append(" ".join(statement.split()).upper())

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def first_index(statements: list[str], *fragments: str) -> int:
    """Return the index of the first statement containing every fragment (upper case)."""
    for index, statement in enumerate(statements):
        if all(fragment in statement for fragment in fragments):
            return index
    raise AssertionError(f"no statement contains {fragments!r}:\n" + "\n".join(statements))
