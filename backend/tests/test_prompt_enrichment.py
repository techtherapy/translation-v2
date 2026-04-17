"""Tests for Phase 1 prompt enrichment: style rules + golden examples."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import ContentType, GoldenExample, StyleRule
from app.services.translation.knowledge_retrieval import (
    fetch_matching_golden_examples,
    fetch_matching_style_rules,
)
from app.services.translation.prompts import (
    build_system_prompt,
    build_translation_prompt,
    format_golden_examples_for_prompt,
    format_style_rules_for_prompt,
)


def test_format_style_rules_empty():
    assert format_style_rules_for_prompt(None) == ""
    assert format_style_rules_for_prompt([]) == ""


def test_format_style_rules_renders_bullets():
    rules = [
        {"content": "Preserve the author's humor."},
        {"content": "Keep sentence length reasonable."},
    ]
    text = format_style_rules_for_prompt(rules)
    assert "Preserve the author's humor." in text
    assert "Keep sentence length reasonable." in text
    assert text.count("- ") == 2


def test_format_golden_examples_empty():
    assert format_golden_examples_for_prompt(None) == ""
    assert format_golden_examples_for_prompt([]) == ""


def test_format_golden_examples_renders_pairs():
    examples = [
        {"source_text": "師尊說：", "translated_text": "Grand Master said:", "notes": "standard opening"},
    ]
    text = format_golden_examples_for_prompt(examples, "Chinese", "English")
    assert "師尊說：" in text
    assert "Grand Master said:" in text
    assert "standard opening" in text
    assert "Example 1" in text


def test_system_prompt_injects_style_rules():
    rules = [{"content": "Do not flatten self-deprecating humor."}]
    prompt = build_system_prompt(target_language="English", style_rules=rules)
    assert "Do not flatten self-deprecating humor." in prompt
    assert "Additional style guidance" in prompt


def test_translation_prompt_injects_golden_examples():
    examples = [{"source_text": "師尊說：", "translated_text": "Grand Master said:"}]
    prompt = build_translation_prompt(
        source_text="今天我們討論密宗。",
        target_language="English",
        golden_examples=examples,
    )
    assert "師尊說：" in prompt
    assert "Grand Master said:" in prompt
    # Examples must appear before the text-to-translate block
    assert prompt.index("Grand Master said:") < prompt.index("今天我們討論密宗。")


def test_system_prompt_composes_custom_instructions_with_rules():
    prompt = build_system_prompt(
        target_language="English",
        custom_instructions="Use British spelling.",
        style_rules=[{"content": "Keep register formal."}],
    )
    assert "Use British spelling." in prompt
    assert "Keep register formal." in prompt


# ----- DB retrieval -----

async def test_fetch_matching_style_rules_respects_scope(db_session: AsyncSession, seed_data):
    db_session.add_all([
        StyleRule(content="en-only rule", language_id=seed_data["en"].id),
        StyleRule(content="zh-only rule", language_id=seed_data["zh"].id),
        StyleRule(content="universal rule"),
        StyleRule(content="inactive", language_id=seed_data["en"].id, is_active=False),
    ])
    await db_session.commit()

    rules = await fetch_matching_style_rules(db_session, language_id=seed_data["en"].id)
    contents = {r["content"] for r in rules}
    assert contents == {"en-only rule", "universal rule"}
    assert all("id" in r and "revision" in r for r in rules)


async def test_fetch_matching_style_rules_respects_content_type(db_session: AsyncSession, seed_data):
    ct = ContentType(name="dharma talk")
    db_session.add(ct)
    await db_session.flush()

    db_session.add_all([
        StyleRule(content="dharma-specific", content_type_id=ct.id),
        StyleRule(content="content-type agnostic"),
    ])
    await db_session.commit()

    rules = await fetch_matching_style_rules(db_session, content_type_id=ct.id)
    contents = {r["content"] for r in rules}
    assert contents == {"dharma-specific", "content-type agnostic"}

    rules_no_type = await fetch_matching_style_rules(db_session)
    contents_no_type = {r["content"] for r in rules_no_type}
    assert contents_no_type == {"content-type agnostic"}, (
        "Rules targeting a specific content_type must NOT match when no type is given"
    )


async def test_fetch_matching_golden_examples(db_session: AsyncSession, seed_data):
    db_session.add_all([
        GoldenExample(source_text="a", translated_text="A", language_id=seed_data["en"].id),
        GoldenExample(source_text="b", translated_text="B", language_id=seed_data["zh"].id),
    ])
    await db_session.commit()

    examples = await fetch_matching_golden_examples(db_session, language_id=seed_data["en"].id)
    assert len(examples) == 1
    assert examples[0]["source_text"] == "a"
    assert "id" in examples[0] and "revision" in examples[0]
