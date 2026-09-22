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


class LessonScope(StrictModel):
    source_language: str = Field(min_length=1)
    target_language: str = Field(min_length=1)
    construction: str = Field(min_length=1)
    positive_example: str = Field(min_length=1)
    counterexample: str = Field(min_length=1)
    edition_restriction: str | None

    @field_validator(
        "source_language",
        "target_language",
        "construction",
        "positive_example",
        "counterexample",
        "edition_restriction",
    )
    @classmethod
    def nonblank(cls, value):
        if value is not None and not value.strip():
            raise ValueError("Scope fields cannot be blank")
        return value


class LessonRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)
    originating_decision_id: str = Field(min_length=1)
    supersedes_id: str | None = Field(default=None, min_length=1)
    scope: dict[str, Any]
    guidance: str
    evidence: list[dict[str, Any]]


class ExperimentRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)
    lesson_ids: list[str]
    evaluation_examples: list[dict[str, Any]] = Field(min_length=1)
    baseline_input: dict[str, Any]
    candidate_input: dict[str, Any]
    excluded_example_hashes: list[str]
    development_sources: list[str] = Field(default_factory=list)


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
    expected_conflict_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    conflict_resolutions: dict[str, str] = Field(default_factory=dict)


class ReviewCoverage(StrictModel):
    source_block_ids: list[str]
    target_block_ids: list[str]
    complete: Literal[True]


class LiveReviewAssessment(ReviewAssessment):
    coverage: ReviewCoverage


class ExperimentConfiguration(StrictModel):
    model: str = Field(min_length=1)
    limits: RunLimits
    guidance: list[SuppliedGuidance] = Field(default_factory=list)
    generate_draft: bool = False
    audit_count: int = Field(default=1, ge=0, le=20)


class EvaluationExample(StrictModel):
    id: str = Field(min_length=1, max_length=255)
    source_text: str = Field(min_length=1)
    translated_text: str = Field(min_length=1)
    classification: Literal["heldout", "development"] = "heldout"


class ReferenceIssue(StrictModel):
    id: str = Field(min_length=1)
    source_quote: str = Field(min_length=1)
    explanation: str = Field(min_length=1)


class ReferenceLabelRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)
    phase: Literal["reference"]
    example_id: str = Field(min_length=1)
    source_qualified: Literal[True]
    reference_complete: bool
    serious_issues: list[ReferenceIssue]
    note: str = Field(min_length=1)


class ReviewInterval(StrictModel):
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(gt=0, allow_inf_nan=False)
    active: bool


class FlagJudgment(StrictModel):
    finding_index: int = Field(ge=0)
    false_alarm: bool | None
    reference_issue_ids: list[str]


class AuditJudgment(StrictModel):
    block_id: str
    serious_issue_ids: list[str]


class GenerationJudgment(StrictModel):
    serious_issue_count: int | None = Field(ge=0)
    note: str


class ArmJudgment(StrictModel):
    flags: list[FlagJudgment]
    audits: list[AuditJudgment]
    review_intervals: list[ReviewInterval]
    generation: GenerationJudgment | None = None


class ExperimentJudgmentRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)
    phase: Literal["judgment"]
    example_id: str = Field(min_length=1)
    arms: dict[str, ArmJudgment]
    note: str = Field(min_length=1)


class ReportRequest(StrictModel):
    client_request_id: str = Field(min_length=1, max_length=255)


class GeneratedDraft(StrictModel):
    schema_version: Literal[1]
    translated_text: str = Field(min_length=1)
