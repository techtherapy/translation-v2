"""Behavioral persistence tests; no Google account or provider is contacted."""

import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.models.setting import Setting


@pytest.fixture(autouse=True)
def enabled(monkeypatch):
    monkeypatch.setitem(get_settings().__dict__, "docs_review_enabled", True)


@pytest.fixture
def docs_project_payload():
    fixture = json.loads((Path(__file__).parent / "fixtures/docs_review/book-300-chapter-009.json").read_text())
    return dict(
        client_request_id="setup-1",
        document_id="synthetic-doc-300-009",
        tab_id="synthetic-tab-009",
        book_label="300",
        chapter_label="009",
        source_language="zh",
        target_language="en",
        source_text=fixture["raw_chinese_section"],
        english_status="unknown",
    )


@pytest.fixture
def docs_snapshot_payload():
    return dict(
        client_request_id="snapshot-1",
        observed_revision_id="revision-1",
        suggestions_pending=False,
        blocks=[dict(block_id="target-1", text="The Benefits of Yidam Samadhi", kind="paragraph")],
    )


def headers(token):
    return {"Authorization": f"Bearer {token}"}


async def project(client, token, payload):
    response = await client.post("/api/docs-review/projects", json=payload, headers=headers(token))
    assert response.status_code == 201, response.text
    return response.json()


async def snapshot(client, token, pid, payload):
    response = await client.post(f"/api/docs-review/projects/{pid}/snapshots", json=payload, headers=headers(token))
    assert response.status_code == 201, response.text
    return response.json()


async def test_setup_checkpoint_retries_and_conflicts(
    client, admin_token, docs_project_payload, docs_snapshot_payload, db_session
):
    p = await project(client, admin_token, docs_project_payload)
    assert (await project(client, admin_token, docs_project_payload))["id"] == p["id"]
    changed = await client.post(
        "/api/docs-review/projects", json={**docs_project_payload, "tab_id": "different"}, headers=headers(admin_token)
    )
    assert changed.status_code == 409
    s = await snapshot(client, admin_token, p["id"], docs_snapshot_payload)
    assert s["canonical_text"] == "The Benefits of Yidam Samadhi"
    assert (await snapshot(client, admin_token, p["id"], docs_snapshot_payload))["id"] == s["id"]
    changed = await client.post(
        f"/api/docs-review/projects/{p['id']}/snapshots",
        json={**docs_snapshot_payload, "suggestions_pending": True},
        headers=headers(admin_token),
    )
    assert changed.status_code == 409
    from app.models.docs_review import DocsReviewProject, DocsReviewSnapshot

    assert await db_session.scalar(select(func.count()).select_from(DocsReviewProject)) == 1
    assert await db_session.scalar(select(func.count()).select_from(DocsReviewSnapshot)) == 1


async def test_auth_owner_feature_and_revoked_permission(
    client,
    admin_token,
    reviewer_token,
    translator_token,
    docs_project_payload,
    docs_snapshot_payload,
    seed_data,
    db_session,
    monkeypatch,
):
    assert (await client.post("/api/docs-review/projects", json=docs_project_payload)).status_code == 401
    p = await project(client, admin_token, docs_project_payload)
    for token in (reviewer_token, translator_token):
        denied = await client.post(
            f"/api/docs-review/projects/{p['id']}/snapshots", json=docs_snapshot_payload, headers=headers(token)
        )
        assert denied.status_code == 404
        denied = await client.post(
            f"/api/docs-review/projects/{p['id']}/decisions",
            json=dict(
                client_request_id="x",
                item_id="missing",
                base_snapshot_id="missing",
                reviewed_snapshot_id="missing",
                disposition="corrected",
                note="",
            ),
            headers=headers(token),
        )
        assert denied.status_code == 404
    seed_data["reviewer"].is_active = False
    await db_session.commit()
    assert (
        await client.post("/api/docs-review/projects", json=docs_project_payload, headers=headers(reviewer_token))
    ).status_code == 403
    translator_project = await project(client, translator_token, docs_project_payload)
    db_session.add(Setting(key="ROLE_PERMISSIONS", value=json.dumps({"translator": []})))
    await db_session.commit()
    assert (
        await client.post("/api/docs-review/projects", json=docs_project_payload, headers=headers(translator_token))
    ).status_code == 403
    revoked = await client.post(
        f"/api/docs-review/projects/{translator_project['id']}/snapshots",
        json=docs_snapshot_payload,
        headers=headers(translator_token),
    )
    assert revoked.status_code == 403
    monkeypatch.setattr(get_settings(), "docs_review_enabled", False)
    assert (
        await client.post("/api/docs-review/projects", json=docs_project_payload, headers=headers(admin_token))
    ).status_code == 404
    assert (await client.post("/api/docs-review/projects", json=docs_project_payload)).status_code == 401


