"""Scoped human learning contracts; real persistence with no external calls."""

import copy

import pytest

from tests import test_docs_review_api as api_fixtures

completed_review = api_fixtures.completed_review
docs_project_payload = api_fixtures.docs_project_payload
docs_snapshot_payload = api_fixtures.docs_snapshot_payload
enabled = api_fixtures.enabled
headers = api_fixtures.headers
decision_payload = api_fixtures.decision_payload
snapshot = api_fixtures.snapshot
SCOPE = dict(
    source_language="zh",
    target_language="en",
    construction="本尊 as a lineage term",
    positive_example="本尊 — yidam",
    counterexample="一般神祇 — deity",
    edition_restriction=None,
)


async def propose(client, token, completed, **changes):
    p, s, _, item = completed
    root = f"/api/docs-review/projects/{p['id']}"
    decision = await client.post(root + "/decisions", json=decision_payload(s, item), headers=headers(token))
    assert decision.status_code == 201
    payload = dict(
        client_request_id="lesson",
        originating_decision_id=decision.json()["id"],
        scope=copy.deepcopy(SCOPE),
        guidance="Preserve yidam in this construction.",
        evidence=[],
    )
    payload.update(changes)
    return root, payload, await client.post(root + "/lessons", json=payload, headers=headers(token))


async def test_dismissed_false_alarm_proposes_scoped_exception_with_exact_evidence(
    client, admin_token, completed_review
):
    root, _, r = await propose(client, admin_token, completed_review)
    assert r.status_code == 201, r.text
    lesson = r.json()
    assert lesson["status"] == "proposed"
    assert lesson["decision_state"] == "dismissed_finding"
    assert lesson["scope"] == SCOPE
    assert lesson["conflicts"] == []
    assert lesson["evidence"][-1]["item"]["target_spans"][0]["quote"] == "Yidam"
    assert lesson["evidence"][-1]["decision"]["disposition"] == "no_issue"
    assert lesson["activation"] == "experiment_only"
    assert (await client.get(root + f"/lessons/{lesson['id']}", headers=headers(admin_token))).json() == lesson


@pytest.mark.parametrize("scope", [{}, {**SCOPE, "counterexample": " "}, {**SCOPE, "source_language": "fr"}])
async def test_incomplete_or_wrong_language_scope_cannot_be_confirmed(client, admin_token, completed_review, scope):
    _, _, r = await propose(client, admin_token, completed_review, scope=scope)
    assert r.status_code == 422


async def test_no_reusable_lesson_is_explicit_and_creates_no_guidance(client, admin_token, completed_review):
    _, _, r = await propose(client, admin_token, completed_review, guidance="")
    assert r.status_code == 201
    assert r.json()["status"] == "no_reusable_lesson"
    assert "content_hash" not in r.json()


@pytest.mark.parametrize("disposition,note", [("needs_another_opinion", "Unresolved"), ("no_issue", " ")])
async def test_unresolved_and_unexplained_decisions_cannot_seed_lessons(
    client, admin_token, completed_review, disposition, note
):
    p, s, _, item = completed_review
    root = f"/api/docs-review/projects/{p['id']}"
    d = (
        await client.post(
            root + "/decisions",
            json={**decision_payload(s, item), "disposition": disposition, "note": note},
            headers=headers(admin_token),
        )
    ).json()
    r = await client.post(
        root + "/lessons",
        json=dict(client_request_id="bad", originating_decision_id=d["id"], scope=SCOPE, guidance="Rule", evidence=[]),
        headers=headers(admin_token),
    )
    assert r.status_code == 409


async def test_incidental_edit_outside_finding_cannot_seed_lesson(
    client, admin_token, completed_review, docs_snapshot_payload
):
    p, s, _, item = completed_review
    root = f"/api/docs-review/projects/{p['id']}"
    changed = await snapshot(
        client,
        admin_token,
        p["id"],
        {
            **docs_snapshot_payload,
            "client_request_id": "incidental",
            "blocks": [*s["blocks"], dict(block_id="new", text="An incidental note", kind="paragraph")],
        },
    )
    d = (
        await client.post(
            root + "/decisions",
            json={**decision_payload(s, item), "disposition": "corrected", "reviewed_snapshot_id": changed["id"]},
            headers=headers(admin_token),
        )
    ).json()
    r = await client.post(
        root + "/lessons",
        json=dict(client_request_id="bad", originating_decision_id=d["id"], scope=SCOPE, guidance="Rule", evidence=[]),
        headers=headers(admin_token),
    )
    assert r.status_code == 409


