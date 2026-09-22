"""Transactional review evidence operations. Callers own commit/rollback.

All nested lookups follow owner lookup. Row locks serialize mutations on PostgreSQL;
unique constraints and savepoints also protect idempotency across concurrent requests.
This module never writes production translations or shared knowledge.
"""

import hashlib
from copy import deepcopy
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.docs_review import (
    DocsReviewDecision,
    DocsReviewItem,
    DocsReviewProject,
    DocsReviewRun,
    DocsReviewSnapshot,
)
from app.models.user import User
from app.schemas.docs_review import (
    DecisionRequest,
    ExperimentRequest,
    LessonConfirmationRequest,
    LessonRequest,
    ProjectRequest,
    RunRequest,
    SnapshotRequest,
)
from app.services.docs_review.evidence import evidence_hash


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def record_dict(record):
    """Copy JSON values so later callers cannot mutate an evidence bundle by alias."""
    result = {column.name: deepcopy(getattr(record, column.name)) for column in record.__table__.columns}
    for key, value in result.items():
        if isinstance(value, datetime) and value.tzinfo is None:
            result[key] = value.replace(tzinfo=UTC)
    return result


async def get_project(db: AsyncSession, owner_id: int, project_id: str, *, lock=False):
    if lock and db.bind.dialect.name == "sqlite":
        # SQLite ignores FOR UPDATE. Reserve its writer lock before reading state,
        # preventing read-to-write upgrade deadlocks in concurrent confirmations.
        await db.execute(
            update(DocsReviewProject)
            .where(DocsReviewProject.id == project_id, DocsReviewProject.owner_user_id == owner_id)
            .values(id=DocsReviewProject.id)
            .execution_options(synchronize_session=False)
        )
    stmt = select(DocsReviewProject).where(
        DocsReviewProject.id == project_id, DocsReviewProject.owner_user_id == owner_id
    )
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    project = await db.scalar(stmt)
    if project is None:
        raise HTTPException(404, "Review project not found")
    return project


