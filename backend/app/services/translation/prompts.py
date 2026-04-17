"""Prompt templates for Buddhist text translation.

Phase 1 knowledge-base integration: `style_rules` and `golden_examples`
parameters accept lists of dicts (id, revision, content / source_text /
translated_text / notes). Callers are responsible for fetching matching rows
from the DB (filtered by language_id and content_type_id) and forwarding them
here. The prompt builders format them into the prompt and leave it to the
caller to record which rules/examples were used in the future
PipelineSegmentResult.evidence_snapshot (per spec Appendix A, 2026-04-17
amendment).
"""

import os


def _get_prompt(key: str, default: str) -> str:
    """Get prompt from environment (loaded from DB at startup) or use default."""
    return os.environ.get(key) or default


def format_style_rules_for_prompt(rules: list[dict] | None) -> str:
    """Render style rules as a bulleted list suitable for the system prompt.

    Each rule dict must have a `content` key. Rules are rendered in the order
    provided (caller is responsible for priority sorting).
    """
    if not rules:
        return ""
    lines = ["Additional style guidance (human-authored, must be respected):"]
    for rule in rules:
        content = rule.get("content", "").strip()
        if content:
            lines.append(f"- {content}")
    return "\n".join(lines) if len(lines) > 1 else ""


def format_golden_examples_for_prompt(
    examples: list[dict] | None,
    source_language: str = "Chinese",
    target_language: str = "English",
) -> str:
    """Render golden examples as few-shot source/translation pairs.

    Each example dict must have `source_text` and `translated_text` keys.
    Returns a block to be injected into the user prompt before the actual
    text to translate.
    """
    if not examples:
        return ""
    lines = [
        "Examples of exemplary translations (follow this style and register):",
        "",
    ]
    for i, ex in enumerate(examples, 1):
        src = ex.get("source_text", "").strip()
        tgt = ex.get("translated_text", "").strip()
        if not src or not tgt:
            continue
        lines.append(f"Example {i}:")
        lines.append(f"  {source_language}: {src}")
        lines.append(f"  {target_language}: {tgt}")
        notes = (ex.get("notes") or "").strip()
        if notes:
            lines.append(f"  Note: {notes}")
        lines.append("")
    return "\n".join(lines).rstrip()


def _compose_custom_instructions(custom_instructions: str, style_rules_text: str) -> str:
    parts = [p for p in (custom_instructions.strip(), style_rules_text.strip()) if p]
    return "\n\n".join(parts)


def _compose_context_before(context_before: str, golden_examples_text: str) -> str:
    """Prepend golden examples to context_before so the model sees few-shot
    examples BEFORE the text to translate, not after it. Keeps the prompt
    template unchanged to avoid breaking DB-driven prompt overrides.
    """
    parts = [p for p in (golden_examples_text.strip(), context_before.strip()) if p]
    return "\n\n".join(parts)


SYSTEM_PROMPT = """You are an expert translator specializing in Buddhist texts, particularly the works of Living Buddha Lian Sheng (盧勝彥), the founder of True Buddha School (真佛宗).

Key guidelines:
- Translate from {source_language} to {target_language}
- Maintain the spiritual depth and meaning of Buddhist concepts
- Use the approved True Buddha School terminology provided in the glossary below
- Preserve mantras in their romanized Sanskrit form (do not translate mantras)
- Maintain honorific conventions (e.g., 上師 = Root Guru/Grand Master as appropriate)
- Preserve the author's teaching style while making the text accessible to {target_language} readers
- Keep proper nouns consistent with TBS conventions
- Preserve paragraph structure

{era_context}

{glossary_context}

{custom_instructions}"""

TRANSLATION_PROMPT = """Translate the following {source_language} Buddhist text to {target_language}.

{context_before}

--- TEXT TO TRANSLATE ---
{source_text}
--- END TEXT ---

{context_after}

{extra_instructions}

Provide ONLY the translated text. Do not add titles, headers, labels, markdown formatting, or notes. Start directly with the translated content."""


PIVOT_SYSTEM_PROMPT = """You are an expert translator specializing in Buddhist texts, particularly the works of Living Buddha Lian Sheng (盧勝彥), the founder of True Buddha School (真佛宗).

Key guidelines:
- Translate from {source_language} to {target_language}
- The {original_language} original is provided as reference to ensure accuracy and completeness
- Use the {source_language} text as your primary source for translation
- Cross-reference with the {original_language} original to ensure no meaning is lost in relay translation
- Maintain the spiritual depth and meaning of Buddhist concepts
- Use the approved True Buddha School terminology provided in the glossary below
- Preserve mantras in their romanized Sanskrit form (do not translate mantras)
- Maintain honorific conventions (e.g., Root Guru/Grand Master as appropriate)
- Preserve paragraph structure

{era_context}

{glossary_context}

{custom_instructions}"""

PIVOT_TRANSLATION_PROMPT = """Translate the following {source_language} Buddhist text to {target_language}.

--- PRIMARY SOURCE ({source_language}) ---
{pivot_text}
--- END PRIMARY SOURCE ---

--- {original_language} ORIGINAL (for reference) ---
{original_text}
--- END {original_language} ORIGINAL ---

{context_before}

{context_after}

{extra_instructions}

Provide ONLY the translated text. Do not add titles, headers, labels, markdown formatting, or notes. Start directly with the translated content."""


