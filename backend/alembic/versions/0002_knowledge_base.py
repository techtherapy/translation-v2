"""Phase 1 knowledge base: content_types, style_rules, golden_examples

Revision ID: 0002_knowledge_base
Revises: 008866999d3c
Create Date: 2026-04-17

Adds the three Phase 1 tables per the 2026-04-11 spec (Appendix A, as amended
2026-04-17). Each table carries a `revision` column bumped on every edit so
that `PipelineSegmentResult.evidence_snapshot` (future Phase 2) can record the
exact version of each knowledge input that shaped a given translation.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0002_knowledge_base"
down_revision: str | None = "008866999d3c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "content_types",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="uq_content_types_name"),
    )

    op.create_table(
        "style_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=50), nullable=False, server_default="style"),
        sa.Column("content_type_id", sa.Integer(), sa.ForeignKey("content_types.id", ondelete="SET NULL"), nullable=True),
        sa.Column("language_id", sa.Integer(), sa.ForeignKey("languages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_style_rules_content_type_id", "style_rules", ["content_type_id"])
    op.create_index("ix_style_rules_language_id", "style_rules", ["language_id"])

    op.create_table(
        "golden_examples",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_text", sa.Text(), nullable=False),
        sa.Column("translated_text", sa.Text(), nullable=False),
        sa.Column("language_id", sa.Integer(), sa.ForeignKey("languages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_type_id", sa.Integer(), sa.ForeignKey("content_types.id", ondelete="SET NULL"), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("nominated_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("confirmed_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_golden_examples_language_id", "golden_examples", ["language_id"])
    op.create_index("ix_golden_examples_content_type_id", "golden_examples", ["content_type_id"])


def downgrade() -> None:
    op.drop_index("ix_golden_examples_content_type_id", table_name="golden_examples")
    op.drop_index("ix_golden_examples_language_id", table_name="golden_examples")
    op.drop_table("golden_examples")
    op.drop_index("ix_style_rules_language_id", table_name="style_rules")
    op.drop_index("ix_style_rules_content_type_id", table_name="style_rules")
    op.drop_table("style_rules")
    op.drop_table("content_types")