async def _nested(db, model, project_id, record_id, *, lock=False):
    stmt = select(model).where(model.id == record_id, model.project_id == project_id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    record = await db.scalar(stmt)
    if record is None:
        raise HTTPException(404, "Review evidence not found")
    return record


async def get_record(db, owner_id, project_id, model, record_id):
    await get_project(db, owner_id, project_id)
    return await _nested(db, model, project_id, record_id)


async def _existing(db, model, scope, request_id, request_hash):
    stmt = select(model).filter_by(**scope, client_request_id=request_id)
    record = await db.scalar(stmt)
    if record is not None and record.request_hash != request_hash:
        raise HTTPException(409, "Request ID was already used with different content")
    return record


async def _insert(db, model, identity_scope, payload, **values):
    request_hash = evidence_hash(payload)
    request_id = payload["client_request_id"]
    existing = await _existing(db, model, identity_scope, request_id, request_hash)
    if existing is not None:
        return existing
    record = model(**identity_scope, client_request_id=request_id, request_hash=request_hash, **deepcopy(values))
    try:
        async with db.begin_nested():
            db.add(record)
            await db.flush()
    except IntegrityError:
        # A competing transaction may have committed while this insert waited.
        existing = await _existing(db, model, identity_scope, request_id, request_hash)
        if existing is None:
            raise
        return existing
    return record


async def _retry(db, model, project_id, payload):
    return await _existing(db, model, {"project_id": project_id}, payload["client_request_id"], evidence_hash(payload))


async def create_project(db: AsyncSession, owner_id: int, request: ProjectRequest):
    # There is no project row to lock yet. Serialize setup for this owner instead.
    if db.bind.dialect.name == "sqlite":
        await db.execute(
            update(User)
            .where(User.id == owner_id)
            .values(id=User.id, updated_at=User.updated_at)
            .execution_options(synchronize_session=False)
        )
    await db.scalar(select(User).where(User.id == owner_id).with_for_update())
    payload = request.model_dump()
    values = {k: v for k, v in payload.items() if k != "client_request_id"}
    return await _insert(
        db,
        DocsReviewProject,
        {"owner_user_id": owner_id},
        payload,
        source_sha256=text_hash(request.source_text),
        **values,
    )


async def append_snapshot(db, owner_id, project_id, request: SnapshotRequest):
    await get_project(db, owner_id, project_id, lock=True)
    payload = request.model_dump()
    existing = await _retry(db, DocsReviewSnapshot, project_id, payload)
    if existing is not None:
        return existing
    canonical_text = "\n".join(block.text for block in request.blocks)
    if not canonical_text.strip():
        raise HTTPException(422, "A checkpoint must contain text")
    if any(block.kind not in {"paragraph", "list_item", "heading"} for block in request.blocks):
        raise HTTPException(422, "Unsupported text-bearing structure")
    return await _insert(
        db,
        DocsReviewSnapshot,
        {"project_id": project_id},
        payload,
        canonical_text=canonical_text,
        target_sha256=text_hash(canonical_text),
        blocks=payload["blocks"],
        observed_revision_id=request.observed_revision_id,
        suggestions_pending=request.suggestions_pending,
    )


async def create_run(db, owner_id, project_id, request: RunRequest, *, input_bundle: dict):
    project = await get_project(db, owner_id, project_id, lock=True)
    # Guidance is a live-only input. Keep the fixture request contract unchanged.
    if request.mode == "fixture" and request.guidance:
        raise HTTPException(422, "Supplied guidance requires live review")
    # Request identity is the explicit client action, not mutable knowledge retrieved later.
    payload = request.model_dump(exclude={"guidance"} if request.mode == "fixture" else set())
    existing = await _retry(db, DocsReviewRun, project_id, payload)
    if existing is not None:
        return existing
    snapshot = await _nested(db, DocsReviewSnapshot, project_id, request.snapshot_id)
    bundle = deepcopy(input_bundle)
    bundle.update(
        source_text=project.source_text,
        source_sha256=project.source_sha256,
        source_language=project.source_language,
        target_language=project.target_language,
        target_blocks=deepcopy(snapshot.blocks),
        target_sha256=snapshot.target_sha256,
        request=payload,
    )
    return await _insert(
        db,
        DocsReviewRun,
        {"project_id": project_id},
        payload,
        snapshot_id=snapshot.id,
        mode=request.mode,
        input_bundle=bundle,
        input_sha256=evidence_hash(bundle),
    )


async def complete_run(
    db,
    owner_id,
    project_id,
    run_id,
    *,
    raw_response: str | None,
    validated_result: dict | None,
    items: list[dict],
    usage: dict,
    error_code: str | None = None,
):
    await get_project(db, owner_id, project_id, lock=True)
    run = await _nested(db, DocsReviewRun, project_id, run_id, lock=True)
    if run.status not in {"pending", "running"}:
        raise HTTPException(409, "Run evidence is already final")
    if error_code is not None and items:
        raise HTTPException(422, "Failed runs cannot produce review items")
    # Validate all item shapes before adding anything to the transaction.
    rows = []
    for item in items:
        values = deepcopy(item)
        if values.get("kind") not in {"finding", "audit"}:
            raise HTTPException(422, "Unknown review item kind")
        rows.append(DocsReviewItem(run_id=run.id, **values))
    async with db.begin_nested():
        db.add_all(rows)
        run.raw_response = raw_response
        run.validated_result = deepcopy(validated_result)
        run.usage = deepcopy(usage)
        run.error_code = error_code
        run.status = "failed" if error_code else "completed"
        run.lease_expires_at = None
        await db.flush()
    return run


async def append_decision(db, owner_id, project_id, request: DecisionRequest):
    await get_project(db, owner_id, project_id, lock=True)
    payload = request.model_dump()
    existing = await _retry(db, DocsReviewDecision, project_id, payload)
    if existing is not None:
        return existing
    item = await db.scalar(
        select(DocsReviewItem)
        .join(DocsReviewRun)
        .where(
            DocsReviewItem.id == request.item_id,
            DocsReviewRun.project_id == project_id,
            DocsReviewRun.status.in_(["completed", "succeeded"]),
        )
    )
    if item is None:
        raise HTTPException(404, "Review item not found")
    run = await _nested(db, DocsReviewRun, project_id, item.run_id)
    base = await _nested(db, DocsReviewSnapshot, project_id, request.base_snapshot_id)
    reviewed = await _nested(db, DocsReviewSnapshot, project_id, request.reviewed_snapshot_id)
    if base.id != run.snapshot_id:
        raise HTTPException(409, "Decision base must be the assessed checkpoint")
    if base.suggestions_pending or reviewed.suggestions_pending:
        raise HTTPException(409, "Resolve native suggestions and refresh before recording a decision")
    audit = request.disposition in {"audit_no_issue", "audit_found_issue"}
    if audit != (item.kind == "audit"):
        raise HTTPException(422, "Disposition does not match review item kind")
    if request.disposition != "corrected" and base.target_sha256 != reviewed.target_sha256:
        raise HTTPException(409, "The chapter changed; assess the new checkpoint first")
    if request.disposition == "corrected" and base.target_sha256 == reviewed.target_sha256:
        raise HTTPException(409, "A correction requires a changed checkpoint")
    if request.disposition == "audit_found_issue" and not request.note.strip():
        raise HTTPException(422, "An audit issue requires a source-grounded note")
    values = {k: v for k, v in payload.items() if k != "client_request_id"}
    return await _insert(db, DocsReviewDecision, {"project_id": project_id}, payload, reviewer_id=owner_id, **values)


def lesson_content(lesson):
    return {
        name: deepcopy(getattr(lesson, name))
        for name in (
            "originating_decision_id",
            "supersedes_id",
            "source_language",
            "target_language",
            "scope",
            "guidance",
            "evidence",
        )
    }


async def propose_lesson(db, owner_id, project_id, request: LessonRequest):
    from app.services.docs_review.learning import propose_lesson as propose

    return await propose(db, owner_id, project_id, request)


async def confirm_lesson(db, owner_id, project_id, lesson_id, request: LessonConfirmationRequest):
    from app.services.docs_review.learning import confirm_lesson as confirm

    return await confirm(db, owner_id, project_id, lesson_id, request)


async def create_experiment(db, owner_id, project_id, request: ExperimentRequest):
    from app.services.docs_review.evaluation import create_experiment as create

    return await create(db, owner_id, project_id, request)