def build_pivot_system_prompt(
    source_language: str,
    target_language: str,
    era_context: str = "",
    glossary_terms: list[dict] | None = None,
    custom_instructions: str = "",
    original_language: str = "Chinese",
    style_rules: list[dict] | None = None,
) -> str:
    glossary_context = ""
    if glossary_terms:
        lines = ["Approved terminology (use these translations):"]
        for term in glossary_terms:
            translation = term.get("translation")
            if not translation:
                continue
            line = f"  {term['source']} → {translation}"
            if term.get("sanskrit"):
                line += f" (Sanskrit: {term['sanskrit']})"
            if term.get("do_not_translate"):
                line += " [DO NOT TRANSLATE - keep romanized]"
            if term.get("transliterate"):
                line += " [TRANSLITERATE - romanize, do not translate meaning]"
            if term.get("tbs_notes"):
                line += f"\n    TBS note: {term['tbs_notes']}"
            if term.get("context_notes"):
                line += f"\n    Context: {term['context_notes']}"
            lines.append(line)
        glossary_context = "\n".join(lines)

    custom_instructions = _compose_custom_instructions(
        custom_instructions, format_style_rules_for_prompt(style_rules)
    )

    return _get_prompt("PROMPT_SYSTEM_PIVOT", PIVOT_SYSTEM_PROMPT).format(
        source_language=source_language,
        target_language=target_language,
        original_language=original_language,
        era_context=era_context,
        glossary_context=glossary_context,
        custom_instructions=custom_instructions,
    )


def build_pivot_translation_prompt(
    pivot_text: str,
    original_text: str,
    source_language: str,
    target_language: str,
    context_before: str = "",
    context_after: str = "",
    extra_instructions: str = "",
    original_language: str = "Chinese",
    golden_examples: list[dict] | None = None,
) -> str:
    ctx_before = ""
    if context_before:
        ctx_before = f"Previous paragraphs for context ({source_language}):\n{context_before}\n"

    ctx_after = ""
    if context_after:
        ctx_after = f"\nFollowing paragraph for context ({source_language}):\n{context_after}"

    examples_text = format_golden_examples_for_prompt(golden_examples, source_language, target_language)
    ctx_before = _compose_context_before(ctx_before, examples_text)

    return _get_prompt("PROMPT_USER_PIVOT", PIVOT_TRANSLATION_PROMPT).format(
        source_language=source_language,
        target_language=target_language,
        original_language=original_language,
        pivot_text=pivot_text,
        original_text=original_text,
        context_before=ctx_before,
        context_after=ctx_after,
        extra_instructions=extra_instructions,
    )


def build_system_prompt(
    target_language: str = "English",
    era_context: str = "",
    glossary_terms: list[dict] | None = None,
    custom_instructions: str = "",
    source_language: str = "Chinese",
    style_rules: list[dict] | None = None,
) -> str:
    glossary_context = ""
    if glossary_terms:
        lines = ["Approved terminology (use these translations):"]
        for term in glossary_terms:
            translation = term.get("translation")
            if not translation:
                continue
            line = f"  {term['source']} → {translation}"
            if term.get("sanskrit"):
                line += f" (Sanskrit: {term['sanskrit']})"
            if term.get("do_not_translate"):
                line += " [DO NOT TRANSLATE - keep romanized]"
            if term.get("transliterate"):
                line += " [TRANSLITERATE - romanize, do not translate meaning]"
            if term.get("tbs_notes"):
                line += f"\n    TBS note: {term['tbs_notes']}"
            if term.get("context_notes"):
                line += f"\n    Context: {term['context_notes']}"
            lines.append(line)
        glossary_context = "\n".join(lines)

    custom_instructions = _compose_custom_instructions(
        custom_instructions, format_style_rules_for_prompt(style_rules)
    )

    return _get_prompt("PROMPT_SYSTEM_DIRECT", SYSTEM_PROMPT).format(
        source_language=source_language,
        target_language=target_language,
        era_context=era_context,
        glossary_context=glossary_context,
        custom_instructions=custom_instructions,
    )


def build_translation_prompt(
    source_text: str,
    target_language: str = "English",
    context_before: str = "",
    context_after: str = "",
    extra_instructions: str = "",
    source_language: str = "Chinese",
    golden_examples: list[dict] | None = None,
) -> str:
    ctx_before = ""
    if context_before:
        ctx_before = f"Previous paragraphs for context:\n{context_before}"

    examples_text = format_golden_examples_for_prompt(golden_examples, source_language, target_language)
    ctx_before = _compose_context_before(ctx_before, examples_text)

    ctx_after = ""
    if context_after:
        ctx_after = f"\nFollowing paragraph for context:\n{context_after}"

    return _get_prompt("PROMPT_USER_DIRECT", TRANSLATION_PROMPT).format(
        source_language=source_language,
        target_language=target_language,
        source_text=source_text,
        context_before=ctx_before,
        context_after=ctx_after,
        extra_instructions=extra_instructions,
    )
