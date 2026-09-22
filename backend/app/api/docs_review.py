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
    ExperimentRequest,
    LessonConfirmationRequest,
    LessonRequest,
    ProjectRequest,
    RunRequest,
    SnapshotRequest,
)
from app.services.docs_review import repository as repo
from app.services.docs_review.development_fixture import create_fixture_run, load_development_fixture


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
async def start_fixture_run(
    project_id: str, request: RunRequest, user=Depends(review_writer), db: AsyncSession = Depends(get_db)
):
    run = await create_fixture_run(db, user.id, project_id, request)
    items = await db.scalars(select(DocsReviewItem).where(DocsReviewItem.run_id == run.id).order_by(DocsReviewItem.id))
    return {**repo.record_dict(run), "items": [repo.record_dict(item) for item in items]}


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
    items = await db.scalars(select(DocsReviewItem).where(DocsReviewItem.run_id == run.id).order_by(DocsReviewItem.id))
    return {**repo.record_dict(run), "items": [repo.record_dict(item) for item in items]}


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
    return repo.record_dict(await repo.propose_lesson(db, user.id, project_id, request))


@router.get("/projects/{project_id}/lessons/{lesson_id}")
async def get_lesson(project_id: str, lesson_id: str, user=Depends(enabled_user), db: AsyncSession = Depends(get_db)):
    return repo.record_dict(await repo.get_record(db, user.id, project_id, DocsReviewLesson, lesson_id))


@router.post("/projects/{project_id}/lessons/{lesson_id}/confirm")
async def confirm_lesson(
    project_id: str,
    lesson_id: str,
    request: LessonConfirmationRequest,
    user=Depends(review_writer),
    db: AsyncSession = Depends(get_db),
):
    return repo.record_dict(await repo.confirm_lesson(db, user.id, project_id, lesson_id, request))


@router.post("/projects/{project_id}/experiments", status_code=201)
async def create_experiment(
    project_id: str, request: ExperimentRequest, user=Depends(review_writer), db: AsyncSession = Depends(get_db)
):
    return repo.record_dict(await repo.create_experiment(db, user.id, project_id, request))


@router.get("/projects/{project_id}/experiments/{experiment_id}")
async def get_experiment(
    project_id: str, experiment_id: str, user=Depends(enabled_user), db: AsyncSession = Depends(get_db)
):
    return repo.record_dict(await repo.get_record(db, user.id, project_id, DocsReviewExperiment, experiment_id))
