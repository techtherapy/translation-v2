"""Smoke tests for the ARQ worker spike.

These do not require a running Redis or worker — they only verify that the
worker module imports cleanly, WorkerSettings is well-formed, and the task
function works when invoked directly against the in-memory test DB.
"""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.chapter import Chapter
from app.models.segment import Segment


async def test_worker_module_imports():
    from app.worker.config import WorkerSettings

    assert WorkerSettings.functions, "WorkerSettings must register at least one function"
    assert WorkerSettings.max_jobs > 0
    assert WorkerSettings.job_timeout > 0


async def test_translate_chapter_spike_returns_summary(db_session: AsyncSession, seed_data, monkeypatch):
    from app.worker import tasks

    book = Book(title_source="测试", title_translated="Test", source_language_id=seed_data["zh"].id)
    db_session.add(book)
    await db_session.flush()

    chapter = Chapter(book_id=book.id, title="Chapter 1", order=1)
    db_session.add(chapter)
    await db_session.flush()

    db_session.add_all([
        Segment(chapter_id=chapter.id, source_text="第一段", order=0, paragraph_group=1),
        Segment(chapter_id=chapter.id, source_text="第二段", order=1, paragraph_group=1),
    ])
    await db_session.commit()

    # Route the task's async_session to the test SQLite session factory.
    from sqlalchemy.ext.asyncio import async_sessionmaker

    test_factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr("app.worker.tasks.async_session", test_factory)

    ctx = {"job_id": "test-job"}
    result = await tasks.translate_chapter_spike(ctx, chapter_id=chapter.id, language_id=seed_data["en"].id)

    assert result["status"] == "ok"
    assert result["chapter_id"] == chapter.id
    assert result["segment_count"] == 2
    assert result["source_char_count"] == len("第一段") + len("第二段")


async def test_translate_chapter_spike_handles_missing_chapter(seed_data, monkeypatch, db_session):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.worker import tasks

    test_factory = async_sessionmaker(db_session.bind, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr("app.worker.tasks.async_session", test_factory)

    result = await tasks.translate_chapter_spike({}, chapter_id=99999, language_id=seed_data["en"].id)

    assert result["status"] == "not_found"
    assert result["chapter_id"] == 99999
