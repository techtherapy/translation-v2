# Simple Google Docs Review Sidebar Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A compact review queue with Chinese source in the expanded item, direct suggestions, manual completion, deferral and undo.

**Architecture:** Keep the existing Apps Script add-on and owner-scoped backend evidence. Persist the context the reviewer opened separately from the original assessment. Retain the legacy decision API semantics for existing callers. New actions refer to an explicitly opened context; later edits require reopening except for the explicit Done editing action.

**Tech Stack:** Apps Script, HTML/CSS/JavaScript, FastAPI, SQLAlchemy, Alembic.

**Spec:** User-approved design in this chat on 2026-10-29: one expanded item; exact Chinese excerpt; concise reason and before/after suggestion; Use suggestion changes the document; Keep wording, Done editing, Do later; reviewed group with Undo; Next is explicit; spot checks separate; settings and detailed evidence secondary.

## Global Constraints
- Preserve the source, original assessment and recorded decisions.
- Never activate shared lessons automatically or enable paid AI during development.
- Only offer a replacement for a single exact target span and a concrete single-paragraph correction.
- Use current-document Apps Script permissions; no broader account access.
- Preserve unrelated text/formatting. Undo must not overwrite intervening edits.
- Default review is a left-aligned 300px queue, white surface, dark green action, warm gold pending mark; Georgia for source/text, Trebuchet MS for controls.
- Keep the existing experimental tools behind Settings, retain their functionality.

## Review Focus
- Sequential decisions after edits elsewhere must record current context without misclassifying another passage as corrected.
- Duplicate quotes, Unicode, missing anchors and split paragraphs must not cause writes to the wrong text.
- Failed remote recording after a document edit must be recoverable without applying the edit twice.
- Resolved/deferred states must survive reopening; undo is an append-only reopening action.
- Narrow layout, keyboard use, literal rendering of untrusted text, and no automatic source-qualified claims.

### Task 1: Context-aware decisions and presentation
**Files:** backend schemas/models/repository/API, Alembic migration, development fixture/prompt, tests; Apps Script Code.js/Document.js.
**Interfaces:** context_snapshot_id on decisions; reopened/deferred dispositions; run response includes decisions. openReviewItem(id) freezes current context; completeReviewItem(id, action) verifies it and records; applyReviewSuggestion(id) returns a recoverable write receipt; finishReviewSuggestion() records after the Google save boundary; undoReviewAction(id) validates unchanged post-write content before reversing.
- [x] Test context-aware keep/correct/defer/reopen, owner separation, stale context, exact span and undo behavior.
- [x] Implement persistence and document operations, keeping old decision semantics.
- [x] Verify focused backend and add-on suites.

### Task 2: Compact sidebar
**Files:** Sidebar.html, Code.js, tests, local preview harness.
**Interfaces:** ordered presentation items include source, sourceContext, target, suggestion, summary, state. Server action return feeds the same queue renderer.
- [x] Replace long cards with one expanded item, separate checks/reviewed groups, concise actions and explicit Next.
- [x] Move sign-in/setup/experiments to secondary views; resume saved session and review on open.
- [x] Verify actual DOM interactions with the saved Chapter 9 example; check 300px layout visually.

### Task 3: Handoff
- [x] Review the diff independently; fix substantive findings.
- [x] Run appropriate regression checks, bump release version and notes, document install/testing results.
- [ ] Commit and push existing feature branch; update live add-on if signed-in access permits.

## Progress and implementation rulings
- User approved the design and asked to start; execute without a second plan-approval pause.
- Native Google Docs writes use the already-authorized current-document service. A document lock serializes add-on actions; exact text is revalidated immediately before mutation. It cannot lock human typing, so captured evidence is checked again after saving.
- Task 1/2 verification: 41 add-on tests pass, including real sidebar DOM interactions and lost-response action retries. Backend review suite: 133 passed, one fixture-builder mismatch fixed and its regression test passed, one optional PostgreSQL test skipped. SQLite migration round trip passes; frontend type checking passes.
- Ruling: fixture false-alarm exercises are labelled Practice checks, not random Spot checks, because they were deliberately selected. Live random samples keep the Spot checks label.
- Ruling: allow direct replacements only while the complete targeted paragraph still matches the original assessment. Changed paragraphs remain reviewable and manually editable; this deliberately trades convenience for avoiding guessed reattachment.
- Visual preview: the actual Sidebar.html is served beside an in-memory editable manuscript at http://127.0.0.1:8776. Expanded source, inline diff, Apply, Undo and explicit Next are visible; this is not a Google integration pass.
- Final review: independent reviewer found two Important issues, both fixed with failing-then-passing regression tests. Session expiry/401 retains recovery state, restored only after authentication as the same BITS owner. Use suggestion now retains the entered note through lost-response retries. All 42 add-on tests and all 134 backend review tests pass; one optional PostgreSQL integration test is skipped. SQLite migration round trip and PostgreSQL offline SQL generation pass. Release is 0.25.0.
- Final: minor (deferred): keyboard focus is not explicitly moved to Next after a successful action.
- Final: Ruling: reviewer could not verify native Google save timing or formatting serialization locally; retain exact-text checks and the two-call save boundary, and report native apply/undo as unverified until exercised in a disposable document. Cost if wrong: a partial edit would require manual recovery; no review decision is saved against mismatched text.
- Final: Ruling: deployed authentication remains a live integration check; session-renewal ownership and recovery are covered by unit tests. Cost if wrong: sign-in recovery might need operator assistance.
- Final: Ruling: provider output quality is outside this UI change and live AI remains disabled. Cost if wrong: future live suggestions could still need substantial human correction.
- Final: Ruling: no disposable PostgreSQL test database is configured; use the SQLite round trip and inspect PostgreSQL offline migration SQL, then observe the pilot deployment. Cost if wrong: deployment migration would fail before the new API becomes usable.
