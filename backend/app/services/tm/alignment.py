"""Text alignment for TM seeding using bertalign or simple structural matching."""

import re
import logging

logger = logging.getLogger(__name__)


def segment_into_paragraphs(text: str) -> list[str]:
    """Split text into paragraphs on blank lines."""
    paragraphs = re.split(r'\n\s*\n', text.strip())
    return [p.strip() for p in paragraphs if p.strip()]


def structural_align(
    source_paragraphs: list[str],
    translation_paragraphs: list[str],
) -> list[dict]:
    """Simple 1:1 alignment when paragraph counts match or are close.

    Returns list of {"source_text", "translated_text", "confidence",
                     "source_index", "translation_index"} dicts.
    """
    pairs = []
    min_len = min(len(source_paragraphs), len(translation_paragraphs))

    for i in range(min_len):
        pairs.append({
            "source_text": source_paragraphs[i],
            "translated_text": translation_paragraphs[i],
            "confidence": 0.9 if len(source_paragraphs) == len(translation_paragraphs) else 0.7,
            "source_index": i,
            "translation_index": i,
        })

    # Flag unmatched paragraphs
    if len(source_paragraphs) > min_len:
        for i in range(min_len, len(source_paragraphs)):
            pairs.append({
                "source_text": source_paragraphs[i],
                "translated_text": "",
                "confidence": 0.0,
                "source_index": i,
                "translation_index": -1,
            })

    if len(translation_paragraphs) > min_len:
        for i in range(min_len, len(translation_paragraphs)):
            pairs.append({
                "source_text": "",
                "translated_text": translation_paragraphs[i],
                "confidence": 0.0,
                "source_index": -1,
                "translation_index": i,
            })

    return pairs


def embedding_align(
    source_paragraphs: list[str],
    translation_paragraphs: list[str],
) -> list[dict]:
    """Embedding-based alignment using bertalign for mismatched paragraph counts.

    Falls back to structural alignment if bertalign is not available.
    """
    try:
        from bertalign import Bertalign

        src_text = "\n".join(source_paragraphs)
        tgt_text = "\n".join(translation_paragraphs)

        aligner = Bertalign(src_text, tgt_text)
        aligner.align_sents()

        pairs = []
        for src_idxs, tgt_idxs in aligner.result:
            src_text_combined = " ".join(source_paragraphs[i] for i in src_idxs if i < len(source_paragraphs))
            tgt_text_combined = " ".join(translation_paragraphs[i] for i in tgt_idxs if i < len(translation_paragraphs))

            if src_text_combined and tgt_text_combined:
                pairs.append({
                    "source_text": src_text_combined,
                    "translated_text": tgt_text_combined,
                    "confidence": 0.8,
                    "source_index": src_idxs[0] if src_idxs else -1,
                    "translation_index": tgt_idxs[0] if tgt_idxs else -1,
                })

        return pairs

    except ImportError:
        logger.warning("bertalign not available, falling back to structural alignment")
        return structural_align(source_paragraphs, translation_paragraphs)
    except Exception as e:
        logger.error(f"bertalign alignment failed: {e}, falling back to structural alignment")
        return structural_align(source_paragraphs, translation_paragraphs)


def align_texts(
    source_text: str,
    translation_text: str,
) -> list[dict]:
    """Align source and translation texts into paragraph pairs.

    Uses structural alignment if paragraph counts match,
    embedding-based alignment otherwise.
    """
    source_paragraphs = segment_into_paragraphs(source_text)
    translation_paragraphs = segment_into_paragraphs(translation_text)

    if not source_paragraphs or not translation_paragraphs:
        return []

    # If counts are equal or very close (within 10%), use structural alignment
    ratio = len(source_paragraphs) / len(translation_paragraphs)
    if 0.9 <= ratio <= 1.1:
        return structural_align(source_paragraphs, translation_paragraphs)

    # Otherwise use embedding-based alignment
    return embedding_align(source_paragraphs, translation_paragraphs)
