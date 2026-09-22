"""Positive-allowlist export behavior; no provider or Google service is contacted."""

import copy
import json
import subprocess
import sys
from pathlib import Path

import httpx
import pytest

from tests import test_docs_review_api as api_fixtures
from tests import test_docs_review_evaluation as evaluation_fixtures

completed_review = api_fixtures.completed_review
docs_project_payload = api_fixtures.docs_project_payload
docs_snapshot_payload = api_fixtures.docs_snapshot_payload
enabled = api_fixtures.enabled
headers = api_fixtures.headers


def test_export_excludes_credentials():
    from app.services.docs_review.evaluation import redact_export

    result = redact_export({"id": "experiment-1", "report": {}, "access_token": "never-export-this"})
    assert result == {"id": "experiment-1", "report": {}}


def test_export_is_a_positive_allowlist_at_every_supported_level():
    from app.services.docs_review.evaluation import redact_export

    value = {
        "id": "experiment-1",
        "project_id": "project-1",
        "client_request_id": "request-1",
        "request_hash": "hash-1",
        "created_at": "2026-09-21T12:00:00+00:00",
        "baseline_input": {
            "configuration_id": "baseline-config",
            "configuration": {
                "model": "anthropic/test-model",
                "limits": {
                    "max_input_tokens": 20000,
                    "max_output_tokens": 2000,
                    "max_cost_usd": 0.1,
                    "provider_key": "never-export-this",
                },
                "guidance": [{"id": "guide-1", "content": "Use this", "password": "no"}],
                "generate_draft": False,
                "audit_count": 1,
                "refresh_token": "never-export-this",
            },
            "confirmed_lessons": [],
            "calls": [
                {
                    "example_id": "heldout-1",
                    "outcome": "assessment",
                    "input": {
                        "source_text": "山間秋雨滋潤松林。",
                        "source_language": "zh",
                        "target_language": "en",
                        "target_blocks": [
                            {"block_id": "target", "text": "Autumn rain.", "kind": "paragraph", "api_key": "no"}
                        ],
                        "guidance": [],
                        "model": "anthropic/test-model",
                        "provider": "anthropic",
                        "limits": {"max_input_tokens": 20000, "max_output_tokens": 2000, "max_cost_usd": 0.1},
                        "price_schedule": {
                            "id": "schedule-1",
                            "input_per_million": 1.0,
                            "output_per_million": 2.0,
                            "access_token": "no",
                        },
                        "prompt_version": "docs-review-v1",
                        "audit_seed": 0,
                        "audit_count": 1,
                        "account_spend_limit_usd": 1.0,
                        "messages": [{"role": "user", "content": "payload", "secret": "no"}],
                        "completion_options": {
                            "model": "anthropic/test-model",
                            "messages": [{"role": "user", "content": "payload", "password": "no"}],
                            "max_completion_tokens": 2000,
                            "timeout": 30,
                            "num_retries": 0,
                            "temperature": 0,
                            "top_p": 1,
                            "n": 1,
                            "stream": False,
                            "stop": None,
                            "seed": None,
                            "presence_penalty": None,
                            "frequency_penalty": None,
                            "api_key": "never-export-this",
                        },
                        "password": "never-export-this",
                    },
                    "access_token": "never-export-this",
                }
            ],
            "refresh_token": "never-export-this",
        },
        "candidate_input": {"configuration_id": "candidate-config", "configuration": {}, "calls": []},
        "lesson_ids": ["lesson-1"],
        "excluded_example_hashes": ["excluded-hash"],
        "evaluation_examples": [
            {
                "id": "heldout-1",
                "source_text": "山間秋雨滋潤松林。",
                "translated_text": "Autumn rain nourishes the mountain pines.",
                "classification": "heldout",
                "password": "never-export-this",
            }
        ],
        "baseline_outputs": [
            {
                "example_id": "heldout-1",
                "outcome": "assessment",
                "raw_response": "{}",
                "validated_result": {
                    "schema_version": 1,
                    "findings": [],
                    "coverage": {
                        "source_block_ids": ["source", {"access_token": "never-export-this"}],
                        "target_block_ids": ["target"],
                        "complete": True,
                    },
                    "audit": {"population": ["target"], "selected_ids": ["target"], "count": 1, "seed": 0},
                    "unflagged_status": "unreviewed",
                    "access_token": "never-export-this",
                },
                "usage": {"provider_calls": 1, "prompt_tokens": 100, "completion_tokens": 20, "api_key": "no"},
                "error_code": None,
                "refresh_token": "never-export-this",
            }
        ],
        "candidate_outputs": [],
        "independent_labels": [
            {
                "id": "label-1",
                "client_request_id": "label-request",
                "request_hash": "label-hash",
                "phase": "reference",
                "example_id": "heldout-1",
                "source_qualified": True,
                "reference_complete": True,
                "serious_issues": [],
                "note": "Reviewed",
                "reviewer_id": 42,
                "created_at": "2026-09-21T12:01:00+00:00",
                "blinded": True,
                "password": "never-export-this",
            }
        ],
        "report": {
            "execution": {
                "status": "succeeded",
                "provider_calls": 2,
                "started_calls": [
                    {
                        "arm": "baseline",
                        "example_id": "heldout-1",
                        "outcome": "assessment",
                        "started_at": "now",
                        "token": "no",
                    }
                ],
                "lease_token": "never-export-this",
            },
            "blinded_order": {"heldout-1": {"A": "baseline", "B": "candidate", "access_token": "no"}},
            "exclusions": [],
            "exclusion_sources": ["chapter source"],
            "revisions": [
                {
                    "id": "report-1",
                    "client_request_id": "report-request",
                    "request_hash": "report-hash",
                    "reviewer_id": 42,
                    "created_at": "2026-09-21T12:02:00+00:00",
                    "label_ids": ["label-1"],
                    "report": {
                        "schema_version": 1,
                        "conclusion": "inconclusive",
                        "limitations": ["Small pilot"],
                        "access_token": "never-export-this",
                    },
                    "refresh_token": "never-export-this",
                }
            ],
            "access_token": "never-export-this",
        },
        "owner_user_id": 42,
        "password": "never-export-this",
    }

    exported = redact_export(value)

    assert exported["baseline_input"]["calls"][0]["input"]["source_text"] == "山間秋雨滋潤松林。"
    assert exported["baseline_outputs"][0]["usage"]["prompt_tokens"] == 100
    assert exported["independent_labels"][0]["id"] == "label-1"
    assert exported["report"]["revisions"][0]["report"]["conclusion"] == "inconclusive"
    assert "reviewer_id" not in exported["independent_labels"][0]
    assert "reviewer_id" not in exported["report"]["revisions"][0]
    assert "lease_token" not in exported["report"]["execution"]
    serialized = json.dumps(exported)
    for forbidden in ("never-export-this", '"password"', '"access_token"', '"refresh_token"', '"api_key"'):
        assert forbidden not in serialized


