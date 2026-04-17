"""End-to-end test: /api/translate/segment uses seeded knowledge base.

This is the Phase 1 acceptance test — it verifies that when a senior
translator seeds a StyleRule and a GoldenExample, they actually make it into
the prompt sent to the LLM. Without this, the Phase 1 plumbing is decoration.

The LLM itself is monkey-patched: we don't call a real model, we just capture
the prompts that would have been sent and assert the knowledge-base text is
in them.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.book import Book
from app.models.chapter import Chapter
from app.models.knowledge import GoldenExample, StyleRule
from app.models.segment import Segment
from tests.conftest import auth_header


@pytest.fixture()
async def seeded_chapter(db_session: AsyncSession, seed_data):
    """A chapter with one segment for the admin to translate."""
    book = Book(
        title_source="測試書",
        title_translated="Test Book",
        source_language_id=seed_data["zh"].id,
    )
    db_session.add(book)
    await db_session.flush()

    chapter = Chapter(book_id=book.id, title="Chapter 1", order=1)
    db_session.add(chapter)
    await db_session.flush()

    segment = Segment(
        chapter_id=chapter.id,
        source_text="今天我們討論密宗的修行。",
        order=0,
        paragraph_group=1,
    )
    db_session.add(segment)
    await db_session.commit()
    await db_session.refresh(segment)
    return {"book": book, "chapter": chapter, "segment": segment}


async def test_translate_segment_injects_style_rules_and_golden_examples(
    client: AsyncClient,
    admin_token: str,
    db_session: AsyncSession,
    seed_data,
    seeded_chapter,
    monkeypatch,
):
    # Seed knowledge base
    db_session.add_all([
        StyleRule(
            content="Preserve the author's teaching voice; avoid overly formal register.",
            language_id=seed_data["en"].id,
        ),
        StyleRule(content="Keep Sanskrit terms in their romanized form."),  # universal
        GoldenExample(
            source_text="師尊開示：",
            translated_text="Grand Master teaches:",
            language_id=seed_data["en"].id,
            notes="Standard dharma talk opener.",
        ),
    ])
    await db_session.commit()

    # Capture prompts instead of calling a real LLM
    captured = {}

    async def fake_translate_text(system_prompt: str, user_prompt: str, model: str | None = None):
        captured["system"] = system_prompt
        captured["user"] = user_prompt
        return {
            "translated_text": "Today we discuss Tantric practice.",
            "model": "fake-model",
            "token_count": 42,
        }

    monkeypatch.setattr("app.api.translate.translate_text", fake_translate_text)

    resp = await client.post(
        "/api/translate/segment",
        headers=auth_header(admin_token),
        json={
            "segment_id": seeded_chapter["segment"].id,
            "language_id": seed_data["en"].id,
        },
    )

    assert resp.status_code == 200, resp.text

    # Style rules should appear in the SYSTEM prompt
    assert "Preserve the author's teaching voice" in captured["system"]
    assert "Keep Sanskrit terms in their romanized form." in captured["system"]

    # Golden example should appear in the USER prompt, BEFORE the text to translate
    assert "師尊開示：" in captured["user"]
    assert "Grand Master teaches:" in captured["user"]
    assert captured["user"].index("Grand Master teaches:") < captured["user"].index("今天我們討論密宗的修行。")


async def test_translate_segment_works_when_knowledge_base_is_empty(
    client: AsyncClient,
    admin_token: str,
    seed_data,
    seeded_chapter,
    monkeypatch,
):
    """Backward compat: an empty knowledge base must not break translation."""
    captured = {}

    async def fake_translate_text(system_prompt: str, user_prompt: str, model: str | None = None):
        captured["system"] = system_prompt
        captured["user"] = user_prompt
        return {"translated_text": "X", "model": "fake", "token_count": 1}

    monkeypatch.setattr("app.api.translate.translate_text", fake_translate_text)

    resp = await client.post(
        "/api/translate/segment",
        headers=auth_header(admin_token),
        json={
            "segment_id": seeded_chapter["segment"].id,
            "language_id": seed_data["en"].id,
        },
    )

    assert resp.status_code == 200
    # No style-rules section should be appended to the system prompt
    assert "Additional style guidance" not in captured["system"]
    # No golden-example block in the user prompt
    assert "Examples of exemplary translations" not in captured["user"]


async def test_inactive_style_rules_are_not_injected(
    client: AsyncClient,
    admin_token: str,
    db_session: AsyncSession,
    seed_data,
    seeded_chapter,
    monkeypatch,
):
    db_session.add(
        StyleRule(
            content="DEACTIVATED RULE — SHOULD NOT APPEAR.",
            language_id=seed_data["en"].id,
            is_active=False,
        )
    )
    await db_session.commit()

    captured = {}

    async def fake_translate_text(system_prompt: str, user_prompt: str, model: str | None = None):
        captured["system"] = system_prompt
        return {"translated_text": "X", "model": "fake", "token_count": 1}

    monkeypatch.setattr("app.api.translate.translate_text", fake_translate_text)

    await client.post(
        "/api/translate/segment",
        headers=auth_header(admin_token),
        json={
            "segment_id": seeded_chapter["segment"].id,
            "language_id": seed_data["en"].id,
        },
    )

    assert "DEACTIVATED RULE" not in captured["system"]
