"""Prepare the historical baseline before Alembic runs.

The first Alembic revision is intentionally a no-op because established BITS
databases already had the legacy schema. A brand-new database therefore needs
those baseline tables once, before Alembic applies later revisions.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.database import Base, engine

logger = logging.getLogger(__name__)

_MIGRATION_OWNED_TABLES = {
    "content_types",
    "style_rules",
    "golden_examples",
}


def _is_baseline_table(name: str) -> bool:
    return name not in _MIGRATION_OWNED_TABLES and not name.startswith("docs_review_")


async def bootstrap_baseline_tables(db_engine: AsyncEngine = engine) -> bool:
    """Create the pre-Alembic schema when its anchor table is absent.

    Returns ``True`` only when baseline creation ran. Later Alembic-owned
    tables remain absent so ``alembic upgrade head`` can create and version
    them normally. This also repairs a database where a previous empty-schema
    migration reached a later revision before discovering that the baseline
    tables were missing.
    """
    import app.models  # noqa: F401  # populate Base.metadata

    async with db_engine.begin() as connection:
        existing = set(await connection.run_sync(lambda sync: inspect(sync).get_table_names()))
        if "users" in existing:
            return False

        baseline_tables = [table for table in Base.metadata.sorted_tables if _is_baseline_table(table.name)]
        await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=baseline_tables))

    logger.info("Created %d historical baseline tables before Alembic upgrade", len(baseline_tables))
    return True


def main() -> None:
    asyncio.run(bootstrap_baseline_tables())


if __name__ == "__main__":
    main()