async def test_export_endpoint_is_authenticated_owner_scoped_and_complete(
    client, admin_token, translator_token, completed_review, db_session
):
    root = f"/api/docs-review/projects/{completed_review[0]['id']}"
    created = await client.post(
        root + "/experiments",
        json=evaluation_fixtures.experiment_payload(),
        headers=headers(admin_token),
    )
    assert created.status_code == 201, created.text
    experiment_id = created.json()["id"]

    from app.models.docs_review import DocsReviewExperiment

    experiment = await db_session.get(DocsReviewExperiment, experiment_id)
    baseline = copy.deepcopy(experiment.baseline_input)
    seeded_credential = "never-export-this"
    baseline["access_token"] = seeded_credential
    baseline["calls"][0]["input"]["refresh_token"] = seeded_credential
    experiment.baseline_input = baseline
    await db_session.commit()

    url = f"/api/docs-review/experiments/{experiment_id}/export"
    assert (await client.get(url)).status_code == 401
    assert (await client.get(url, headers=headers(translator_token))).status_code == 404
    response = await client.get(url, headers=headers(admin_token))
    assert response.status_code == 200, response.text
    exported = response.json()
    assert exported["id"] == experiment_id
    assert exported["project_id"] == completed_review[0]["id"]
    assert exported["evaluation_examples"][0]["id"] == "heldout-1"
    assert exported["baseline_input"]["calls"][0]["input"]["completion_options"]["num_retries"] == 0
    assert "never-export-this" not in json.dumps(exported)


def complete_export_payload():
    return {
        "id": "experiment-1",
        "project_id": "project-1",
        "baseline_input": {"configuration": {}, "configuration_id": "baseline", "confirmed_lessons": [], "calls": []},
        "candidate_input": {"configuration": {}, "configuration_id": "candidate", "confirmed_lessons": [], "calls": []},
        "lesson_ids": [],
        "excluded_example_hashes": [],
        "evaluation_examples": [],
        "baseline_outputs": [],
        "candidate_outputs": [],
        "independent_labels": [],
        "report": {
            "execution": {"status": "ready"},
            "blinded_order": {},
            "exclusions": [],
            "exclusion_sources": [],
            "revisions": [],
        },
    }


def test_cli_fetch_uses_bearer_auth_and_rejects_malformed_success():
    from scripts.export_docs_review_experiment import ExportError, fetch_export

    seen = []

    def valid(request):
        seen.append(request)
        return httpx.Response(200, json=complete_export_payload())

    with httpx.Client(transport=httpx.MockTransport(valid)) as client:
        result = fetch_export("https://bits.example", "secret-jwt", "experiment-1", client=client)
    assert result["id"] == "experiment-1"
    assert seen[0].headers["Authorization"] == "Bearer secret-jwt"
    assert seen[0].url == "https://bits.example/api/docs-review/experiments/experiment-1/export"

    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"id": "experiment-1"}))
        ) as client,
        pytest.raises(ExportError, match="schema"),
    ):
        fetch_export("https://bits.example", "secret-jwt", "experiment-1", client=client)


def test_cli_fails_closed_without_exposing_token_on_http_errors():
    from scripts.export_docs_review_experiment import ExportError, fetch_export

    session_value = "super-secret-jwt"
    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda request: httpx.Response(401, json={"detail": "Not authenticated"}))
        ) as client,
        pytest.raises(ExportError) as error,
    ):
        fetch_export("https://bits.example", session_value, "experiment-1", client=client)
    assert "401" in str(error.value)
    assert session_value not in str(error.value)


def test_cli_can_be_run_directly_from_the_backend_directory():
    script = Path(__file__).parents[1] / "scripts" / "export_docs_review_experiment.py"
    result = subprocess.run(  # noqa: S603 - fixed interpreter and repository script path
        [sys.executable, str(script), "--help"],
        cwd=script.parents[1],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "experiment_id" in result.stdout
