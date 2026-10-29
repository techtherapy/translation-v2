"""review decision context

Revision ID: 0836b75bd292
Revises: 20260921_docs_review
Create Date: 2026-10-29 10:21:06.996129

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0836b75bd292"
down_revision: str | None = "20260921_docs_review"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("docs_review_decisions") as batch:
        batch.add_column(sa.Column("context_snapshot_id", sa.String(length=36), nullable=True))
        batch.create_foreign_key(
            "fk_review_decision_context", "docs_review_snapshots", ["context_snapshot_id"], ["id"], ondelete="RESTRICT"
        )


def downgrade() -> None:
    with op.batch_alter_table("docs_review_decisions") as batch:
        batch.drop_constraint("fk_review_decision_context", type_="foreignkey")
        batch.drop_column("context_snapshot_id")