@pytest.fixture
async def completed_review(client, admin_token, docs_project_payload, docs_snapshot_payload, db_session, seed_data):
    p = await project(client, admin_token, docs_project_payload)
    s = await snapshot(client, admin_token, p["id"], docs_snapshot_payload)
    from app.schemas.docs_review import RunRequest
    from app.services.docs_review import repository as repo

    run = await repo.create_run(
        db_session,
        seed_data["admin"].id,
        p["id"],
        RunRequest(client_request_id="run-1", snapshot_id=s["id"], mode="fixture"),
        input_bundle={"prompt": "Exact prompt", "rules": [{"content": "Original rule"}]},
    )
    finding = dict(
        kind="finding",
        category="meaning",
        proposed_severity="question",
        source_spans=[dict(block_id="source", quote="本尊", occurrence=0)],
        target_spans=[dict(block_id="target-1", quote="Yidam", occurrence=0)],
        explanation="Check the term",
        evidence_ids=[],
    )
    await repo.complete_run(
        db_session,
        seed_data["admin"].id,
        p["id"],
        run.id,
        raw_response="raw",
        validated_result={"schema_version": 1, "findings": []},
        items=[finding],
        usage={"cost": 0},
    )
    await db_session.commit()
    from app.models.docs_review import DocsReviewItem

    item = (await db_session.scalars(select(DocsReviewItem).where(DocsReviewItem.run_id == run.id))).one()
    return p, s, run, item


def decision_payload(s, item):
    return dict(
        client_request_id="decision-1",
        item_id=item.id,
        base_snapshot_id=s["id"],
        reviewed_snapshot_id=s["id"],
        disposition="no_issue",
        note="Source checked",
    )


async def test_decisions_are_attributable_idempotent_and_atomic(
    client, admin_token, completed_review, docs_snapshot_payload, db_session, seed_data
):
    p, s, _run, item = completed_review
    url = f"/api/docs-review/projects/{p['id']}/decisions"
    payload = decision_payload(s, item)
    response = await client.post(url, json=payload, headers=headers(admin_token))
    assert response.status_code == 201, response.text
    assert response.json()["reviewer_id"] == seed_data["admin"].id
    assert (await client.post(url, json=payload, headers=headers(admin_token))).json()["id"] == response.json()["id"]
    assert (
        await client.post(url, json={**payload, "note": "changed"}, headers=headers(admin_token))
    ).status_code == 409
    assert (
        await client.post(url, json={**payload, "reviewer_id": 999}, headers=headers(admin_token))
    ).status_code == 422
    pending = await snapshot(
        client,
        admin_token,
        p["id"],
        {**docs_snapshot_payload, "client_request_id": "pending", "suggestions_pending": True},
    )
    for changes, expected in [
        ({"disposition": "audit_found_issue"}, 422),
        ({"reviewed_snapshot_id": "missing"}, 404),
        ({"base_snapshot_id": pending["id"]}, 409),
        ({"reviewed_snapshot_id": pending["id"]}, 409),
    ]:
        rejected = await client.post(
            url, json={**payload, "client_request_id": "invalid", **changes}, headers=headers(admin_token)
        )
        assert rejected.status_code == expected, rejected.text
    from app.models.docs_review import DocsReviewDecision

    assert await db_session.scalar(select(func.count()).select_from(DocsReviewDecision)) == 1


