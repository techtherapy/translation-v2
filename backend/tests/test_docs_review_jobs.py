"""Durable job and API tests: in-memory DB, fake queue, fake completion only."""

import asyncio
import copy
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.config import get_settings
from app.models.docs_review import DocsReviewItem, DocsReviewRun, DocsReviewSnapshot
from app.schemas.docs_review import ProjectRequest, RunRequest, SnapshotRequest
from app.services.docs_review import repository as repo
from tests.test_docs_review_assessment import assessment, response


@pytest.fixture(autouse=True)
def live_config(monkeypatch):
    settings = get_settings()
    for name, value in {
        "docs_review_enabled": True,
        "docs_review_live_ai": True,
        "docs_review_account_spend_limit_confirmed": True,
        "docs_review_account_spend_limit_usd": 0.1,
        "docs_review_price_schedules": {
            "anthropic/test-model": {"id": "test-v1", "input_per_million": 1.0, "output_per_million": 2.0}
        },
    }.items():
        monkeypatch.setitem(settings.__dict__, name, value)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fake-key-never-used")


@pytest.fixture()
async def project_snapshot(db_session, seed_data):
    owner = seed_data["admin"].id
    project = await repo.create_project(
        db_session,
        owner,
        ProjectRequest(
            client_request_id="p",
            document_id="doc",
            tab_id="tab",
            book_label="test",
            chapter_label="chapter",
            source_language="zh",
            target_language="en",
            source_text="源文:甲乙。",
        ),
    )
    snapshot = await repo.append_snapshot(
        db_session,
        owner,
        project.id,
        SnapshotRequest(
            client_request_id="s",
            suggestions_pending=False,
            blocks=[
                {"block_id": "p1", "text": "First passage", "kind": "paragraph"},
                {"block_id": "p2", "text": "Second passage", "kind": "paragraph"},
                {"block_id": "p3", "text": "Third passage", "kind": "paragraph"},
                {"block_id": "empty", "text": "", "kind": "paragraph"},
            ],
        ),
    )
    await db_session.commit()
    return owner, project, snapshot


def request(snapshot, **changes):
    payload = dict(
        client_request_id="run",
        snapshot_id=snapshot.id,
        mode="live",
        model="anthropic/test-model",
        limits=dict(max_input_tokens=20000, max_output_tokens=2000, max_cost_usd=0.1),
        guidance=[{"id": "g1", "content": "Preserve authorial wordplay."}],
    )
    payload.update(changes)
    return RunRequest(**payload)


class FakeQueue:
    def __init__(self, fail=False):
        self.fail = fail
        self.ids = []

    async def enqueue_job(self, name, run_id, *, _job_id):
        assert name == "review_docs_snapshot"
        self.ids.append(_job_id)
        if self.fail:
            raise ConnectionError("private queue connection error")
        return object()

    async def aclose(self):
        pass


def context(db_session, completion):
    return {
        "session_factory": async_sessionmaker(db_session.bind, expire_on_commit=False),
        "completion_client": completion,
    }


async def start(db, project_snapshot, **changes):
    from app.worker.docs_review import create_live_run

    owner, project, snapshot = project_snapshot
    return await create_live_run(db, owner, project.id, request(snapshot, **changes), queue=FakeQueue())


async def good(**kwargs):
    return response()


async def test_queue_failure_commits_run_before_enqueue_and_retry_keeps_identity(db_session, project_snapshot):
    from app.worker.docs_review import create_live_run, enqueue_run

    owner, project, snapshot = project_snapshot
    q = FakeQueue(fail=True)
    run = await create_live_run(db_session, owner, project.id, request(snapshot), queue=q)
    assert run.status == "pending_enqueue"
    assert run.error_code == "queue_unavailable"
    factory = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with factory() as other:
        persisted = await other.get(DocsReviewRun, run.id)
        assert persisted.status == "pending_enqueue"
    q.fail = False
    await enqueue_run(db_session, run, queue=q)
    assert run.status == "queued"
    repeated = await create_live_run(db_session, owner, project.id, request(snapshot), queue=q)
    assert repeated.id == run.id
    assert q.ids == ["docs-review:" + run.id] * 2
    assert await db_session.scalar(select(func.count()).select_from(DocsReviewRun)) == 1


