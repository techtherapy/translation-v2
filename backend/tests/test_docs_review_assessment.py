"""Grounding failures never produce a clean review. All completion calls are fake."""

import copy
import json
from types import SimpleNamespace

import pytest


def bundle():
    return {
        "source_text": "源文:甲乙。",
        "source_language": "zh",
        "target_language": "en",
        "target_blocks": [
            {"block_id": "p1", "text": "First passage", "kind": "paragraph"},
            {"block_id": "p2", "text": "Second passage", "kind": "paragraph"},
            {"block_id": "p3", "text": "Third passage", "kind": "paragraph"},
            {"block_id": "empty", "text": "", "kind": "paragraph"},
        ],
        "guidance": [{"id": "g1", "content": "Preserve authorial wordplay."}],
        "model": "anthropic/test-model",
        "provider": "anthropic",
        "limits": {"max_input_tokens": 20000, "max_output_tokens": 2000, "max_cost_usd": 0.1},
        "price_schedule": {"id": "test-prices", "input_per_million": 1.0, "output_per_million": 2.0},
        "audit_seed": 7,
        "audit_count": 3,
    }


def freeze_test_request(inputs):
    # Literal request evidence, independent of the production default builder.
    inputs["completion_options"] = {
        "model": inputs["model"],
        "messages": copy.deepcopy(inputs["messages"]),
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


def assessment():
    return {
        "schema_version": 1,
        "coverage": {"source_block_ids": ["source"], "target_block_ids": ["p1", "p2", "p3"], "complete": True},
        "findings": [
            {
                "category": "meaning",
                "proposed_severity": "question",
                "source_spans": [{"block_id": "source", "quote": "甲乙", "occurrence": 0}],
                "target_spans": [
                    {"block_id": "p1", "quote": "First", "occurrence": 0},
                    {"block_id": "p2", "quote": "Second", "occurrence": 0},
                ],
                "explanation": "Check the relation across both passages.",
                "evidence_ids": ["g1"],
                "proposed_correction": None,
            }
        ],
    }


def response(value=None, *, raw=None, finish="stop"):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=raw if raw is not None else json.dumps(value or assessment())),
                finish_reason=finish,
            )
        ],
        usage=SimpleNamespace(prompt_tokens=321, completion_tokens=123, total_tokens=444),
    )


def test_audit_excludes_flagged_and_is_repeatable():
    from app.services.docs_review.sampling import select_audit

    first = select_audit(["p3", "p2", "p1", "p1"], {"p2"}, count=2, seed=7)
    assert set(first) == {"p1", "p3"}
    assert first == select_audit(["p1", "p2", "p3"], {"p2"}, count=2, seed=7)
    assert select_audit(["p1"], {"p1"}, count=3, seed=7) == []


async def test_valid_multiblock_finding_uses_full_chapter_and_separate_guidance():
    from app.services.docs_review.assessment import assess_snapshot
    from app.services.docs_review.prompts import build_messages

    inputs = bundle()
    inputs["messages"] = build_messages(inputs)
    freeze_test_request(inputs)
    before = copy.deepcopy(inputs)
    calls = []

    async def fake(**kwargs):
        calls.append(kwargs)
        return response()

    result = await assess_snapshot(inputs, fake)
    assert result["validated_result"]["findings"][0]["target_spans"][1]["block_id"] == "p2"
    assert result["usage"]["prompt_tokens"] == 321
    assert result["usage"]["completion_tokens"] == 123
    assert result["raw_response"] == response().choices[0].message.content
    assert inputs == before
    assert len(calls) == 1
    assert calls[0]["num_retries"] == 0
    assert calls[0]["max_completion_tokens"] == 2000
    sent = calls[0]["messages"]
    assert sent[0]["role"] == "system"
    data = json.loads(sent[1]["content"])
    assert data["source_blocks"] == [{"block_id": "source", "text": "源文:甲乙。"}]
    assert len(data["target_blocks"]) == 4
    assert data["supplied_guidance"] == inputs["guidance"]
    assert "First passage" not in sent[0]["content"]
    assert "analyst_cards" not in sent[1]["content"]


@pytest.mark.parametrize("problem", ["quote", "evidence", "json", "truncated", "coverage", "exception", "timeout"])
async def test_failure_preserves_private_evidence_without_partial_findings(problem):
    from app.services.docs_review.assessment import AssessmentError, assess_snapshot
    from app.services.docs_review.prompts import build_messages

    inputs = bundle()
    inputs["messages"] = build_messages(inputs)
    freeze_test_request(inputs)
    value = assessment()
    if problem == "quote":
        value["findings"][0]["source_spans"][0]["quote"] = "invented"
    if problem == "evidence":
        value["findings"][0]["evidence_ids"] = ["not-supplied"]
    if problem == "coverage":
        value["coverage"]["target_block_ids"] = ["p1"]
    raw = "not JSON" if problem == "json" else json.dumps(value)

    async def fake(**kwargs):
        if problem == "timeout":
            raise TimeoutError("response lost")
        if problem == "exception":
            raise RuntimeError("private provider error")
        return response(raw=raw, finish="length" if problem == "truncated" else "stop")

    with pytest.raises(AssessmentError) as failure:
        await assess_snapshot(inputs, fake)
    assert failure.value.code
    assert failure.value.ambiguous == (problem in {"timeout", "exception"})
    if problem not in {"timeout", "exception"}:
        assert failure.value.raw_response == raw
        assert failure.value.usage["total_tokens"] == 444
    assert not hasattr(failure.value, "findings")


async def test_nontext_provider_content_is_preserved_privately_but_rejected():
    from app.services.docs_review.assessment import AssessmentError, assess_snapshot
    from app.services.docs_review.prompts import build_messages

    inputs = bundle()
    inputs["messages"] = build_messages(inputs)
    freeze_test_request(inputs)

    async def fake(**kwargs):
        return response(raw={"unusable": "provider object"})

    with pytest.raises(AssessmentError) as caught:
        await assess_snapshot(inputs, fake)
    assert caught.value.code == "invalid_assessment"
    assert isinstance(caught.value.raw_response, str)
    assert json.loads(caught.value.raw_response) == {"unusable": "provider object"}
