"""Strict request and structured-assessment contracts for Docs review."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ReviewSpan(StrictModel):
    block_id: str = Field(min_length=1)
    quote: str = Field(min_length=1)
    occurrence: int = Field(ge=0)


class ReviewFinding(StrictModel):
    category: Literal["meaning", "omission", "addition", "terminology", "consistency", "voice"]
    proposed_severity: Literal["major", "minor", "question"]
    source_spans: list[ReviewSpan] = Field(min_length=1)
    target_spans: list[ReviewSpan] = Field(min_length=1)
    explanation: str = Field(min_length=1)
    evidence_ids: list[str]
    proposed_correction: str | None = None


class ReviewAssessment(StrictModel):
    schema_version: Literal[1]
    findings: list[ReviewFinding]


class SnapshotBlock(StrictModel):
    block_id: str = Field(min_length=1)
    text: str
    kind: str = Field(min_length=1)
    named_range_id: str | None = None


class SnapshotRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)
    observed_revision_id: str | None = None
    suggestions_pending: bool
    blocks: list[SnapshotBlock] = Field(min_length=1)

    @field_validator("blocks")
    @classmethod
    def require_unique_block_ids(cls, blocks: list[SnapshotBlock]) -> list[SnapshotBlock]:
        seen: set[str] = set()
        for block in blocks:
            if block.block_id in seen:
                raise ValueError(f"duplicate block_id: {block.block_id}")
            seen.add(block.block_id)
        return blocks


class RunLimits(StrictModel):
    max_input_tokens: int | None = Field(default=None, gt=0)
    max_output_tokens: int | None = Field(default=None, gt=0)
    max_cost_usd: float | None = Field(default=None, gt=0)


class SuppliedGuidance(StrictModel):
    id: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1)


class RunRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)
    snapshot_id: str = Field(min_length=1)
    mode: Literal["fixture", "live"]
    model: str | None = Field(default=None, min_length=1)
    limits: RunLimits | None = None
    guidance: list[SuppliedGuidance] = Field(default_factory=list)

    @field_validator("guidance")
    @classmethod
    def unique_guidance_ids(cls, guidance):
        if len({item.id for item in guidance}) != len(guidance):
            raise ValueError("Guidance IDs must be unique")
        return guidance


class DecisionRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)
    item_id: str = Field(min_length=1)
    base_snapshot_id: str = Field(min_length=1)
    reviewed_snapshot_id: str = Field(min_length=1)
    disposition: Literal[
        "confirmed_issue",
        "no_issue",
        "corrected",
        "needs_another_opinion",
        "audit_no_issue",
        "audit_found_issue",
    ]
    note: str


class LessonRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)
    originating_decision_id: str = Field(min_length=1)
    supersedes_id: str | None = Field(default=None, min_length=1)
    scope: dict[str, Any]
    guidance: str = Field(min_length=1)
    evidence: list[dict[str, Any]]


class ExperimentRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)
    lesson_ids: list[str]
    evaluation_examples: list[dict[str, Any]] = Field(min_length=1)
    baseline_input: dict[str, Any]
    candidate_input: dict[str, Any]
    excluded_example_hashes: list[str]


class ProjectRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)
    document_id: str = Field(min_length=1, max_length=255)
    tab_id: str = Field(min_length=1, max_length=255)
    book_label: str = Field(max_length=500)
    chapter_label: str = Field(max_length=500)
    source_language: str = Field(min_length=1, max_length=32)
    target_language: str = Field(min_length=1, max_length=32)
    source_text: str = Field(min_length=1)
    english_status: Literal["unknown"] = "unknown"


class LessonConfirmationRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)
    expected_content_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class ReviewCoverage(StrictModel):
    source_block_ids: list[str]
    target_block_ids: list[str]
    complete: Literal[True]


class LiveReviewAssessment(ReviewAssessment):
    coverage: ReviewCoverage
