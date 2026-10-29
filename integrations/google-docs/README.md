# BITS Google Docs review prototype

A standalone Apps Script **Editor add-on** for a maintainer's personal Google account. The document holds the manuscript; the sidebar shows a compact queue of review points. Live AI review is a separate, default-off pilot. The Book 300, Chapter 9 practice review uses six prepared examples and makes no provider calls.

## Simplified review flow

Open a point to select its passage and see the Chinese source, a short reason, and any suggested wording. **Use suggestion** applies the exact change to the document. **Keep wording** records that the current passage is acceptable. Edit the document yourself and choose **Done editing**, or choose **Do later**. **Next** is explicit so the changed passage stays visible.

Reviewed points are collapsed. **Undo** reverses an applied suggestion only while its passage still matches; **Reopen** keeps the current wording and returns the point to review. Later edits to a reviewed passage make it pending again. Paragraph splits, merges, missing anchors, or native Google suggestions require resolving the document structure before continuing.

Actions retain the original assessment, the context opened by the reviewer, and the reviewed text. A failed save can be retried without applying the edit twice. Dismissing a pending save keeps the document as it is and reloads the recorded review state. Feedback is stored automatically; reusable lessons still require an explicit scoped proposal and confirmation.

Run `node integrations/google-docs/preview.cjs` from the repository root and open `http://127.0.0.1:8776` for a local interaction preview. It uses the actual sidebar with an in-memory document adapter; it creates no Google or backend records. The preview is not evidence of Google Docs integration success.

## Set up a personal-account test deployment

