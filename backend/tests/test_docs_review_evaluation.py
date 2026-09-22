"""Paired experiment behavior, fake queue and fake completion only."""

import copy
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.models.docs_review import DocsReviewExperiment
from app.models.setting import Setting
from tests import test_docs_review_api as api_fixtures
from tests import test_docs_review_jobs as job_fixtures
from tests.test_docs_review_learning import propose

completed_review = api_fixtures.completed_review
docs_project_payload = api_fixtures.docs_project_payload
docs_snapshot_payload = api_fixtures.docs_snapshot_payload
enabled = api_fixtures.enabled
headers = api_fixtures.headers
decision_payload = api_fixtures.decision_payload
snapshot = api_fixtures.snapshot

context = job_fixtures.context
live_config = job_fixtures.live_config


def experiment_payload(**changes):
    config = dict(
        model="anthropic/test-model",
        limits=dict(max_input_tokens=20000, max_output_tokens=2000, max_cost_usd=0.1),
        guidance=[],
        generate_draft=False,
        audit_count=1,
    )
    value = dict(
        client_request_id="experiment",
        lesson_ids=[],
        evaluation_examples=[
            dict(
                id="heldout-1",
                source_text="山間秋雨滋潤松林。",
                translated_text="Autumn rain nourishes the mountain pines.",
                classification="heldout",
            )
        ],
        baseline_input=config,
        candidate_input=copy.deepcopy(config),
        excluded_example_hashes=[],
        development_sources=[],
    )
    value.update(changes)
    return value


class Queue:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    async def enqueue_job(self, name, experiment_id, *, _job_id):
        assert name == "evaluate_docs_experiment"
        self.calls.append(_job_id)
        if self.fail:
            raise ConnectionError("Lost dispatch")
        return object()

    async def aclose(self):
        pass


def completion(value):
    return SimpleNamespace(
        usage=SimpleNamespace(prompt_tokens=100, completion_tokens=20, total_tokens=120),
        choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=json.dumps(value)))],
    )


async def fake(**kwargs):
    data = json.loads(kwargs["messages"][1]["content"])
    if "generation" in kwargs["messages"][0]["content"]:
        return completion({"schema_version": 1, "translated_text": "Fresh independent draft"})
    return completion(
        dict(
            schema_version=1,
            findings=[],
            coverage=dict(
                source_block_ids=["source"],
                target_block_ids=[b["block_id"] for b in data["target_blocks"]],
                complete=True,
            ),
        )
    )


async def create(client, token, completed, payload=None):
    root = f"/api/docs-review/projects/{completed[0]['id']}"
    r = await client.post(root + "/experiments", json=payload or experiment_payload(), headers=headers(token))
    assert r.status_code == 201, r.text
    return root, r.json()


async def run_experiment(db, completed, eid, completion_client=fake):
    from app.worker.docs_review import enqueue_experiment, evaluate_docs_experiment

    experiment = await db.get(DocsReviewExperiment, eid)
    await enqueue_experiment(db, experiment, queue=Queue())
    result = await evaluate_docs_experiment(context(db, completion_client), eid)
    await db.refresh(experiment)
    return experiment, result


def reference_payload(**changes):
    value = dict(
        client_request_id="reference",
        phase="reference",
        example_id="heldout-1",
        source_qualified=True,
        reference_complete=True,
        serious_issues=[],
        note="Compared source and supplied translation before seeing flags",
    )
    value.update(changes)
    return value


def judgment_payload(**changes):
    arm = dict(
        flags=[],
        audits=[dict(block_id="target", serious_issue_ids=[])],
        review_intervals=[dict(start=0.0, end=12.0, active=True), dict(start=12.0, end=100.0, active=False)],
        generation=None,
    )
    value = dict(
        client_request_id="judgment",
        phase="judgment",
        example_id="heldout-1",
        arms={"A": copy.deepcopy(arm), "B": copy.deepcopy(arm)},
        note="Independent comparison",
    )
    value.update(changes)
    return value


def test_held_out_material_cannot_reuse_lesson_source():
    from app.services.docs_review.evaluation import require_unseen

    with pytest.raises(ValueError, match="development overlap"):
        require_unseen(["只要你自化本尊"], ["只要你自化本尊"])
    with pytest.raises(ValueError, match="development overlap"):
        require_unseen(["　只 要你自化本尊。"], ["第一段:只要你自化本尊,便有功德。"])
    with pytest.raises(ValueError, match="manual review"):
        require_unseen(
            ["The pine trees receive autumn rain in the quiet mountain valley"],
            ["The pine trees receive autumn rain in a quiet mountain valley"],
        )
    assert require_unseen(["山間秋雨滋潤松林"], ["心境澄明如鏡"]) is None


