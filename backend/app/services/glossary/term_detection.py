"""Glossary term detection in source text, with in-memory cache."""

import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.glossary import GlossaryTerm

# ---------------------------------------------------------------------------
# Module-level cache – glossary changes infrequently relative to reads.
# We store plain dicts (not ORM objects) to avoid DetachedInstanceError.
# ---------------------------------------------------------------------------
_cache: dict = {"terms": None, "timestamp": 0.0}
_CACHE_TTL = 300  # seconds (5 minutes)


def invalidate_cache() -> None:
    """Call after any glossary mutation (create/update/delete/import)."""
    _cache["terms"] = None
    _cache["timestamp"] = 0.0


async def _load_all_terms(db: AsyncSession) -> list[dict]:
    """Return all glossary terms with translations, using a TTL cache.

    Results are plain dicts so they remain valid outside a DB session.
    """
    now = time.time()
    if _cache["terms"] is not None and (now - _cache["timestamp"]) < _CACHE_TTL:
        return _cache["terms"]

    result = await db.execute(
        select(GlossaryTerm).options(selectinload(GlossaryTerm.translations))
    )
    orm_terms = list(result.scalars().unique().all())

    terms = []
    for t in orm_terms:
        terms.append({
            "id": t.id,
            "source_term": t.source_term,
            "sanskrit_pali": t.sanskrit_pali,
            "do_not_translate": t.do_not_translate,
            "transliterate": t.transliterate,
            "tbs_notes": t.tbs_notes,
            "context_notes": t.context_notes,
            "category": t.category,
            "translations": [
                {
                    "language_id": tr.language_id,
                    "translated_term": tr.translated_term,
                    "is_preferred": tr.is_preferred,
                }
                for tr in t.translations
            ],
        })

    _cache["terms"] = terms
    _cache["timestamp"] = now
    return terms


def _find_positions(text: str, term: str) -> list[dict]:
    """Return every ``{start, end}`` occurrence of *term* inside *text*."""
    positions: list[dict] = []
    start = 0
    while True:
        idx = text.find(term, start)
        if idx == -1:
            break
        positions.append({"start": idx, "end": idx + len(term)})
        start = idx + 1
    return positions


async def detect_terms_in_text(
    text: str,
    language_id: int,
    db: AsyncSession,
) -> list[dict]:
    """Find glossary terms present in *text* and return rich metadata.

    Returns a list sorted by source-term length descending (longest first)
    so the frontend can prioritise longer matches when highlighting.
    """
    all_terms = await _load_all_terms(db)

    matched: list[dict] = []
    for term in all_terms:
        source = term["source_term"]
        if source not in text:
            continue

        # Pick the preferred translation for the requested language.
        preferred = None
        for tr in term["translations"]:
            if tr["language_id"] == language_id:
                if tr["is_preferred"] or preferred is None:
                    preferred = tr

        matched.append(
            {
                "term_id": term["id"],
                "source": source,
                "translation": preferred["translated_term"] if preferred else None,
                "sanskrit": term["sanskrit_pali"] or None,
                "do_not_translate": term["do_not_translate"],
                "transliterate": term["transliterate"],
                "tbs_notes": term["tbs_notes"] or None,
                "context_notes": term["context_notes"] or None,
                "category": term["category"] or None,
                "positions": _find_positions(text, source),
            }
        )

    matched.sort(key=lambda m: len(m["source"]), reverse=True)
    return matched


async def detect_terms_for_pivot(
    chinese_text: str,
    pivot_text: str,
    pivot_language_id: int,
    target_language_id: int,
    db: AsyncSession,
) -> list[dict]:
    """Detect glossary terms in both Chinese source and pivot text.

    Returns merged glossary context for pivot translation prompts:
    - Terms found in the Chinese text with their target-language translations
    - Terms found in the pivot text (by matching pivot-language translations)
      with their target-language translations
    """
    # Standard detection: Chinese source → target language terms
    chinese_matches = await detect_terms_in_text(chinese_text, target_language_id, db)

    # Also detect terms via pivot text: look for pivot-language translations in the pivot text
    all_terms = await _load_all_terms(db)
    matched_ids = {m["term_id"] for m in chinese_matches}

    for term in all_terms:
        if term["id"] in matched_ids:
            continue

        # Find pivot-language translation for this term
        pivot_translation = None
        for tr in term["translations"]:
            if tr["language_id"] == pivot_language_id:
                if tr["is_preferred"] or pivot_translation is None:
                    pivot_translation = tr

        if not pivot_translation or not pivot_translation["translated_term"]:
            continue

        # Check if the pivot-language translation appears in the pivot text
        if pivot_translation["translated_term"] not in pivot_text:
            continue

        # Found a term via pivot text — get target language translation
        target_translation = None
        for tr in term["translations"]:
            if tr["language_id"] == target_language_id:
                if tr["is_preferred"] or target_translation is None:
                    target_translation = tr

        chinese_matches.append({
            "term_id": term["id"],
            "source": term["source_term"],
            "translation": target_translation["translated_term"] if target_translation else None,
            "sanskrit": term["sanskrit_pali"] or None,
            "do_not_translate": term["do_not_translate"],
            "transliterate": term["transliterate"],
            "tbs_notes": term["tbs_notes"] or None,
            "context_notes": term["context_notes"] or None,
            "category": term["category"] or None,
            "positions": _find_positions(chinese_text, term["source_term"]),
        })

    chinese_matches.sort(key=lambda m: len(m["source"]), reverse=True)
    return chinese_matches