async def test_lessons_freeze_confirmation_and_experiment_inputs(client, admin_token, completed_review, db_session):
    p, s, run, item = completed_review
    root = f"/api/docs-review/projects/{p['id']}"
    d = (await client.post(root + "/decisions", json=decision_payload(s, item), headers=headers(admin_token))).json()
    payload = dict(
        client_request_id="lesson-1",
        originating_decision_id=d["id"],
        scope={"term": "本尊"},
        guidance="Keep yidam",
        evidence=[{"source": "本尊", "target": "Yidam"}],
    )
    response = await client.post(root + "/lessons", json=payload, headers=headers(admin_token))
    assert response.status_code == 201, response.text
    lesson = response.json()
    assert (await client.post(root + "/lessons", json=payload, headers=headers(admin_token))).json()["id"] == lesson[
        "id"
    ]
    confirm = dict(client_request_id="confirm-1", expected_content_hash=lesson["content_hash"])
    url = root + f"/lessons/{lesson['id']}/confirm"
    assert (
        await client.post(url, json={**confirm, "expected_content_hash": "0" * 64}, headers=headers(admin_token))
    ).status_code == 409
    confirmed = await client.post(url, json=confirm, headers=headers(admin_token))
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    assert (await client.post(url, json=confirm, headers=headers(admin_token))).json() == confirmed.json()
    revision = await client.post(
        root + "/lessons",
        json={**payload, "client_request_id": "lesson-2", "supersedes_id": lesson["id"], "guidance": "New revision"},
        headers=headers(admin_token),
    )
    assert revision.status_code == 201
    assert revision.json()["id"] != lesson["id"]
    experiment = dict(
        client_request_id="experiment-1",
        lesson_ids=[lesson["id"]],
        evaluation_examples=[{"source_text": "另一章", "translated_text": "Another chapter"}],
        baseline_input={"prompt": "baseline"},
        candidate_input={"prompt": "baseline"},
        excluded_example_hashes=[],
    )
    e = await client.post(root + "/experiments", json=experiment, headers=headers(admin_token))
    assert e.status_code == 201, e.text
    assert e.json()["candidate_input"]["confirmed_lessons"][0]["guidance"] == "Keep yidam"
    assert (await client.post(root + "/experiments", json=experiment, headers=headers(admin_token))).json()[
        "id"
    ] == e.json()["id"]
    assert (
        await client.post(
            root + "/experiments",
            json={**experiment, "client_request_id": "unconfirmed", "lesson_ids": [revision.json()["id"]]},
            headers=headers(admin_token),
        )
    ).status_code == 409
    from app.models.docs_review import DocsReviewLesson, DocsReviewProject

    dbp = await db_session.get(DocsReviewProject, p["id"])
    dbp.chapter_label = "Renamed"
    await db_session.commit()
    await db_session.refresh(run)
    assert run.input_bundle["source_text"] == p["source_text"]
    assert run.input_bundle["rules"] == [{"content": "Original rule"}]
    assert (await db_session.get(DocsReviewLesson, lesson["id"])).guidance == "Keep yidam"
    for name in ("Translation", "TranslationVersion", "StyleRule", "GoldenExample"):
        import app.models as models

        assert await db_session.scalar(select(func.count()).select_from(getattr(models, name))) == 0


async def test_run_completion_is_once_only(client, admin_token, completed_review, db_session, seed_data):
    from fastapi import HTTPException

    from app.models.docs_review import DocsReviewItem
    from app.services.docs_review import repository as repo

    p, _s, run, _item = completed_review
    with pytest.raises(HTTPException) as exc:
        await repo.complete_run(
            db_session,
            seed_data["admin"].id,
            p["id"],
            run.id,
            raw_response="replacement",
            validated_result={},
            items=[],
            usage={},
        )
    assert exc.value.status_code == 409
    await db_session.refresh(run)
    assert run.raw_response == "raw"
    assert await db_session.scalar(select(func.count()).select_from(DocsReviewItem)) == 1


async def test_cross_project_nested_ids_and_owner_only_reads(
    client, admin_token, reviewer_token, completed_review, docs_project_payload, docs_snapshot_payload
):
    p, s, run, item = completed_review
    other = await project(client, admin_token, {**docs_project_payload, "client_request_id": "other"})
    other_snapshot = await snapshot(client, admin_token, other["id"], docs_snapshot_payload)
    response = await client.post(
        f"/api/docs-review/projects/{p['id']}/decisions",
        json={**decision_payload(s, item), "reviewed_snapshot_id": other_snapshot["id"]},
        headers=headers(admin_token),
    )
    assert response.status_code == 404
    for path in ("", f"/snapshots/{s['id']}", f"/runs/{run.id}", "/lessons/missing", "/experiments/missing"):
        response = await client.get(f"/api/docs-review/projects/{p['id']}" + path, headers=headers(reviewer_token))
        assert response.status_code == 404
    read = await client.get(f"/api/docs-review/projects/{p['id']}/runs/{run.id}", headers=headers(admin_token))
    assert read.status_code == 200
    assert read.json()["input_bundle"]["prompt"] == "Exact prompt"
    assert len(read.json()["items"]) == 1


