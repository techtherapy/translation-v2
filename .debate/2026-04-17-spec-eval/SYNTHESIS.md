# Debate Synthesis — BITS Spec Evaluation (2026-04-17)

**Spec:** `docs/superpowers/specs/2026-04-11-autonomous-translation-pipeline-design.md`
**Rounds:** 1 (opening + synthesis)
**Participants:** Sonnet (ship Phase 1), Gemini (trim), Codex-via-Sonnet (engineering gaps), Opus (synthesizer)
**Note:** Codex CLI failed on OpenAI auth (401). Position was re-run by a Sonnet agent briefed to ground its argument in the actual codebase state.

---

## The three positions in one line each

| Position | Verdict | Core claim |
|---|---|---|
| Sonnet | Ship Phase 1 now | The spec is unusually mature; Phase 1 is independent and generates the only evidence that can end this debate |
| Gemini | Trim the spec | 9 entities + 6 phases for a 5-person team violates Principle 6 ("Simplicity is a feature") |
| Codex | Engineering gaps | No Alembic, no tests, background jobs unresolved, `prompt_hash` is reproducibility theater — fix the foundation first |

---

## Where they agree

All three converge on: **the knowledge-base bet (Bet 1) is the valuable core, and Phases 4-6 should not be built in parallel with Phase 1.** None of the three argue the spec should be built end-to-end as written. The disagreement is about *what comes first*.

## Where they conflict

- **Sonnet vs Codex** collide head-on: Sonnet's concrete recommendation is "Build the three Phase 1 tables in `backend/app/core/database.py` `_run_migrations()`." Codex's concrete recommendation is "Migrate to Alembic before adding any more tables to `_run_migrations()`." One of them is wrong about the correct first action.
- **Gemini vs Sonnet** conflict on scope: Gemini wants phases 4-6 deleted from the spec; Sonnet wants them kept as option value because "each phase can be used independently."
- **Gemini's consolidation proposal** (polymorphic `KnowledgeAsset`) is a distinct design choice not endorsed by the other two — and is a classic premature-abstraction trap: it saves a handful of tables at the cost of type-safety, migration clarity, and query-planner effectiveness.

---

## Judgment

### Winner: **CODEX — engineering gaps position**

### Rationale

**1. Codex's argument produces two specific, hard-to-dispute technical findings that the other two positions do not reach.**

The first is the `_run_migrations()` risk. The current pattern in `core/database.py` executes raw SQL in "fail and continue" mode at app startup. Adding nine new tables with foreign keys to an already-fragile startup chain is not a migration strategy. This is not a stylistic concern — it is a silent-failure surface. Sonnet's recommendation ("build the tables in `_run_migrations()`") walks directly into it. Gemini ignores the mechanics entirely.

The second is the `prompt_hash` reproducibility critique. Appendix A specifies:

> `evidence_snapshot (JSON: {glossary_terms_applied, style_rules_applied, golden_examples_used, correction_patterns_applied, ..., prompt_hash (immutable hash of the assembled prompt for reproducibility)})`

The listed inputs are name arrays, not versioned identifiers. If any `StyleRule`, `GoldenExample`, or glossary entry is edited after the translation is produced, the `prompt_hash` persists but the prompt is no longer reconstructible. This directly violates Principle 3.4 (evidentiary transparency), which the spec itself frames as stronger than LLM introspection: *"The system's transparency comes from showing what went in, not from asking the model to explain what came out."* The current schema breaks the principle. This is a design-level bug, not a quibble.

**2. Codex's prerequisites are cheap to complete and unlock all three positions.**

The three proposed prerequisites (Alembic migration, ARQ spike, pytest harness) are each days of work. None of them preclude Phase 1; they make Phase 1 safer. Sonnet's Phase 1 pilot plan survives intact if executed after them. Gemini's trimming proposal remains available after them. A codebase with no test harness is a weak foundation for a system whose entire value proposition is "the AI does the volume work, humans ensure fidelity" — Section 3.4 transparency and Bet 4 feedback correctness both require that the records be trustworthy. Without tests, they cannot be.

**3. Sonnet's strongest argument — "further debate is procrastination" — is actually the weakest under scrutiny.**

Procrastination and prerequisite work are not the same thing. The spec was written in prose and reads mature; the codebase that must carry it has no tests, no migration tooling, and an empty `services/pipeline/` directory. Starting Phase 1 without the prerequisites means compounding debt at exactly the moment the project is promising to become the system of record for doctrinal fidelity. "Ship Phase 1 now" without first addressing the foundation is optimistic action disguised as decisive action.

**4. Gemini's diagnosis is correct; its remedy is not.**

Gemini is right that 9 entities on this team is a lot, and right that Phases 4-6 are speculative. But the polymorphic `KnowledgeAsset` consolidation it proposes is worse than the problem it solves — it sacrifices type safety, FK clarity, and SQL ergonomics for a superficial reduction in table count. The real discipline is in Codex's prerequisites: migration tooling and tests make it *cheap* to add or remove tables later, which is the correct answer to "too many tables for this team."

---

## Integrated recommendation (what actually happens this week)

The three positions are not mutually exclusive once you accept Codex's prerequisites. The sequencing is:

**Days 1-3 — Foundation (from Codex):**

1. Introduce Alembic. Generate an initial migration from the existing schema. Establish `alembic upgrade head` as the deploy step. Keep `_run_migrations()` for legacy compatibility but freeze it — no new tables added to it.
2. Add a minimal pytest harness: `pytest`, `pytest-asyncio`, one async session fixture, one smoke test per existing router.
3. One-day ARQ spike: a single background job that translates one chapter segment-by-segment and writes a `PipelineRun` row. Answer Appendix C item 1 by demonstration. Do not commit to the broader pipeline orchestrator yet.

**Days 4-5 — Phase 1 pilot (from Sonnet):**

4. Add three tables via Alembic migration (not `_run_migrations`): `ContentType`, `StyleRule`, `GoldenExample`. Defer `CorrectionPattern` to Phase 5.
5. Seed with 3-5 style rules, 5-10 golden examples, 2-3 content types — all authored by a senior translator.
6. Modify `services/translation/prompts.py` to inject matching style rules and golden examples.
7. Select one pilot chapter (doctrinally dense, existing approved human translation available). Translate twice (current vs. enriched). Senior reviewer blind evaluation on Friday.

**Scope discipline (from Gemini):**

8. Hold Phases 4-6 explicitly out of scope until Phase 1 and Phase 2 gate data is in hand. The spec already documents this — make it operationally true by not creating placeholder tables or routes for them.

**Spec revision (new, from the synthesis):**

9. Amend Appendix A so `evidence_snapshot` captures *versioned* identifiers of every knowledge input: `style_rule_ids_and_versions`, `golden_example_ids_and_versions`, `glossary_snapshot_id`, and so on. Store the assembled prompt text itself (or a content-addressable pointer) rather than relying on a hash of a reproducibility-unsafe prompt. Without this, the `prompt_hash` field is misleading audit theater and Principle 3.4 is not satisfied.

---

## Bottom line

The spec is strategically strong and should not be discarded — but it should not be implemented as written on the current codebase foundation either. The winning position is **Codex's "engineering gaps"**, because it names the two highest-leverage design/infra issues (migration fragility, `prompt_hash` reproducibility) and its prerequisites unlock the other positions' recommendations without conflict. Run the prerequisites first, then Sonnet's Phase 1 pilot, then Gemini's scope discipline as an operating norm.
