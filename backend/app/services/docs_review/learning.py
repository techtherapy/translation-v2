"""Human-authored scoped proposals. Confirmation never activates shared knowledge."""

from copy import deepcopy
from datetime import UTC, datetime
from difflib import SequenceMatcher

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.models.docs_review import (
    DocsReviewDecision,
    DocsReviewItem,
    DocsReviewLesson,
    DocsReviewLessonConfirmation,
    DocsReviewSnapshot,
)
from app.schemas.docs_review import LessonScope
from app.services.docs_review import repository as repo
from app.services.docs_review.evidence import evidence_hash

DECISION_STATES = {
    "corrected": "local_correction",
    "no_issue": "dismissed_finding",
    "needs_another_opinion": "unresolved_review",
    "confirmed_issue": "confirmed_issue",
    "audit_found_issue": "confirmed_audit_issue",
    "audit_no_issue": "audit_no_issue",
}


def corrected_span(span, before, after):
    text = before.get(span["block_id"], "")
    start = 0
    for _ in range(span["occurrence"] + 1):
        found = text.find(span["quote"], start)
        if found < 0:
            return False
        start = found + len(span["quote"])
    # Only a changed range touching this exact occurrence can seed a correction.
    return any(
        tag != "equal" and ((a < start and b > found) or (a == b and found < a < start))
        for tag, a, b, _, _ in SequenceMatcher(
            None, text, after.get(span["block_id"], ""), autojunk=False
        ).get_opcodes()
    )


async def eligible_evidence(db, project, decision):
    latest = await db.scalar(
        select(DocsReviewDecision)
        .where(DocsReviewDecision.item_id == decision.item_id)
        .order_by(DocsReviewDecision.created_at.desc(), DocsReviewDecision.id.desc())
        .limit(1)
    )
    if latest.id != decision.id:
        raise HTTPException(409, "This decision has been superseded; use the latest review")
    if (
        decision.disposition not in {"corrected", "no_issue", "confirmed_issue", "audit_found_issue"}
        or not decision.note.strip()
    ):
        raise HTTPException(
            409, "This decision cannot seed reusable guidance; record an explicit source-grounded decision first"
        )
    base = await repo._nested(
        db, DocsReviewSnapshot, project.id, decision.context_snapshot_id or decision.base_snapshot_id
    )
    reviewed = await repo._nested(db, DocsReviewSnapshot, project.id, decision.reviewed_snapshot_id)
    item = await db.get(DocsReviewItem, decision.item_id)
    if decision.disposition == "corrected":
        before = {b["block_id"]: b["text"] for b in base.blocks}
        after = {b["block_id"]: b["text"] for b in reviewed.blocks}
        if not any(corrected_span(s, before, after) for s in item.target_spans):
            raise HTTPException(409, "Incidental edits outside the finding cannot seed a lesson")
    decision_record, item_record = repo.record_dict(decision), repo.record_dict(item)
    decision_record["created_at"] = decision.created_at.isoformat()
    item_record["created_at"] = item.created_at.isoformat()
    return dict(
        decision=decision_record,
        item=item_record,
        source_text=project.source_text,
        base_blocks=deepcopy(base.blocks),
        reviewed_blocks=deepcopy(reviewed.blocks),
    )


def validate_scope(scope, project):
    try:
        value = LessonScope.model_validate(scope)
    except ValidationError as exc:
        raise HTTPException(
            422, "Scope requires languages, construction, positive example, counterexample, and edition restriction"
        ) from exc
    if (value.source_language, value.target_language) != (project.source_language, project.target_language):
        raise HTTPException(422, "Lesson scope languages must match the reviewed project")
    return value.model_dump()