async def test_checkpoint_exact_text_and_invalid_blocks(
    client, admin_token, docs_project_payload, docs_snapshot_payload
):
    p = await project(client, admin_token, docs_project_payload)
    payload = {
        **docs_snapshot_payload,
        "blocks": [
            dict(block_id="a", text=" A\u00a0", kind="paragraph"),
            dict(block_id="b", text="", kind="paragraph"),
        ],
    }
    s = await snapshot(client, admin_token, p["id"], payload)
    assert s["canonical_text"] == " A\u00a0\n"
    for blocks in (
        [dict(block_id="a", text="", kind="paragraph")],
        [dict(block_id="a", text="Table content", kind="table")],
    ):
        response = await client.post(
            f"/api/docs-review/projects/{p['id']}/snapshots",
            json={**payload, "client_request_id": "invalid", "blocks": blocks},
            headers=headers(admin_token),
        )
        assert response.status_code == 422


async def test_correction_relation_and_ineligible_lesson(client, admin_token, completed_review, docs_snapshot_payload):
    p, s, _run, item = completed_review
    root = f"/api/docs-review/projects/{p['id']}"
    changed = await snapshot(
        client,
        admin_token,
        p["id"],
        {
            **docs_snapshot_payload,
            "client_request_id": "changed",
            "blocks": [dict(block_id="target-1", text="Revised yidam text", kind="paragraph")],
        },
    )
    payload = decision_payload(s, item)
    assert (
        await client.post(
            root + "/decisions", json={**payload, "disposition": "corrected"}, headers=headers(admin_token)
        )
    ).status_code == 409
    assert (
        await client.post(
            root + "/decisions", json={**payload, "reviewed_snapshot_id": changed["id"]}, headers=headers(admin_token)
        )
    ).status_code == 409
    corrected = await client.post(
        root + "/decisions",
        json={**payload, "disposition": "corrected", "reviewed_snapshot_id": changed["id"]},
        headers=headers(admin_token),
    )
    assert corrected.status_code == 201
    uncertain = await client.post(
        root + "/decisions",
        json={**payload, "client_request_id": "uncertain", "disposition": "needs_another_opinion"},
        headers=headers(admin_token),
    )
    proposed = await client.post(
        root + "/lessons",
        json=dict(
            client_request_id="ineligible",
            originating_decision_id=uncertain.json()["id"],
            scope={},
            guidance="Unconfirmed hypothesis",
            evidence=[],
        ),
        headers=headers(admin_token),
    )
    assert proposed.status_code == 409


async def test_run_inputs_retry_and_failed_completion_are_atomic(
    client, admin_token, completed_review, db_session, seed_data
):
    from fastapi import HTTPException

    from app.models.docs_review import DocsReviewItem
    from app.schemas.docs_review import RunRequest
    from app.services.docs_review import repository as repo

    p, s, _run, _item = completed_review
    req = RunRequest(client_request_id="run-2", snapshot_id=s["id"], mode="fixture")
    bundle = {"rules": [{"content": "Frozen"}]}
    second = await repo.create_run(db_session, seed_data["admin"].id, p["id"], req, input_bundle=bundle)
    bundle["rules"][0]["content"] = "Mutable source changed"
    retried = await repo.create_run(db_session, seed_data["admin"].id, p["id"], req, input_bundle=bundle)
    assert retried.id == second.id
    assert retried.input_bundle["rules"][0]["content"] == "Frozen"
    with pytest.raises(HTTPException) as conflict:
        await repo.create_run(
            db_session, seed_data["admin"].id, p["id"], req.model_copy(update={"model": "different"}), input_bundle={}
        )
    assert conflict.value.status_code == 409
    with pytest.raises(HTTPException):
        await repo.complete_run(
            db_session,
            seed_data["admin"].id,
            p["id"],
            second.id,
            raw_response="bad",
            validated_result={},
            items=[dict(kind="invalid")],
            usage={},
        )
    assert second.status == "pending"
    assert second.raw_response is None
    assert await db_session.scalar(select(func.count()).select_from(DocsReviewItem)) == 1
    await repo.complete_run(
        db_session,
        seed_data["admin"].id,
        p["id"],
        second.id,
        raw_response=None,
        validated_result=None,
        items=[],
        usage={},
        error_code="before_provider",
    )
    assert second.status == "failed"


