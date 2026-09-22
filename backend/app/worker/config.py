"""ARQ worker configuration.

This is a spike demonstrating the background-job mechanism for the future
translation pipeline. Run with:

    cd backend && arq app.worker.config.WorkerSettings

Enqueue jobs from the app with `arq.create_pool(WorkerSettings.redis_settings)`
and `await pool.enqueue_job('task_name', ...)`.
"""

from __future__ import annotations

from typing import ClassVar

from arq.connections import RedisSettings

from app.core.config import get_settings
from app.core.database import async_session
from app.services.runtime_settings import load_settings_into_env
from app.worker.docs_review import review_docs_snapshot
from app.worker.tasks import translate_chapter_spike

settings = get_settings()


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


async def startup(ctx):
    factory = ctx.get("session_factory", async_session)
    async with factory() as db:
        await load_settings_into_env(db)


class WorkerSettings:
    """Arq worker definition. Referenced by `arq app.worker.config.WorkerSettings`."""

    functions: ClassVar[list] = [translate_chapter_spike, review_docs_snapshot]
    on_startup = startup
    redis_settings = _redis_settings()
    max_jobs = 4
    job_timeout = 1800  # 30 minutes — translation jobs can be long
    keep_result = 3600  # keep results for 1 hour
