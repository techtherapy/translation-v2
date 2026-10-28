# Book 300, Chapter 009 — Google Docs review pilot record

- Record prepared: 2026-09-21; deployment preparation updated 2026-10-28
- Pilot status: **partially run** — installation, Google authorization, and sidebar rendering observed; chapter review workflow not run
- Scope: maintainer-controlled Google Workspace Editor add-on test deployment; disposable Google document only
- Source fixture: Book 300, Chapter 009; English editorial status **unknown**
- Add-on version/commit used live: `a519bea`
- Browser and version: ChatGPT in-app browser; engine version unavailable
- First Google account type: organizational Google Workspace account; reviewed manifest scopes authorized
- Second Google account type: **not run**
- Disposable document and selected tab: Workspace-owned document `16WiBwR00yfUWpUMqvGYuVqwLdh3_q7JDWD1P8ZL_GNE`, selected `Tab 1`; Editor add-on test deployment opened and rendered its sidebar
- BITS HTTPS destination/configuration: `https://translation-production-188f.up.railway.app`; `/health` returned `{"status":"ok"}` on 2026-10-28; review enabled and live AI disabled
- BITS deployment/release identifier: Railway project `docs-review-pilot`, service `dbe37701-f64c-4386-8edc-8122d70f5a39`, source commit `edb074f`
- BITS account boundary: dedicated `pilot-reviewer` account created with the reviewer role; seeded `admin/admin` login disabled; replacement credentials stored in the maintainer's macOS Keychain and both roles verified on 2026-10-28
- Model and verified price schedule: **not run**
- Run limits and provider/account budget cap: **not run**
- Reviewer authorization timestamp: 2026-10-28T22:18:46+00:00

This record separates automated repository evidence from live Google Docs and human-review evidence. “Passed in an automated test” does not satisfy a live row. Unavailable or unperformed work remains **not run**.

## Automated evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Redacted experiment export keeps the allowlisted immutable contract, reproduces the frozen configuration identity, and removes seeded credentials at nested levels | passed | `backend/tests/test_docs_review_export.py` — 15 tests passed locally on 2026-09-22 |
| Export endpoint requires authentication and returns data only to the owning BITS user | passed | Same local suite; another authenticated user receives not found |
| Export CLI sends a bearer session only to an explicit HTTPS BITS origin and fails closed on HTTP/schema errors | passed | Same local suite; no network request left the test process |
| Affected review export, authentication, evaluation/knowledge, API, job and worker suites | passed | 112 focused backend tests passed locally on 2026-09-22 |
| Google Docs add-on behavior suite | passed | 29 Node tests passed locally on 2026-09-21; this is simulated Apps Script behavior, not a browser observation |
| Complete backend regression suite | previously passed; not repeated after the scoped export fix | 177 tests passed and 1 optional PostgreSQL integration test skipped on 2026-09-21; the final producer/schema changes were covered by the 112 focused tests above |

Automated tests used in-memory storage, fake queues/completion clients, and mock HTTP transport. They did not contact Google, Redis, a model provider, or a deployed BITS service and incurred no provider cost.

## Live Google Docs observations

| Required observation | Timestamp | Result | Observed behavior/error and evidence |
| --- | --- | --- | --- |
| Selected-document test deployment opens under the first account and consent scopes match the reviewed manifest | 2026-10-28T22:18:46+00:00 | passed | Workspace-owned disposable document opened through the selected-document dry run; Google authorization completed; **BITS · Chapter review** rendered with sign-in, preview, refresh, live-review, lesson, and experiment controls. No BITS credentials were entered and no chapter content was sent. |
| Empty-tab preview and explicit Chapter 9 load; nonempty-tab refusal | **not run** | **not run** | **not run** |
| Active and nested tab identity remains bound correctly | **not run** | **not run** | **not run** |
| Exact named-range selection after text is inserted or edited before the range | **not run** | **not run** | **not run** |
| Repeated quotations and supplementary characters select the intended occurrence without changing text or style | **not run** | **not run** | **not run** |
| Deleted or duplicated range blocks block use and require refresh/reassociation, with no fuzzy reattachment | **not run** | **not run** | **not run** |
| Paragraph split, merge, or moved text blocks block use and require refresh/reassociation, with no fuzzy reattachment | **not run** | **not run** | **not run** |
| Pending insertion, deletion, or style suggestion blocks the checkpoint | **not run** | **not run** | **not run** |
| Native accepted-preview content is not treated as reviewer approval | **not run** | **not run** | **not run** |
| Sidebar refresh resumes the saved owner-specific binding and run status | **not run** | **not run** | **not run** |
| Switching tab/document does not silently rebind an existing review | **not run** | **not run** | **not run** |
| Docs API denial fails closed | **not run** | **not run** | **not run** |
| Edit during read, after decision preview, and after submission preserves the recorded checkpoint meaning | **not run** | **not run** | **not run** |
| Sign-out and BITS HTTP 401 clear credential and current binding | **not run** | **not run** | **not run** |

