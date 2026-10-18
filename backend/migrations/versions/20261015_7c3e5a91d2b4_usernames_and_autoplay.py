"""Usernames (public profiles) and the auto-play previews preference.

Adds ``users.username`` (unique, CHECK ``username_format``) and
``users.autoplay_previews`` (default true). Existing accounts get a username derived
deterministically from their email's local part (see :func:`derive_usernames`).

The rules (length, pattern, reserved names) come from ``shared/usernames.json`` through
``sotd.usernames``, the single source of truth that the models also use.

``ADD COLUMN`` holds an ACCESS EXCLUSIVE lock on ``users`` until the transaction
commits, so no account can be created between the backfill and ``SET NOT NULL``.

Revision ID: 7c3e5a91d2b4
Revises: 419e8fc1e9c6
Create Date: 2026-10-15 10:00:00
"""

import re
import unicodedata
from collections.abc import Iterable, Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op

from sotd.usernames import UsernameRules, get_username_rules

revision: str = "7c3e5a91d2b4"
down_revision: str | Sequence[str] | None = "419e8fc1e9c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Used when nothing usable is left of an email's local part.
FALLBACK_USERNAME: Final = "user"
_DISALLOWED: Final = re.compile(r"[^a-z0-9_-]")
_SEPARATOR_RUN: Final = re.compile(r"([-_])[-_]+")


def base_username(email: str, rules: UsernameRules) -> str:
    """Turn an email's local part into a well-formed (not necessarily unique) username.

    Accents are dropped (NFKD), the result is lower-cased, any other character becomes
    ``-``, runs of separators collapse to their first character, separators are stripped
    from both ends, it is cut to ``max_length`` and padded with ``0`` to ``min_length``.
    """
    local = email.rpartition("@")[0] or email
    decomposed = unicodedata.normalize("NFKD", local)
    name = "".join(char for char in decomposed if not unicodedata.combining(char)).lower()
    name = _SEPARATOR_RUN.sub(r"\1", _DISALLOWED.sub("-", name)).strip("-_")
    name = name[: rules.max_length].rstrip("-_") or FALLBACK_USERNAME
    return name.ljust(rules.min_length, "0")


def derive_usernames(emails: Iterable[str], rules: UsernameRules) -> list[str]:
    """Return a unique, valid, non-reserved username for each email, in order.

    A taken or reserved name gets the first free numeric suffix (``ada``, ``ada2``,
    ``ada3``, ...), cutting the base so the result stays within ``max_length``.

    Raises:
        RuntimeError: If a derived name doesn't satisfy the rules (a rules change that
            this derivation doesn't cover).
    """
    taken: set[str] = set()
    usernames: list[str] = []
    for email in emails:
        base = base_username(email, rules)
        candidate, number = base, 1
        while candidate in taken or candidate in rules.reserved:
            number += 1
            suffix = str(number)
            candidate = base[: rules.max_length - len(suffix)] + suffix
        if not rules.pattern.fullmatch(candidate):
            raise RuntimeError(f"Derived username {candidate!r} doesn't match the rules.")
        taken.add(candidate)
        usernames.append(candidate)
    return usernames


def upgrade() -> None:
    rules = get_username_rules()
    op.add_column("users", sa.Column("username", sa.String(length=30), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "autoplay_previews", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
    )

    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, email FROM users ORDER BY id")).all()
    usernames = derive_usernames((row.email for row in rows), rules)
    if rows:
        connection.execute(
            sa.text("UPDATE users SET username = :username WHERE id = :id"),
            [
                {"id": row.id, "username": username}
                for row, username in zip(rows, usernames, strict=True)
            ],
        )

    op.alter_column("users", "username", existing_type=sa.String(length=30), nullable=False)
    op.create_unique_constraint(op.f("uq_users_username"), "users", ["username"])
    op.create_check_constraint(
        op.f("ck_users_username_format"), "users", rules.check_constraint_sql()
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_username_format"), "users", type_="check")
    op.drop_constraint(op.f("uq_users_username"), "users", type_="unique")
    op.drop_column("users", "autoplay_previews")
    op.drop_column("users", "username")
