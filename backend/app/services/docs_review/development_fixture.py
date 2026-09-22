"""Packaged analyst examples. These are never approved translation knowledge."""

import json
from pathlib import Path

from fastapi import HTTPException

from app.models.docs_review import DocsReviewSnapshot
from app.services.docs_review import repository as repo


def load_development_fixture():
    return json.loads((Path(__file__).parent / "fixtures/book-300-chapter-009.json").read_text(encoding="utf-8"))


# Explicit editorial passage associations: card descriptions are not exact quotations.
CARD_BLOCKS = {
    "R1": ["target-0005"],
    "R2": ["target-0019"],
    "R3": ["target-0045"],
    "R4": ["target-0060", "target-0062"],
    "F1": ["target-0032"],
    "F2": ["target-0021", "target-0022"],
}


async def create_fixture_run(db, owner_id, project_id, request):
    project = await repo.get_project(db, owner_id, project_id, lock=True)
    if request.mode != "fixture":
        raise HTTPException(409, "Live review is not ready; use fixture mode")
    fixture = load_development_fixture()
    if any(
        getattr(project, field) != fixture[field]
        for field in ("source_language", "target_language", "book_label", "chapter_label")
    ):
        raise HTTPException(409, "Example findings are scoped to Book 300, Chapter 9, Chinese to English")
    snapshot = await repo.get_record(db, owner_id, project_id, DocsReviewSnapshot, request.snapshot_id)
    # An analyst example cannot assess new source or edited chapter text.
    expected = [(b["block_id"], b["text"]) for b in fixture["target_blocks"]]
    actual = [(b["block_id"], b["text"]) for b in snapshot.blocks]
    if project.source_text != fixture["raw_chinese_section"] or actual != expected:
        raise HTTPException(
            409, "Example findings require the supplied Chapter 9 text; edited text needs a fresh review"
        )
    if snapshot.suggestions_pending:
        raise HTTPException(409, "Resolve native suggestions before starting a review")
    run = await repo.create_run(db, owner_id, project_id, request, input_bundle={"fixture": fixture})
    if run.status == "completed":
        return run
    targets = {b["block_id"]: b["text"] for b in snapshot.blocks}
    items = []
    for card in fixture["analyst_cards"]:
        audit = card["kind"] == "false_alarm_check"
        items.append(
            dict(
                kind="audit" if audit else "finding",
                category=None if audit else "meaning",
                proposed_severity=None if audit else "question",
                source_spans=[dict(block_id="source", quote=fixture["raw_chinese_section"], occurrence=0)],
                target_spans=[dict(block_id=bid, quote=targets[bid], occurrence=0) for bid in CARD_BLOCKS[card["id"]]],
                explanation=card.get("concern", card.get("example")),
                evidence_ids=[f"analyst_development_example:{card['id']}"],
                proposed_correction=None,
            )
        )
    return await repo.complete_run(
        db,
        owner_id,
        project_id,
        run.id,
        raw_response=json.dumps(fixture["analyst_cards"], ensure_ascii=False),
        validated_result={"provenance": "analyst_development_example", "human_confirmed": False},
        items=items,
        usage={"cost_usd": 0, "provider_calls": 0},
    )
