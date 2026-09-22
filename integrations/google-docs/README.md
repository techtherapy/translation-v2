# BITS Google Docs review prototype

A standalone Apps Script **Editor add-on** for a maintainer's personal Google account. It loads Book 300, Chapter 9 into an explicitly selected empty test tab, shows six analyst examples, and records private BITS review decisions against immutable checkpoints. It does not run an AI model, edit native suggestions, approve shared knowledge, or replace manuscript wording.

## Set up a personal-account test deployment

1. Run the backend migration and enable `DOCS_REVIEW_ENABLED=true` on the configured BITS deployment. Use an active BITS account with `translations.edit` permission. The account owns the review project it creates; other BITS users cannot read or mutate it.
2. Create a **standalone** project at [Apps Script](https://script.google.com/). Copy `Code.js`, `Api.js`, `Document.js`, and `ReviewState.js` into script files with the same names (the editor may display `.gs`), and `Sidebar.html` into an HTML file named `Sidebar`.
3. In project settings, show the manifest and replace it with `appsscript.json`. Enable the **Google Docs API v1** advanced service (`Docs`). If using a standard Cloud project, also enable the Google Docs API in that project. No installable triggers are required.
4. Review `BITS_BASE_URL`, `BITS_ALLOWED_BASE_URLS`, and the manifest's `urlFetchWhitelist` together. The default is the existing Railway deployment. To use a different deployment, a maintainer must edit all three; only exact HTTPS origins are accepted. Redirects are refused, including for login. No URL is accepted from a sidebar input.
5. Use **Deploy → Test deployments**, choose the **Editor add-on** test type, select a test document, and choose the appropriate installed/enabled authorization state. Run that test deployment. See Google's [Editor add-on testing instructions](https://developers.google.com/workspace/add-ons/how-tos/testing-editor-addons). Test the installed and enabled states as part of Task 6.
6. In the document, open **Extensions → BITS review → Open BITS review** (the menu grouping uses your script's deployment name). Authorize Google access, then separately sign in to **BITS** in the sidebar. Google authorization does not sign you in to BITS.
7. Select an empty document tab, choose **Preview chapter**, inspect the visible English preview and tab ID, then choose **Load chapter**. This is the sole manuscript-writing action. A tab with any existing text, whitespace, table or embedded object is refused. An existing exact copy of the supplied chapter can instead use **Review supplied chapter already in this tab**, which writes only review metadata and named ranges.
8. Click a card's title to select its exact named range. Edit wording manually in Docs, then choose the disposition, add a note, and click **Preview decision**. Inspect the full old/new chapter and both checkpoint IDs before clicking **Record decision**. A changed chapter blocks ordinary approvals. **Corrected** requires a changed checkpoint and explicit confirmation. An audit issue requires a source-grounded note.

Only maintainers should have permission to edit this test script. An editor can change code executed with the user's Google authorization or intercept a later BITS sign-in. A personal test deployment is a development trust boundary, not a public distribution mechanism. Do not give untrusted reviewers script-edit access to make testing easier.

## Manifest scopes

| Scope | Purpose |
| --- | --- |
| `https://www.googleapis.com/auth/documents.currentonly` | Read the open document's tab, create named ranges, select passages, and explicitly load the supplied chapter into an empty tab. |
| `https://www.googleapis.com/auth/documents.readonly` | Read Docs API content with all tab content and inline suggestions for the current document ID. This OAuth scope permits reading other Docs, although this code only requests the active document. |
| `https://www.googleapis.com/auth/script.container.ui` | Display the Editor menu and HTML sidebar. |
| `https://www.googleapis.com/auth/script.external_request` | Send HTTPS requests to the reviewed BITS origin, including the existing form-based login endpoint. |

There is no Drive discovery scope, Drive listing, native suggestion write scope, background trigger, or credential logging. The advanced Docs read is mandatory: a failure blocks the checkpoint rather than using accepted-preview text. See Google's [tab guide](https://developers.google.com/apps-script/guides/docs/tabs), [suggestions guide](https://developers.google.com/workspace/docs/api/how-tos/suggestions), and [URL allowlist reference](https://developers.google.com/apps-script/manifest/allowlist-url).

## Session and evidence handling

- Only the returned expiring BITS JWT is retained as an authentication credential, in **UserProperties**. Passwords are never stored and the password input clears before the request starts. Model keys are never requested. Neither document nor script properties are used. Sign-out, expiry, and HTTP 401 remove the token and current review/decision binding. Raw HTTP bodies and transport errors are not surfaced or logged.
- A small user-specific binding stores document/tab/project/run/checkpoint IDs and unique named-range IDs. A pending decision stores a nonce, IDs, explicit disposition and note until submission, refresh, or sign-out. Notes allow up to 5,000 characters, subject to the serialized UTF-8 property-size limit; multibyte or heavily escaped notes may need shortening. The full pending payload is checked before any checkpoint is created, with 36 bytes reserved for the backend checkpoint UUID and a 9,000-byte ceiling below the 9 KB property limit. The text checkpoints themselves live in the owner-only BITS backend. Switching tabs or documents does not rebind the review.
- Named ranges use the `bits-review:` prefix and their returned unique IDs. Full-paragraph anchors guard structural identity; exact quote ranges guard selection and duplicate-quote occurrence. Deleted, duplicate, moved, split or merged anchors block use with a refresh/reassociation message. There is no fuzzy reattachment. To reassociate an unchanged supplied chapter, explicitly preview it and start another example review. An edited or structurally altered chapter requires a fresh assessment workflow; do not overwrite it to reuse examples.
- A fresh checkpoint compares DocumentApp text before and after the Docs API read, checks canonical paragraph text agreement, and inspects insertions, deletions and style suggestions. Tables, footnotes, headers, footers and embedded content are outside this prototype's chapter scope and block checkpoints. Only the bound tab is assessed.
- The event certifies the reviewed checkpoint, not future document state. Confirmation checks the document again against the displayed checkpoint. Network retries of the same decision use the same request ID. A successful submission refreshes the sidebar; later typing remains a new revision. Google does not offer an atomic lock against concurrent human edits here, so an edit after the last read does not change the recorded event's meaning.
- The packaged fixture is byte-identical to the Task 1 golden fixture. `GET /api/docs-review/development-fixture` is authenticated, feature-gated and read-only. Every card retains `analyst_development_example` and `human_confirmed: false`. The English approval status is unknown. No production translation, glossary, style rule, golden example or approved lesson is created by fetching/loading/deciding these examples.
- `POST /api/docs-review/projects/{id}/runs` currently accepts `mode: "fixture"` only. It freezes the fixture and snapshot, creates four findings and two audit checks, and returns their database IDs synchronously with zero provider calls/cost. It requires exact supplied source, block IDs and English text; it cannot pretend to reassess edited text. `mode: "live"` returns 409 until Task 4 implements live review. Provenance is frozen in the run bundle and explicitly referenced by each item.

## Verification and remaining live checks

```sh
cd backend && .venv/bin/python -m pytest tests/test_docs_review_api.py -q
cd .. && node --test integrations/google-docs/tests/*.test.cjs
```

The Node tests load the same global production functions with `vm`; there are no CommonJS exports in Apps Script files. They validate pure state logic and mocked service contracts. They do **not** prove real Google authorization, menu installation, range survival, selection behavior, suggestion permissions, or canonical-text agreement.

Task 6 must use a personal account to verify: authorization and consent scopes; active and nested tabs; actual named-range representation including blank paragraphs; exact selection without style/text changes; supplementary characters and repeated quotes; missing/duplicated ranges; paragraph split/merge; pending insertion/deletion/style suggestions; Docs API denial; an edit during read/after preview/after submission; two Google users with distinct BITS sessions; sign-out/401; and refusal to load a nonempty tab. Preserve the original manuscript and test only in a disposable document. Public Marketplace publication is not part of this task.