async def test_worker_stores_once_audits_separately_and_never_updates_newer_snapshot(db_session, project_snapshot):
    from app.worker.docs_review import review_docs_snapshot

    owner, project, snapshot = project_snapshot
    run = await start(db_session, project_snapshot)
    frozen = copy.deepcopy(run.input_bundle)
    new = await repo.append_snapshot(
        db_session,
        owner,
        project.id,
        SnapshotRequest(
            client_request_id="new",
            suggestions_pending=False,
            blocks=[{"block_id": "p1", "text": "Later typing", "kind": "paragraph"}],
        ),
    )
    await db_session.commit()
    calls = []

    async def fake(**kwargs):
        calls.append(kwargs)
        return response()

    ctx = context(db_session, fake)
    first = await review_docs_snapshot(ctx, run.id)
    second = await review_docs_snapshot(ctx, run.id)
    assert first == second
    assert first["status"] == "succeeded"
    assert len(calls) == 1
    await db_session.refresh(run)
    assert run.input_bundle == frozen
    assert run.snapshot_id == snapshot.id
    assert run.validated_result["audit"] == {
        "population": ["p3"],
        "seed": run.input_bundle["audit_seed"],
        "requested_count": 3,
        "count": 1,
        "selected_ids": ["p3"],
    }
    assert run.validated_result["unflagged_status"] == "unreviewed"
    assert run.usage["reserved_cost_usd"] == pytest.approx(0.024)
    assert run.usage["prompt_tokens"] == 321
    items = (await db_session.scalars(select(DocsReviewItem).where(DocsReviewItem.run_id == run.id))).all()
    assert sorted(item.kind for item in items) == ["audit", "finding"]
    assert run.raw_response
    await db_session.refresh(new)
    assert new.canonical_text == "Later typing"
    assert await db_session.scalar(select(func.count()).select_from(DocsReviewSnapshot)) == 2


@pytest.mark.parametrize("case", ["json", "truncated", "quote", "timeout", "exception"])
async def test_bad_provider_response_never_persists_items_or_clean_result(db_session, project_snapshot, case):
    from app.worker.docs_review import review_docs_snapshot

    run = await start(db_session, project_snapshot)
    calls = []

    async def fake(**kwargs):
        calls.append(kwargs)
        if case == "timeout":
            raise TimeoutError("lost")
        if case == "exception":
            raise RuntimeError("do not disclose fake key")
        value = assessment()
        if case == "quote":
            value["findings"][0]["target_spans"][0]["quote"] = "invented"
        return response(
            value, raw="bad json" if case == "json" else None, finish="length" if case == "truncated" else "stop"
        )

    ctx = context(db_session, fake)
    await review_docs_snapshot(ctx, run.id)
    await review_docs_snapshot(ctx, run.id)
    await db_session.refresh(run)
    assert run.status == ("interrupted" if case in {"timeout", "exception"} else "failed")
    assert run.error_code
    assert run.validated_result is None
    assert await db_session.scalar(select(func.count()).select_from(DocsReviewItem)) == 0
    assert len(calls) == 1


@pytest.mark.parametrize(
    "case", ["missing_model", "missing_key", "unknown_price", "budget", "input_size", "missing_limits", "account_cap"]
)
async def test_preflight_failure_is_visible_and_calls_no_provider(db_session, project_snapshot, monkeypatch, case):
    from app.worker.docs_review import review_docs_snapshot

    changes = {}
    if case == "missing_model":
        changes["model"] = None
    if case == "missing_key":
        monkeypatch.delenv("ANTHROPIC_API_KEY")
    if case == "unknown_price":
        monkeypatch.setattr(get_settings(), "docs_review_price_schedules", {})
    if case == "budget":
        changes["limits"] = dict(max_input_tokens=20000, max_output_tokens=2000, max_cost_usd=0.001)
    if case == "input_size":
        changes["limits"] = dict(max_input_tokens=10, max_output_tokens=2000, max_cost_usd=0.1)
    if case == "missing_limits":
        changes["limits"] = None
    if case == "account_cap":
        monkeypatch.setattr(get_settings(), "docs_review_account_spend_limit_confirmed", False)
    run = await start(db_session, project_snapshot, **changes)

    async def forbidden(**kwargs):
        pytest.fail("Provider must not be called")

    await review_docs_snapshot(context(db_session, forbidden), run.id)
    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.error_code
    assert run.validated_result is None
    assert run.usage.get("provider_calls", 0) == 0


async def test_expired_running_lease_is_interrupted_and_cannot_be_retried(db_session, project_snapshot):
    from app.worker.docs_review import enqueue_run, reconcile_run, review_docs_snapshot

    run = await start(db_session, project_snapshot)
    run.status = "running"
    run.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()
    await reconcile_run(db_session, run)
    assert run.status == "interrupted"
    await enqueue_run(db_session, run, queue=FakeQueue())

    async def forbidden(**kwargs):
        pytest.fail("Expired paid call must not retry")

    assert (await review_docs_snapshot(context(db_session, forbidden), run.id))["status"] == "interrupted"


