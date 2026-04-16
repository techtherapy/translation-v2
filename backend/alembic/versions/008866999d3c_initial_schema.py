"""initial schema

Revision ID: 008866999d3c
Revises: 
Create Date: 2026-02-16 23:00:57.184909

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '008866999d3c'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Baseline migration — tables already exist via Base.metadata.create_all.
    # For existing databases: run `alembic stamp head` to mark as current.
    # For new databases: init_db() in main.py creates all tables, then stamp head.
    pass


def downgrade() -> None:
    pass
