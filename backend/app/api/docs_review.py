"""Feature-gated, owner-only review evidence API."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.security import get_current_user
from app.models.docs_review import (
    DocsReviewDecision,
    DocsReviewExperiment,
    DocsReviewItem,
    DocsReviewLesson,
    DocsReviewRun,
    DocsReviewSnapshot,
)
from app.schemas.docs_review import (
    DecisionRequest,
    ExperimentJudgmentRequest,
    ExperimentRequest,
    LessonConfirmationRequest,
    LessonRequest,
    ProjectRequest,
    ReferenceLabelRequest,
    ReportRequest,
    RunRequest,
    SnapshotRequest,
)
from app.services.docs_review import evaluation
from app.services.docs_review import repository as repo
from app.services.docs_review.development_fixture import create_fixture_run, load_development_fixture
from app.services.docs_review.learning import lesson_response
from app.worker.docs_review import create_live_run, enqueue_experiment, enqueue_run, reconcile_experiment, reconcile_run


async def enabled_user(user=Depends(get_current_user)):
    if not get_settings().docs_review_enabled:
        raise HTTPException(404, "Not found")
    return user


router = APIRouter(dependencies=[Depends(enabled_user)])
review_writer = require_permission("translations.edit")


@router.get("/development-fixture")
async def development_fixture():
    return load_development_fixture()


@router.post("/projects/{project_id}/runs", status_code=201)
async def start_run(
    project_id: str, request: RunRequest, user=Depends(review_writer), db: AsyncSession = Depends(get_db)
):
    run = await (create_fixture_run if request.mode == "fixture" else create_live_run)(db, user.id, project_id, request)
    return await run_response(db, run)


@router.post("/projects", status_code=201)
async def create_project(request: ProjectRequest, user=Depends(review_writer), db: AsyncSession = Depends(get_db)):
    return repo.record_dict(await repo.create_project(db, user.id, request))


@router.get("/projects/{project_id}")
async def get_project(project_id: str, user=Depends(enabled_user), db: AsyncSession = Depends(get_db)):
    return repo.record_dict(await repo.get_project(db, user.id, project_id))


@router.post("/projects/{project_id}/snapshots", status_code=201)
async def append_snapshot(
    project_id: str, request: SnapshotRequest, user=Depends(review_writer), db: AsyncSession = Depends(get_db)
):
    return repo.record_dict(await repo.append_snapshot(db, user.id, project_id, request))


@router.get("/projects/{project_id}/snapshots/{snapshot_id}")
async def get_snapshot(
    project_id: str, snapshot_id: str, user=Depends(enabled_user), db: AsyncSession = Depends(get_db)
):
    return repo.record_dict(await repo.get_record(db, user.id, project_id, DocsReviewSnapshot, snapshot_id))


@router.get("/projects/{project_id}/runs/{run_id}")
async def get_run(project_id: str, run_id: str, user=Depends(enabled_user), db: AsyncSession = Depends(get_db)):
    run = await repo.get_record(db, user.id, project_id, DocsReviewRun, run_id)
    if run.mode == "live":
        await reconcile_run(db, run)
    return await run_response(db, run)


async def run_response(db, run):
    items = list(
        await db.scalars(select(DocsReviewItem).where(DocsReviewItem.run_id == run.id).order_by(DocsReviewItem.id))
    )
    result = {**repo.record_dict(run), "items": [repo.record_dict(item) for item in items]}
    if run.mode == "live":
        result.pop("raw_response")
        result.update(
            queue_retryable=run.status == "pending_enqueue",
            finding_count=sum(i.kind == "finding" for i in items),
            audit_count=sum(i.kind == "audit" for i in items),
        )
    return result


@router.post("/projects/{project_id}/runs/{run_id}/retry")
async def retry_run(project_id: str, run_id: str, user=Depends(review_writer), db: AsyncSession = Depends(get_db)):
    run = await repo.get_record(db, user.id, project_id, DocsReviewRun, run_id)
    if run.mode != "live" or not get_settings().docs_review_live_ai:
        raise HTTPException(409, "Live queue retry is unavailable")
    await enqueue_run(db, run)
    return await run_response(db, run)


@router.post("/projects/{project_id}/decisions", status_code=201)
async def append_decision(
    project_id: str, request: DecisionRequest, user=Depends(review_writer), db: AsyncSession = Depends(get_db)
):
    return repo.record_dict(await repo.append_decision(db, user.id, project_id, request))


@router.get("/projects/{project_id}/decisions/{decision_id}")
async def get_decision(
    project_id: str, decision_id: str, user=Depends(enabled_user), db: AsyncSession = Depends(get_db)
):
    return repo.record_dict(await repo.get_record(db, user.id, project_id, DocsReviewDecision, decision_id))


@router.post("/projects/{project_id}/lessons", status_code=201)
async def propose_lesson(
    project_id: str, request: LessonRequest, user=Depends(review_writer), db: AsyncSession = Depends(get_db)
):
    lesson = await repo.propose_lesson(db, user.id, project_id, request)
    return (
        await lesson_response(db, lesson)
        if lesson
        else {"status": "no_reusable_lesson", "originating_decision_id": request.originating_decision_id}
    )


@router.get("/projects/{project_id}/lessons/{lesson_id}")
async def get_lesson(project_id: str, lesson_id: str, user=Depends(enabled_user), db: AsyncSession = Depends(get_db)):
    return await lesson_response(db, await repo.get_record(db, user.id, project_id, DocsReviewLesson, lesson_id))


@router.post("/projects/{project_id}/lessons/{lesson_id}/confirm")
async def confirm_lesson(
    project_id: str,
    lesson_id: str,
    request: LessonConfirmationRequest,
    user=Depends(review_writer),
    db: AsyncSession = Depends(get_db),
):
    return await lesson_response(db, await repo.confirm_lesson(db, user.id, project_id, lesson_id, request))


@router.post("/projects/{project_id}/experiments", status_code=201)
async def create_experiment(
    project_id: str, request: ExperimentRequest, user=Depends(review_writer), db: AsyncSession = Depends(get_db)
):
    return evaluation.public_experiment(await repo.create_experiment(db, user.id, project_id, request))


@router.get("/projects/{project_id}/experiments/{experiment_id}")
async def get_experiment(
    project_id: str, experiment_id: str, user=Depends(enabled_user), db: AsyncSession = Depends(get_db)
):
    experiment = await repo.get_record(db, user.id, project_id, DocsReviewExperiment, experiment_id)
    return evaluation.public_experiment(await reconcile_experiment(db, experiment))


@router.post("/projects/{project_id}/experiments/{experiment_id}/run")
async def run_experiment(
    project_id: str, experiment_id: str, user=Depends(review_writer), db: AsyncSession = Depends(get_db)
):
    experiment = await repo.get_record(db, user.id, project_id, DocsReviewExperiment, experiment_id)
    return evaluation.public_experiment(await enqueue_experiment(db, experiment))


@router.post("/projects/{project_id}/experiments/{experiment_id}/labels", status_code=201)
async def append_experiment_label(
    project_id: str,
    experiment_id: str,
    request: ReferenceLabelRequest | ExperimentJudgmentRequest,
    user=Depends(review_writer),
    db: AsyncSession = Depends(get_db),
):
    return await evaluation.append_label(db, user.id, project_id, experiment_id, request)


@router.post("/projects/{project_id}/experiments/{experiment_id}/reports", status_code=201)
async def append_experiment_report(
    project_id: str,
    experiment_id: str,
    request: ReportRequest,
    user=Depends(review_writer),
    db: AsyncSession = Depends(get_db),
):
    return await evaluation.append_report(db, user.id, project_id, experiment_id, request)
