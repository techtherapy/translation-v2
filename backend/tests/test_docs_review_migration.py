"""Alembic round trips on isolated databases, never the application database."""

import os
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.core.database import Base

ROOT = Path(__file__).resolve().parents[1]
PREVIOUS = "0002_knowledge_base"
REVISION = "20260921_docs_review"


def migrate(url, *args):
    env = {**os.environ, "DATABASE_URL": url}
    result = subprocess.run(  # noqa: S603 -- fixed Alembic executable, controlled arguments
        [
            str(ROOT / ".venv/bin/alembic"),
            *args,
        ],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr


async def round_trip(url):
    engine = create_async_engine(url)
    try:
        async with engine.begin() as connection:
            tables = await connection.run_sync(lambda c: inspect(c).get_table_names())
            assert tables == [], "Disposable migration database must be empty; refusing to change it"
            # The historical baseline is intentionally a no-op. Bootstrap only existing tables.
            old_tables = [table for table in Base.metadata.sorted_tables if not table.name.startswith("docs_review_")]
            await connection.run_sync(lambda c: Base.metadata.create_all(c, tables=old_tables))
            await connection.execute(
                text("INSERT INTO languages (code, name, is_enabled) VALUES ('sentinel', 'Preserve me', true)")
            )
        migrate(url, "stamp", PREVIOUS)
        migrate(url, "upgrade", REVISION)
        expected = {table.name for table in Base.metadata.tables.values() if table.name.startswith("docs_review_")}
        async with engine.connect() as connection:
            tables = set(await connection.run_sync(lambda c: inspect(c).get_table_names()))
            assert expected <= tables
            assert await connection.scalar(text("SELECT name FROM languages WHERE code = 'sentinel'")) == "Preserve me"
        migrate(url, "downgrade", PREVIOUS)
        async with engine.connect() as connection:
            tables = set(await connection.run_sync(lambda c: inspect(c).get_table_names()))
            assert not expected.intersection(tables)
            assert await connection.scalar(text("SELECT name FROM languages WHERE code = 'sentinel'")) == "Preserve me"
        migrate(url, "upgrade", REVISION)
        async with engine.connect() as connection:
            assert expected <= set(await connection.run_sync(lambda c: inspect(c).get_table_names()))
            assert await connection.scalar(text("SELECT name FROM languages WHERE code = 'sentinel'")) == "Preserve me"
        # Leave the explicitly disposable PostgreSQL database intact for inspection.
    finally:
        await engine.dispose()


async def test_sqlite_migration_round_trip(tmp_path):
    await round_trip(f"sqlite+aiosqlite:///{tmp_path / 'migration.db'}")


async def test_postgresql_migration_round_trip():
    configured = os.environ.get("DOCS_REVIEW_TEST_DATABASE_URL")
    if not configured:
        pytest.skip(
            "DOCS_REVIEW_TEST_DATABASE_URL is not configured; requires an empty disposable PostgreSQL test database"
        )
    url = make_url(configured)
    normal = make_url(get_settings().database_url)
    assert url.get_backend_name() == "postgresql", "Migration integration test requires PostgreSQL"
    assert "test" in (url.database or "").lower(), "Disposable database name must contain 'test'"
    assert (url.host, url.port, url.database) != (normal.host, normal.port, normal.database), (
        "Refusing the normal application database"
    )
    await round_trip(url.set(drivername="postgresql+asyncpg").render_as_string(hide_password=False))