## Account separation

| Check | Timestamp | Result | Evidence |
| --- | --- | --- | --- |
| Second personal Google account has distinct Apps Script UserProperties and a distinct BITS session | **not run** | **not run** | **not run** |
| Second BITS user creates and sees only its own review project | **not run** | **not run** | **not run** |
| Second BITS user cannot read the first user's project, decision, experiment, or export | **not run** | **not run** | **not run** |
| Neither account receives the other's JWT, document binding, or pending decision | **not run** | **not run** | **not run** |

## Live assessment and reviewer evidence

- Exact approved destination, model, price schedule and budget shown before enabling live AI: **not run**
- Provider/account-side cap confirmed: **not run**
- Worker and feature gates enabled for the selected deployment: web and worker services online; `DOCS_REVIEW_ENABLED=true`; `DOCS_REVIEW_LIVE_AI=false` on 2026-10-28
- Live assessment request timestamp and result: **not run**
- Experiment/export ID: **not run**
- Provider calls, tokens, reserved cost and actual cost: **not run**
- Flagged passages reviewed: **not run**
- Random unflagged sample reviewed: **not run**
- Naturally observed R1–R4 candidates: **not run**
- Naturally observed F1/F2 false-alarm cases: **not run**

### Exact review decision

- Reviewer and source-qualified status: **not run**
- Decision/item IDs: **not run**
- Source span(s): **not run**
- Target span(s): **not run**
- Before checkpoint ID and text: **not run**
- After checkpoint ID and text: **not run**
- Disposition and reviewer note: **not run**
- Reviewer inspection of exact source/before/after evidence: **not run**

### Review effort and adequacy

- Active review time for flags: **not run**
- Active review time for random sample: **not run**
- False alarms: **not run**
- Confirmed missed serious issues: **not run**
- Did highlighting reduce reviewer effort?: **not run**
- Basis for the effort judgment: **not run**
- Is random-audit and missed-error evidence sufficient, insufficient, or adverse?: **not run**
- Basis for the adequacy judgment: **not run**

## Held-out lesson comparison

- Eligible confirmed decision and lesson revision: **not run**
- Separate supplied passage IDs and provenance: **not run**
- Evidence that passages were excluded from development history: **not run**
- Source-qualified reference labels recorded before arm reveal: **not run**
- Frozen baseline/candidate configuration IDs: **not run**
- Blinded reviewer judgments and active time: **not run**
- Assessment conclusion (`inconclusive`, `regression`, or `candidate_for_larger_trial`): **not run**
- Generation result, if separately enabled: **not run**
- Actual result and limitations: **not run**

No lesson improvement is claimed. If there is no eligible confirmed lesson or no independently supplied material, this section remains **not run**.

## Pilot conclusion

- Google Docs add-on feasibility: **partial pass** — standalone test deployment, Google authorization, and sidebar rendering work in the Workspace account; chapter loading, highlighting, decisions, and learning remain untested
- Highlighting usefulness: **not run**
- Learning-system evidence: **not run**
- Security/account-isolation evidence: **not run**
- Decision on a larger trial: **not run**
- Open failures and follow-up work: sidebar sign-in, chapter loading, real reviewer decision, paid provider run, second account, and separate held-out lesson material are all **not run**.