@pytest.fixture
async def race_client(tmp_path):
    """Independent real SQLite connections, unlike the single in-memory connection."""
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import event
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.core.database import Base, get_db
    from app.core.security import create_access_token
    from app.main import app
    from app.models.user import User, UserRole

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'race.db'}", connect_args={"timeout": 30})

    @event.listens_for(engine.sync_engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db:
        owner = User(username="race-owner", email="race@test.com", hashed_password="unused", role=UserRole.admin)
        db.add(owner)
        await db.commit()
        owner_id = owner.id

    async def get_test_db():
        async with factory() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = get_test_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, create_access_token({"sub": str(owner_id)}), factory, owner_id
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous
        await engine.dispose()


async def test_concurrent_setup_checkpoint_and_decision_races(race_client, docs_project_payload, docs_snapshot_payload):
    import asyncio

    from app.models.docs_review import DocsReviewDecision, DocsReviewItem, DocsReviewProject, DocsReviewSnapshot
    from app.schemas.docs_review import RunRequest
    from app.services.docs_review import repository as repo

    client, token, factory, owner_id = race_client

    async def pair(url, payload, conflicting=False):
        other = {**payload, "note": "Different content"} if conflicting else payload
        responses = await asyncio.gather(
            *[client.post(url, json=body, headers=headers(token)) for body in (payload, other)]
        )
        if conflicting:
            assert sorted(r.status_code for r in responses) == [201, 409]
        else:
            assert [r.status_code for r in responses] == [201, 201], [r.text for r in responses]
            assert responses[0].json()["id"] == responses[1].json()["id"]
        return next(r.json() for r in responses if r.status_code == 201)

    p = await pair("/api/docs-review/projects", docs_project_payload)
    root = f"/api/docs-review/projects/{p['id']}"
    s = await pair(root + "/snapshots", docs_snapshot_payload)
    async with factory() as db:
        run = await repo.create_run(
            db,
            owner_id,
            p["id"],
            RunRequest(client_request_id="race-run", snapshot_id=s["id"], mode="fixture"),
            input_bundle={},
        )
        await repo.complete_run(
            db,
            owner_id,
            p["id"],
            run.id,
            raw_response="fixture",
            validated_result={},
            items=[
                dict(
                    kind="audit",
                    category=None,
                    proposed_severity=None,
                    source_spans=[],
                    target_spans=[],
                    explanation="Audit sample",
                    evidence_ids=[],
                )
            ],
            usage={},
        )
        await db.commit()
        item = await db.scalar(select(DocsReviewItem).where(DocsReviewItem.run_id == run.id))
    payload = {**decision_payload(s, item), "disposition": "audit_no_issue"}
    await pair(root + "/decisions", payload)
    await pair(root + "/decisions", {**payload, "client_request_id": "conflicting-race"}, conflicting=True)
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(DocsReviewProject)) == 1
        assert await db.scalar(select(func.count()).select_from(DocsReviewSnapshot)) == 1
        assert await db.scalar(select(func.count()).select_from(DocsReviewDecision)) == 2


