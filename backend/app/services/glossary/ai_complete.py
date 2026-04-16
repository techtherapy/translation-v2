"""AI completion service for glossary terms using LiteLLM."""

import json
import logging

from app.services.translation.llm import translate_text

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert in Buddhist terminology, specializing in Chinese Buddhist texts and their translation into multiple languages. You have deep knowledge of:

- Sanskrit and Pali terminology used in Buddhist texts
- True Buddha School (真佛宗) terminology and conventions
- Vajrayana, Mahayana, and Theravada traditions
- Buddhist deities, mantras, mudras, practices, and rituals
- Historical and contemporary Buddhist scholarship

You help complete glossary entries for a Buddhist text translation tool."""

COMPLETE_PROMPT = """Given the following Buddhist glossary term, suggest completions for the missing or empty fields.

Current term data:
- Chinese (source term): {source_term}
- {target_language} translation: {english}
- Sanskrit/Pali: {sanskrit}
- Category: {category}
- Context notes: {context_notes}
- TBS notes: {tbs_notes}
- Project: {project_tags}
- Tradition/Group: {tradition_group}

Fields to complete: {fields_to_complete}

Respond with ONLY a JSON object containing the suggested values for the requested fields. Use these exact field names:
- "translation" - {target_language} translation of the Chinese term (MUST be in {target_language}, not English or any other language)
- "sanskrit" - Sanskrit/Pali/Tibetan equivalent
- "category" - One of: dharma_concept, deity_buddha, mantra, mudra, practice_ritual, person, place_temple, honorific, general
- "confidence" - A number 0.0 to 1.0 indicating your overall confidence in the suggestions

Guidelines:
- For {target_language} translations: use standard Buddhist {target_language} terminology, following True Buddha School conventions where applicable
- For Sanskrit: provide the standard romanized Sanskrit/Pali form if known
- For category: choose the most specific applicable category
- If you're unsure about a field, still provide your best suggestion but lower the confidence score
- Do NOT include fields that were not requested

Respond with ONLY the JSON object, no markdown formatting or explanation."""

BATCH_PROMPT = """Given the following list of Buddhist glossary terms, suggest English translations and Sanskrit equivalents for each.

Terms to complete:
{terms_list}

Respond with ONLY a JSON array where each element has:
- "term_id" - the ID from the input
- "english" - suggested English translation
- "sanskrit" - Sanskrit/Pali equivalent (empty string if unknown)
- "category" - One of: dharma_concept, deity_buddha, mantra, mudra, practice_ritual, person, place_temple, honorific, general
- "confidence" - A number 0.0 to 1.0

Respond with ONLY the JSON array, no markdown formatting or explanation."""


def _build_fields_to_complete(
    term_data: dict,
    requested_fields: list[str] | None,
) -> list[str]:
    """Determine which fields need AI completion."""
    all_completable = ["english", "sanskrit", "category"]

    if requested_fields:
        return [f for f in requested_fields if f in all_completable]

    # Auto-detect empty fields
    fields = []
    if not term_data.get("english"):
        fields.append("english")
    if not term_data.get("sanskrit"):
        fields.append("sanskrit")
    if term_data.get("category") in (None, "", "general"):
        fields.append("category")
    return fields or all_completable


async def ai_complete_term(
    source_term: str,
    english: str = "",
    sanskrit: str = "",
    category: str = "",
    context_notes: str = "",
    tbs_notes: str = "",
    project_tags: str = "",
    tradition_group: str = "",
    fields: list[str] | None = None,
    model: str | None = None,
    target_language: str = "English",
) -> dict:
    """Use AI to suggest completions for a glossary term.

    Returns dict with suggested field values and confidence score.
    """
    term_data = {
        "english": english,
        "sanskrit": sanskrit,
        "category": category,
    }

    fields_to_complete = _build_fields_to_complete(term_data, fields)
    if not fields_to_complete:
        return {"confidence": 1.0}

    # Map internal "english" field name to "translation" in the prompt
    prompt_fields = ["translation" if f == "english" else f for f in fields_to_complete]

    prompt = COMPLETE_PROMPT.format(
        source_term=source_term,
        english=english or "(empty)",
        sanskrit=sanskrit or "(empty)",
        category=category or "(empty)",
        context_notes=context_notes or "(none)",
        tbs_notes=tbs_notes or "(none)",
        project_tags=project_tags or "(none)",
        tradition_group=tradition_group or "(none)",
        fields_to_complete=", ".join(prompt_fields),
        target_language=target_language,
    )

    result = await translate_text(SYSTEM_PROMPT, prompt, model=model)
    raw = result["translated_text"]

    # Strip markdown code fences if present
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    try:
        suggestions = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("AI returned invalid JSON for term '%s': %s", source_term, raw)
        raise ValueError(f"AI returned invalid response: {raw[:200]}")

    # Remap "translation" back to "english" for API compatibility
    if "translation" in suggestions:
        suggestions["english"] = suggestions.pop("translation")

    # Only return requested fields + confidence
    filtered = {}
    for field in fields_to_complete:
        if field in suggestions:
            filtered[field] = suggestions[field]
    filtered["confidence"] = suggestions.get("confidence", 0.5)
    filtered["model"] = result["model"]
    filtered["token_count"] = result["token_count"]

    return filtered


async def ai_complete_batch(
    terms: list[dict],
    model: str | None = None,
) -> list[dict]:
    """Use AI to suggest completions for multiple glossary terms.

    Each term dict should have: term_id, source_term, english (optional), sanskrit (optional)

    Returns list of dicts with: term_id, english, sanskrit, category, confidence
    """
    if not terms:
        return []

    # Build the terms list for the prompt
    lines = []
    for t in terms:
        line = f"- ID {t['term_id']}: {t['source_term']}"
        if t.get("english"):
            line += f" (current English: {t['english']})"
        if t.get("sanskrit"):
            line += f" (current Sanskrit: {t['sanskrit']})"
        lines.append(line)

    prompt = BATCH_PROMPT.format(terms_list="\n".join(lines))

    result = await translate_text(SYSTEM_PROMPT, prompt, model=model)
    raw = result["translated_text"]

    # Strip markdown code fences if present
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    try:
        suggestions = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("AI returned invalid JSON for batch: %s", raw[:500])
        raise ValueError(f"AI returned invalid batch response: {raw[:200]}")

    if not isinstance(suggestions, list):
        raise ValueError("AI returned non-list response for batch completion")

    # Attach model info to each result
    for s in suggestions:
        s["model"] = result["model"]

    return suggestions
