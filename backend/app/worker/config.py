"""ARQ worker configuration.

This is a spike demonstrating the background-job mechanism for the future
translation pipeline. Run with:

    cd backend && arq app.worker.config.WorkerSettings

Enqueue jobs from the app with `arq.create_pool(WorkerSettings.redis_settings)`
and `await pool.enqueue_job('task_name', ...)`.
"""
from __future__ import annotations

from arq.connections import RedisSettings

from app.core.config import get_settings
from app.worker.tasks import translate_chapter_spike

settings = get_settings()


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


class WorkerSettings:
    """Arq worker definition. Referenced by `arq app.worker.config.WorkerSettings`."""

    functions = [translate_chapter_spike]
    redis_settings = _redis_settings()
    max_jobs = 4
    job_timeout = 1800  # 30 minutes — translation jobs can be long
    keep_result = 3600  # keep results for 1 hour