async def test_paired_contract_rejects_arbitrary_candidate_changes(client, admin_token, completed_review):
    root = f"/api/docs-review/projects/{completed_review[0]['id']}"
    payload = experiment_payload()
    payload["candidate_input"]["model"] = "openai/different"
    r = await client.post(root + "/experiments", json=payload, headers=headers(admin_token))
    assert r.status_code == 422


async def test_chapter_nine_and_development_are_excluded_or_classified(client, admin_token, completed_review):
    root = f"/api/docs-review/projects/{completed_review[0]['id']}"
    payload = experiment_payload()
    payload["evaluation_examples"][0]["source_text"] = "只要你自化本尊"
    r = await client.post(root + "/experiments", json=payload, headers=headers(admin_token))
    assert r.status_code == 409, r.text
    payload["evaluation_examples"][0]["classification"] = "development"
    r = await client.post(root + "/experiments", json=payload, headers=headers(admin_token))
    assert r.status_code == 201, r.text
    assert r.json()["exclusions"][0]["classification"] == "development"


async def test_confirmed_lessons_are_frozen_and_disabling_restores_baseline(
    client, admin_token, completed_review, db_session
):
    root, lesson_payload, r = await propose(client, admin_token, completed_review)
    lesson = r.json()
    r = await client.post(
        root + f"/lessons/{lesson['id']}/confirm",
        json=dict(client_request_id="confirm", expected_content_hash=lesson["content_hash"]),
        headers=headers(admin_token),
    )
    assert r.status_code == 200
    payload = experiment_payload(lesson_ids=[lesson["id"]])
    _, view = await create(client, admin_token, completed_review, payload)
    experiment = await db_session.get(DocsReviewExperiment, view["id"])
    frozen = copy.deepcopy(experiment.candidate_input)
    base = experiment.baseline_input
    assert base["confirmed_lessons"] == []
    assert frozen["confirmed_lessons"][0]["content_hash"] == lesson["content_hash"]
    assert frozen["calls"][0]["input"]["completion_options"]["num_retries"] == 0
    assert frozen["calls"][0]["input"]["guidance"][-1]["content"].find(lesson["guidance"]) >= 0
    await client.post(
        root + "/lessons",
        json={
            **lesson_payload,
            "client_request_id": "revision",
            "supersedes_id": lesson["id"],
            "guidance": "New future wording",
        },
        headers=headers(admin_token),
    )
    await db_session.refresh(experiment)
    assert experiment.candidate_input == frozen
    _, view2 = await create(client, admin_token, completed_review, experiment_payload(client_request_id="disabled"))
    disabled = await db_session.get(DocsReviewExperiment, view2["id"])
    assert disabled.candidate_input == disabled.baseline_input
    assert disabled.baseline_input["calls"] == base["calls"]


async def test_worker_reserves_both_arms_before_any_call_and_reuses_frozen_options(
    client, admin_token, completed_review, db_session
):
    from app.worker.docs_review import evaluate_docs_experiment

    _, view = await create(client, admin_token, completed_review)
    seen = []

    async def check(**kwargs):
        ledger = await db_session.get(Setting, "DOCS_REVIEW_PILOT_RESERVED_USD")
        assert float(ledger.value) == pytest.approx(0.048)
        seen.append(copy.deepcopy(kwargs))
        return await fake(**kwargs)

    experiment, result = await run_experiment(db_session, completed_review, view["id"], check)
    assert result["status"] == "succeeded"
    assert seen == [
        experiment.baseline_input["calls"][0]["input"]["completion_options"],
        experiment.candidate_input["calls"][0]["input"]["completion_options"],
    ]
    assert experiment.baseline_outputs[0]["usage"]["prompt_tokens"] == 100
    assert experiment.report["execution"]["provider_calls"] == 2
    await evaluate_docs_experiment(context(db_session, check), view["id"])
    assert len(seen) == 2


async def test_full_budget_rejection_makes_no_calls(client, admin_token, completed_review, db_session, monkeypatch):
    from app.core.config import get_settings

    _, view = await create(client, admin_token, completed_review)
    monkeypatch.setattr(get_settings(), "docs_review_account_spend_limit_usd", 0.03)

    async def forbidden(**kwargs):
        pytest.fail("The entire pair must fit before the first call")

    experiment, result = await run_experiment(db_session, completed_review, view["id"], forbidden)
    assert result["status"] == "failed"
    assert experiment.report["execution"]["error_code"] == "account_budget_exhausted"


