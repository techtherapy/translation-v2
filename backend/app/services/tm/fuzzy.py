"""Fuzzy matching for Translation Memory lookups."""

from rapidfuzz import fuzz


def fuzzy_match(
    query: str,
    candidates: list[dict],
    threshold: float = 0.75,
    limit: int = 5,
) -> list[dict]:
    """Find fuzzy matches for a source text against TM entries.

    Args:
        query: Source text to search for
        candidates: List of dicts with at least "source_text" key
        threshold: Minimum similarity (0.0-1.0)
        limit: Max results to return

    Returns:
        List of dicts with added "similarity" key, sorted by similarity desc
    """
    scored = []
    for entry in candidates:
        ratio = fuzz.ratio(query, entry["source_text"]) / 100.0
        if ratio >= threshold:
            scored.append({**entry, "similarity": ratio})

    scored.sort(key=lambda x: x["similarity"], reverse=True)
    return scored[:limit]