async def test_confirmation_races_do_not_change_frozen_timestamp(
    race_client, docs_project_payload, docs_snapshot_payload
):
    import asyncio

    from app.models.docs_review import DocsReviewItem, DocsReviewLessonConfirmation
    from app.schemas.docs_review import RunRequest
    from app.services.docs_review import repository as repo

    client, token, factory, owner_id = race_client
    p = await project(client, token, docs_project_payload)
    s = await snapshot(client, token, p["id"], docs_snapshot_payload)
    root = f"/api/docs-review/projects/{p['id']}"
    async with factory() as db:
        run = await repo.create_run(
            db,
            owner_id,
            p["id"],
            RunRequest(client_request_id="run", snapshot_id=s["id"], mode="fixture"),
            input_bundle={},
        )
        await repo.complete_run(
            db,
            owner_id,
            p["id"],
            run.id,
            raw_response="fixture",
            validated_result={},
            items=[
                dict(
                    kind="audit",
                    category=None,
                    proposed_severity=None,
                    source_spans=[],
                    target_spans=[],
                    explanation="Audit sample",
                    evidence_ids=[],
                )
            ],
            usage={},
        )
        await db.commit()
        item = await db.scalar(select(DocsReviewItem).where(DocsReviewItem.run_id == run.id))
    decision = (
        await client.post(
            root + "/decisions",
            json={**decision_payload(s, item), "disposition": "audit_found_issue"},
            headers=headers(token),
        )
    ).json()
    request = dict(
        client_request_id="lesson",
        originating_decision_id=decision["id"],
        scope={},
        guidance="Test lesson",
        evidence=[],
    )
    proposed = await asyncio.gather(
        *[client.post(root + "/lessons", json=request, headers=headers(token)) for _ in range(2)]
    )
    assert [r.status_code for r in proposed] == [201, 201]
    assert proposed[0].json()["id"] == proposed[1].json()["id"]
    lesson = proposed[0].json()
    confirm = dict(client_request_id="confirmation", expected_content_hash=lesson["content_hash"])
    url = root + f"/lessons/{lesson['id']}/confirm"
    responses = await asyncio.gather(*[client.post(url, json=confirm, headers=headers(token)) for _ in range(2)])
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json()["confirmed_at"] == responses[1].json()["confirmed_at"]
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(DocsReviewLessonConfirmation)) == 1


async def test_existing_translation_and_knowledge_records_are_untouched(
    client, admin_token, db_session, seed_data, docs_project_payload, docs_snapshot_payload
):
    from app.models import Book, Chapter, GoldenExample, Segment, StyleRule, Translation, TranslationVersion
    from app.models.translation import SegmentStatus
    from app.schemas.docs_review import RunRequest
    from app.services.docs_review import repository as repo

    book = Book(title_source="Existing")
    db_session.add(book)
    await db_session.flush()
    chapter = Chapter(book_id=book.id)
    db_session.add(chapter)
    await db_session.flush()
    segment = Segment(chapter_id=chapter.id, source_text="Existing source")
    db_session.add(segment)
    await db_session.flush()
    translation = Translation(segment_id=segment.id, language_id=seed_data["en"].id, translated_text="Existing draft")
    rule = StyleRule(content="Existing rule")
    golden = GoldenExample(language_id=seed_data["en"].id, source_text="Golden source", translated_text="Golden target")
    db_session.add_all([translation, rule, golden])
    await db_session.flush()
    version = TranslationVersion(
        translation_id=translation.id, version_number=1, translated_text="Existing version", status=SegmentStatus.draft
    )
    db_session.add(version)
    await db_session.commit()
    p = await project(client, admin_token, docs_project_payload)
    s = await snapshot(client, admin_token, p["id"], docs_snapshot_payload)
    run = await repo.create_run(
        db_session,
        seed_data["admin"].id,
        p["id"],
        RunRequest(client_request_id="existing-run", snapshot_id=s["id"], mode="fixture"),
        input_bundle={
            "rules": [{"id": rule.id, "content": rule.content}],
            "examples": [
                {"id": golden.id, "source_text": golden.source_text, "translated_text": golden.translated_text}
            ],
        },
    )
    await db_session.commit()
    for record, field, expected in [
        (translation, "translated_text", "Existing draft"),
        (version, "translated_text", "Existing version"),
        (rule, "content", "Existing rule"),
        (golden, "translated_text", "Golden target"),
    ]:
        await db_session.refresh(record)
        assert getattr(record, field) == expected
        assert await db_session.scalar(select(func.count()).select_from(type(record))) == 1
    rule.content = "Edited after review"
    golden.translated_text = "Edited later"
    await db_session.commit()
    await db_session.refresh(run)
    assert run.input_bundle["rules"][0]["content"] == "Existing rule"
    assert run.input_bundle["examples"][0]["translated_text"] == "Golden target"


async def test_evidence_foreign_keys_restrict_deletion(race_client, docs_project_payload, docs_snapshot_payload):
    from sqlalchemy import delete
    from sqlalchemy.exc import IntegrityError

    from app.models.docs_review import DocsReviewProject

    client, token, factory, _owner_id = race_client
    p = await project(client, token, docs_project_payload)
    s = await snapshot(client, token, p["id"], docs_snapshot_payload)
    async with factory() as db:
        with pytest.raises(IntegrityError):
            async with db.begin_nested():
                await db.execute(delete(DocsReviewProject).where(DocsReviewProject.id == p["id"]))
    assert (
        await client.get(f"/api/docs-review/projects/{p['id']}/snapshots/{s['id']}", headers=headers(token))
    ).status_code == 200