async def test_ambiguous_second_call_retains_first_and_is_never_retried(
    client, admin_token, completed_review, db_session
):
    from app.worker.docs_review import evaluate_docs_experiment

    _, view = await create(client, admin_token, completed_review)
    count = 0

    async def lost(**kwargs):
        nonlocal count
        count += 1
        if count == 2:
            raise TimeoutError("Potential provider completion")
        return await fake(**kwargs)

    experiment, result = await run_experiment(db_session, completed_review, view["id"], lost)
    assert result["status"] == "interrupted"
    assert experiment.baseline_outputs[0]["validated_result"]["findings"] == []
    assert experiment.candidate_outputs[0]["error_code"] == "provider_completion_unknown"
    await evaluate_docs_experiment(context(db_session, lost), view["id"])
    assert count == 2


async def test_generation_is_a_separate_outcome_and_full_four_call_budget(
    client, admin_token, completed_review, db_session
):
    payload = experiment_payload()
    payload["baseline_input"]["generate_draft"] = payload["candidate_input"]["generate_draft"] = True
    _, view = await create(client, admin_token, completed_review, payload)
    experiment, result = await run_experiment(db_session, completed_review, view["id"])
    assert result["status"] == "succeeded"
    assert [o["outcome"] for o in experiment.baseline_outputs] == ["assessment", "generation"]
    assert experiment.baseline_outputs[1]["validated_result"]["translated_text"] == "Fresh independent draft"
    assert experiment.report["execution"]["reserved_cost_usd"] == pytest.approx(0.096)


async def test_blinding_reference_before_flags_append_only_labels_and_report_revisions(
    client, admin_token, reviewer_token, completed_review, db_session, seed_data
):
    root, view = await create(client, admin_token, completed_review)
    eid = view["id"]
    url = root + f"/experiments/{eid}"
    await run_experiment(db_session, completed_review, eid)
    before = (await client.get(url, headers=headers(admin_token))).json()
    assert "baseline_input" not in before and "arm_key" not in json.dumps(before)
    assert "outputs" not in before["examples"][0]
    assert (
        await client.post(url + "/labels", json=judgment_payload(), headers=headers(admin_token))
    ).status_code == 409
    assert (
        await client.post(url + "/labels", json=reference_payload(), headers=headers(reviewer_token))
    ).status_code == 404
    assert (
        await client.post(
            url + "/labels", json={**reference_payload(), "reviewer_id": 999}, headers=headers(admin_token)
        )
    ).status_code == 422
    r = await client.post(url + "/labels", json=reference_payload(), headers=headers(admin_token))
    assert r.status_code == 201, r.text
    blinded = (await client.get(url, headers=headers(admin_token))).json()
    assert set(blinded["examples"][0]["outputs"]) == {"A", "B"}
    assert "arm_key" not in json.dumps(blinded)
    assert (await client.post(url + "/labels", json=reference_payload(), headers=headers(admin_token))).json()[
        "id"
    ] == r.json()["id"]
    r = await client.post(url + "/labels", json=judgment_payload(), headers=headers(admin_token))
    assert r.status_code == 201, r.text
    assert r.json()["reviewer_id"] == seed_data["admin"].id
    after = (await client.get(url, headers=headers(admin_token))).json()
    assert set(after["examples"][0]["arm_key"].values()) == {"baseline", "candidate"}
    first_report = await client.post(
        url + "/reports", json={"client_request_id": "report-1"}, headers=headers(admin_token)
    )
    assert first_report.status_code == 201, first_report.text
    report = first_report.json()["report"]
    assert report["conclusion"] == "inconclusive"
    assert report["assessment"]["baseline"]["active_review_seconds"] == 12.0
    assert report["assessment"]["baseline"]["audit_inspected"] == 1
    assert report["label_coverage"]["unknown_examples"] == 0
    assert (
        await client.post(
            url + "/labels",
            json=judgment_payload(client_request_id="amendment", note="Unblinded amendment"),
            headers=headers(admin_token),
        )
    ).status_code == 201
    second = await client.post(url + "/reports", json={"client_request_id": "report-2"}, headers=headers(admin_token))
    assert second.status_code == 201
    persisted = await db_session.get(DocsReviewExperiment, eid)
    await db_session.refresh(persisted)
    assert len(persisted.independent_labels) == 3
    assert persisted.independent_labels[-1]["blinded"] is False
    assert persisted.report["revisions"][0] == first_report.json()
    assert len(persisted.report["revisions"]) == 2
    r = await client.post(
        root + "/experiments", json=experiment_payload(client_request_id="reused"), headers=headers(admin_token)
    )
    assert r.status_code == 409, "Labeled holdouts cannot become unseen again"


