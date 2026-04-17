"""Phase 1 smoke test — see what the knowledge base does to a real prompt.

Usage:
    cd backend
    .venv/bin/python scripts/phase1_smoke_test.py              # prompt diff only (no LLM call, free)
    .venv/bin/python scripts/phase1_smoke_test.py --call-llm   # also call the real LLM twice and show the translation diff

The --call-llm flag requires your LiteLLM API key to be in the environment
(ANTHROPIC_API_KEY, OPENAI_API_KEY, etc. — whichever provider your default
model uses).

This script uses the real prompt builders from `app.services.translation.prompts`
and the same StyleRule/GoldenExample shapes that the API layer produces, so
what you see here is exactly what the live /api/translate/segment path sends
to the LLM.
"""
from __future__ import annotations

import argparse
import difflib
import os
import sys
from pathlib import Path

# Make the backend's `app` package importable when running this script directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.translation.prompts import build_system_prompt, build_translation_prompt  # noqa: E402

SAMPLE_SOURCE = "今天我們討論密宗的修行方法，師尊常常說：修行要有恆心。"

# What a minimal senior-translator-authored seed looks like.
STYLE_RULES = [
    {
        "id": 1,
        "revision": 1,
        "content": (
            "Preserve the author's warm, teaching voice. Do not flatten his "
            "language into generic formal Buddhist English — the register "
            "should feel like a teacher speaking directly to students."
        ),
    },
    {
        "id": 2,
        "revision": 1,
        "content": "Keep Sanskrit terms (mantra names, deity names) in their romanized form.",
    },
    {
        "id": 3,
        "revision": 1,
        "content": "Translate 師尊 as 'Grand Master' (his preferred honorific in English).",
    },
]

GOLDEN_EXAMPLES = [
    {
        "id": 1,
        "revision": 1,
        "source_text": "師尊常常教我們：密宗的修行要有恆心。",
        "translated_text": "Grand Master often teaches us: Tantric practice requires perseverance.",
        "notes": "Direct, warm, preserves the teaching cadence.",
    },
]


def banner(title: str) -> None:
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


def show_prompt_diff() -> tuple[str, str, str, str]:
    """Build the two prompt variants and print them. Returns (sys_empty, user_empty, sys_seeded, user_seeded)."""

    sys_empty = build_system_prompt(
        target_language="English",
        glossary_terms=[],
        source_language="Chinese",
    )
    user_empty = build_translation_prompt(
        source_text=SAMPLE_SOURCE,
        target_language="English",
        source_language="Chinese",
    )

    sys_seeded = build_system_prompt(
        target_language="English",
        glossary_terms=[],
        source_language="Chinese",
        style_rules=STYLE_RULES,
    )
    user_seeded = build_translation_prompt(
        source_text=SAMPLE_SOURCE,
        target_language="English",
        source_language="Chinese",
        golden_examples=GOLDEN_EXAMPLES,
    )

    banner("SOURCE TEXT")
    print(SAMPLE_SOURCE)

    banner("SYSTEM PROMPT — without knowledge base")
    print(sys_empty)

    banner("SYSTEM PROMPT — with 3 style rules seeded")
    print(sys_seeded)

    banner("USER PROMPT — without knowledge base")
    print(user_empty)

    banner("USER PROMPT — with 1 golden example seeded")
    print(user_seeded)

    # Show a unified diff so the addition is obvious
    banner("DIFF: system prompt (empty → seeded)")
    for line in difflib.unified_diff(
        sys_empty.splitlines(),
        sys_seeded.splitlines(),
        lineterm="",
        fromfile="system prompt (no rules)",
        tofile="system prompt (3 rules)",
        n=1,
    ):
        print(line)

    banner("DIFF: user prompt (empty → seeded)")
    for line in difflib.unified_diff(
        user_empty.splitlines(),
        user_seeded.splitlines(),
        lineterm="",
        fromfile="user prompt (no examples)",
        tofile="user prompt (1 example)",
        n=1,
    ):
        print(line)

    return sys_empty, user_empty, sys_seeded, user_seeded


async def call_llm_twice(sys_empty: str, user_empty: str, sys_seeded: str, user_seeded: str) -> None:
    """Call the configured LLM once without knowledge, once with, and print both translations."""
    from app.services.translation.llm import translate_text

    banner("LLM CALL 1: without knowledge base")
    result_empty = await translate_text(sys_empty, user_empty)
    print(f"[model: {result_empty['model']}, tokens: {result_empty['token_count']}]")
    print()
    print(result_empty["translated_text"])

    banner("LLM CALL 2: with 3 style rules + 1 golden example")
    result_seeded = await translate_text(sys_seeded, user_seeded)
    print(f"[model: {result_seeded['model']}, tokens: {result_seeded['token_count']}]")
    print()
    print(result_seeded["translated_text"])

    banner("DIFF: translation output (empty → seeded)")
    for line in difflib.unified_diff(
        result_empty["translated_text"].splitlines(),
        result_seeded["translated_text"].splitlines(),
        lineterm="",
        fromfile="translation (no knowledge)",
        tofile="translation (with knowledge)",
        n=1,
    ):
        print(line)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--call-llm",
        action="store_true",
        help="Also call the real LLM twice and show the translation diff. Requires an API key in env.",
    )
    args = parser.parse_args()

    sys_empty, user_empty, sys_seeded, user_seeded = show_prompt_diff()

    if args.call_llm:
        import asyncio
        try:
            asyncio.run(call_llm_twice(sys_empty, user_empty, sys_seeded, user_seeded))
        except Exception as exc:
            print()
            print(f"LLM call failed: {exc}")
            print(
                "If you haven't configured an API key, set it in your environment "
                "(e.g. export ANTHROPIC_API_KEY=sk-...) or start the backend and "
                "save it via the Settings page."
            )
            return 1

    banner("WHAT TO LOOK FOR")
    print(
        "- Prompt diff should show the 3 style rules appended under 'Additional style\n"
        "  guidance' in the system prompt, and the golden example inserted before the\n"
        "  TEXT TO TRANSLATE block in the user prompt.\n"
        "- If you ran with --call-llm, compare the two translations: does the seeded\n"
        "  version pick up the 'Grand Master' honorific? Does it preserve the warmer\n"
        "  teaching voice? Does it echo the cadence of the golden example?\n"
        "- If the seeded translation is indistinguishable from the unseeded one,\n"
        "  the lever is too weak — debug before investing in frontend curation UI."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