async def test_development_fixture_is_authenticated_read_only_golden(client, admin_token, db_session, monkeypatch):
    from app.models.docs_review import DocsReviewProject

    url = "/api/docs-review/development-fixture"
    assert (await client.get(url)).status_code == 401
    response = await client.get(url, headers=headers(admin_token))
    assert response.status_code == 200
    golden = Path(__file__).parent / "fixtures/docs_review/book-300-chapter-009.json"
    packaged = Path(__file__).parents[1] / "app/services/docs_review/fixtures/book-300-chapter-009.json"
    assert response.json() == json.loads(golden.read_text())
    assert packaged.read_bytes() == golden.read_bytes()
    assert all(
        c["provenance"] == "analyst_development_example" and c["human_confirmed"] is False
        for c in response.json()["analyst_cards"]
    )
    assert await db_session.scalar(select(func.count()).select_from(DocsReviewProject)) == 0
    monkeypatch.setattr(get_settings(), "docs_review_enabled", False)
    assert (await client.get(url, headers=headers(admin_token))).status_code == 404


async def test_fixture_run_materializes_decidable_items(client, admin_token, reviewer_token, docs_project_payload):
    fixture = json.loads((Path(__file__).parent / "fixtures/docs_review/book-300-chapter-009.json").read_text())
    p = await project(client, admin_token, docs_project_payload)
    s = await snapshot(
        client,
        admin_token,
        p["id"],
        dict(client_request_id="full", suggestions_pending=False, blocks=fixture["target_blocks"]),
    )
    url = f"/api/docs-review/projects/{p['id']}/runs"
    request = dict(client_request_id="fixture-run", snapshot_id=s["id"], mode="fixture")
    assert (await client.post(url, json=request, headers=headers(reviewer_token))).status_code == 404
    result = await client.post(url, json=request, headers=headers(admin_token))
    assert result.status_code == 201, result.text
    run = result.json()
    assert run["status"] == "completed"
    assert len(run["items"]) == 6
    assert run["input_bundle"]["fixture"]["analyst_cards"] == fixture["analyst_cards"]
    assert run["usage"]["cost_usd"] == 0
    assert (await client.post(url, json=request, headers=headers(admin_token))).json() == run
    assert (await client.post(url, json={**request, "mode": "live"}, headers=headers(admin_token))).status_code == 409
    for i, item in enumerate(run["items"]):
        assert item["evidence_ids"]
        response = await client.post(
            f"/api/docs-review/projects/{p['id']}/decisions",
            headers=headers(admin_token),
            json=dict(
                client_request_id=f"decide-{i}",
                item_id=item["id"],
                base_snapshot_id=s["id"],
                reviewed_snapshot_id=s["id"],
                disposition="audit_no_issue" if item["kind"] == "audit" else "no_issue",
                note="Reviewed example, not approved knowledge",
            ),
        )
        assert response.status_code == 201, response.text
    changed = await snapshot(
        client,
        admin_token,
        p["id"],
        dict(
            client_request_id="changed",
            suggestions_pending=False,
            blocks=[
                {**b, "text": b["text"] + (" edited" if b["block_id"] == "target-0005" else "")}
                for b in fixture["target_blocks"]
            ],
        ),
    )
    assert (
        await client.post(url, json={**request, "snapshot_id": changed["id"]}, headers=headers(admin_token))
    ).status_code == 409


async def test_fixture_run_cannot_be_relabelled_as_another_language(client, admin_token, docs_project_payload):
    fixture = json.loads((Path(__file__).parent / "fixtures/docs_review/book-300-chapter-009.json").read_text())
    p = await project(client, admin_token, {**docs_project_payload, "target_language": "fr"})
    s = await snapshot(
        client,
        admin_token,
        p["id"],
        dict(client_request_id="full", suggestions_pending=False, blocks=fixture["target_blocks"]),
    )
    response = await client.post(
        f"/api/docs-review/projects/{p['id']}/runs",
        headers=headers(admin_token),
        json=dict(client_request_id="fixture", snapshot_id=s["id"], mode="fixture"),
    )
    assert response.status_code == 409