async def test_unknown_labels_stay_unknown_and_more_flags_never_prove_improvement(
    client, admin_token, completed_review, db_session
):
    from app.services.docs_review.evaluation import build_report

    _, view = await create(client, admin_token, completed_review)
    experiment, _ = await run_experiment(db_session, completed_review, view["id"])
    report = build_report(experiment)
    assert report["conclusion"] == "inconclusive"
    assert report["label_coverage"] == {"heldout_examples": 1, "labeled_examples": 0, "unknown_examples": 1}
    assert report["assessment"]["baseline"]["confirmed_missed_issues"] is None
    assert report["assessment"]["candidate"]["false_alarms"] is None


async def test_unlabeled_report_cannot_unblind_arms_by_flag_counts(client, admin_token, completed_review, db_session):
    from app.services.docs_review.evaluation import build_report

    _, view = await create(client, admin_token, completed_review)
    experiment, _ = await run_experiment(db_session, completed_review, view["id"])
    outputs = copy.deepcopy(experiment.candidate_outputs)
    outputs[0]["validated_result"]["findings"] = [{"explanation": "Only candidate flagged"}]
    experiment.candidate_outputs = outputs
    report = build_report(experiment)
    assert report["assessment"]["baseline"] == report["assessment"]["candidate"], (
        "Unlabeled reports must not reveal arm-specific output counts"
    )


async def test_created_holdout_is_rechecked_before_execution_after_other_labels(
    client, admin_token, completed_review, db_session
):
    root, first = await create(client, admin_token, completed_review)
    _, second = await create(client, admin_token, completed_review, experiment_payload(client_request_id="second"))
    r = await client.post(
        root + f"/experiments/{first['id']}/labels", json=reference_payload(), headers=headers(admin_token)
    )
    assert r.status_code == 201

    async def forbidden(**kwargs):
        pytest.fail("A newly contaminated holdout cannot be executed as unseen")

    experiment, result = await run_experiment(db_session, completed_review, second["id"], forbidden)
    assert result["status"] == "failed"
    assert experiment.report["execution"]["error_code"] == "holdout_no_longer_unseen"


async def test_report_counts_reference_misses_false_alarms_and_coverage_separately(
    client, admin_token, completed_review, db_session
):
    from app.services.docs_review.evaluation import build_report

    root, view = await create(client, admin_token, completed_review)
    experiment, _ = await run_experiment(db_session, completed_review, view["id"])
    # Synthetic stored outputs isolate human metric arithmetic from provider behavior.
    for arm, count in [("baseline", 2), ("candidate", 1)]:
        outputs = copy.deepcopy(getattr(experiment, arm + "_outputs"))
        outputs[0]["validated_result"]["findings"] = [{"explanation": "Human assessed"}] * count
        outputs[0]["validated_result"]["audit"] = dict(population=[], selected_ids=[], count=0, seed=0)
        setattr(experiment, arm + "_outputs", outputs)
    await db_session.commit()
    url = root + f"/experiments/{view['id']}/labels"
    r = await client.post(
        url,
        json=reference_payload(
            serious_issues=[
                dict(id="s1", source_quote="山間", explanation="Serious omission"),
                dict(id="s2", source_quote="松林", explanation="Second serious issue"),
            ]
        ),
        headers=headers(admin_token),
    )
    assert r.status_code == 201
    labels = {
        "baseline": dict(
            flags=[
                dict(finding_index=0, false_alarm=False, reference_issue_ids=["s1"]),
                dict(finding_index=1, false_alarm=True, reference_issue_ids=[]),
            ],
            audits=[],
            review_intervals=[dict(start=0.0, end=20.0, active=True)],
            generation=None,
        ),
        "candidate": dict(
            flags=[dict(finding_index=0, false_alarm=False, reference_issue_ids=["s1", "s2"])],
            audits=[],
            review_intervals=[dict(start=0.0, end=10.0, active=True)],
            generation=None,
        ),
    }
    arms = {alias: labels[arm] for alias, arm in experiment.report["blinded_order"]["heldout-1"].items()}
    r = await client.post(url, json=judgment_payload(arms=arms), headers=headers(admin_token))
    assert r.status_code == 201, r.text
    await db_session.refresh(experiment)
    report = build_report(experiment)
    assert report["assessment"]["baseline"]["confirmed_missed_issues"] == 1
    assert report["assessment"]["baseline"]["false_alarms"] == 1
    assert report["assessment"]["candidate"]["confirmed_missed_issues"] == 0
    assert report["assessment"]["candidate"]["false_alarms"] == 0
    assert report["conclusion"] == "candidate_for_larger_trial"
    # An unblinded amendment cannot erase the first judgment's evidence.
    for value in arms.values():
        for flag in value["flags"]:
            flag.update(false_alarm=None, reference_issue_ids=[])
    assert (
        await client.post(
            url, json=judgment_payload(client_request_id="amend", arms=arms), headers=headers(admin_token)
        )
    ).status_code == 201
    await db_session.refresh(experiment)
    assert build_report(experiment)["assessment"] == report["assessment"]


