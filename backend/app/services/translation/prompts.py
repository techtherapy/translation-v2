"""Prompt templates for Buddhist text translation."""

import os


def _get_prompt(key: str, default: str) -> str:
    """Get prompt from environment (loaded from DB at startup) or use default."""
    return os.environ.get(key) or default


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
) -> str:
    ctx_before = ""
    if context_before:
        ctx_before = f"Previous paragraphs for context ({source_language}):\n{context_before}\n"

    ctx_after = ""
    if context_after:
        ctx_after = f"\nFollowing paragraph for context ({source_language}):\n{context_after}"

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
) -> str:
    ctx_before = ""
    if context_before:
        ctx_before = f"Previous paragraphs for context:\n{context_before}\n"

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
