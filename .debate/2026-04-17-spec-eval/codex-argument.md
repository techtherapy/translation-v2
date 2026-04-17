# CODEX Argument: The Spec Hides Critical Engineering Gaps — Not Implementation-Ready

## Headline Verdict

The spec is strategically coherent but functionally incomplete: it commits to nine new database entities, a background job orchestrator, a confidence-scoring service, and idempotent pipeline resumability on top of a codebase with no Alembic, no test suite, and an empty `services/pipeline/` directory — leaving every load-bearing engineering decision either open or unanswered.

---

## Three Strongest Claims

### Claim 1: The infrastructure foundation is too fragile for the schema changes the spec demands

The current codebase has no Alembic. All schema changes are raw SQL in `core/database.py::_run_migrations()`, which already accumulates 20+ individual steps executed at app startup in "fail and continue" mode (each step is wrapped in `_safe_execute` which logs and skips on error). Appendix A adds nine new tables — `PipelineRun`, `PipelineSegmentResult`, `StyleRule`, `GoldenExample`, `CorrectionPattern`, `ContentType`, `ContentTypeAssignment`, `ReviewerOutcome`, `FidelityAudit` — with multi-level foreign keys between them. Appending nine more `_safe_execute` blocks to an already-fragile startup migration chain is not a migration strategy; it is a silent-failure machine. Any FK ordering error or partial rollout will corrupt the schema with no rollback path and no test harness to detect it.

**Citation:** Appendix A (data model additions); `backend/app/core/database.py` lines 65–299.

### Claim 2: Appendix C's open question on background jobs is not a deferrable detail — it determines every Phase 2 design decision

Appendix C lists "Background job infrastructure: Celery + Redis (mature), ARQ (async-native, lighter), or custom queue on existing PostgreSQL" as an open question. `requirements.txt` contains neither Celery nor ARQ nor any task-queue library. Section 6.1 specifies that pipeline runs must be "resumable, configurable, observable, batchable, and cancellable." Resumability alone requires idempotency guarantees: if a run restarts mid-chapter, the system must not re-translate already-completed segments or double-charge tokens. The spec does not define idempotency semantics for `PipelineSegmentResult` writes, nor specify how `PipelineRun.status` transitions are made atomic against worker restarts. This is not a detail to resolve during Phase 2 implementation — the choice of job infrastructure determines the transaction model, the worker concurrency model, the retry semantics, and the cancellation mechanism. Starting Phase 2 without resolving Appendix C item 1 means building the pipeline twice.

**Citation:** Appendix C item 1; Section 6.1 ("resumable…cancellable"); `backend/requirements.txt` (no task queue present).

### Claim 3: The `evidence_snapshot.prompt_hash` field is a reproducibility theater, not evidentiary transparency

`PipelineSegmentResult.evidence_snapshot` (Appendix A) stores a `prompt_hash` described as "an immutable hash of the assembled prompt for reproducibility." But the assembled prompt is a function of: the glossary version at the time of the run, the set of active `StyleRule` rows, the selected `GoldenExample` rows, the active `CorrectionPattern` rows, and the full layered context strategy (Section 6.1). None of these inputs are snapshotted by ID or version in `evidence_snapshot` — the schema stores only `glossary_terms_applied`, `style_rules_applied`, etc. as opaque arrays, with no version or `updated_at` capture. If a `StyleRule` is edited after a pipeline run, the hash is valid but the prompt is no longer reconstructible, violating the principle in Section 3.4 ("evidentiary transparency over black-box optimization"). The hash becomes a false audit trail. Reproducibility requires snapshotting the content or a versioned identifier of every input, not just a hash of the final assembled string.

**Citation:** Appendix A (`PipelineSegmentResult.evidence_snapshot`); Section 3.4 (Principle 4, evidentiary transparency).

---

## Strongest Counter-Argument and Rebuttal

**Counter-argument:** The spec is a phased design document, not a sprint ticket. Phase 1 only builds the knowledge base and integrates it into the existing single-segment translation endpoint. None of Phase 1 touches the pipeline, the job infrastructure, or `PipelineSegmentResult`. The engineering gaps are real but they sit in Phase 2 and beyond, and the spec explicitly acknowledges open questions.

**Rebuttal:** Phase 1 adds `StyleRule`, `GoldenExample`, `CorrectionPattern`, `ContentType`, and `ContentTypeAssignment` to the schema — five of the nine new entities — using the same raw-SQL startup migration pattern that already has 20+ unsafe steps. More critically, if the team reaches Phase 2 with an unresolved job infrastructure choice, they will build prompt assembly, context layering, and self-assessment on top of an assumed execution model that may need to be thrown away when the infrastructure decision is finally made. The spec's own Phase 2 gate ("offline calibration shows self-assessment is poorly calibrated") cannot be evaluated without instrumentation that depends on `PipelineSegmentResult` — which is where the `prompt_hash` reproducibility trap lives. Acknowledging open questions in Appendix C while specifying observable requirements in Section 6.1 that contradict deferring those questions is not strategic sequencing; it is contradiction.

---

## Concrete Recommendation

Before any Phase 1 implementation begins, the team must complete three engineering prerequisites:

1. **Migrate to Alembic.** Generate an initial migration from the existing schema, establish `alembic upgrade head` as the deploy step, and add a smoke-test assertion that `alembic current` matches `alembic head` in CI. Without this, the nine new Phase 1 tables will be bolted onto a startup migration chain with no rollback.

2. **Resolve Appendix C item 1 this week.** Given the existing async FastAPI stack and Redis already in `requirements.txt`, ARQ is the correct default. Spike it: write a single background job that translates one chapter using the existing `services/translation/llm.py` call and stores status in a `PipelineRun` row. This spike surfaces the idempotency and cancellation design before any other Phase 2 work begins.

3. **Add a minimal backend test harness.** `pytest` + `pytest-asyncio` + one in-memory SQLite session fixture. The spec's feedback loop depends on `ReviewerOutcome` and `FidelityAudit` records being trustworthy. You cannot validate that trust without tests. A codebase with no tests is not a foundation for a machine-first translation system with autonomous quality governance.

None of these are blocking the spec's strategic vision. All of them are blocking safe implementation of it.
