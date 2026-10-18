"""The YouTube auto-match cache.

One row per track identity (``itunes:<trackId>`` or a normalized ``q:`` key), shared by
all users: the matched video id (``NULL`` for "no match"), its score, a small details
JSON and the expiry that ``flask sotd prune`` enforces. The
``key_length`` and ``score_range`` constraints are written out because autogenerate only
renders CHECK constraints that the model already declares.

Revision ID: 3c82d7348ba6
Revises: 7c3e5a91d2b4
Create Date: 2026-10-16 01:58:21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "3c82d7348ba6"
down_revision: str | Sequence[str] | None = "7c3e5a91d2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "youtube_matches",
        sa.Column("key", sa.String(length=600), nullable=False),
        sa.Column("video_id", sa.String(length=11), nullable=True),
        sa.Column("score", sa.Double(), nullable=True),
        sa.Column(
            "details",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("octet_length(key) <= 600", name=op.f("ck_youtube_matches_key_length")),
        sa.CheckConstraint(
            "score IS NULL OR (score >= 0 AND score <= 1)",
            name=op.f("ck_youtube_matches_score_range"),
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_youtube_matches")),
    )
    op.create_index(
        op.f("ix_youtube_matches_expires_at"), "youtube_matches", ["expires_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_youtube_matches_expires_at"), table_name="youtube_matches")
    op.drop_table("youtube_matches")
