"""ARQ task definitions — spike implementations.

These are proof-of-concept tasks demonstrating the pipeline shape. They are
deliberately minimal: one chapter, no context layering, no confidence scoring,
no QA. The purpose is to validate the job-infrastructure choice (Appendix C
item 1 of the 2026-04-11 spec) before Phase 2 commits to the full pipeline.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import async_session
from app.models.chapter import Chapter
from app.models.segment import Segment

logger = logging.getLogger(__name__)


async def translate_chapter_spike(ctx: dict[str, Any], chapter_id: int, language_id: int) -> dict[str, Any]:
    """Spike: count segments in a chapter and return a summary.

    Intentionally does NOT call the LLM — the goal of this spike is to
    demonstrate that an arq worker can read the DB against the existing async
    session factory and return structured results. LLM wiring belongs to the
    real pipeline orchestrator, not the spike.
    """
    job_id = ctx.get("job_id", "unknown")
    logger.info("translate_chapter_spike job=%s chapter_id=%s lang=%s", job_id, chapter_id, language_id)

    async with async_session() as db:
        result = await db.execute(
            select(Chapter)
            .where(Chapter.id == chapter_id)
            .options(selectinload(Chapter.segments))
        )
        chapter = result.scalar_one_or_none()
        if chapter is None:
            return {"status": "not_found", "chapter_id": chapter_id}

        segments = list(chapter.segments)
        segment_count = len(segments)
        total_chars = sum(len(s.source_text or "") for s in segments)

    return {
        "status": "ok",
        "chapter_id": chapter_id,
        "language_id": language_id,
        "segment_count": segment_count,
        "source_char_count": total_chars,
        "job_id": job_id,
    }