async def test_expired_queued_run_becomes_visible_retryable_pending(db_session, project_snapshot):
    from app.worker.docs_review import reconcile_run

    run = await start(db_session, project_snapshot)
    run.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()
    await reconcile_run(db_session, run)
    assert run.status == "pending_enqueue"
    assert run.error_code == "queue_confirmation_expired"


async def test_late_completion_cannot_overwrite_interrupted_run(db_session, project_snapshot):
    from app.worker.docs_review import reconcile_run, review_docs_snapshot

    run = await start(db_session, project_snapshot)
    ctx = context(db_session, good)

    async def delayed(**kwargs):
        async with ctx["session_factory"]() as other:
            await other.execute(
                update(DocsReviewRun)
                .where(DocsReviewRun.id == run.id)
                .values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
            await other.commit()
            stale = await other.get(DocsReviewRun, run.id)
            await reconcile_run(other, stale)
        return response()

    ctx["completion_client"] = delayed
    result = await review_docs_snapshot(ctx, run.id)
    assert result["status"] == "interrupted"
    assert await db_session.scalar(select(func.count()).select_from(DocsReviewItem)) == 0
    await db_session.refresh(run)
    assert run.raw_response == response().choices[0].message.content
    assert run.validated_result is None
    assert run.usage["late_response"] is True


async def test_live_api_preserves_owner_permission_and_raw_output_privacy(
    client, admin_token, reviewer_token, db_session, project_snapshot, monkeypatch
):
    from app.worker import docs_review as jobs

    _owner, project, snapshot = project_snapshot

    async def pool():
        return FakeQueue(fail=True)

    monkeypatch.setattr(jobs, "create_queue", pool)
    root = f"/api/docs-review/projects/{project.id}/runs"
    payload = request(snapshot).model_dump()
    auth = {"Authorization": "Bearer " + admin_token}
    assert (await client.post(root, json=payload)).status_code == 401
    assert (
        await client.post(root, json=payload, headers={"Authorization": "Bearer " + reviewer_token})
    ).status_code == 404
    result = await client.post(root, json=payload, headers=auth)
    assert result.status_code == 201, result.text
    run = result.json()
    assert run["status"] == "pending_enqueue" and run["queue_retryable"]
    assert "raw_response" not in run
    retry = await client.post(root + "/" + run["id"] + "/retry", headers=auth)
    assert retry.status_code == 200
    await jobs.review_docs_snapshot(context(db_session, good), run["id"])
    observed = (await client.get(root + "/" + run["id"], headers=auth)).json()
    assert observed["status"] == "succeeded"
    assert observed["finding_count"] == 1 and observed["audit_count"] == 1
    assert "raw_response" not in observed
    assert observed["input_bundle"]["guidance"] == payload["guidance"]
    monkeypatch.setattr(get_settings(), "docs_review_live_ai", False)
    assert (await client.post(root, json={**payload, "client_request_id": "disabled"}, headers=auth)).status_code == 409


# Reuse the independent-connection SQLite harness rather than the in-memory singleton.
from tests.test_docs_review_api import race_client  # noqa: F401, E402


@pytest.fixture()
async def durable_run(race_client):  # noqa: F811 -- imported pytest fixture
    _client, _token, factory, owner = race_client
    async with factory() as db:
        project = await repo.create_project(
            db,
            owner,
            ProjectRequest(
                client_request_id="project",
                document_id="doc",
                tab_id="tab",
                book_label="test",
                chapter_label="test",
                source_language="zh",
                target_language="en",
                source_text="源文:甲乙。",
            ),
        )
        snapshot = await repo.append_snapshot(
            db,
            owner,
            project.id,
            SnapshotRequest(
                client_request_id="snap",
                suggestions_pending=False,
                blocks=[
                    {"block_id": bid, "text": text, "kind": "paragraph"}
                    for bid, text in [("p1", "First passage"), ("p2", "Second passage"), ("p3", "Third passage")]
                ],
            ),
        )
        await db.commit()
    return factory, owner, project, snapshot


async def test_concurrent_delivery_and_restart_acquire_one_paid_call(durable_run):
    from app.worker.docs_review import create_live_run, review_docs_snapshot

    factory, owner, project, snapshot = durable_run

    class ObservingQueue(FakeQueue):
        async def enqueue_job(self, name, run_id, *, _job_id):
            async with factory() as other:
                saved = await other.get(DocsReviewRun, run_id)
                assert saved.status == "pending_enqueue"  # committed before Redis is contacted
            return await super().enqueue_job(name, run_id, _job_id=_job_id)

    async with factory() as db:
        run = await create_live_run(db, owner, project.id, request(snapshot), queue=ObservingQueue())
    calls = 0
    entered, release = asyncio.Event(), asyncio.Event()

    async def fake(**kwargs):
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return response()

    ctx = {"session_factory": factory, "completion_client": fake}
    first = asyncio.create_task(review_docs_snapshot(ctx, run.id))
    await asyncio.wait_for(entered.wait(), timeout=5)
    duplicate = await review_docs_snapshot(ctx, run.id)
    assert duplicate["status"] == "running"
    release.set()
    completed = await first
    assert completed["status"] == "succeeded"
    assert await review_docs_snapshot(ctx, run.id) == completed
    assert calls == 1
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(DocsReviewItem)) == 2