async def conflicts(db, lesson):
    # This is potential overlap for a human, never a claim of semantic contradiction.
    others = await db.scalars(
        select(DocsReviewLesson)
        .where(
            DocsReviewLesson.project_id == lesson.project_id,
            DocsReviewLesson.status == "confirmed",
            DocsReviewLesson.id != lesson.id,
        )
        .order_by(DocsReviewLesson.id)
    )
    return [
        dict(id=other.id, content_hash=other.content_hash, scope=deepcopy(other.scope), guidance=other.guidance)
        for other in others
        if other.id != lesson.supersedes_id
        and (other.source_language, other.target_language) == (lesson.source_language, lesson.target_language)
        and (
            not other.scope.get("edition_restriction")
            or not lesson.scope.get("edition_restriction")
            or other.scope["edition_restriction"] == lesson.scope["edition_restriction"]
        )
    ]


async def lesson_response(db, lesson):
    overlaps = await conflicts(db, lesson)
    decision = await db.get(DocsReviewDecision, lesson.originating_decision_id)
    return {
        **repo.record_dict(lesson),
        "conflicts": overlaps,
        "conflict_hash": evidence_hash(overlaps),
        "decision_state": DECISION_STATES[decision.disposition],
        "activation": "experiment_only",
    }


async def propose_lesson(db, owner_id, project_id, request):
    project = await repo.get_project(db, owner_id, project_id, lock=True)
    payload = request.model_dump()
    existing = await repo._retry(db, DocsReviewLesson, project_id, payload)
    if existing is not None:
        return existing
    decision = await repo._nested(db, DocsReviewDecision, project_id, request.originating_decision_id)
    evidence = await eligible_evidence(db, project, decision)
    if not request.guidance.strip():
        return None
    scope = validate_scope(request.scope, project)
    if request.supersedes_id:
        previous = await repo._nested(db, DocsReviewLesson, project_id, request.supersedes_id)
        if previous.originating_decision_id != decision.id:
            raise HTTPException(409, "A revision must retain its originating decision")
    values = dict(
        originating_decision_id=decision.id,
        supersedes_id=request.supersedes_id,
        source_language=project.source_language,
        target_language=project.target_language,
        scope=scope,
        guidance=request.guidance,
        evidence=[*deepcopy(request.evidence), evidence],
    )
    return await repo._insert(
        db, DocsReviewLesson, {"project_id": project_id}, payload, content_hash=evidence_hash(values), **values
    )


async def confirm_lesson(db, owner_id, project_id, lesson_id, request):
    project = await repo.get_project(db, owner_id, project_id, lock=True)
    payload = {**request.model_dump(), "lesson_id": lesson_id}
    existing = await repo._retry(db, DocsReviewLessonConfirmation, project_id, payload)
    lesson = await repo._nested(db, DocsReviewLesson, project_id, lesson_id)
    if existing is not None:
        return lesson
    if request.expected_content_hash != lesson.content_hash or lesson.content_hash != evidence_hash(
        repo.lesson_content(lesson)
    ):
        raise HTTPException(409, "Lesson content changed; review it again before confirming")
    if lesson.status != "proposed":
        raise HTTPException(409, "Lesson is already confirmed")
    decision = await repo._nested(db, DocsReviewDecision, project_id, lesson.originating_decision_id)
    await eligible_evidence(db, project, decision)
    validate_scope(lesson.scope, project)
    overlaps = await conflicts(db, lesson)
    if (overlaps and request.expected_conflict_hash != evidence_hash(overlaps)) or (
        request.expected_conflict_hash is not None and request.expected_conflict_hash != evidence_hash(overlaps)
    ):
        raise HTTPException(409, "Conflicting guidance changed; review conflicts again")
    if set(request.conflict_resolutions) != {c["id"] for c in overlaps} or any(
        not v.strip() for v in request.conflict_resolutions.values()
    ):
        raise HTTPException(409, "Resolve every potentially conflicting lesson before confirmation")
    await repo._insert(
        db,
        DocsReviewLessonConfirmation,
        {"project_id": project_id},
        payload,
        lesson_id=lesson.id,
        confirmed_by=owner_id,
        content_hash=lesson.content_hash,
    )
    lesson.status, lesson.confirmed_by, lesson.confirmed_at = "confirmed", owner_id, datetime.now(UTC)
    await db.flush()
    return lesson
