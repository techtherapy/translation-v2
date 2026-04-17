You are CODEX, one of four AI models debating the merits of a draft design spec.

**Spec under review:** `/Users/it1/GitHub/translation v2/docs/superpowers/specs/2026-04-11-autonomous-translation-pipeline-design.md` — read it fully.
**Briefing:** `/Users/it1/GitHub/translation v2/.debate/2026-04-17-spec-eval/BRIEFING.md` — read it for context.

**Your assigned position: "THE SPEC HIDES CRITICAL ENGINEERING GAPS. NOT IMPLEMENTATION-READY."**

Argue that the spec reads like strategy but leaves load-bearing engineering questions unanswered, and that starting implementation now would compound technical debt before the key decisions have been made. You believe:

- The codebase already has significant structural issues the spec does not address: no Alembic (raw-SQL manual migrations in `core/database.py`), no backend tests, no CI/CD beyond git push — yet the spec adds 9 new entities, a background job system, a confidence scoring service, and a pipeline orchestrator on top of this foundation.
- Appendix C ("Open Engineering Questions") leaves the background job infrastructure choice (Celery vs ARQ vs custom Postgres queue) open. This is a foundational decision that changes every later phase. It cannot remain open after Phase 2 begins.
- The `evidence_snapshot` JSON blob in `PipelineSegmentResult` (Appendix A) is a reproducibility trap — storing `prompt_hash` without storing or addressing the prompt assembly dependencies (which glossary version, which style-rule versions, which golden-example versions) means the hash is not actually reproducible. The "evidentiary transparency" principle (Section 3.4) is not achieved by the proposed schema.
- The spec specifies "Pipeline runs are resumable, configurable, observable, batchable, and cancellable" (Section 6.1) as if these are obvious. Each one is a nontrivial engineering feature — resumability alone requires idempotency guarantees the spec does not specify.
- The "tentative vs authoritative context" mechanism (Section 5.3) — distinguishing unreviewed machine output from human-approved output in the context window — is a hard constraint that needs a concrete storage/retrieval design. The spec states the rule but not the implementation.

Be specific about Section numbers, Appendix letters, and engineering details. Do not hedge — your job is adversarial clarity.

**Output format (strict):**
- **Headline verdict** (one sentence)
- **Three strongest claims** (each ≤ 3 sentences, each with a spec citation like "Appendix A", "Section 6.1")
- **Strongest counter-argument you anticipate, and your rebuttal**
- **Concrete recommendation** (what engineering work must precede Phase 1 — be specific: Alembic setup, backend test harness, one specific engineering spike, etc.)

Keep the total response under 700 words. Be direct.