async def test_pilot_budget_reservations_are_shared_across_runs_and_never_released_after_ambiguity(
    durable_run, monkeypatch
):
    from app.worker.docs_review import create_live_run, review_docs_snapshot

    factory, owner, project, snapshot = durable_run
    monkeypatch.setattr(get_settings(), "docs_review_account_spend_limit_usd", 0.03)
    runs = []
    async with factory() as db:
        for i in range(2):
            runs.append(
                await create_live_run(
                    db, owner, project.id, request(snapshot, client_request_id=f"budget-{i}"), queue=FakeQueue()
                )
            )
    calls = 0

    async def lost(**kwargs):
        nonlocal calls
        calls += 1
        raise TimeoutError("may have been charged")

    ctx = {"session_factory": factory, "completion_client": lost}
    first, second = await asyncio.gather(*(review_docs_snapshot(ctx, run.id) for run in runs))
    assert sorted([first["status"], second["status"]]) == ["failed", "interrupted"]
    assert calls == 1
    async with factory() as db:
        failed = await db.scalar(select(DocsReviewRun).where(DocsReviewRun.status == "failed"))
        assert failed.error_code == "account_budget_exhausted"


async def test_worker_uses_frozen_prices_and_prompt_after_configuration_changes(
    db_session, project_snapshot, monkeypatch
):
    from app.worker.docs_review import review_docs_snapshot

    run = await start(db_session, project_snapshot)
    before = copy.deepcopy(run.input_bundle)
    monkeypatch.setattr(get_settings(), "docs_review_price_schedules", {})
    await review_docs_snapshot(context(db_session, good), run.id)
    await db_session.refresh(run)
    assert run.status == "succeeded"
    assert run.input_bundle == before
    assert run.usage["reserved_cost_usd"] == pytest.approx(0.024)


async def test_empty_findings_are_unreviewed_with_audits_not_clean(db_session, project_snapshot):
    from app.worker.docs_review import review_docs_snapshot

    run = await start(db_session, project_snapshot)

    async def no_findings(**kwargs):
        value = assessment()
        value["findings"] = []
        return response(value)

    await review_docs_snapshot(context(db_session, no_findings), run.id)
    await db_session.refresh(run)
    assert run.status == "succeeded"
    assert run.validated_result["findings"] == []
    assert run.validated_result["unflagged_status"] == "unreviewed"
    assert set(run.validated_result["audit"]["selected_ids"]) == {"p1", "p2", "p3"}
    assert run.validated_result["audit"]["count"] == 3


async def test_cancelled_call_is_durably_interrupted(db_session, project_snapshot):
    from app.worker.docs_review import review_docs_snapshot

    run = await start(db_session, project_snapshot)

    async def cancelled(**kwargs):
        raise asyncio.CancelledError()

    result = await review_docs_snapshot(context(db_session, cancelled), run.id)
    assert result["status"] == "interrupted"
    assert (await review_docs_snapshot(context(db_session, good), run.id))["status"] == "interrupted"


