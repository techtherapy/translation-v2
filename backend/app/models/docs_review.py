"""Owner-scoped evidence storage, deliberately independent of translation writers."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def reference(table):
    return ForeignKey(f"{table}.id", ondelete="RESTRICT")


class EvidenceRecord:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RequestRecord:
    client_request_id: Mapped[str] = mapped_column(String(255))
    request_hash: Mapped[str] = mapped_column(String(64))


class ProjectRecord(EvidenceRecord, RequestRecord):
    project_id: Mapped[str] = mapped_column(reference("docs_review_projects"), index=True)


class DocsReviewProject(EvidenceRecord, RequestRecord, Base):
    __tablename__ = "docs_review_projects"
    __table_args__ = (UniqueConstraint("owner_user_id", "client_request_id", name="uq_docs_project_request"),)
    owner_user_id: Mapped[int] = mapped_column(reference("users"), index=True)
    document_id: Mapped[str] = mapped_column(String(255))
    tab_id: Mapped[str] = mapped_column(String(255))
    book_label: Mapped[str] = mapped_column(String(500))
    chapter_label: Mapped[str] = mapped_column(String(500))
    source_language: Mapped[str] = mapped_column(String(32))
    target_language: Mapped[str] = mapped_column(String(32))
    source_text: Mapped[str] = mapped_column(Text)
    source_sha256: Mapped[str] = mapped_column(String(64))
    english_status: Mapped[str] = mapped_column(String(50))


class DocsReviewSnapshot(ProjectRecord, Base):
    __tablename__ = "docs_review_snapshots"
    __table_args__ = (UniqueConstraint("project_id", "client_request_id", name="uq_docs_snapshot_request"),)
    canonical_text: Mapped[str] = mapped_column(Text)
    blocks: Mapped[list] = mapped_column(JSON)
    target_sha256: Mapped[str] = mapped_column(String(64))
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    observed_revision_id: Mapped[str | None] = mapped_column(Text)
    suggestions_pending: Mapped[bool] = mapped_column(Boolean)


class DocsReviewRun(ProjectRecord, Base):
    __tablename__ = "docs_review_runs"
    __table_args__ = (UniqueConstraint("project_id", "client_request_id", name="uq_docs_run_request"),)
    snapshot_id: Mapped[str] = mapped_column(reference("docs_review_snapshots"))
    status: Mapped[str] = mapped_column(String(50), default="pending")
    mode: Mapped[str] = mapped_column(String(20))
    input_bundle: Mapped[dict] = mapped_column(JSON)
    input_sha256: Mapped[str] = mapped_column(String(64))
    raw_response: Mapped[str | None] = mapped_column(Text)
    validated_result: Mapped[dict | None] = mapped_column(JSON)
    error_code: Mapped[str | None] = mapped_column(String(100))
    usage: Mapped[dict | None] = mapped_column(JSON)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DocsReviewItem(EvidenceRecord, Base):
    __tablename__ = "docs_review_items"
    run_id: Mapped[str] = mapped_column(reference("docs_review_runs"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    category: Mapped[str | None] = mapped_column(String(50))
    proposed_severity: Mapped[str | None] = mapped_column(String(20))
    source_spans: Mapped[list] = mapped_column(JSON)
    target_spans: Mapped[list] = mapped_column(JSON)
    explanation: Mapped[str] = mapped_column(Text)
    evidence_ids: Mapped[list] = mapped_column(JSON)
    proposed_correction: Mapped[str | None] = mapped_column(Text)


class DocsReviewDecision(ProjectRecord, Base):
    __tablename__ = "docs_review_decisions"
    __table_args__ = (UniqueConstraint("project_id", "client_request_id", name="uq_docs_decision_request"),)
    item_id: Mapped[str] = mapped_column(reference("docs_review_items"))
    reviewer_id: Mapped[int] = mapped_column(reference("users"))
    base_snapshot_id: Mapped[str] = mapped_column(reference("docs_review_snapshots"))
    reviewed_snapshot_id: Mapped[str] = mapped_column(reference("docs_review_snapshots"))
    disposition: Mapped[str] = mapped_column(String(50))
    note: Mapped[str] = mapped_column(Text)


class DocsReviewLesson(ProjectRecord, Base):
    __tablename__ = "docs_review_lessons"
    __table_args__ = (UniqueConstraint("project_id", "client_request_id", name="uq_docs_lesson_request"),)
    originating_decision_id: Mapped[str] = mapped_column(reference("docs_review_decisions"))
    supersedes_id: Mapped[str | None] = mapped_column(reference("docs_review_lessons"))
    source_language: Mapped[str] = mapped_column(String(32))
    target_language: Mapped[str] = mapped_column(String(32))
    scope: Mapped[dict] = mapped_column(JSON)
    guidance: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="proposed")
    confirmed_by: Mapped[int | None] = mapped_column(reference("users"))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DocsReviewLessonConfirmation(ProjectRecord, Base):
    __tablename__ = "docs_review_lesson_confirmations"
    __table_args__ = (
        UniqueConstraint("project_id", "client_request_id", name="uq_docs_confirmation_request"),
        UniqueConstraint("lesson_id", name="uq_docs_confirmation_lesson"),
    )
    lesson_id: Mapped[str] = mapped_column(reference("docs_review_lessons"))
    confirmed_by: Mapped[int] = mapped_column(reference("users"))
    content_hash: Mapped[str] = mapped_column(String(64))


class DocsReviewExperiment(ProjectRecord, Base):
    __tablename__ = "docs_review_experiments"
    __table_args__ = (UniqueConstraint("project_id", "client_request_id", name="uq_docs_experiment_request"),)
    baseline_input: Mapped[dict] = mapped_column(JSON)
    candidate_input: Mapped[dict] = mapped_column(JSON)
    lesson_ids: Mapped[list] = mapped_column(JSON)
    excluded_example_hashes: Mapped[list] = mapped_column(JSON)
    evaluation_examples: Mapped[list] = mapped_column(JSON)
    baseline_outputs: Mapped[list | None] = mapped_column(JSON)
    candidate_outputs: Mapped[list | None] = mapped_column(JSON)
    independent_labels: Mapped[list] = mapped_column(JSON, default=list)
    report: Mapped[dict | None] = mapped_column(JSON)
