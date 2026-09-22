"""One bounded completion; validate the entire response before producing any findings."""

import asyncio
import json

import litellm
from pydantic import ValidationError

from app.schemas.docs_review import LiveReviewAssessment
from app.services.docs_review.evidence import validate_assessment_evidence

CALL_TIMEOUT_SECONDS = 120
litellm.telemetry = False


class AssessmentError(Exception):
    def __init__(self, code, *, raw_response=None, usage=None, ambiguous=False):
        super().__init__(code)
        self.code = code
        self.raw_response = raw_response
        self.usage = usage or {}
        self.ambiguous = ambiguous


async def assess_snapshot(input_bundle, completion_client=None):
    """Use the frozen prompt/model. Never repair, clean, or retry provider output."""
    client = completion_client or litellm.acompletion
    raw = None
    usage = {"provider_calls": 1}
    try:
        response = await asyncio.wait_for(
            client(
                model=input_bundle["model"],
                messages=input_bundle["messages"],
                max_completion_tokens=input_bundle["limits"]["max_output_tokens"],
                response_format={"type": "json_object"},
                num_retries=0,
                timeout=CALL_TIMEOUT_SECONDS,
            ),
            timeout=CALL_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        # No response is not proof that the provider did not charge or finish.
        usage["provider_error_type"] = type(exc).__name__
        raise AssessmentError("provider_completion_unknown", usage=usage, ambiguous=True) from exc
    try:
        if response.usage is not None:
            for field in ("prompt_tokens", "completion_tokens", "total_tokens"):
                usage[field] = getattr(response.usage, field, None)
        content = response.choices[0].message.content
        raw = (
            content
            if isinstance(content, str) or content is None
            else json.dumps(content, ensure_ascii=False, default=repr)
        )
        if not isinstance(content, str):
            raise ValueError("Provider content must be text")
        if response.choices[0].finish_reason != "stop":
            raise AssessmentError("incomplete_response", raw_response=raw, usage=usage)
        assessment = LiveReviewAssessment.model_validate_json(raw)
        targets = {b["block_id"]: b["text"] for b in input_bundle["target_blocks"]}
        covered = assessment.coverage.target_block_ids
        expected = {bid for bid, text in targets.items() if text.strip()}
        if (
            assessment.coverage.source_block_ids != ["source"]
            or set(covered) != expected
            or len(covered) != len(expected)
        ):
            raise ValueError("Incomplete chapter coverage")
        validate_assessment_evidence(
            assessment,
            source_blocks={"source": input_bundle["source_text"]},
            target_blocks=targets,
            evidence_ids={g["id"] for g in input_bundle["guidance"]},
        )
    except AssessmentError:
        raise
    except (ValueError, TypeError, ValidationError, AttributeError, IndexError) as exc:
        raise AssessmentError("invalid_assessment", raw_response=raw, usage=usage) from exc
    return {"raw_response": raw, "validated_result": assessment.model_dump(), "usage": usage}