async def test_conflicts_require_explicit_resolution_and_revisions_preserve_confirmed_lesson(
    client, admin_token, reviewer_token, completed_review
):
    root, payload, r = await propose(client, admin_token, completed_review)
    old = r.json()
    confirm = dict(
        client_request_id="confirm",
        expected_content_hash=old["content_hash"],
        expected_conflict_hash=old["conflict_hash"],
        conflict_resolutions={},
    )
    assert (
        await client.post(root + f"/lessons/{old['id']}/confirm", json=confirm, headers=headers(reviewer_token))
    ).status_code == 404
    assert (
        await client.post(
            root + f"/lessons/{old['id']}/confirm",
            json={**confirm, "expected_content_hash": "0" * 64},
            headers=headers(admin_token),
        )
    ).status_code == 409
    confirmed = await client.post(root + f"/lessons/{old['id']}/confirm", json=confirm, headers=headers(admin_token))
    assert confirmed.status_code == 200, confirmed.text
    frozen = confirmed.json()
    revised = await client.post(
        root + "/lessons",
        json={**payload, "client_request_id": "revision", "supersedes_id": old["id"], "guidance": "Revised guidance"},
        headers=headers(admin_token),
    )
    assert revised.status_code == 201
    assert revised.json()["status"] == "proposed"
    assert (await client.get(root + f"/lessons/{old['id']}", headers=headers(admin_token))).json() == frozen
    conflict = (
        await client.post(
            root + "/lessons",
            json={**payload, "client_request_id": "conflict", "guidance": "Use deity instead"},
            headers=headers(admin_token),
        )
    ).json()
    assert conflict["conflicts"][0]["id"] == old["id"]
    confirm = dict(
        client_request_id="resolve",
        expected_content_hash=conflict["content_hash"],
        expected_conflict_hash=conflict["conflict_hash"],
        conflict_resolutions={},
    )
    url = root + f"/lessons/{conflict['id']}/confirm"
    assert (await client.post(url, json=confirm, headers=headers(admin_token))).status_code == 409
    confirm["conflict_resolutions"] = {old["id"]: "Separate reading; keep both experimental pending larger review."}
    assert (await client.post(url, json=confirm, headers=headers(admin_token))).status_code == 200


@pytest.mark.parametrize(
    "text,expected",
    [
        ("The Benefits of Yidam Samadhi. An unrelated footnote.", 409),
        ("The Benefits of the meditational deity Samadhi", 201),
    ],
)
async def test_correction_evidence_must_change_the_exact_finding_span(
    client, admin_token, completed_review, docs_snapshot_payload, text, expected
):
    p, s, _, item = completed_review
    root = f"/api/docs-review/projects/{p['id']}"
    changed = await snapshot(
        client,
        admin_token,
        p["id"],
        {
            **docs_snapshot_payload,
            "client_request_id": "span-change",
            "blocks": [dict(block_id="target-1", text=text, kind="paragraph")],
        },
    )
    d = (
        await client.post(
            root + "/decisions",
            json={**decision_payload(s, item), "disposition": "corrected", "reviewed_snapshot_id": changed["id"]},
            headers=headers(admin_token),
        )
    ).json()
    r = await client.post(
        root + "/lessons",
        json=dict(
            client_request_id="from-correction",
            originating_decision_id=d["id"],
            scope=SCOPE,
            guidance="Scoped correction",
            evidence=[],
        ),
        headers=headers(admin_token),
    )
    assert r.status_code == expected
    if expected == 201:
        assert r.json()["decision_state"] == "local_correction"
        assert r.json()["status"] == "proposed"
