"""Initial schema: users, user_sessions, entries, annotations, uploads.

Revision ID: 419e8fc1e9c6
Revises:
Create Date: 2026-10-11 21:47:31
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "419e8fc1e9c6"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamp(name: str) -> sa.Column[datetime]:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=50), nullable=False),
        sa.Column("bio", sa.String(length=280), server_default="", nullable=False),
        sa.Column(
            "theme", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )

    op.create_table(
        "user_sessions",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.CHAR(length=64), nullable=False),
        sa.Column("remember", sa.Boolean(), nullable=False),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        _timestamp("created_at"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_user_sessions_token_hash")),
    )
    op.create_index(op.f("ix_user_sessions_user_id"), "user_sessions", ["user_id"])

    op.create_table(
        "entries",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("artist", sa.String(length=300), nullable=False),
        sa.Column("album", sa.String(length=300), nullable=True),
        sa.Column("artwork_url", sa.String(length=1000), nullable=True),
        sa.Column("preview_url", sa.String(length=1000), nullable=True),
        sa.Column("external_url", sa.String(length=1000), nullable=True),
        sa.Column("youtube_video_id", sa.String(length=11), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("source_id", sa.String(length=64), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint("source IN ('itunes', 'manual')", name=op.f("ck_entries_source_valid")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_entries_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_entries")),
        # Its index also serves (user_id, entry_date DESC) scans.
        sa.UniqueConstraint("user_id", "entry_date", name=op.f("uq_entries_user_id_entry_date")),
    )

    op.create_table(
        "annotations",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("entry_id", sa.BigInteger(), nullable=False),
        sa.Column("start_ms", sa.Integer(), nullable=False),
        sa.Column("end_ms", sa.Integer(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("color", sa.String(length=16), server_default="yellow", nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        sa.CheckConstraint(
            "start_ms BETWEEN 0 AND 86400000", name=op.f("ck_annotations_start_ms_range")
        ),
        sa.CheckConstraint(
            "end_ms IS NULL OR (end_ms > start_ms AND end_ms <= 86400000)",
            name=op.f("ck_annotations_end_after_start"),
        ),
        sa.ForeignKeyConstraint(
            ["entry_id"],
            ["entries.id"],
            name=op.f("fk_annotations_entry_id_entries"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_annotations")),
    )
    op.create_index(op.f("ix_annotations_entry_id"), "annotations", ["entry_id"])

    op.create_table(
        "uploads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("content_type", sa.String(length=64), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.CHAR(length=64), nullable=False),
        _timestamp("created_at"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_uploads_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_uploads")),
    )
    op.create_index(op.f("ix_uploads_user_id"), "uploads", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_uploads_user_id"), table_name="uploads")
    op.drop_table("uploads")
    op.drop_index(op.f("ix_annotations_entry_id"), table_name="annotations")
    op.drop_table("annotations")
    op.drop_table("entries")
    op.drop_index(op.f("ix_user_sessions_user_id"), table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_table("users")
