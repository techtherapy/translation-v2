import asyncio
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()


def _fix_db_url(url: str) -> str:
    """Convert Railway's postgresql:// to postgresql+asyncpg:// for SQLAlchemy async."""
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


db_url = _fix_db_url(settings.database_url)

engine = create_async_engine(db_url, echo=settings.debug)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db(retries: int = 5, delay: float = 2.0):
    """Create tables with retry logic for Railway cold-start timing."""
    for attempt in range(1, retries + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("Database initialised successfully.")
            break
        except Exception as exc:
            if attempt < retries:
                logger.warning(
                    "DB init attempt %d/%d failed (%s). Retrying in %.1fs…",
                    attempt, retries, exc, delay,
                )
                await asyncio.sleep(delay)
                delay *= 2  # exponential backoff
            else:
                logger.error("DB init failed after %d attempts: %s", retries, exc)
                raise

    # Legacy migrations (frozen — see policy note on _run_migrations).
    # Existing deploys rely on these having already been applied; they are
    # idempotent so re-running them is safe.
    try:
        await _run_migrations()
    except Exception as exc:
        logger.error("Migrations failed (app will continue): %s", exc)

    # Alembic ownership: ensure alembic_version table exists and is stamped
    # at HEAD so future migrations can layer on top. For existing databases
    # this is a no-op after the first successful run.
    try:
        await _ensure_alembic_baseline()
    except Exception as exc:
        logger.error("Alembic baseline stamp failed (app will continue): %s", exc)


async def _ensure_alembic_baseline():
    """Idempotently create and stamp alembic_version to the HEAD revision.

    Existing deploys never ran `alembic stamp head` manually — this does the
    equivalent on first startup, so going forward `alembic upgrade head` works
    against real infrastructure. Does nothing if alembic_version already holds
    a revision.
    """
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    # Resolve alembic.ini relative to this file: backend/app/core/database.py → backend/alembic.ini
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    ini_path = os.path.abspath(os.path.join(here, "..", "..", "alembic.ini"))
    if not os.path.exists(ini_path):
        logger.info("alembic.ini not found at %s — skipping baseline stamp", ini_path)
        return

    alembic_cfg = Config(ini_path)
    alembic_cfg.set_main_option("script_location", os.path.join(os.path.dirname(ini_path), "alembic"))
    script = ScriptDirectory.from_config(alembic_cfg)
    head_revision = script.get_current_head()
    if head_revision is None:
        logger.info("Alembic has no revisions yet — skipping baseline stamp")
        return

    async with engine.begin() as conn:
        # Check if alembic_version exists
        exists = await conn.execute(text(
            "SELECT 1 FROM information_schema.tables WHERE table_name = 'alembic_version'"
        ))
        if exists.fetchone():
            current = await conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
            row = current.fetchone()
            if row:
                logger.info("Alembic already at revision %s", row[0])
                return
            # Table exists but empty — insert head
            await conn.execute(text("INSERT INTO alembic_version (version_num) VALUES (:v)"), {"v": head_revision})
            logger.info("Alembic stamped: inserted HEAD %s into empty alembic_version", head_revision)
            return

        # Create the table and stamp HEAD
        await conn.execute(text(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL, "
            "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
        ))
        await conn.execute(text("INSERT INTO alembic_version (version_num) VALUES (:v)"), {"v": head_revision})
        logger.info("Alembic stamped: created alembic_version and inserted HEAD %s", head_revision)


async def _safe_execute(label: str, coro):
    """Run a migration step, log and skip on failure."""
    try:
        await coro
    except Exception as exc:
        logger.warning("Migration '%s' skipped: %s", label, exc)


async def _add_column_if_missing(table: str, column: str, col_def: str):
    """Add a column to a table if it doesn't exist (own transaction)."""
    async with engine.begin() as conn:
        result = await conn.execute(text(
            f"SELECT 1 FROM information_schema.columns "
            f"WHERE table_name = '{table}' AND column_name = '{column}'"
        ))
        if not result.fetchone():
            await conn.execute(text(
                f"ALTER TABLE {table} ADD COLUMN {column} {col_def}"
            ))
            logger.info("Migration: added %s.%s", table, column)


async def _run_migrations():
    """FROZEN. Apply schema changes that create_all doesn't handle on existing tables.

    ⚠️ DO NOT ADD NEW MIGRATIONS HERE. As of 2026-04-17, all schema changes go
    through Alembic (see backend/alembic/README.md). This function remains only
    to keep existing deploys idempotently healthy; every step below is already
    applied in production. New columns, tables, indexes, enum conversions, or
    data backfills MUST be added as an Alembic revision:

        cd backend && alembic revision --autogenerate -m "short description"

    Rationale: each step here is wrapped in _safe_execute, which logs and
    continues on failure — a silent-failure pattern that is acceptable for
    idempotent legacy migrations but unacceptable as a primary migration
    strategy.

    Each step runs in its own transaction so one failure doesn't block others.
    """

    # --- Simple column additions ---
    column_migrations = [
        ("books", "content_type", "VARCHAR(10) NOT NULL DEFAULT 'book'"),
        ("books", "book_number", "INTEGER"),
        ("glossary_terms", "project_tags", "VARCHAR(500) NOT NULL DEFAULT ''"),
        ("glossary_terms", "source_reference", "TEXT NOT NULL DEFAULT ''"),
        ("glossary_terms", "tradition_group", "VARCHAR(200) NOT NULL DEFAULT ''"),
        ("glossary_terms", "source_language_id", "INTEGER REFERENCES languages(id) ON DELETE SET NULL"),
        ("languages", "reference_language_id", "INTEGER REFERENCES languages(id) ON DELETE SET NULL"),
        ("translations", "source_language_id", "INTEGER REFERENCES languages(id) ON DELETE SET NULL"),
        ("translations", "pivot_translation_id", "INTEGER REFERENCES translations(id) ON DELETE SET NULL"),
        ("tm_entries", "source_language_id", "INTEGER REFERENCES languages(id) ON DELETE SET NULL"),
        ("translation_versions", "llm_model_used", "VARCHAR(200)"),
        ("book_translations", "translated_title", "VARCHAR(500) NOT NULL DEFAULT ''"),
        ("book_translations", "track_changes", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ("translations", "previous_text", "TEXT"),
        ("segments", "paragraph_group", "INTEGER NOT NULL DEFAULT 1"),
        ("books", "source_language_id", "INTEGER REFERENCES languages(id) ON DELETE SET NULL"),
        ("segment_comments", "quoted_text", "TEXT"),
        ("translations", "content_format", "VARCHAR(20) DEFAULT 'plain'"),
        ("translation_versions", "content_format", "VARCHAR(20) DEFAULT 'plain'"),
    ]
    for table, col, col_def in column_migrations:
        await _safe_execute(f"{table}.{col}", _add_column_if_missing(table, col, col_def))

    # --- Unique index on book_number ---
    async def _book_number_index():
        async with engine.begin() as conn:
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_books_book_number "
                "ON books (book_number) WHERE book_number IS NOT NULL"
            ))
    await _safe_execute("book_number index", _book_number_index())

    # --- Backfill books.source_language_id with Chinese for existing books ---
    async def _backfill_book_source_language():
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT COUNT(*) FROM books WHERE source_language_id IS NULL"
            ))
            null_count = result.scalar()
            if null_count and null_count > 0:
                await conn.execute(text(
                    "UPDATE books SET source_language_id = ("
                    "  SELECT id FROM languages WHERE code = 'zh' LIMIT 1"
                    ") WHERE source_language_id IS NULL"
                ))
                logger.info("Migration: backfilled %d books with Chinese source_language_id", null_count)
    await _safe_execute("backfill book source_language", _backfill_book_source_language())

    # --- Widen translated_term to TEXT ---
    async def _widen_translated_term():
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name = 'glossary_translations' AND column_name = 'translated_term'"
            ))
            row = result.fetchone()
            if row and row[0] == 'character varying':
                await conn.execute(text(
                    "ALTER TABLE glossary_translations ALTER COLUMN translated_term TYPE TEXT"
                ))
                logger.info("Migration: widened translated_term to TEXT")
    await _safe_execute("widen translated_term", _widen_translated_term())

    # --- Convert glossary category ENUM to VARCHAR ---
    async def _category_enum_to_varchar():
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name = 'glossary_terms' AND column_name = 'category'"
            ))
            row = result.fetchone()
            if row and row[0] == 'USER-DEFINED':
                await conn.execute(text("ALTER TABLE glossary_terms ALTER COLUMN category TYPE VARCHAR(50) USING category::text"))
                await conn.execute(text("ALTER TABLE glossary_terms ALTER COLUMN category SET DEFAULT 'general'"))
                await conn.execute(text("DROP TYPE IF EXISTS termcategory"))
                logger.info("Migration: converted category ENUM to VARCHAR(50)")
    await _safe_execute("category enum→varchar", _category_enum_to_varchar())

    # --- Seed default glossary categories ---
    async def _seed_categories():
        async with engine.begin() as conn:
            result = await conn.execute(text("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'glossary_categories'"))
            if not result.scalar():
                return
            for key, label, color, sort_order in [
                ("dharma_concept", "Dharma Concept", "amber", 0), ("deity_buddha", "Deity/Buddha", "purple", 1),
                ("mantra", "Mantra", "red", 2), ("mudra", "Mudra", "pink", 3),
                ("practice_ritual", "Practice/Ritual", "blue", 4), ("person", "Person", "green", 5),
                ("place_temple", "Place/Temple", "cyan", 6), ("honorific", "Honorific", "orange", 7),
                ("general", "General", "gray", 8),
            ]:
                exists = await conn.execute(text("SELECT 1 FROM glossary_categories WHERE key = :key"), {"key": key})
                if not exists.fetchone():
                    await conn.execute(text(
                        "INSERT INTO glossary_categories (key, label, color, sort_order, is_builtin) VALUES (:key, :label, :color, :sort_order, true)"
                    ), {"key": key, "label": label, "color": color, "sort_order": sort_order})
    await _safe_execute("seed categories", _seed_categories())

    # --- Backfill categories from glossary_terms ---
    async def _backfill_categories():
        async with engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO glossary_categories (key, label, color, sort_order, is_builtin) "
                "SELECT DISTINCT t.category, REPLACE(INITCAP(REPLACE(t.category, '_', ' ')), '_', ' '), 'gray', 0, false "
                "FROM glossary_terms t "
                "WHERE t.category IS NOT NULL AND t.category != '' "
                "  AND t.category NOT IN (SELECT key FROM glossary_categories)"
            ))
    await _safe_execute("backfill categories", _backfill_categories())

    # --- Backfill projects from glossary_terms.project_tags ---
    async def _backfill_projects():
        async with engine.begin() as conn:
            await conn.execute(text(
                "INSERT INTO glossary_projects (name, description, is_active) "
                "SELECT DISTINCT TRIM(tag), '', true "
                "FROM glossary_terms, unnest(string_to_array(project_tags, ',')) AS tag "
                "WHERE project_tags IS NOT NULL AND project_tags != '' "
                "  AND TRIM(tag) != '' AND TRIM(tag) NOT IN (SELECT name FROM glossary_projects)"
            ))
    await _safe_execute("backfill projects", _backfill_projects())

    # --- Rename title_chinese/title_english ---
    async def _rename_title_columns():
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT 1 FROM information_schema.columns WHERE table_name = 'books' AND column_name = 'title_chinese'"
            ))
            if result.fetchone():
                await conn.execute(text("ALTER TABLE books RENAME COLUMN title_chinese TO title_source"))
                await conn.execute(text("ALTER TABLE books RENAME COLUMN title_english TO title_translated"))
                logger.info("Migration: renamed title columns")
    await _safe_execute("rename title columns", _rename_title_columns())

    # --- Auto-populate book_translations ---
    async def _auto_populate_book_translations():
        async with engine.begin() as conn:
            result = await conn.execute(text("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'book_translations'"))
            if not result.scalar():
                return
            populated = await conn.execute(text(
                "INSERT INTO book_translations (book_id, target_language_id, status) "
                "SELECT c.book_id, t.language_id, 'in_progress' "
                "FROM translations t "
                "JOIN segments s ON t.segment_id = s.id "
                "JOIN chapters c ON s.chapter_id = c.id "
                "WHERE NOT EXISTS ("
                "  SELECT 1 FROM book_translations bt "
                "  WHERE bt.book_id = c.book_id AND bt.target_language_id = t.language_id"
                ") GROUP BY c.book_id, t.language_id"
            ))
            if populated.rowcount:
                logger.info("Migration: auto-populated %d book_translations", populated.rowcount)
    await _safe_execute("auto-populate book_translations", _auto_populate_book_translations())

    # --- Create segment_comments table ---
    async def _create_segment_comments():
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS segment_comments (
                    id SERIAL PRIMARY KEY,
                    segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
                    language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    text TEXT NOT NULL,
                    parent_id INTEGER REFERENCES segment_comments(id) ON DELETE CASCADE,
                    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
                    resolved_by INTEGER REFERENCES users(id),
                    resolved_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                )
            """))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_segment_comments_segment_language "
                "ON segment_comments(segment_id, language_id)"
            ))
    await _safe_execute("segment_comments table", _create_segment_comments())

    # --- Create comment_reactions table ---
    async def _create_comment_reactions():
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS comment_reactions (
                    id SERIAL PRIMARY KEY,
                    comment_id INTEGER NOT NULL REFERENCES segment_comments(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    emoji VARCHAR(8) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                    UNIQUE(comment_id, user_id, emoji)
                )
            """))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment "
                "ON comment_reactions(comment_id)"
            ))
    await _safe_execute("comment_reactions table", _create_comment_reactions())
