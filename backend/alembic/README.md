# Alembic migrations

All schema changes from 2026-04-17 onward go through Alembic. The legacy
`_run_migrations()` function in `app/core/database.py` remains in place for
backward compatibility with existing deploys but is **frozen** — no new
column additions, table creations, or data migrations may be added to it.

## First-time setup on an existing database

```bash
# Stamp the baseline as already applied (schema already matches current models via _run_migrations + create_all)
alembic stamp 0001_baseline
```

## Creating a new migration

```bash
# Preferred: autogenerate from model diffs
alembic revision --autogenerate -m "short description"

# Manual: handwritten migration
alembic revision -m "short description"
```

Always review the generated migration before committing — autogenerate is a
starting point, not a finished migration. Check index drops, FK cascades,
and data migrations for correctness.

## Applying migrations

```bash
alembic upgrade head       # apply all pending
alembic downgrade -1       # revert the most recent migration
alembic current            # show current revision
alembic history            # show full history
```

## Deploy integration

Railway deploys first run `python -m app.core.migration_bootstrap`, which
creates the historical pre-Alembic tables only when the baseline anchor is
missing. They then run `alembic upgrade head` before the app begins serving
traffic. This order supports both established databases and completely empty
databases without skipping later Alembic revisions.