1. Run the backend migration and enable `DOCS_REVIEW_ENABLED=true` on the configured BITS deployment. Use an active BITS account with `translations.edit` permission. The account owns the review project it creates; other BITS users cannot read or mutate it.
2. Create a **standalone** project at [Apps Script](https://script.google.com/). Copy `Code.js`, `Api.js`, `Document.js`, and `ReviewState.js` into script files with the same names (the editor may display `.gs`), and `Sidebar.html` into an HTML file named `Sidebar`.
3. In project settings, show the manifest and replace it with `appsscript.json`. Enable the **Google Docs API v1** advanced service (`Docs`). If using a standard Cloud project, also enable the Google Docs API in that project. No installable triggers are required.
4. Review `BITS_BASE_URL`, `BITS_ALLOWED_BASE_URLS`, and the manifest's `urlFetchWhitelist` together. The default is the existing Railway deployment. To use a different deployment, a maintainer must edit all three; only exact HTTPS origins are accepted. Redirects are refused, including for login. No URL is accepted from a sidebar input.
5. Use **Deploy → Test deployments**, choose the **Editor add-on** test type, select a test document, and choose the appropriate installed/enabled authorization state. Run that test deployment. See Google's [Editor add-on testing instructions](https://developers.google.com/workspace/add-ons/how-tos/testing-editor-addons). Test the installed and enabled states as part of Task 6.
6. In the document, open **Extensions → BITS review → Open BITS review** (the menu grouping uses your script's deployment name). Authorize Google access, then separately sign in to **BITS** in the sidebar. Google authorization does not sign you in to BITS.
7. Under **Review settings**, choose **Set up example chapter**. In an empty test tab, preview the English and choose **Load chapter**. After Google finishes saving, choose **Review supplied chapter already in this tab**. You can also start with an existing exact copy of the supplied chapter. Loading refuses any existing text or embedded structure.
8. Open a point and follow the simplified flow above. The source appears in the expanded item. A practice or spot-check issue needs a note explaining what you found. An already bound older fixture retains its frozen examples; start a new example review on an unchanged copy to see the updated concise examples and opening-sentence suggestion.

Only maintainers should have permission to edit this test script. An editor can change code executed with the user's Google authorization or intercept a later BITS sign-in. A personal test deployment is a development trust boundary, not a public distribution mechanism. Do not give untrusted reviewers script-edit access to make testing easier.

## Manifest scopes

| Scope | Purpose |
| --- | --- |
| `https://www.googleapis.com/auth/documents.currentonly` | Read the open tab, anchor/select passages, apply or undo an explicit suggestion, and load the supplied chapter into an empty tab. |
| `https://www.googleapis.com/auth/documents.readonly` | Read Docs API content with all tab content and inline suggestions for the current document ID. This OAuth scope permits reading other Docs, although this code only requests the active document. |
| `https://www.googleapis.com/auth/script.container.ui` | Display the Editor menu and HTML sidebar. |
| `https://www.googleapis.com/auth/script.external_request` | Send HTTPS requests to the reviewed BITS origin, including the existing form-based login endpoint. |

There is no Drive discovery scope, Drive listing, native suggestion write scope, background trigger, or credential logging. The advanced Docs read is mandatory: a failure blocks the checkpoint rather than using accepted-preview text. See Google's [tab guide](https://developers.google.com/apps-script/guides/docs/tabs), [suggestions guide](https://developers.google.com/workspace/docs/api/how-tos/suggestions), and [URL allowlist reference](https://developers.google.com/apps-script/manifest/allowlist-url).

## Session and evidence handling

- Only the returned expiring BITS JWT is retained as an authentication credential, in **UserProperties**. Passwords are never stored and the password input clears before the request starts. Model keys are never requested. Neither document nor script properties are used. Explicit sign-out removes all BITS session and recovery data. Expiry and HTTP 401 remove only the token; the same authenticated BITS account can resume a pending save. Signing in as a different account clears the previous private state. Raw HTTP bodies and transport errors are not surfaced or logged.
- A small user-specific binding stores document/tab/project/run/checkpoint IDs and unique named-range IDs. A pending decision stores a nonce, IDs, explicit disposition and note until submission, refresh, or sign-out. Notes allow up to 5,000 characters, subject to the serialized UTF-8 property-size limit; multibyte or heavily escaped notes may need shortening. The full pending payload is checked before any checkpoint is created, with 36 bytes reserved for the backend checkpoint UUID and a 9,000-byte ceiling below the 9 KB property limit. The full checkpoints live in the owner-only BITS backend. One-click actions additionally retain a bounded before/after passage and formatting receipt in UserProperties for recovery and Undo; oversized receipts are refused before writing. Switching tabs or documents does not rebind the review.
- Named ranges use the `bits-review:` prefix and their returned unique IDs. Full-paragraph anchors guard structural identity; exact quote ranges guard selection and duplicate-quote occurrence. Deleted, duplicate, moved, split or merged anchors block use with a refresh/reassociation message. There is no fuzzy reattachment. To reassociate an unchanged supplied chapter, explicitly preview it and start another example review. Edited passages remain openable through their paragraph anchors, but no automatic replacement is offered for a changed paragraph. Structural changes require a fresh assessment workflow; do not overwrite them to reuse examples.
- A fresh checkpoint compares DocumentApp text before and after the Docs API read, checks canonical paragraph text agreement, and inspects insertions, deletions and style suggestions. Tables, footnotes, headers, footers and embedded content are outside this prototype's chapter scope and block checkpoints. Only the bound tab is assessed.
- The event certifies the reviewed checkpoint, not future document state. Confirmation checks the document again against the displayed checkpoint. Network retries of the same decision use the same request ID. A successful submission refreshes the sidebar; later typing remains a new revision. Google does not offer an atomic lock against concurrent human edits here, so an edit after the last read does not change the recorded event's meaning.
- The packaged fixture is byte-identical to the Task 1 golden fixture. `GET /api/docs-review/development-fixture` is authenticated, feature-gated and read-only. Every card retains `analyst_development_example` and `human_confirmed: false`. The English approval status is unknown. No production translation, glossary, style rule, golden example or approved lesson is created by fetching/loading/deciding these examples.
- `POST /api/docs-review/projects/{id}/runs` preserves synchronous `mode: "fixture"`. It freezes the fixture and snapshot, creates four findings and two audit checks, and returns their database IDs synchronously with zero provider calls/cost. It requires exact supplied source, block IDs and English text; it cannot pretend to reassess edited text. `mode: "live"` requires the separately enabled pilot described below. Provenance is frozen in the run bundle and explicitly referenced by each item.

## Live review pilot

Both `DOCS_REVIEW_ENABLED` and `DOCS_REVIEW_LIVE_AI` default to false. Before enabling live review, an operator must configure the selected provider's API key, an **actual provider/account-side spend cap**, and a versioned price schedule. Model credentials saved through BITS settings are hydrated by both web startup and ARQ worker startup. Restart the worker after changing credentials; the web settings writer still applies changes immediately in its own process.

Configure these deployment environment values explicitly:

- `DOCS_REVIEW_ACCOUNT_SPEND_LIMIT_CONFIRMED=true` only after configuring the real provider/account-side cap.
- `DOCS_REVIEW_ACCOUNT_SPEND_LIMIT_USD` is the pilot's total conservative reservation ceiling, in USD.
- `DOCS_REVIEW_PRICE_SCHEDULES` is a JSON map keyed by the normalized LiteLLM model name. Each value requires `id`, `input_per_million`, and `output_per_million`. Enter verified rates for that exact model and account. No automatic price lookup or default price is used. Example **shape only**, not real pricing: `{"provider/exact-model":{"id":"verified-schedule-date","input_per_million":1.0,"output_per_million":2.0}}`.
- Server ceilings default to `DOCS_REVIEW_MAX_INPUT_TOKENS=24000`, `DOCS_REVIEW_MAX_OUTPUT_TOKENS=4000`, and `DOCS_REVIEW_MAX_COST_USD=1`. Every live request must also supply an explicit model and all three run-local limits.

Run a separate worker process with `arq app.worker.config.WorkerSettings`, using the same database, Redis, and pilot configuration as the web process. No worker or add-on deployment is performed by this implementation. The existing translation spike remains registered.

After binding the supplied source chapter in the add-on, expand **Live review of the current chapter**, choose the model and limits, optionally supply chapter guidance, and start the review. The add-on captures the current translation as a new checkpoint. Source and target text plus only the explicit guidance enter the prompt; analyst fixture cards, proposed lessons, and held-out examples are never automatically added. The live API also supports owner-created projects independently of the fixture.

A run freezes the full short chapter, guidance IDs/content, exact prompt and schema version, model, price schedule, limits, audit seed, and the complete selected completion request. A conservative UTF-8 byte bound plus message overhead refuses over-limit input rather than truncating it. The frozen request includes response format, output limit, retry count, timeout, temperature (0), top-p (1), one non-streaming result, and explicit nulls for optional stop/seed/penalty values. The worker passes a copy of those saved options directly to the completion client and uses the saved timeout for its call deadline and lease. Runtime default changes affect only newly created runs. Older queued runs without complete request evidence fail visibly without a call; their options are never reconstructed. The worker reserves the maximum input/output cost before making one completion call, with automatic retries disabled. The shared database setting `DOCS_REVIEW_PILOT_RESERVED_USD` serializes total reservations across runs and workers; it is not automatically refunded, even when a response is invalid, interrupted, or lost. An operator must reconcile provider accounting before intentionally raising the pilot ceiling. These are estimates, so the independently configured provider/account cap remains necessary.

States are `pending_enqueue`, `queued`, `running`, `succeeded`, `failed`, and `interrupted`. A queue outage leaves a saved, visible request with **Retry queue delivery**. Queued requests unconfirmed for five minutes become retryable on status read. Retries reuse `docs-review:<run ID>`. When ARQ refuses enqueue because a terminal result is retained, the retry removes only that redundant result-cache entry and attempts the same ID again; database run evidence remains authoritative. A `None` enqueue result without confirmed acceptance stays visibly pending and retryable instead of being reported as queued. The worker conditionally acquires one lease before calling the provider. Expired running leases, cancellations, and uncertain provider failures become interrupted and never auto-call again. Redelivery of a completed run returns its stored result. Late provider output is retained privately without reviving the run or creating findings.

The sidebar polls at 1, 2, 4, 8, then at most 15 seconds while open and visible, and stops on completion, failure, interruption, retryable queue state, network error, sign-out, or closing/hiding the sidebar. Refresh resumes status checks. At presentation, each point shows whether its passage changed. An edit after a review decision returns that passage to the queue; completion does not overwrite a newer checkpoint or change text/styles. A lost submission response, HTTP timeout/server error, or unreadable success response preserves the same request ID and frozen options for retry. Positive integer token limits and a positive finite cost limit are validated before checkpoint creation. Definitive request rejection (including validation error 422) releases the rejected pending request so corrected options can start a new action; HTTP 401 pauses the session while retaining recovery state for the same account.

A successful assessment produces human-review candidates and a separately counted random audit, never a clean-chapter certification. Every finding passes strict schema and exact quotation/evidence-ID grounding checks against the frozen bundle. Full-chapter coverage must be reported; invalid JSON, incomplete/truncated output, and invented spans/references fail the whole run. Raw model output remains private database evidence and is omitted from the live status API. The audit uses sorted unique nonempty unflagged blocks, a local seeded random generator, and a persisted population, seed, requested count, actual count, and selected IDs. Default count is three or all remaining eligible blocks if fewer. Unflagged passages, including audit samples, remain unreviewed until an explicit human decision. This sample is a workflow pilot setting, not a production quality guarantee.

## Verification and remaining live checks

```sh
cd backend && .venv/bin/python -m pytest tests/test_docs_review_assessment.py tests/test_docs_review_jobs.py tests/test_docs_review_api.py tests/test_runtime_settings.py tests/test_worker.py -q
cd .. && node --test integrations/google-docs/tests/*.test.cjs
```

The Node tests load the same global production functions with `vm`; there are no CommonJS exports in Apps Script files. They validate pure state logic and mocked service contracts. They do **not** prove real Google authorization, menu installation, range survival, selection behavior, suggestion permissions, or canonical-text agreement.

Task 6 must use a personal account to verify: authorization and consent scopes; active and nested tabs; actual named-range representation including blank paragraphs; exact selection without style/text changes; supplementary characters and repeated quotes; missing/duplicated ranges; paragraph split/merge; pending insertion/deletion/style suggestions; Docs API denial; an edit during read/after preview/after submission; two Google users with distinct BITS sessions; sign-out/401; and refusal to load a nonempty tab. Preserve the original manuscript and test only in a disposable document. Public Marketplace publication is not part of this task.

### Personal-account pilot procedure

Use `docs/experiments/book-300-chapter-009-pilot.md` as the evidence record. Do not convert an automated result into a live pass. Before opening Apps Script or enabling live AI, record the exact add-on commit, browser/version, personal Google account type, disposable document, BITS HTTPS origin, deployment identifier, model, verified price schedule, run-local token/cost limits, provider-side cap, and total pilot ceiling. The reviewer must approve that exact destination, model, and budget before a paid call. Keep `DOCS_REVIEW_LIVE_AI=false` until those values are recorded and approved.

1. Create a disposable Google document owned by the first personal Google account. Do not use the original manuscript. Create a standalone Apps Script project from the reviewed commit, restrict script-edit access to the maintainer, and make a selected-document Editor add-on test deployment. Record the deployment ID only in a private operator field; it is not part of the experiment export.
2. Verify the requested consent scopes against `appsscript.json`. Open the sidebar, sign in to BITS separately, and run the fixture demonstration first. The fixture has zero provider calls. Confirm the tab preview before loading Chapter 9 into an empty tab.
3. Exercise each row in the pilot record: selection after edits before the range, repeated quotations including supplementary characters, deletion, paragraph split/merge, pending insertion/deletion/style suggestions, sidebar refresh, tab switching, sign-out/401, Docs API denial, and refusal of a nonempty tab. Record a timestamp and the observed result or error for every attempt.
4. From the fixture or an authorized live assessment, record at least one real reviewer decision. Inspect the exact source spans, target spans, before checkpoint, after checkpoint, disposition, note, and IDs in BITS. The analyst cards remain development examples and are not established errors.
5. Sign out. Open the same deployment with a second personal Google account and a distinct BITS user. Verify its UserProperties session is separate, its project is separately owned, and it receives `404` for the first user's private experiment/export ID. Do not share JWTs or script-edit access between accounts.
6. Only after the recorded authorization, start the worker and enable the live gate. Run the exact pre-approved model and limits once. Review every flag plus the selected random audit passages, record false alarms and missed issues, and stop if the saved reservation reaches the pilot ceiling. Do not retry an interrupted or uncertain paid experiment.
7. A confirmed lesson may be tested only on separately supplied passages with a source-qualified reference judgment created before arm results are shown. Record regression or insufficient evidence as the result when applicable. If no eligible decision or separate material exists, leave the lesson comparison **not run**.
8. Save a report revision, then export the immutable owner-scoped experiment. The export includes source and target passages, prompts, model settings, outputs, usage, labels, exclusions, and report conclusions. It omits BITS JWTs, provider credentials, worker lease tokens, and reviewer account IDs, but the manuscript and model output are still sensitive and must remain in private storage.

Obtain a short-lived BITS JWT through the normal `/api/auth/login` flow and place it in an environment variable without echoing it. The CLI refuses non-HTTPS origins, redirects, malformed schemas, authentication errors, and accidental overwrites:

```sh
cd backend
BITS_ACCESS_TOKEN='short-lived-token' .venv/bin/python scripts/export_docs_review_experiment.py \
  EXPERIMENT_ID ../private-pilot-exports/book-300-009-experiment.json \
  --base-url https://review-backend.example
```

Use `--token-file /private/path/token.txt` instead of the environment variable when local policy requires it. Do not pass the JWT as a command-line value. Delete the token file after the export. The endpoint is feature-gated and owner-scoped; another authenticated BITS user receives the same not-found response as an unknown experiment.

## Scoped lessons and blinded experiments (Task 5)

Recording **Corrected** remains a local checkpoint decision. **Propose scoped guidance** is a separate action; **Keep this decision local** creates no lesson. A proposal requires source/target languages, a construction or concept, a positive example, a counterexample, and an explicit edition restriction (possibly none). Unresolved questions, unexplained decisions, and edits outside the exact finding occurrence cannot seed guidance. Empty guidance returns “no reusable lesson.” Drafting is human-authored; no AI lesson-drafting call is made.

The proposal shows its exact content hash, decision/item/source/before/after evidence, and potentially overlapping confirmed guidance. Confirmation checks the displayed hash and requires a resolution note for each conflict. Refinement creates a new proposed revision without changing its predecessor. Nothing activates shared knowledge. Copy a lesson ID to reopen it or select it explicitly in an experiment.

**Freeze paired experiment** saves a separate source passage and its supplied translation, complete model options, prompts, languages, guidance, limits, prices, audit settings, and selected confirmed lesson revisions. Client baseline/candidate configurations must be identical: the server adds only selected lessons to the candidate. Selecting none restores the same baseline configuration. Optional draft generation is a separate structured call and quality outcome; it does not receive the supplied translation or assessment findings.

The cost ceiling covers both arms and all examples, including generation. **Run or retry queue delivery** explicitly starts the gated worker, which reserves the entire budget before any call and durably records each attempt before dispatch. Responses and actual token usage are retained. Queue retries reuse one job ID; a started experiment never retries after failure, expiry, cancellation, or uncertain completion. Late output remains private evidence and cannot revive an interrupted experiment.

Chapter 9, reviewed source chapters, lesson evidence, supplied guidance examples, explicit development sources, and previously labeled passages are exclusions. Exact normalized/substring overlap is rejected for heldouts; fuzzy high overlap requires manual review and reclassification as development or exclusion. Original strings and match reasons are retained. Historical guidance and explicit development sources from every earlier experiment remain excluded even if its outputs were never run or labeled. Execution reloads current source chapters and all historical exclusions before reserving budget. Any newly contaminated passage is recorded as excluded from heldout results without changing the frozen inputs or earlier reports. Similarity screening does not establish semantic independence. Development examples may be exercised but never count toward independent evaluation.

Each example requires an authenticated, source-qualified reference review before either arm's outputs appear. Reference labels then become immutable. Review anonymous A/B outputs, recording false alarms, links to reference serious issues, inspected random audits, and active time. Start/pause controls exclude pauses, hidden time, and inactivity beyond 60 seconds; missing timing stays unknown. The first judgment reveals that example's arm identity. Later judgments are append-only unblinded amendments, excluded from blinded conclusions.

**Save a new report revision** retains earlier reports and labels. Reports separate assessment misses, false alarms, time, audit/flag coverage, and optional generation quality. Unknown labels stay unknown. Arm-specific output counts for unjudged examples are withheld to preserve blinding. Conclusions concern assessment only: `inconclusive`, `regression`, or `candidate_for_larger_trial`, never production readiness. Each report records configuration IDs, exclusions, label IDs, authenticated reviewer attribution, and usage/reservation information. Per-example reference issues and judgment history remain available in the owner-only response.

Offline verification:

```sh
cd backend && .venv/bin/python -m pytest tests/test_docs_review_learning.py tests/test_docs_review_evaluation.py -q
cd .. && node --test integrations/google-docs/tests/*.test.cjs
```

Only fake completion clients and queues were used. Real Google, Redis, provider, and account behavior remains a separately authorized smoke test.
