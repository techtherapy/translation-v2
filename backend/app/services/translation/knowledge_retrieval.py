"""Retrieve matching StyleRule and GoldenExample rows for a translation call.

This is the query layer that sits between the DB (Phase 1 knowledge entities)
and the prompt builders in `prompts.py`. Callers pass in the translation
context (target language, optional content type) and get back two lists of
dicts suitable for direct forwarding to `build_system_prompt(style_rules=...)`
and `build_translation_prompt(golden_examples=...)`.

Each returned dict includes the `id` and `revision` of its source row. Phase 2
will forward these through to `PipelineSegmentResult.evidence_snapshot`.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import GoldenExample, StyleRule


async def fetch_matching_style_rules(
    db: AsyncSession,
    *,
    language_id: int | None = None,
    content_type_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Return active style rules whose language/content-type scopes match.

    A rule with NULL language_id applies to all languages; same for content_type_id.
    """
    q = select(StyleRule).where(StyleRule.is_active.is_(True))
    if language_id is not None:
        q = q.where(or_(StyleRule.language_id == language_id, StyleRule.language_id.is_(None)))
    else:
        q = q.where(StyleRule.language_id.is_(None))
    if content_type_id is not None:
        q = q.where(or_(StyleRule.content_type_id == content_type_id, StyleRule.content_type_id.is_(None)))
    else:
        q = q.where(StyleRule.content_type_id.is_(None))
    q = q.order_by(StyleRule.priority, StyleRule.id).limit(limit)

    result = await db.execute(q)
    rules = result.scalars().all()
    return [
        {
            "id": r.id,
            "revision": r.revision,
            "content": r.content,
            "category": r.category,
            "priority": r.priority,
        }
        for r in rules
    ]


async def fetch_matching_golden_examples(
    db: AsyncSession,
    *,
    language_id: int,
    content_type_id: int | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Return active golden examples for the target language and (optional) content type.

    Examples with NULL content_type_id apply to all content types. When
    `content_type_id` is provided, examples matching it rank ahead of
    content-type-agnostic ones (ordered result mirrors priority intent).
    """
    q = select(GoldenExample).where(
        GoldenExample.is_active.is_(True),
        GoldenExample.language_id == language_id,
    )
    if content_type_id is not None:
        q = q.where(or_(
            GoldenExample.content_type_id == content_type_id,
            GoldenExample.content_type_id.is_(None),
        ))
    else:
        q = q.where(GoldenExample.content_type_id.is_(None))

    # Examples matching the specific content type first, then agnostic ones.
    q = q.order_by(
        GoldenExample.content_type_id.is_(None),
        GoldenExample.id,
    ).limit(limit)

    result = await db.execute(q)
    examples = result.scalars().all()
    return [
        {
            "id": e.id,
            "revision": e.revision,
            "source_text": e.source_text,
            "translated_text": e.translated_text,
            "notes": e.notes,
        }
        for e in examples
    ]