async def test_expired_experiment_retains_late_evidence_without_second_call(
    client, admin_token, completed_review, db_session
):
    from app.worker.docs_review import evaluate_docs_experiment

    _, view = await create(client, admin_token, completed_review)
    calls = 0

    async def late(**kwargs):
        nonlocal calls
        calls += 1
        current = await db_session.get(DocsReviewExperiment, view["id"])
        await db_session.refresh(current)
        current.report = {
            **current.report,
            "execution": {
                **current.report["execution"],
                "lease_expires_at": (datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
            },
        }
        await db_session.commit()
        return await fake(**kwargs)

    experiment, result = await run_experiment(db_session, completed_review, view["id"], late)
    assert result["status"] == "interrupted"
    assert calls == 1
    assert experiment.baseline_outputs[0]["late_response"] is True
    await evaluate_docs_experiment(context(db_session, late), view["id"])
    assert calls == 1


race_client = api_fixtures.race_client


async def test_concurrent_worker_labels_and_reports_preserve_once_only_execution_and_history(
    race_client, docs_project_payload
):
    import asyncio

    from app.worker.docs_review import enqueue_experiment, evaluate_docs_experiment

    client, token, factory, _ = race_client
    p = await api_fixtures.project(client, token, docs_project_payload)
    root, view = await create(client, token, (p,))
    eid = view["id"]
    async with factory() as db:
        e = await db.get(DocsReviewExperiment, eid)
        await enqueue_experiment(db, e, queue=Queue())
    entered, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def waiting(**kwargs):
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return await fake(**kwargs)

    ctx = {"session_factory": factory, "completion_client": waiting}
    first = asyncio.create_task(evaluate_docs_experiment(ctx, eid))
    await entered.wait()
    second = await evaluate_docs_experiment(ctx, eid)
    assert second["status"] == "running"
    release.set()
    assert (await first)["status"] == "succeeded"
    assert calls == 2
    url = root + f"/experiments/{eid}"
    responses = await asyncio.gather(
        *[client.post(url + "/labels", json=reference_payload(), headers=headers(token)) for _ in range(2)]
    )
    assert [r.status_code for r in responses] == [201, 201]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    responses = await asyncio.gather(
        *[
            client.post(url + "/reports", json={"client_request_id": f"report-{i}"}, headers=headers(token))
            for i in range(2)
        ]
    )
    assert [r.status_code for r in responses] == [201, 201]
    async with factory() as db:
        e = await db.get(DocsReviewExperiment, eid)
        assert len(e.independent_labels) == 1
        assert len(e.report["revisions"]) == 2


async def test_queue_loss_and_retry_reuses_experiment_identity(client, admin_token, completed_review, db_session):
    from app.worker.docs_review import enqueue_experiment

    _, view = await create(client, admin_token, completed_review)
    e = await db_session.get(DocsReviewExperiment, view["id"])
    queue = Queue(fail=True)
    await enqueue_experiment(db_session, e, queue=queue)
    assert e.report["execution"]["status"] == "pending_enqueue"
    queue.fail = False
    await enqueue_experiment(db_session, e, queue=queue)
    assert e.report["execution"]["status"] == "queued"
    assert queue.calls == ["docs-experiment:" + e.id] * 2


async def test_experiment_mutations_enforce_revoked_review_write_permission(
    client, translator_token, docs_project_payload, db_session
):
    p = await api_fixtures.project(client, translator_token, docs_project_payload)
    db_session.add(Setting(key="ROLE_PERMISSIONS", value=json.dumps({"translator": []})))
    await db_session.commit()
    root = f"/api/docs-review/projects/{p['id']}"
    for suffix, payload in [
        ("/experiments", experiment_payload()),
        ("/experiments/missing/labels", reference_payload()),
        ("/experiments/missing/reports", {"client_request_id": "report"}),
        ("/experiments/missing/run", None),
        ("/lessons/missing/confirm", {"client_request_id": "confirm", "expected_content_hash": "0" * 64}),
    ]:
        r = await client.post(root + suffix, json=payload, headers=headers(translator_token))
        assert r.status_code == 403


async def test_generation_unknown_is_reported_without_revealing_unjudged_outputs(
    client, admin_token, completed_review, db_session
):
    from app.services.docs_review.evaluation import build_report

    payload = experiment_payload()
    payload["baseline_input"]["generate_draft"] = payload["candidate_input"]["generate_draft"] = True
    _, view = await create(client, admin_token, completed_review, payload)
    e, _ = await run_experiment(db_session, completed_review, view["id"])
    report = build_report(e)
    assert report["generation"]["baseline"] == {"serious_issues": None, "labeled_examples": 0, "unknown_examples": 1}
    assert report["generation"]["candidate"] == report["generation"]["baseline"]


async def test_selected_scoped_lesson_can_execute_within_explicit_pilot_limits(
    client, admin_token, completed_review, db_session
):
    root, _, r = await propose(client, admin_token, completed_review)
    lesson = r.json()
    assert (
        await client.post(
            root + f"/lessons/{lesson['id']}/confirm",
            json=dict(client_request_id="confirm", expected_content_hash=lesson["content_hash"]),
            headers=headers(admin_token),
        )
    ).status_code == 200
    _, view = await create(client, admin_token, completed_review, experiment_payload(lesson_ids=[lesson["id"]]))
    e, result = await run_experiment(db_session, completed_review, view["id"])
    assert result["status"] == "succeeded", e.report["execution"]
    original = e.baseline_input["calls"][0]["input"]["completion_options"]
    changed = e.candidate_input["calls"][0]["input"]["completion_options"]
    assert {k: v for k, v in original.items() if k != "messages"} == {
        k: v for k, v in changed.items() if k != "messages"
    }
    original_data, changed_data = [json.loads(options["messages"][1]["content"]) for options in (original, changed)]
    assert {k: v for k, v in original_data.items() if k != "supplied_guidance"} == {
        k: v for k, v in changed_data.items() if k != "supplied_guidance"
    }
    assert changed_data["supplied_guidance"][0]["id"] == "lesson:" + lesson["id"]


async def test_supplied_guidance_examples_are_development_evidence(client, admin_token, completed_review):
    payload = experiment_payload()
    for arm in ("baseline_input", "candidate_input"):
        payload[arm]["guidance"] = [
            {"id": "training-example", "content": "Previously reviewed example: 山間秋雨滋潤松林。"}
        ]
    root = f"/api/docs-review/projects/{completed_review[0]['id']}"
    r = await client.post(root + "/experiments", json=payload, headers=headers(admin_token))
    assert r.status_code == 409


async def test_missing_active_timing_stays_unknown(client, admin_token, completed_review, db_session):
    from app.services.docs_review.evaluation import build_report

    root, view = await create(client, admin_token, completed_review)
    e, _ = await run_experiment(db_session, completed_review, view["id"])
    url = root + f"/experiments/{view['id']}/labels"
    assert (await client.post(url, json=reference_payload(), headers=headers(admin_token))).status_code == 201
    payload = judgment_payload()
    for arm in payload["arms"].values():
        arm["review_intervals"] = []
    assert (await client.post(url, json=payload, headers=headers(admin_token))).status_code == 201
    await db_session.refresh(e)
    report = build_report(e)
    assert report["assessment"]["baseline"]["active_review_seconds"] is None
    assert report["assessment"]["candidate"]["review_time_unknown_examples"] == 1
    assert report["conclusion"] == "inconclusive"
    assert report["conclusion_outcome"] == "assessment"


async def test_attempt_is_durable_before_provider_can_lose_response(client, admin_token, completed_review, db_session):
    _, view = await create(client, admin_token, completed_review)
    markers = []

    async def check(**kwargs):
        e = await db_session.get(DocsReviewExperiment, view["id"])
        await db_session.refresh(e)
        state = e.report["execution"]
        markers.append((state["provider_calls"], len(state.get("started_calls", []))))
        return await fake(**kwargs)

    e, result = await run_experiment(db_session, completed_review, view["id"], check)
    assert result["status"] == "succeeded"
    assert markers == [(1, 1), (2, 2)], "Dispatch attempts must be durable before any response or process loss"
    assert e.report["execution"]["provider_calls"] == 2


def historical_evidence_payload(kind):
    payload = experiment_payload(client_request_id="historical-evidence")
    source = payload["evaluation_examples"][0]["source_text"]
    payload["evaluation_examples"][0].update(
        id="other-passage",
        source_text="海邊漁舟迎著晨光返航。",
        translated_text="Fishing boats return in the morning light.",
    )
    if kind == "development_sources":
        payload["development_sources"] = [source]
    else:
        for arm in ("baseline_input", "candidate_input"):
            payload[arm]["guidance"] = [{"id": "earlier-example", "content": "Reviewed source example: " + source}]
    return payload


async def assert_development_cannot_improve_report(client, token, completed, db, payload):
    """Even complete, favorable human labels must not promote development evidence."""
    from app.services.docs_review.evaluation import build_report

    payload = copy.deepcopy(payload)
    payload["client_request_id"] = "reclassified-development"
    payload["evaluation_examples"][0]["classification"] = "development"
    root, view = await create(client, token, completed, payload)
    calls = 0

    async def favorable(**kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return completion(
                dict(
                    schema_version=1,
                    findings=[
                        dict(
                            category="meaning",
                            proposed_severity="minor",
                            source_spans=[dict(block_id="source", quote="山間", occurrence=0)],
                            target_spans=[dict(block_id="target", quote="Autumn", occurrence=0)],
                            explanation="A false alarm for the human to dismiss",
                            evidence_ids=[],
                        )
                    ],
                    coverage=dict(source_block_ids=["source"], target_block_ids=["target"], complete=True),
                )
            )
        return await fake(**kwargs)

    e, result = await run_experiment(db, completed, view["id"], favorable)
    assert result["status"] == "succeeded"
    url = root + f"/experiments/{e.id}/labels"
    assert (await client.post(url, json=reference_payload(), headers=headers(token))).status_code == 201
    by_arm = {
        "baseline": dict(
            flags=[dict(finding_index=0, false_alarm=True, reference_issue_ids=[])],
            audits=[],
            review_intervals=[dict(start=0.0, end=12.0, active=True)],
            generation=None,
        ),
        "candidate": dict(
            flags=[],
            audits=[dict(block_id="target", serious_issue_ids=[])],
            review_intervals=[dict(start=0.0, end=12.0, active=True)],
            generation=None,
        ),
    }
    arms = {alias: by_arm[arm] for alias, arm in e.report["blinded_order"]["heldout-1"].items()}
    response = await client.post(url, json=judgment_payload(arms=arms), headers=headers(token))
    assert response.status_code == 201, response.text
    await db.refresh(e)
    report = build_report(e)
    assert report["label_coverage"] == {"heldout_examples": 0, "labeled_examples": 0, "unknown_examples": 0}
    assert report["conclusion"] == "inconclusive"
    assert report["assessment"]["candidate"]["measured_examples"] == 0
    assert report["examples"] == []
    assert report["exclusions"][0]["example_id"] == "heldout-1"


@pytest.mark.parametrize("kind", ["development_sources", "guidance"])
async def test_historical_exclusion_sources_block_new_holdouts_and_remain_development(
    client, admin_token, completed_review, db_session, kind
):
    root, historical = await create(client, admin_token, completed_review, historical_evidence_payload(kind))
    historical_row = await db_session.get(DocsReviewExperiment, historical["id"])
    assert historical_row.independent_labels == [], "History must apply even without prior human labels"
    payload = experiment_payload(client_request_id="later-heldout")
    response = await client.post(root + "/experiments", json=payload, headers=headers(admin_token))
    assert response.status_code == 409, "Historical supplied guidance/development sources cannot become unseen"
    matches = response.json()["detail"]["matches"]
    assert any(payload["evaluation_examples"][0]["source_text"] in m["development_source"] for m in matches)
    await assert_development_cannot_improve_report(client, admin_token, completed_review, db_session, payload)


async def assert_preexecution_contamination_is_excluded(client, token, completed, db, view):
    from app.services.docs_review.evaluation import build_report

    e = await db.get(DocsReviewExperiment, view["id"])
    frozen = copy.deepcopy((e.baseline_input, e.candidate_input, e.evaluation_examples))

    async def forbidden(**kwargs):
        pytest.fail("Contaminated heldouts must fail before reservation or provider dispatch")

    e, result = await run_experiment(db, completed, e.id, forbidden)
    assert result["status"] == "failed"
    assert e.report["execution"]["error_code"] == "holdout_no_longer_unseen"
    assert e.report["execution"]["provider_calls"] == 0
    assert await db.get(Setting, "DOCS_REVIEW_PILOT_RESERVED_USD") is None
    assert (e.baseline_input, e.candidate_input, e.evaluation_examples) == frozen
    report = build_report(e)
    assert report["label_coverage"]["heldout_examples"] == 0
    assert report["conclusion"] == "inconclusive"
    assert report["exclusions"][0]["example_id"] == "heldout-1"
    assert report["exclusions"][0]["matches"]
    public = (
        await client.get(f"/api/docs-review/projects/{completed[0]['id']}/experiments/{e.id}", headers=headers(token))
    ).json()
    assert public["examples"][0]["classification"] == "development"
    assert public["examples"][0]["requested_classification"] == "heldout"


@pytest.mark.parametrize("kind", ["development_sources", "guidance"])
async def test_new_historical_evidence_invalidates_already_frozen_holdout_before_execution(
    client, admin_token, completed_review, db_session, kind
):
    _, waiting = await create(client, admin_token, completed_review)
    await create(client, admin_token, completed_review, historical_evidence_payload(kind))
    await assert_preexecution_contamination_is_excluded(client, admin_token, completed_review, db_session, waiting)


async def test_new_owner_source_chapter_blocks_creation_or_requires_development_classification(
    client, admin_token, completed_review, docs_project_payload, db_session
):
    source = experiment_payload()["evaluation_examples"][0]["source_text"]
    await api_fixtures.project(
        client, admin_token, {**docs_project_payload, "client_request_id": "new-chapter", "source_text": source}
    )
    root = f"/api/docs-review/projects/{completed_review[0]['id']}"
    payload = experiment_payload()
    response = await client.post(root + "/experiments", json=payload, headers=headers(admin_token))
    assert response.status_code == 409
    await assert_development_cannot_improve_report(client, admin_token, completed_review, db_session, payload)


async def test_new_owner_source_chapter_invalidates_already_frozen_holdout_before_execution(
    client, admin_token, completed_review, docs_project_payload, db_session
):
    _, waiting = await create(client, admin_token, completed_review)
    source = experiment_payload()["evaluation_examples"][0]["source_text"]
    await api_fixtures.project(
        client, admin_token, {**docs_project_payload, "client_request_id": "new-chapter", "source_text": source}
    )
    await assert_preexecution_contamination_is_excluded(client, admin_token, completed_review, db_session, waiting)


@pytest.mark.parametrize("kind", ["guidance", "source_chapter"])
@pytest.mark.parametrize("evidence_timing", ["before_creation", "before_execution"])
async def test_cross_owner_evidence_does_not_contaminate_heldout_creation_or_execution(
    client, admin_token, translator_token, completed_review, docs_project_payload, db_session, kind, evidence_timing
):
    from app.services.docs_review.evaluation import build_report

    payload = experiment_payload()
    source = payload["evaluation_examples"][0]["source_text"]
    if evidence_timing == "before_execution":
        _, view = await create(client, admin_token, completed_review, payload)

    other_payload = {**docs_project_payload, "client_request_id": "other-owner-evidence"}
    if kind == "source_chapter":
        other_payload["source_text"] = source
    other_project = await api_fixtures.project(client, translator_token, other_payload)
    assert other_project["owner_user_id"] != completed_review[0]["owner_user_id"]
    if kind == "guidance":
        await create(client, translator_token, (other_project,), historical_evidence_payload("guidance"))

    if evidence_timing == "before_creation":
        _, view = await create(client, admin_token, completed_review, payload)

    e, result = await run_experiment(db_session, completed_review, view["id"])
    assert result["status"] == "succeeded", e.report["execution"]
    assert e.report["execution"]["provider_calls"] == 2
    assert len(e.baseline_outputs) == len(e.candidate_outputs) == 1
    assert all(source not in excluded for excluded in e.report["exclusion_sources"])
    assert e.evaluation_examples[0]["classification"] == "heldout"
    report = build_report(e)
    assert report["exclusions"] == []
    assert report["label_coverage"] == {"heldout_examples": 1, "labeled_examples": 0, "unknown_examples": 1}