async def test_fixture_request_identity_does_not_change_when_live_guidance_is_added(db_session, project_snapshot):
    from app.services.docs_review.evidence import evidence_hash

    owner, project, snapshot = project_snapshot
    old_payload = {
        "client_request_id": "old-fixture",
        "snapshot_id": snapshot.id,
        "mode": "fixture",
        "model": None,
        "limits": None,
    }
    old_run = DocsReviewRun(
        project_id=project.id,
        snapshot_id=snapshot.id,
        mode="fixture",
        status="completed",
        client_request_id="old-fixture",
        request_hash=evidence_hash(old_payload),
        input_bundle={"request": old_payload},
        input_sha256=evidence_hash({"request": old_payload}),
    )
    db_session.add(old_run)
    await db_session.commit()
    retried = await repo.create_run(db_session, owner, project.id, RunRequest(**old_payload), input_bundle={})
    assert retried.id == old_run.id
    assert retried.input_bundle["request"] == old_payload


async def test_retry_removes_retained_arq_result_and_actually_enqueues(db_session, project_snapshot):
    from arq.constants import result_key_prefix

    from app.worker.docs_review import enqueue_run

    run = await start(db_session, project_snapshot)
    run.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()
    job_id = "docs-review:" + run.id

    class RetainedResultQueue(FakeQueue):
        def __init__(self):
            super().__init__()
            self.keys = {result_key_prefix + job_id}
            self.scheduled = []

        async def enqueue_job(self, name, run_id, *, _job_id):
            self.ids.append(_job_id)
            if result_key_prefix + _job_id in self.keys:
                return None  # ARQ refuses IDs with a retained terminal result.
            self.scheduled.append((name, run_id, _job_id))
            return object()

        async def exists(self, key):
            return key in self.keys

        async def delete(self, key):
            self.keys.discard(key)

    queue = RetainedResultQueue()
    await enqueue_run(db_session, run, queue=queue)
    assert queue.scheduled == [("review_docs_snapshot", run.id, job_id)]
    assert queue.ids == [job_id, job_id]
    assert run.status == "queued"
    assert run.error_code is None


async def test_none_enqueue_without_result_stays_visibly_unconfirmed(db_session, project_snapshot):
    from app.worker.docs_review import enqueue_run

    run = await start(db_session, project_snapshot)
    run.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()

    class UnconfirmedQueue(FakeQueue):
        async def enqueue_job(self, *args, **kwargs):
            return None

        async def exists(self, key):
            return False

    await enqueue_run(db_session, run, queue=UnconfirmedQueue())
    assert run.status == "pending_enqueue"
    assert run.error_code == "queue_delivery_unconfirmed"
    assert run.lease_expires_at is None


async def test_queued_run_uses_complete_frozen_request_after_runtime_defaults_change(
    db_session, project_snapshot, monkeypatch
):
    from app.services.docs_review import assessment as service
    from app.worker.docs_review import review_docs_snapshot

    run = await start(db_session, project_snapshot)
    frozen = copy.deepcopy(run.input_bundle)
    options = frozen.get("completion_options")
    assert options is not None, "Every provider option must be frozen at creation"
    assert options == {
        "model": "anthropic/test-model",
        "messages": frozen["messages"],
        "max_completion_tokens": 2000,
        "response_format": {"type": "json_object"},
        "num_retries": 0,
        "timeout": 120,
        "temperature": 0.0,
        "top_p": 1.0,
        "n": 1,
        "stream": False,
        "stop": None,
        "seed": None,
        "presence_penalty": None,
        "frequency_penalty": None,
    }
    monkeypatch.setattr(
        service,
        "COMPLETION_DEFAULTS",
        {
            "temperature": 0.9,
            "top_p": 0.8,
            "timeout": 1,
            "num_retries": 9,
            "response_format": {"type": "text"},
        },
    )
    seen = []

    async def fake(**kwargs):
        seen.append(copy.deepcopy(kwargs))
        # Provider SDKs are allowed to mutate their argument dictionaries.
        kwargs["messages"][0]["content"] = "mutated by provider"
        return response()

    await review_docs_snapshot(context(db_session, fake), run.id)
    assert seen == [options]
    await db_session.refresh(run)
    assert run.input_bundle == frozen
    assert run.status == "succeeded"


async def test_older_queued_run_without_completion_options_fails_without_call(db_session, project_snapshot):
    from app.services.docs_review.evidence import evidence_hash
    from app.worker.docs_review import review_docs_snapshot

    run = await start(db_session, project_snapshot)
    run.input_bundle = {key: value for key, value in run.input_bundle.items() if key != "completion_options"}
    run.input_sha256 = evidence_hash(run.input_bundle)
    await db_session.commit()

    async def forbidden(**kwargs):
        pytest.fail("Missing request evidence must not be reconstructed at execution")

    await review_docs_snapshot(context(db_session, forbidden), run.id)
    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.error_code == "completion_options_missing"
    assert run.usage["provider_calls"] == 0
