"""Build the immutable Book 300, Chapter 009 Docs-review fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


EXPECTED_SHA256 = "7b97bab8f0343c8787973e1d09671f4f7f8f2a69290a715838f5a35301674ec0"
CHINESE_TITLE = "本尊三摩地之益"
ENGLISH_TITLE = "The Benefits of Yidam Samadhi"
ENGLISH_MARKER = f"009 {ENGLISH_TITLE}"


ANALYST_CARDS: list[dict[str, Any]] = [
    {
        "id": "R1",
        "kind": "review_candidate",
        "title": "Check the condition",
        "source": "只要你「自化本尊」，住於「本尊三摩地」，真實而不動搖，是有大益。",
        "english": "as soon as you transform into your yidam and dwell in yidam samadhi in a true and unwavering state",
        "priority": "Meaning review.",
        "concern": "Does “as long as” preserve the condition in 只要 more accurately?",
        "possible_direction": "Consider “provided that” or “as long as,” subject to the reviewer’s reading of the complete sentence. Preserve the qualification about the state of abiding.",
        "learning_candidate": "Distinguish conditional constructions from temporal triggers. Keep the lesson scoped to comparable constructions; do not globally replace every occurrence of “as soon as.”",
        "provenance": "analyst_development_example",
        "human_confirmed": False,
        "proposed_correction": "I say that as long as you transform into your yidam and dwell in yidam samadhi in a true and unwavering state, there are great benefits.",
    },
    {
        "id": "R2",
        "kind": "review_candidate",
        "title": "Check the Eightfold Path terms",
        "source": "八正道：正見、正思惟、正語、正業、正命、正精進、正念、正定。",
        "english": "right mindset and right thought, respectively.",
        "priority": "Terminology and meaning review.",
        "concern": "Check the English terms for 正思惟 and 正念 against the approved glossary.",
        "reviewer_action": "Confirm the intended mapping and applicable editorial convention, then assess whether any change is needed here. Other terms in the list can be checked in the same review action rather than generating separate noisy alerts.",
        "learning_candidate": "A language- and sense-scoped mapping for the named Eightfold Path list, with edition/style scope if necessary.",
        "reference": "https://en.tbsn.org/wordm/detail/323.html",
        "provenance": "analyst_development_example",
        "human_confirmed": False,
    },
    {
        "id": "R3",
        "kind": "review_candidate",
        "title": "Preserve the wordplay",
        "source": "入「四摩地」，睡著了。",
        "english": "they fall asleep when trying to enter samadhi.",
        "priority": "Authorial voice review.",
        "concern": "How should the translation carry the play on 三摩地 and 四摩地?",
        "reviewer_action": "Make an editorial decision about voice; do not silently normalize the Chinese. No automatic replacement is proposed.",
        "learning_candidate": "An author-specific example of deliberate term alteration in the context of meditation and drowsiness. Future occurrences merit contextual assessment rather than a blanket spelling correction.",
        "reference": "https://tbsn.org/dynamics/detail/86",
        "provenance": "analyst_development_example",
        "human_confirmed": False,
    },
    {
        "id": "R4",
        "kind": "review_candidate",
        "title": "Check the explanation of qi",
        "source": "修「氣」是很重要的。因為「氣動念頭就動」。用「住氣」及「持氣」，來控制念頭，漸漸的穩定心念，集中在本尊的聖像，這是一個很好的方法。",
        "english": "Qi (breathing) practice is crucial and hold the breath (qi) inside you. By letting qi dwell",
        "priority": "Practice terminology review.",
        "concern": "Check whether the added explanations of qi are supported by the source.",
        "reviewer_action": "Confirm the terminology and intended equivalence. Avoid generating new practice instructions as a proposed fix.",
        "learning_candidate": "A scoped terminology rule distinguishing the relevant concepts and identifying when explanatory glosses are permitted.",
        "provenance": "analyst_development_example",
        "human_confirmed": False,
    },
    {
        "id": "F1",
        "kind": "false_alarm_check",
        "title": "Check the four yogas",
        "example": "離戲瑜伽 is rendered Yoga of Renunciation. A generic Buddhist terminology check might prefer a different label. However, a TBSN translation of a Vimalakirti discourse describes renunciation in this position within the same progression, alongside concentration, one taste, and no-practice. That provides evidence against automatically treating “Renunciation” as an error.",
        "desired_behavior": "Consult lineage-specific guidance and the project’s glossary before flagging. If the team confirms this wording, retain the scoped decision as evidence for reducing recurring false alarms. Do not infer that it is approved merely because it appears in another publication.",
        "reference": "https://en.tbsn.org/guidem/detail/3341/Vimalakirti_Sutra_Discourse_57_7_January_2023__-_Chapter_One%E2%80%94Buddhaverse_%28Continued%29.html",
        "provenance": "analyst_development_example",
        "human_confirmed": False,
        "source": "專一瑜伽。離戲瑜伽。一味瑜伽。無修瑜伽。",
        "concern": "Check these lineage terms; an unfamiliar name may still be correct.",
    },
    {
        "id": "F2",
        "kind": "false_alarm_check",
        "title": "Check the list is complete",
        "example": "The Chinese lists six transcendent powers together. The English discusses knowledge of lives in the preceding bullet, then lists five “[other transcendent powers].” A check limited to the second bullet would wrongly report the missing sixth item.",
        "desired_behavior": "Assess coverage over the aligned surrounding passage. Suppress a count-only omission claim. This does not certify the wording of each power; term accuracy is a separate question.",
        "alignment": "surrounding_passage",
        "target_block_ids": ["target-0021", "target-0022"],
        "provenance": "analyst_development_example",
        "human_confirmed": False,
        "source": "尤其是在本尊三摩地中，逐漸能了知「過去世」、「現在世」、「未來世」，宿命的神通均能知曉。甚至，天眼通、天耳通、他心通、神足通、宿命通、漏盡通均可達成。",
        "concern": "Check that all six abilities are present, allowing for a different English order.",
    },
]


def _target_blocks(english_section: str) -> list[dict[str, str]]:
    blocks = []
    for index, text in enumerate(english_section.split("\n"), start=1):
        if index == 1:
            kind = "heading"
        elif text.startswith("o "):
            kind = "list_item"
        else:
            kind = "paragraph"
        blocks.append(
            {"block_id": f"target-{index:04d}", "text": text, "kind": kind}
        )
    return blocks


def build_fixture(
    input_path: Path,
    *,
    expected_sha256: str = EXPECTED_SHA256,
) -> dict[str, Any]:
    raw_bytes = input_path.read_bytes()
    actual_sha256 = hashlib.sha256(raw_bytes).hexdigest()
    if actual_sha256 != expected_sha256:
        raise ValueError(
            f"SHA-256 mismatch for {input_path}: expected {expected_sha256}, "
            f"got {actual_sha256}"
        )

    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(f"UTF-8 decoding failed for {input_path}: {exc}") from exc

    if text.count(ENGLISH_MARKER) != 1:
        raise ValueError(
            f"English title marker mismatch: expected exactly one {ENGLISH_MARKER!r}"
        )
    if CHINESE_TITLE not in text:
        raise ValueError(f"Chinese title mismatch: expected {CHINESE_TITLE!r}")

    chinese_section, english_tail = text.split(ENGLISH_MARKER, 1)
    english_section = ENGLISH_MARKER + english_tail
    return {
        "fixture_version": 2,
        "book_label": "300",
        "chapter_label": "009",
        "source_language": "zh",
        "target_language": "en",
        "source_sha256": actual_sha256,
        "chinese_title": CHINESE_TITLE,
        "english_title": ENGLISH_TITLE,
        "english_status": "unknown",
        "raw_chinese_section": chinese_section,
        "raw_english_section": english_section,
        "source_blocks": [
            {"block_id": "source", "text": chinese_section, "kind": "source"}
        ],
        "target_blocks": _target_blocks(english_section),
        "analyst_cards": ANALYST_CARDS,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    fixture = build_fixture(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(fixture, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
