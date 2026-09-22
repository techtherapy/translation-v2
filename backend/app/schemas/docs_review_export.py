"""Strict, account-neutral schema for portable Docs review experiment evidence."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class ExportModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ExportLimits(ExportModel):
    max_input_tokens: int
    max_output_tokens: int
    max_cost_usd: int | float


class ExportGuidance(ExportModel):
    id: str
    content: str


class ExportConfiguration(ExportModel):
    model: str
    limits: ExportLimits
    guidance: list[ExportGuidance]
    generate_draft: bool
    audit_count: int


class ExportLessonScope(ExportModel):
    source_language: str
    target_language: str
    construction: str
    positive_example: str
    counterexample: str
    edition_restriction: str | None


class ExportLesson(ExportModel):
    id: str
    content_hash: str
    source_language: str
    target_language: str
    scope: ExportLessonScope
    guidance: str


class ExportBlock(ExportModel):
    block_id: str
    text: str
    kind: str
    named_range_id: str | None = None


class ExportMessage(ExportModel):
    role: str
    content: str


class ExportPriceSchedule(ExportModel):
    id: str | None = None
    input_per_million: int | float | None = None
    output_per_million: int | float | None = None

    @model_validator(mode="after")
    def complete_or_unconfigured(self):
        values = (self.id, self.input_per_million, self.output_per_million)
        if any(value is not None for value in values) and any(value is None for value in values):
            raise ValueError("A price schedule must be complete or unconfigured")
        return self


class ExportCompletionOptions(ExportModel):
    model: str
    messages: list[ExportMessage]
    max_completion_tokens: int
    response_format: dict[Literal["type"], Literal["json_object"]]
    num_retries: int
    timeout: int | float
    temperature: int | float
    top_p: int | float
    n: int
    stream: bool
    stop: None
    seed: None
    presence_penalty: None
    frequency_penalty: None


class ExportBundle(ExportModel):
    source_text: str
    source_language: str
    target_language: str
    target_blocks: list[ExportBlock]
    guidance: list[ExportGuidance]
    model: str
    provider: str
    limits: ExportLimits
    price_schedule: ExportPriceSchedule | None
    prompt_version: str
    audit_seed: int
    audit_count: int
    account_spend_limit_usd: int | float
    messages: list[ExportMessage]
    completion_options: ExportCompletionOptions


class ExportCall(ExportModel):
    example_id: str
    outcome: Literal["assessment", "generation"]
    input: ExportBundle


class ExportArm(ExportModel):
    configuration: ExportConfiguration
    confirmed_lessons: list[ExportLesson]
    calls: list[ExportCall]
    configuration_id: str


class ExportExample(ExportModel):
    id: str
    source_text: str
    translated_text: str
    classification: Literal["heldout", "development"]


class ExportSpan(ExportModel):
    block_id: str
    quote: str
    occurrence: int


class ExportFinding(ExportModel):
    category: Literal["meaning", "omission", "addition", "terminology", "consistency", "voice"]
    proposed_severity: Literal["major", "minor", "question"]
    source_spans: list[ExportSpan]
    target_spans: list[ExportSpan]
    explanation: str
    evidence_ids: list[str]
    proposed_correction: str | None = None


class ExportCoverage(ExportModel):
    source_block_ids: list[str]
    target_block_ids: list[str]
    complete: bool


class ExportAudit(ExportModel):
    population: list[str]
    selected_ids: list[str]
    count: int
    seed: int
    requested_count: int | None = None


class ExportAssessmentResult(ExportModel):
    schema_version: Literal[1]
    findings: list[ExportFinding]
    coverage: ExportCoverage
    audit: ExportAudit
    unflagged_status: Literal["unreviewed"]


class ExportGenerationResult(ExportModel):
    schema_version: Literal[1]
    translated_text: str


class ExportUsage(ExportModel):
    provider_calls: int
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    actual_cost_usd: int | float | None = None
    provider_error_type: str | None = None
    reserved_cost_usd: int | float | None = None
    late_response: bool | None = None


class ExportOutput(ExportModel):
    example_id: str
    outcome: Literal["assessment", "generation"]
    raw_response: str | None
    validated_result: ExportAssessmentResult | ExportGenerationResult | None
    usage: ExportUsage
    error_code: str | None
    late_response: bool | None = None


class ExportReferenceIssue(ExportModel):
    id: str
    source_quote: str
    explanation: str


class ExportFlagJudgment(ExportModel):
    finding_index: int
    false_alarm: bool | None
    reference_issue_ids: list[str]


class ExportAuditJudgment(ExportModel):
    block_id: str
    serious_issue_ids: list[str]


class ExportReviewInterval(ExportModel):
    start: int | float
    end: int | float
    active: bool


class ExportGenerationJudgment(ExportModel):
    serious_issue_count: int | None
    note: str


class ExportArmJudgment(ExportModel):
    flags: list[ExportFlagJudgment]
    audits: list[ExportAuditJudgment]
    review_intervals: list[ExportReviewInterval]
    generation: ExportGenerationJudgment | None = None


class ExportReferenceLabel(ExportModel):
    id: str
    client_request_id: str
    request_hash: str
    phase: Literal["reference"]
    example_id: str
    source_qualified: Literal[True]
    reference_complete: bool
    serious_issues: list[ExportReferenceIssue]
    note: str
    created_at: str
    blinded: bool


class ExportJudgmentLabel(ExportModel):
    id: str
    client_request_id: str
    request_hash: str
    phase: Literal["judgment"]
    example_id: str
    arms: dict[Literal["A", "B"], ExportArmJudgment]
    note: str
    created_at: str
    blinded: bool

    @field_validator("arms")
    @classmethod
    def both_arms(cls, arms):
        if set(arms) != {"A", "B"}:
            raise ValueError("Both blinded arms are required")
        return arms


class ExportOverlap(ExportModel):
    candidate_source: str
    development_source: str
    reason: str


class ExportExclusion(ExportModel):
    example_id: str
    classification: Literal["development"]
    matches: list[ExportOverlap]
    reason: str | None = None
    detected_at: str | None = None
    excluded_hash: bool | None = None


class ExportStartedCall(ExportModel):
    arm: Literal["baseline", "candidate"]
    example_id: str
    outcome: Literal["assessment", "generation"]
    started_at: str


class ExportExecution(ExportModel):
    status: Literal["ready", "pending_enqueue", "queued", "running", "succeeded", "failed", "interrupted"]
    provider_calls: int
    error_code: str | None = None
    lease_expires_at: str | None = None
    reserved_cost_usd: int | float | None = None
    reserved_call_count: int | None = None
    started_calls: list[ExportStartedCall] | None = None


class ExportAssessmentTotals(ExportModel):
    confirmed_missed_issues: int | None
    false_alarms: int | None
    reference_serious_issues: int
    flags_total: int
    flags_inspected: int
    flags_unknown: int
    audit_population: int
    audit_selected: int
    audit_inspected: int
    active_review_seconds: int | float | None
    review_time_unknown_examples: int
    measured_examples: int


class ExportGenerationTotals(ExportModel):
    serious_issues: int | None
    labeled_examples: int
    unknown_examples: int


class ExportLabelCoverage(ExportModel):
    heldout_examples: int
    labeled_examples: int
    unknown_examples: int


class ExportExampleOutcome(ExportModel):
    confirmed_missed_issues: int
    false_alarms: int
    active_review_seconds: int | float | None


class ExportReportExample(ExportModel):
    example_id: str
    status: Literal["labeled", "unknown"]
    outcomes: dict[Literal["baseline", "candidate"], ExportExampleOutcome | None]


class ExportSummaryReport(ExportModel):
    schema_version: Literal[1]
    conclusion: Literal["inconclusive", "regression", "candidate_for_larger_trial"]
    conclusion_outcome: Literal["assessment"]
    assessment: dict[Literal["baseline", "candidate"], ExportAssessmentTotals]
    generation: dict[Literal["baseline", "candidate"], ExportGenerationTotals]
    label_coverage: ExportLabelCoverage
    configuration_ids: dict[Literal["baseline", "candidate"], str]
    exclusions: list[ExportExclusion]
    excluded_source_hashes: list[str]
    examples: list[ExportReportExample]
    limitations: list[str]
    usage: ExportExecution


class ExportReportRevision(ExportModel):
    id: str
    client_request_id: str
    request_hash: str
    created_at: str
    label_ids: list[str]
    report: ExportSummaryReport


class ExportReport(ExportModel):
    execution: ExportExecution
    blinded_order: dict[str, dict[Literal["A", "B"], Literal["baseline", "candidate"]]]
    exclusions: list[ExportExclusion]
    exclusion_sources: list[str]
    revisions: list[ExportReportRevision]

    @field_validator("blinded_order")
    @classmethod
    def complete_orders(cls, orders):
        if any(
            set(value) != {"A", "B"} or set(value.values()) != {"baseline", "candidate"} for value in orders.values()
        ):
            raise ValueError("Every example requires a complete blinded order")
        return orders


class DocsReviewExperimentExport(ExportModel):
    id: str
    created_at: str
    client_request_id: str
    request_hash: str
    project_id: str
    baseline_input: ExportArm
    candidate_input: ExportArm
    lesson_ids: list[str]
    excluded_example_hashes: list[str]
    evaluation_examples: list[ExportExample]
    baseline_outputs: list[ExportOutput]
    candidate_outputs: list[ExportOutput]
    independent_labels: list[ExportReferenceLabel | ExportJudgmentLabel]
    report: ExportReport
