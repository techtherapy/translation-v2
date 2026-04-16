"""Glossary consistency QA check.

Verifies that a translated segment uses the approved glossary translations
for terms found in its source text.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.glossary.term_detection import detect_terms_in_text


async def check_glossary_consistency(
    source_text: str,
    translated_text: str,
    language_id: int,
    db: AsyncSession,
) -> list[dict]:
    """Check whether *translated_text* uses approved glossary translations.

    Returns a list of issues, one per detected glossary term::

        {
            "term_id": int,
            "source_term": str,
            "expected_translation": str,
            "found": bool,         # True when expected translation is present
            "do_not_translate": bool,
            "transliterate": bool,
        }
    """
    detected = await detect_terms_in_text(source_text, language_id, db)
    translated_lower = translated_text.lower()

    issues: list[dict] = []
    for term in detected:
        expected = term.get("translation")
        if not expected:
            continue  # no approved translation for this language — skip

        # For do-not-translate / transliterate terms the source form,
        # Sanskrit form, or approved translation may appear.
        if term.get("do_not_translate") or term.get("transliterate"):
            sanskrit = (term.get("sanskrit") or "").lower()
            found = (
                term["source"] in translated_text
                or expected.lower() in translated_lower
                or (sanskrit and sanskrit in translated_lower)
            )
        else:
            found = expected.lower() in translated_lower

        issues.append(
            {
                "term_id": term["term_id"],
                "source_term": term["source"],
                "expected_translation": expected,
                "found": found,
                "do_not_translate": term.get("do_not_translate", False),
                "transliterate": term.get("transliterate", False),
            }
        )

    return issues
