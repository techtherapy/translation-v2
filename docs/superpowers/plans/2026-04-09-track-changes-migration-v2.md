# Track Changes Migration v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the decoration-based track changes system with `@manuscripts/track-changes-plugin` so that deletions stay in the document and changes are tracked at the transaction level. This plan covers storage + editor/plugin integration only — margin rewrite, comment UX, and version history are separate workstreams.

**Architecture:** The `@manuscripts/track-changes-plugin` intercepts ProseMirror transactions and stores change metadata in `dataTracked` node/mark attributes. A TipTap extension wrapper integrates it into our per-segment editor. The save flow switches from plain text to ProseMirror JSON to preserve marks. A React bridge subscribes to plugin state changes so the UI always reflects current editor state.

**Tech Stack:** @manuscripts/track-changes-plugin 2.3.9, TipTap 2.11.5, ProseMirror, React 18, TypeScript

**Design Spec:** `docs/superpowers/specs/2026-04-08-notion-style-track-changes-design.md`

**Scope boundary:** This plan delivers the core migration: plugin integration, schema, persistence, rendering contract, and interim adaptation of the existing annotation margin to read from the plugin's ChangeSet (not a rewrite, but a functional adaptation). It does NOT include: full annotation margin rewrite, comment UX improvements, connector lines, version history sidebar, or seamless editing polish. Those are separate plans.

**Interim margin note:** Although the full margin rewrite is out of scope, this migration functionally adapts the existing `SegmentAnnotationMargin` — its diff-based card rendering is replaced with ChangeSet-driven rendering, and accept/reject buttons are rewired to dispatch plugin commands with immediate save. This is a meaningful adaptation, not a cosmetic touch, but it works within the existing component structure rather than redesigning the margin UI.

---

## Key Decisions (from design review feedback)

### 1. Plugin Schema Contract
The exact mark names, attribute shapes, and metadata conventions used by @manuscripts/track-changes-plugin are **not assumed** — they are validated in a spike task (Task 0) before any integration work begins. The spike produces a schema compatibility report that all subsequent tasks reference.

### 2. Persistence Contract
- `translated_text` stores serialized content. Its meaning depends on `content_format`.
- `content_format` is `'plain'` (default, legacy) or `'prosemirror'` (JSON with marks).
- `previous_text` is the **immutable plain-text baseline** owned by the **backend**. The invariant: when an update arrives with `content_format='prosemirror'` and `previous_text` is null, the backend captures the current clean plain-text `translated_text` before overwriting. It is never overwritten again. The frontend mirrors this optimistically but the server is the source of truth.
- Accept/reject operations trigger **immediate save** — they do not wait for the 2s auto-save timer. During this migration, the existing `SegmentAnnotationMargin` accept/reject buttons invoke plugin commands and then call `saveSegmentNow`. The margin rewrite (separate workstream) will refine this UI.
- The `translated_text` field name is kept (renaming a DB column across the stack is high risk). The API contract is documented explicitly: this field contains format-dependent content.

### 3. Legacy Content Strategy
- Existing plain-text translations stay as `content_format: 'plain'` indefinitely.
- When a user first edits a plain-text segment with tracking enabled, the content is **upgraded on first save**: converted to ProseMirror JSON with `content_format: 'prosemirror'`.
- No batch migration. Dual-format persistence is the steady state.
- Every consumer of `translated_text` must branch on `content_format`.

### 4. React Bridge for Editor State
Refs do not trigger re-renders. The plan uses an `onTransaction` callback to push `ChangeSet` snapshots from ProseMirror into React state. This ensures margin cards, counts, and accept/reject UI always reflect the current editor state without reading mutable refs during render.

### 5. Author ID Resolution
Change metadata stores `authorID` as a **string** (our numeric user ID normalized to string at the boundary). A `userMap: Record<string, string>` (string user ID → display name) is passed through EditorContext so all components can resolve IDs to names. The map is populated from chapter data (translation `updated_by` / `updated_by_username` fields) and current user. All lookups use string keys end-to-end — no implicit number↔string coercion.

### 6. onSaveRef / hasChangesRef
The ref-based save pattern in SegmentEditor is **kept** — it solves real timing issues with TipTap callbacks and unmount saves that are independent of the track changes architecture. The design spec will be updated to reflect this.

---

## Rendering Contract

Every consumer of `translated_text` must handle both formats. This table defines the contract:

| Consumer | `content_format: 'plain'` | `content_format: 'prosemirror'` |
|----------|--------------------------|--------------------------------|
| **SegmentEditor** (editing) | Load as HTML (`<p>text</p>`) | Load via `editor.commands.setContent(JSON.parse(...))` |
| **TranslationDisplay** (read-only, no TC) | Render as text with TextHighlighter | Strip marks from JSON, render clean text |
| **TranslationDisplay** (read-only, TC all-markup) | InlineDiff against `previous_text` | Parse JSON, render with tracked mark CSS classes |
| **TranslationDisplay** (read-only, TC original) | Show `previous_text` | Show `previous_text` (always plain) |
| **InlineDiff** | Diff `previous_text` vs `translated_text` | Diff `previous_text` vs clean text extracted from JSON |
| **VersionHistoryPanel** | Diff plain texts | Strip marks before diffing, show clean content changes |
| **FindReplaceBar** | Search plain text | Extract clean text from JSON for search |
| **ChangesPanel** | Diff-based hunks | Read from ChangeSet (or diff clean text in read-only mode) |
| **Backend search/export** | Use text directly | Must extract clean text (future task, not in this plan) |

**Helper functions:**
- `extractCleanText(translation)` — returns plain text regardless of format. For `'plain'`, returns `translated_text` directly. For `'prosemirror'`, parses JSON and walks the document tree applying the state matrix below.
- `extractCleanTextFromRaw(text: string, format: string)` — same logic but accepts raw string + format (used by VersionHistoryPanel for historical snapshots that aren't Translation objects).

**Clean text extraction state matrix:**

| Change status | Insert | Delete |
|--------------|--------|--------|
| **pending** | Include (text is proposed addition, visible to user) | Skip (text is proposed removal, should not appear in "clean" view) |
| **accepted** | Include (text is permanent) | Skip (text was removed) |
| **rejected** | Skip (text was discarded) | Include (text was restored to normal) |

This matrix governs `extractCleanText`, `InlineDiff` input, `FindReplaceBar` search, and `VersionHistoryPanel` diffing.

**Malformed JSON policy:**
- **Editor:** If JSON parse fails, fall back to empty editor with a console warning. The editor cannot render corrupt content.
- **Read-only display:** If JSON parse fails, show the raw `translated_text` as plain text with a subtle "content format error" indicator. Do not silently blank — this preserves visibility of possibly corrupt data.
- **Utilities:** `extractCleanText` returns the raw string on parse failure (not empty string). `parseTranslationContent` returns the raw string on parse failure.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `frontend/src/components/editor/TrackChangesExtension.ts` | TipTap extension wrapping @manuscripts plugin — exact schema from spike |
| `frontend/src/components/editor/__tests__/TrackChangesExtension.test.ts` | Unit tests for extension |
| `frontend/src/components/editor/__tests__/trackChangesIntegration.test.ts` | Behavioral integration tests (insert, delete, accept, reject, persist, reload) |
| `frontend/src/utils/translationContent.ts` | Content format utilities: `extractCleanText`, `parseTranslationContent`, `isJsonContent` |
| `frontend/src/utils/__tests__/translationContent.test.ts` | Tests for content utilities |

### Modified Files

| File | Change |
|------|--------|
| `frontend/src/components/editor/SegmentEditor.tsx` | Replace decoration plugin with TrackChangesExtension; dual-format save; `onTransaction` bridge |
| `frontend/src/hooks/useTrackChanges.ts` | Simplify — remove accept/reject/diff state |
| `frontend/src/hooks/__tests__/useTrackChanges.test.ts` | Rewrite for simplified API |
| `frontend/src/components/editor/TranslationDisplay.tsx` | Branch on `content_format` for all display modes |
| `frontend/src/components/editor/TranslationEditor.tsx` | Update save flow with format + immediate save on accept/reject; populate userMap |
| `frontend/src/components/editor/SegmentRow.tsx` | Pass changeSet + userMap; update onSave signature |
| `frontend/src/components/editor/EditorContext.tsx` | Add `userMap` to context |
| `frontend/src/components/editor/InlineDiff.tsx` | Accept clean text extraction for JSON content |
| `frontend/src/components/editor/VersionHistoryPanel.tsx` | Strip marks before diffing |
| `frontend/src/components/editor/FindReplaceBar.tsx` | Use `extractCleanText` for search |
| `frontend/src/api/translate.ts` | Add `content_format` to update params |
| `frontend/src/types/index.ts` | Add `content_format` to Translation interface |
| `frontend/src/index.css` | Add tracked mark CSS, keep old CSS until Task 8 |
| `frontend/package.json` | Add @manuscripts dependency, ProseMirror overrides |
| `backend/app/models/translation.py` | Add `content_format` column |
| `backend/app/schemas/book.py` | Add `content_format` to response schema |
| `backend/app/schemas/translation.py` | Add `content_format` to update request |
| `backend/app/core/database.py` | Migration for `content_format` |
| `backend/app/api/translate.py` | Accept `content_format` in update; respect format in version restore |

### Deleted Files (Task 8)

| File | Reason |
|------|--------|
| `frontend/src/components/editor/trackChangesDecoration.ts` | Replaced by TrackChangesExtension |

---

## Task 0: Plugin Validation Spike

**Goal:** Instantiate a minimal TipTap editor with `@manuscripts/track-changes-plugin`, discover the exact schema it expects, and verify that insert/delete/accept/reject round-trips work. Produce a schema compatibility report that all subsequent tasks reference.

**Files:**
- Modify: `frontend/package.json` (install plugin + ProseMirror overrides)
- Create: `frontend/src/components/editor/__tests__/trackChangesSpike.test.ts`

**Acceptance Criteria:**
- [ ] Plugin installed with ProseMirror deduplication verified
- [ ] A test creates a TipTap editor with the plugin, types text, deletes text, and verifies the document contains tracked marks
- [ ] The exact mark/attribute names the plugin uses are documented in the test file as comments
- [ ] Accept and reject commands work and produce the expected document state
- [ ] The persisted JSON shape (from `editor.getJSON()`) is captured and documented
- [ ] Test passes: the plugin does not crash, marks are created, accept/reject resolve correctly

**Verify:** `cd frontend && npx vitest run src/components/editor/__tests__/trackChangesSpike.test.ts`

**Steps:**

- [ ] **Step 1: Install plugin with ProseMirror dedup**

Add to `frontend/package.json`:
```json
{
  "dependencies": {
    "@manuscripts/track-changes-plugin": "^2.3.9"
  },
  "overrides": {
    "prosemirror-model": "1.25.4",
    "prosemirror-state": "1.4.4",
    "prosemirror-transform": "1.11.0",
    "prosemirror-view": "1.38.1"
  }
}
```

Run:
```bash
cd frontend && rm -rf node_modules package-lock.json && npm install
```

- [ ] **Step 2: Write the spike test**

```typescript
// frontend/src/components/editor/__tests__/trackChangesSpike.test.ts
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  trackChangesPlugin,
  trackChangesPluginKey,
  trackCommands,
  TrackChangesStatus,
  CHANGE_STATUS,
  ChangeSet,
} from '@manuscripts/track-changes-plugin'
import { Extension } from '@tiptap/core'

/**
 * SPIKE: Discover the exact schema and behavior of @manuscripts/track-changes-plugin.
 *
 * This test file serves as documentation of what the plugin actually does.
 * All subsequent tasks reference these findings.
 */

// Minimal extension wrapper for the spike
const SpikeTrackChanges = Extension.create({
  name: 'spikeTrackChanges',

  // The plugin requires 'dataTracked' on tracked node types.
  // Let's discover what happens with and without it.
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          dataTracked: { default: null },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      trackChangesPlugin({
        userID: 'test-user',
        initialStatus: TrackChangesStatus.enabled,
      }),
    ]
  },
})

function createTestEditor(content = '<p>Hello world</p>') {
  return new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      SpikeTrackChanges,
    ],
    content,
  })
}

describe('@manuscripts/track-changes-plugin spike', () => {
  it('creates an editor with the plugin active', () => {
    const editor = createTestEditor()
    const state = trackChangesPluginKey.getState(editor.state)
    expect(state).toBeTruthy()
    expect(state!.status).toBe(TrackChangesStatus.enabled)
    expect(state!.userID).toBe('test-user')
    editor.destroy()
  })

  it('tracks text insertion', () => {
    const editor = createTestEditor('<p>Hello</p>')
    // Move cursor to end and type
    editor.commands.focus('end')
    editor.commands.insertContent(' world')

    const state = trackChangesPluginKey.getState(editor.state)
    const changeSet = state!.changeSet
    console.log('[SPIKE] After insert - changes:', JSON.stringify(changeSet.changes, null, 2))
    console.log('[SPIKE] After insert - textChanges:', JSON.stringify(changeSet.textChanges, null, 2))
    console.log('[SPIKE] After insert - JSON:', JSON.stringify(editor.getJSON(), null, 2))

    // Document should contain tracked insert
    expect(changeSet.changes.length).toBeGreaterThan(0)
    editor.destroy()
  })

  it('tracks text deletion', () => {
    const editor = createTestEditor('<p>Hello world</p>')
    // Select "world" and delete
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 7, to: 12 }) // "world"
    editor.commands.deleteSelection()

    const state = trackChangesPluginKey.getState(editor.state)
    const changeSet = state!.changeSet
    console.log('[SPIKE] After delete - changes:', JSON.stringify(changeSet.changes, null, 2))
    console.log('[SPIKE] After delete - textChanges:', JSON.stringify(changeSet.textChanges, null, 2))
    console.log('[SPIKE] After delete - JSON:', JSON.stringify(editor.getJSON(), null, 2))

    // Document should still contain "world" as tracked deletion
    const text = editor.state.doc.textContent
    console.log('[SPIKE] After delete - doc textContent:', text)
    expect(text).toContain('world') // Text stays in document!
    expect(changeSet.changes.length).toBeGreaterThan(0)
    editor.destroy()
  })

  it('accepts a change', () => {
    const editor = createTestEditor('<p>Hello</p>')
    editor.commands.focus('end')
    editor.commands.insertContent(' world')

    const state = trackChangesPluginKey.getState(editor.state)
    const changes = state!.changeSet.changes
    expect(changes.length).toBeGreaterThan(0)

    // Accept the change
    const changeIds = changes.map(c => c.dataTracked.id)
    console.log('[SPIKE] Change IDs to accept:', changeIds)
    const cmd = trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, changeIds)
    cmd(editor.state, editor.view.dispatch)

    const stateAfter = trackChangesPluginKey.getState(editor.state)
    console.log('[SPIKE] After accept - changes:', JSON.stringify(stateAfter!.changeSet.changes, null, 2))
    console.log('[SPIKE] After accept - text:', editor.state.doc.textContent)

    // After accept, change should be resolved
    expect(editor.state.doc.textContent).toContain('Hello world')
    editor.destroy()
  })

  it('rejects a change', () => {
    const editor = createTestEditor('<p>Hello</p>')
    editor.commands.focus('end')
    editor.commands.insertContent(' world')

    const state = trackChangesPluginKey.getState(editor.state)
    const changes = state!.changeSet.changes
    const changeIds = changes.map(c => c.dataTracked.id)
    const cmd = trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, changeIds)
    cmd(editor.state, editor.view.dispatch)

    const stateAfter = trackChangesPluginKey.getState(editor.state)
    console.log('[SPIKE] After reject - text:', editor.state.doc.textContent)
    console.log('[SPIKE] After reject - JSON:', JSON.stringify(editor.getJSON(), null, 2))

    // After reject, inserted text should be removed
    expect(editor.state.doc.textContent).toBe('Hello')
    editor.destroy()
  })

  it('documents the exact JSON shape persisted', () => {
    const editor = createTestEditor('<p>Hello world</p>')
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.commands.deleteSelection()
    editor.commands.focus('end')
    editor.commands.insertContent(' universe')

    const json = editor.getJSON()
    console.log('[SPIKE] Full JSON with tracked changes:', JSON.stringify(json, null, 2))

    // Document what the marks look like
    const doc = editor.state.doc
    const marks: string[] = []
    doc.descendants((node) => {
      if (node.marks?.length) {
        for (const mark of node.marks) {
          marks.push(`${mark.type.name}: ${JSON.stringify(mark.attrs)}`)
        }
      }
      return true
    })
    console.log('[SPIKE] Marks found in document:', marks)

    // Document node attributes
    doc.descendants((node) => {
      if (node.attrs?.dataTracked) {
        console.log(`[SPIKE] Node ${node.type.name} dataTracked:`, JSON.stringify(node.attrs.dataTracked))
      }
      return true
    })

    editor.destroy()
  })

  it('verifies round-trip: save JSON, create new editor, changes preserved', () => {
    // Create editor, make tracked changes
    const editor1 = createTestEditor('<p>Hello world</p>')
    editor1.commands.focus()
    editor1.commands.setTextSelection({ from: 7, to: 12 })
    editor1.commands.deleteSelection()

    // Save the JSON
    const savedJson = editor1.getJSON()
    editor1.destroy()

    // Create new editor from saved JSON
    const editor2 = createTestEditor()
    editor2.commands.setContent(savedJson)

    // Verify changes are preserved
    const state = trackChangesPluginKey.getState(editor2.state)
    console.log('[SPIKE] After reload - changes:', state?.changeSet.changes.length)
    console.log('[SPIKE] After reload - text:', editor2.state.doc.textContent)

    // The deleted text should still be in the document
    expect(editor2.state.doc.textContent).toContain('world')
    editor2.destroy()
  })

  it('discovers mark names used by the plugin', () => {
    const editor = createTestEditor('<p>Hello world</p>')

    // Check what marks exist in the schema
    const markNames = Object.keys(editor.schema.marks)
    console.log('[SPIKE] Schema mark names:', markNames)

    // Check what node attributes exist
    const nodeTypes = Object.keys(editor.schema.nodes)
    for (const name of nodeTypes) {
      const spec = editor.schema.nodes[name].spec
      if (spec.attrs && 'dataTracked' in spec.attrs) {
        console.log(`[SPIKE] Node '${name}' has dataTracked attribute`)
      }
    }

    editor.destroy()
  })
})
```

- [ ] **Step 3: Run the spike and capture output**

```bash
cd frontend && npx vitest run src/components/editor/__tests__/trackChangesSpike.test.ts --reporter=verbose 2>&1 | tee /tmp/spike-output.txt
```

Read the console output carefully. The [SPIKE] logs reveal:
- Exact mark names the plugin creates (may NOT be `tracked_insert`/`tracked_delete`)
- Exact JSON shape of `dataTracked` attributes
- Whether `getJSON()` preserves all change metadata
- Whether creating a new editor from saved JSON restores changes

- [ ] **Step 4: Document findings**

Add a comment block at the top of the spike test file documenting:
- Exact mark names used by the plugin
- Exact attribute structure of `dataTracked`
- Any schema requirements that weren't obvious from the type definitions
- Any behavioral surprises

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/editor/__tests__/trackChangesSpike.test.ts
git commit -m "spike: validate @manuscripts/track-changes-plugin schema and behavior"
```

**IMPORTANT:** If ANY test fails or the plugin behaves unexpectedly, STOP and report findings. Do not proceed to Task 1 with assumptions. The spike output is the source of truth for all subsequent tasks.

---

## Task 1: Content Format Utilities

**Goal:** Create utility functions for handling dual-format content (`'plain'` and `'prosemirror'`). These are used by every consumer of `translated_text`.

**IMPORTANT: Spike dependency.** The `extractCleanText` implementation includes provisional logic for identifying deleted/inserted content by inspecting `dataTracked.operation` and `dataTracked.status`. The exact attribute names, mark structures, and operation values **must be updated** to match the spike findings from Task 0 before this code is finalized. Do not ship the placeholder logic without validating against the actual plugin output.

**Files:**
- Create: `frontend/src/utils/translationContent.ts`
- Create: `frontend/src/utils/__tests__/translationContent.test.ts`

**Acceptance Criteria:**
- [ ] `extractCleanText(translation)` returns plain text for both formats
- [ ] `parseTranslationContent(translation)` returns either string or ProseMirror JSON object
- [ ] `isJsonContent(translation)` returns boolean
- [ ] For `'prosemirror'` format, `extractCleanText` walks the JSON tree and skips nodes/marks with delete operations
- [ ] Handles edge cases: null content, empty string, malformed JSON (returns raw string as fallback, not empty)
- [ ] All functions have unit tests including malformed input

**Verify:** `cd frontend && npx vitest run src/utils/__tests__/translationContent.test.ts`

**Steps:**

- [ ] **Step 1: Write tests first**

```typescript
// frontend/src/utils/__tests__/translationContent.test.ts
import { describe, it, expect } from 'vitest'
import { extractCleanText, parseTranslationContent, isJsonContent } from '../translationContent'

describe('translationContent utilities', () => {
  describe('isJsonContent', () => {
    it('returns false for plain format', () => {
      expect(isJsonContent({ content_format: 'plain', translated_text: 'hello' } as any)).toBe(false)
    })
    it('returns true for prosemirror format', () => {
      expect(isJsonContent({ content_format: 'prosemirror', translated_text: '{}' } as any)).toBe(true)
    })
    it('returns false for undefined format', () => {
      expect(isJsonContent({ translated_text: 'hello' } as any)).toBe(false)
    })
  })

  describe('extractCleanText', () => {
    it('returns text directly for plain format', () => {
      expect(extractCleanText({ content_format: 'plain', translated_text: 'Hello world' } as any)).toBe('Hello world')
    })

    it('returns empty string for null/undefined text', () => {
      expect(extractCleanText({ content_format: 'plain', translated_text: '' } as any)).toBe('')
      expect(extractCleanText({ translated_text: null } as any)).toBe('')
    })

    it('returns raw string for malformed JSON (does not silently blank)', () => {
      expect(extractCleanText({ content_format: 'prosemirror', translated_text: 'not json' } as any)).toBe('not json')
    })

    it('extracts text from ProseMirror JSON, excluding deleted nodes', () => {
      // This test will use the actual JSON shape discovered in the spike
      // For now, test the basic structure
      const json = JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Hello ' },
              { type: 'text', text: 'world' }, // This would have delete marks — exact shape from spike
            ],
          },
        ],
      })
      const result = extractCleanText({ content_format: 'prosemirror', translated_text: json } as any)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('parseTranslationContent', () => {
    it('returns string for plain format', () => {
      const result = parseTranslationContent({ content_format: 'plain', translated_text: 'hello' } as any)
      expect(result).toBe('hello')
    })

    it('returns parsed object for prosemirror format', () => {
      const json = JSON.stringify({ type: 'doc', content: [] })
      const result = parseTranslationContent({ content_format: 'prosemirror', translated_text: json } as any)
      expect(typeof result).toBe('object')
      expect((result as any).type).toBe('doc')
    })

    it('returns raw string for malformed JSON', () => {
      const result = parseTranslationContent({ content_format: 'prosemirror', translated_text: 'bad' } as any)
      expect(result).toBe('bad')
    })
  })
})
```

- [ ] **Step 2: Implement the utilities**

```typescript
// frontend/src/utils/translationContent.ts
import type { Translation } from '../types'

// NOTE: The exact mark/attribute names used by @manuscripts/track-changes-plugin
// are documented in __tests__/trackChangesSpike.test.ts from the spike results.
// Update the constants below if the spike reveals different values.
const DELETE_OPERATION = 'delete'
const INSERT_OPERATION = 'insert'

/**
 * Check if a translation uses ProseMirror JSON format.
 */
export function isJsonContent(translation: Pick<Translation, 'content_format' | 'translated_text'>): boolean {
  return translation.content_format === 'prosemirror'
}

/**
 * Parse translation content into its native format.
 * Returns string for plain, parsed JSON object for prosemirror.
 * Returns raw string on parse failure (does not silently blank).
 */
export function parseTranslationContent(translation: Pick<Translation, 'content_format' | 'translated_text'>): string | Record<string, any> {
  if (!translation.translated_text) return ''
  if (!isJsonContent(translation)) return translation.translated_text

  try {
    return JSON.parse(translation.translated_text)
  } catch {
    return translation.translated_text // Return raw string, not empty
  }
}

/**
 * Extract clean plain text from a translation, regardless of content_format.
 * For 'prosemirror' format, walks the JSON tree applying the state matrix:
 *   - pending/accepted deletes: SKIP (text removed or proposed removal)
 *   - rejected deletes: INCLUDE (text restored)
 *   - pending/accepted inserts: INCLUDE (text visible or permanent)
 *   - rejected inserts: SKIP (text discarded)
 * Returns raw string on parse failure (does not silently blank).
 */
export function extractCleanText(translation: Pick<Translation, 'content_format' | 'translated_text'>): string {
  if (!translation.translated_text) return ''
  if (!isJsonContent(translation)) return translation.translated_text

  try {
    const doc = JSON.parse(translation.translated_text)
    return extractTextFromNode(doc)
  } catch {
    return translation.translated_text // Return raw string, not empty
  }
}

/**
 * Same as extractCleanText but accepts raw string + format.
 * Used by VersionHistoryPanel for historical snapshots.
 */
export function extractCleanTextFromRaw(text: string, format: string): string {
  if (!text) return ''
  if (format !== 'prosemirror') return text

  try {
    const doc = JSON.parse(text)
    return extractTextFromNode(doc)
  } catch {
    return text // Return raw string, not empty
  }
}

/**
 * Recursively extract text from a ProseMirror JSON node, skipping deleted content.
 */
function extractTextFromNode(node: any): string {
  if (!node) return ''

  // Skip nodes excluded by the state matrix
  if (shouldExcludeNode(node)) return ''

  // Text node — check marks
  if (node.type === 'text') {
    if (node.marks?.some((m: any) => shouldExcludeMark(m))) return ''
    return node.text || ''
  }

  // Recurse into children
  if (node.content && Array.isArray(node.content)) {
    const parts = node.content.map(extractTextFromNode)
    // Add newline between block-level nodes
    if (node.type === 'doc') return parts.join('\n')
    return parts.join('')
  }

  return ''
}

/**
 * Should this node's text be EXCLUDED from clean text?
 * Exclusion rules (from state matrix):
 *   - pending delete: EXCLUDE
 *   - accepted delete: EXCLUDE
 *   - rejected insert: EXCLUDE
 * Everything else (pending insert, accepted insert, rejected delete, untracked): INCLUDE
 *
 * NOTE: Exact attribute names are PROVISIONAL — must be updated from spike findings.
 */
function shouldExcludeNode(node: any): boolean {
  if (!node.attrs?.dataTracked) return false
  const tracked = Array.isArray(node.attrs.dataTracked) ? node.attrs.dataTracked : [node.attrs.dataTracked]
  return tracked.some((t: any) =>
    (t.operation === DELETE_OPERATION && (t.status === 'pending' || t.status === 'accepted')) ||
    (t.operation === INSERT_OPERATION && t.status === 'rejected')
  )
}

function shouldExcludeMark(mark: any): boolean {
  if (!mark.attrs?.dataTracked) return false
  const tracked = Array.isArray(mark.attrs.dataTracked) ? mark.attrs.dataTracked : [mark.attrs.dataTracked]
  return tracked.some((t: any) =>
    (t.operation === DELETE_OPERATION && (t.status === 'pending' || t.status === 'accepted')) ||
    (t.operation === INSERT_OPERATION && t.status === 'rejected')
  )
}
```

- [ ] **Step 3: Run tests**

```bash
cd frontend && npx vitest run src/utils/__tests__/translationContent.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/translationContent.ts src/utils/__tests__/translationContent.test.ts
git commit -m "feat: add content format utilities for dual-format translation content"
```

---

## Task 2: Backend — Add content_format Column + API Support

**Goal:** Add `content_format` field to the Translation and TranslationVersion models. Update API to accept and return it. Ensure version restore respects the field.

**Files:**
- Modify: `backend/app/models/translation.py`
- Modify: `backend/app/schemas/book.py`
- Modify: `backend/app/schemas/translation.py`
- Modify: `backend/app/core/database.py`
- Modify: `backend/app/api/translate.py`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/translate.ts`

**Acceptance Criteria:**
- [ ] `translations` table has `content_format VARCHAR(20) DEFAULT 'plain'`
- [ ] `translation_versions` table has `content_format VARCHAR(20) DEFAULT 'plain'`
- [ ] API returns `content_format` in translation responses
- [ ] API accepts `content_format` in update requests
- [ ] Version creation captures `content_format` from the translation
- [ ] Version restore sets `content_format` from the version being restored
- [ ] Frontend `Translation` type includes `content_format?: 'plain' | 'prosemirror'`
- [ ] Frontend `updateTranslation` accepts `content_format`

**Verify:** Backend starts without errors; `cd frontend && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Add column to models**

In `backend/app/models/translation.py`, add to `Translation`:
```python
content_format: Mapped[str] = mapped_column(String(20), default="plain")
```

Add to `TranslationVersion`:
```python
content_format: Mapped[str] = mapped_column(String(20), default="plain")
```

- [ ] **Step 2: Add migration**

In `backend/app/core/database.py` `_run_migrations()`:
```python
await _add_column(conn, 'translations', 'content_format', "VARCHAR(20) DEFAULT 'plain'")
await _add_column(conn, 'translation_versions', 'content_format', "VARCHAR(20) DEFAULT 'plain'")
```

- [ ] **Step 3: Update schemas**

In `backend/app/schemas/book.py` `TranslationResponse`:
```python
content_format: str = "plain"
```

In `backend/app/schemas/translation.py` update request schema, add:
```python
content_format: str | None = None
```

- [ ] **Step 4: Update API endpoints**

In `backend/app/api/translate.py` update translation endpoint — add `content_format` support AND the `previous_text` invariant:
```python
# previous_text invariant: capture immutable baseline BEFORE switching format
# or overwriting content. This only fires on the first transition to prosemirror.
# At this point, existing stored content is guaranteed to be legacy plain text
# (content_format was 'plain'), so direct assignment is correct.
if (data.content_format == 'prosemirror'
    and translation.previous_text is None
    and translation.translated_text):
    translation.previous_text = translation.translated_text

# Now apply the format and content changes
if data.content_format:
    translation.content_format = data.content_format
```

This replaces the existing `previous_text` capture logic (lines 734-752 in the current file) with a simpler, format-aware rule. The old logic checked `bt.track_changes` via a chain of DB lookups; the new logic uses `content_format` which is already in the request. The baseline is captured BEFORE any fields are mutated.

In version creation (same file), capture format:
```python
version = TranslationVersion(
    translation_id=translation.id,
    version_number=max_version + 1,
    translated_text=translation.translated_text,
    content_format=translation.content_format,  # Add this
    status=translation.status,
    created_by=user.id,
)
```

In version restore, set format:
```python
translation.content_format = version.content_format
```

- [ ] **Step 5: Update frontend types**

In `frontend/src/types/index.ts` Translation interface:
```typescript
content_format?: 'plain' | 'prosemirror'
```

In `frontend/src/api/translate.ts` updateTranslation params:
```typescript
params: { translated_text: string; status?: string; previous_text?: string | null; content_format?: string }
```

- [ ] **Step 6: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git add -A && git commit -m "feat: add content_format to Translation model and API"
```

---

## Task 3: Create TipTap TrackChanges Extension

**Goal:** Create the TipTap extension that wraps @manuscripts/track-changes-plugin, using the exact schema discovered in the spike.

**Files:**
- Create: `frontend/src/components/editor/TrackChangesExtension.ts`
- Create: `frontend/src/components/editor/__tests__/TrackChangesExtension.test.ts`
- Modify: `frontend/src/index.css`

**Acceptance Criteria:**
- [ ] Extension uses exact mark names and attribute shapes from the spike
- [ ] Extension is configurable with `{ enabled, userID }`
- [ ] Returns no plugins when `enabled: false`
- [ ] CSS styles tracked insertions (green underline) and deletions (red strikethrough)
- [ ] Exports `getChangeSet(editorState)` helper
- [ ] Exports plugin key, commands, types for use by other components

**Verify:** `cd frontend && npx vitest run src/components/editor/__tests__/TrackChangesExtension.test.ts && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Read the spike results** and note exact mark names and attribute structures.

- [ ] **Step 2: Create the extension** using the spike-validated schema. The exact code depends on spike findings, but the structure follows:
  - Extension wraps `trackChangesPlugin` in `addProseMirrorPlugins`
  - `addGlobalAttributes` adds `dataTracked` to paragraph/block nodes
  - Mark definitions for tracked insert/delete (names from spike)
  - `getChangeSet` helper function
  - Re-exports of plugin key, commands, types

- [ ] **Step 3: Add CSS**

```css
/* Track changes marks — names from spike validation */
.tc-insert-mark {
  @apply text-green-700 underline decoration-green-500 decoration-1 underline-offset-2;
}
.dark .tc-insert-mark {
  @apply text-green-400 decoration-green-400;
}
.tc-delete-mark {
  @apply text-red-700/60 line-through decoration-1 decoration-red-500/70;
}
.dark .tc-delete-mark {
  @apply text-red-400/60 decoration-red-400/70;
}
```

- [ ] **Step 4: Write tests** that verify the extension creates and configures correctly. Include a behavioral test that creates an editor with the extension, makes edits, and verifies marks appear.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/TrackChangesExtension.ts src/components/editor/__tests__/TrackChangesExtension.test.ts src/index.css
git commit -m "feat: create TipTap TrackChanges extension wrapping @manuscripts plugin"
```

---

## Task 4: Integrate Extension into SegmentEditor

**Goal:** Replace `TrackChangesDecoration` with the new `TrackChangesExtension` in SegmentEditor. Add the `onTransaction` React bridge to push ChangeSet snapshots into React state. Save as ProseMirror JSON when tracking is active.

**Files:**
- Modify: `frontend/src/components/editor/SegmentEditor.tsx`

**Acceptance Criteria:**
- [ ] `TrackChangesDecoration` replaced with `TrackChangesExtension` + tracked marks
- [ ] When tracking enabled: deletions stay in document as marked text
- [ ] `onTransaction` callback pushes `ChangeSet` snapshots to parent via a new `onChangeSetUpdate` prop
- [ ] Save outputs ProseMirror JSON (`editor.getJSON()`) when tracking active, plain text when not
- [ ] `onSave` passes `content_format` alongside text
- [ ] Content loads correctly for both `'plain'` and `'prosemirror'` formats
- [ ] Malformed ProseMirror JSON falls back to an empty editor with a console warning (not a crash)
- [ ] `onSaveRef` / `hasChangesRef` pattern preserved for auto-save timing
- [ ] Old decoration code (baseline updates, REBUILD_META) removed from this file

**Verify:** `cd frontend && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Update imports**

Remove `TrackChangesDecoration` and `trackChangesPluginKey` from old file.
Add imports from `TrackChangesExtension`.

- [ ] **Step 2: Update Props interface**

```typescript
interface Props {
  translation: Translation
  onSave: (text: string, format?: 'plain' | 'prosemirror') => Promise<void> | void
  autoSave?: boolean
  autoSaveDelay?: number
  trackingEnabled?: boolean
  onSaveStatusChange?: (status: SaveStatus) => void
  onSelectionChange?: (selection: EditorSelectionInfo | null) => void
  onChangeSetUpdate?: (changeSet: ChangeSet | null) => void
  comments?: SegmentComment[]
}
```

Note: `previousText` prop is removed — the plugin manages its own baseline.

- [ ] **Step 3: Update useEditor extensions**

Replace the `TrackChangesDecoration.configure(...)` with:
```typescript
TrackChangesExtension.configure({
  enabled: !!trackingEnabled,
  userID: String(currentUserId),
}),
TrackedInsertMark,  // Or whatever mark names the spike reveals
TrackedDeleteMark,
```

- [ ] **Step 4: Update content loading**

```typescript
content: translation.content_format === 'prosemirror' && translation.translated_text
  ? (() => { try { return JSON.parse(translation.translated_text) } catch { return '' } })()
  : translation.translated_text
    ? `<p>${translation.translated_text.replace(/\n/g, '</p><p>')}</p>`
    : '',
```

- [ ] **Step 5: Add onTransaction bridge**

In the `useEditor` config, add:
```typescript
onTransaction: ({ editor: ed }) => {
  if (!trackingEnabled) return
  const state = trackChangesPluginKey.getState(ed.state)
  onChangeSetUpdateRef.current?.(state?.changeSet ?? null)
},
```

Add a ref for the callback:
```typescript
const onChangeSetUpdateRef = useRef(onChangeSetUpdate)
onChangeSetUpdateRef.current = onChangeSetUpdate
```

- [ ] **Step 6: Update save format**

In `onUpdate`, determine format based on tracking state:
```typescript
const tcState = trackChangesPluginKey.getState(ed.state)
const isTracking = tcState?.status === TrackChangesStatus.enabled
latestTextRef.current = isTracking
  ? JSON.stringify(ed.getJSON())
  : ed.getText({ blockSeparator: '\n' })
latestFormatRef.current = isTracking ? 'prosemirror' : 'plain'
```

Add `latestFormatRef`:
```typescript
const latestFormatRef = useRef<'plain' | 'prosemirror'>('plain')
```

Update `doSave` and unmount save to pass format:
```typescript
await onSaveRef.current(latestTextRef.current, latestFormatRef.current)
```

- [ ] **Step 7: Remove old decoration code**

Remove:
- The `previousText` prop handling
- The `useEffect` that dispatched baseline updates
- Any references to `TrackChangesDecoration`

- [ ] **Step 8: Verify**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git commit -m "feat: integrate @manuscripts track changes plugin into SegmentEditor"
```

---

## Task 5: Update Save Flow + Immediate Save on Accept/Reject

**Goal:** Update TranslationEditor's save flow to pass `content_format`. Add `saveSegmentNow` callback that triggers immediate save (bypassing auto-save timer) for accept/reject operations. Define `previous_text` lifecycle.

**Files:**
- Modify: `frontend/src/components/editor/TranslationEditor.tsx`
- Modify: `frontend/src/components/editor/SegmentRow.tsx`
- Modify: `frontend/src/components/editor/EditorContext.tsx`

**Acceptance Criteria:**
- [ ] `handleSaveTranslation` accepts and passes `content_format`
- [ ] `previous_text` is owned by the backend (Task 2 enforces the invariant). Frontend mirrors optimistically: when `content_format` transitions to `'prosemirror'`, the frontend sets `previous_text` in local state for immediate UI feedback. The server is the source of truth.
- [ ] After accept/reject operations, save is triggered immediately (not waiting 2s)
- [ ] `EditorContext` includes `userMap: Record<string, string>` for author name resolution (string keys end-to-end)
- [ ] `userMap` is populated from chapter data + current user

**Verify:** `cd frontend && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Update handleSaveTranslation**

```typescript
const handleSaveTranslation = useCallback(async (
  translationId: number,
  text: string,
  format?: 'plain' | 'prosemirror'
) => {
  try {
    const result = await updateTranslation(translationId, {
      translated_text: text,
      status: 'draft',
      content_format: format || 'plain',
    })
    setChapter((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        segments: prev.segments.map((seg) => ({
          ...seg,
          translations: seg.translations.map((t) => {
            if (t.id !== translationId) return t
            // Capture previous_text exactly once: when format transitions to prosemirror
            const shouldCapturePrevText = format === 'prosemirror' && !t.previous_text && t.content_format !== 'prosemirror'
            return {
              ...t,
              translated_text: result.translated_text,
              status: result.status as any,
              content_format: format || t.content_format,
              previous_text: shouldCapturePrevText ? t.translated_text : t.previous_text,
            }
          }),
        })),
      }
    })
  } catch (err) {
    showError(err)
    throw err
  }
}, [selectedLanguageId])
```

Note: `trackingEnabled` removed from deps — not needed.

- [ ] **Step 2: Add saveSegmentNow callback**

```typescript
const saveSegmentNow = useCallback(() => {
  segmentEditorRef.current?.save()
}, [])
```

This is passed down to SegmentRow → SegmentAnnotationMargin for use after accept/reject.

- [ ] **Step 3: Add userMap to EditorContext**

In `EditorContext.tsx`, add:
```typescript
userMap: Record<string, string>  // string user ID → display name
```

In TranslationEditor, build the map (normalizing numeric IDs to strings at the boundary):
```typescript
const userMap = useMemo(() => {
  const map: Record<string, string> = {}
  if (user) map[String(user.id)] = user.username || user.email || `User ${user.id}`
  if (chapter) {
    for (const seg of chapter.segments) {
      for (const t of seg.translations) {
        if (t.updated_by && t.updated_by_username) {
          map[String(t.updated_by)] = t.updated_by_username
        }
      }
    }
  }
  return map
}, [user, chapter])
```

- [ ] **Step 4: Update SegmentRow onSave signature**

```typescript
onSaveTranslation: (translationId: number, text: string, format?: 'plain' | 'prosemirror') => Promise<void>
```

Update the inline `onSave`:
```typescript
onSave={(text, format) => translation
  ? onSaveTranslation(translation.id, text, format)
  : onCreateTranslation(segment.id, text, format)
}
```

- [ ] **Step 5: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git commit -m "feat: update save flow for content_format + immediate save on accept/reject"
```

---

## Task 6: Update All Content Consumers

**Goal:** Update every component that reads `translated_text` to branch on `content_format` using the utilities from Task 1.

**Files:**
- Modify: `frontend/src/components/editor/TranslationDisplay.tsx`
- Modify: `frontend/src/components/editor/InlineDiff.tsx`
- Modify: `frontend/src/components/editor/VersionHistoryPanel.tsx`
- Modify: `frontend/src/components/editor/FindReplaceBar.tsx`

**Acceptance Criteria:**
- [ ] `TranslationDisplay` renders clean text for JSON content in non-editing modes
- [ ] `InlineDiff` diffs `previous_text` against clean text extracted from JSON
- [ ] `VersionHistoryPanel` strips marks before diffing versions
- [ ] `FindReplaceBar` searches clean text for JSON content
- [ ] All consumers handle malformed JSON gracefully (raw string fallback with error indicator in read-only views)

**Verify:** `cd frontend && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Update TranslationDisplay**

Import `extractCleanText` from `../../utils/translationContent`.

For read-only modes, use `extractCleanText(translation)` instead of `translation.translated_text` directly. The rendering contract table in this document specifies exact behavior per mode.

- [ ] **Step 2: Update InlineDiff**

When called with JSON content, extract clean text first:
```typescript
const newText = isJsonContent(translation) ? extractCleanText(translation) : translation.translated_text
// Then diff previous_text vs newText as before
```

- [ ] **Step 3: Update VersionHistoryPanel**

Before diffing, extract clean text from both versions:
```typescript
const currentClean = extractCleanText(currentTranslation)
const versionClean = version.content_format === 'prosemirror'
  ? extractCleanTextFromRaw(version.translated_text, version.content_format || 'plain')
  : version.translated_text
const diff = dmp.diff_main(versionClean, currentClean)
```

- [ ] **Step 4: Update FindReplaceBar**

Use `extractCleanText` when building the searchable text for each segment.

- [ ] **Step 5: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git commit -m "feat: update all content consumers to handle dual-format content"
```

---

## Task 7: Simplify useTrackChanges Hook

**Goal:** Remove accept/reject/diff state from the hook. It now only manages toggle and display mode.

**Files:**
- Rewrite: `frontend/src/hooks/useTrackChanges.ts`
- Rewrite: `frontend/src/hooks/__tests__/useTrackChanges.test.ts`
- Modify: `frontend/src/components/editor/TranslationEditor.tsx` (use simplified hook)

**Acceptance Criteria:**
- [ ] Hook manages: `trackingEnabled`, `displayMode` only
- [ ] `activeHunkIdx`, `handleAcceptChange`, `handleRejectChange` removed
- [ ] `hasVisibleChanges` removed (consumers check ChangeSet directly)
- [ ] Tests updated for simplified interface

**Verify:** `cd frontend && npx vitest run src/hooks/__tests__/useTrackChanges.test.ts && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Rewrite hook** with only toggle/display state management (see simplified version in this document's file structure).

- [ ] **Step 2: Rewrite tests** for the smaller API surface.

- [ ] **Step 3: Update TranslationEditor** to remove destructured values that no longer exist.

- [ ] **Step 4: Verify and commit**

```bash
cd frontend && npx vitest run src/hooks/__tests__/useTrackChanges.test.ts && npx tsc --noEmit
git commit -m "refactor: simplify useTrackChanges — plugin handles change operations"
```

---

## Task 8: Remove Old Decoration Code

**Goal:** Delete `trackChangesDecoration.ts` and all remaining references. Clean up old CSS.

**Files:**
- Delete: `frontend/src/components/editor/trackChangesDecoration.ts`
- Modify: `frontend/src/index.css` (remove old `.tc-insertion`, `.tc-deletion`, `.tc-collapsed-p`)
- Modify: any files with stale imports

**Acceptance Criteria:**
- [ ] `trackChangesDecoration.ts` deleted
- [ ] No imports of `TrackChangesDecoration` remain
- [ ] Old `.tc-insertion`, `.tc-deletion`, `.tc-collapsed-p` CSS removed
- [ ] New `.tc-insert-mark`, `.tc-delete-mark` CSS retained
- [ ] `diff-match-patch` only imported in read-only consumers (diffUtils, InlineDiff, VersionHistoryPanel, ChangesPanel)
- [ ] All tests pass, TypeScript compiles

**Verify:** `cd frontend && npx tsc --noEmit && npx vitest run`

**Steps:**

- [ ] **Step 1: Delete old file**

```bash
rm frontend/src/components/editor/trackChangesDecoration.ts
```

- [ ] **Step 2: Remove old CSS** from `index.css`

- [ ] **Step 3: Grep for stale references**

```bash
grep -r "TrackChangesDecoration\|trackChangesDecoration\|tc-insertion\b\|tc-deletion\b\|tc-collapsed\|REBUILD_META" frontend/src/ --include="*.ts" --include="*.tsx" --include="*.css"
```

Fix any remaining.

- [ ] **Step 4: Verify and commit**

```bash
cd frontend && npx tsc --noEmit && npx vitest run
git commit -m "chore: remove old decoration-based track changes system"
```

---

## Task 9: Integration Tests

**Goal:** Write behavioral integration tests that verify the end-to-end track changes flow. These test the hard failure modes, not just type correctness.

**Files:**
- Create: `frontend/src/components/editor/__tests__/trackChangesIntegration.test.ts`

**Acceptance Criteria:**
- [ ] Test: delete text → text stays in document with strikethrough mark
- [ ] Test: insert text → text has insertion mark
- [ ] Test: save to JSON → reload from JSON → pending changes preserved
- [ ] Test: accept deletion → text actually removed from document
- [ ] Test: reject insertion → inserted text removed
- [ ] Test: toggle tracking on a plain-text segment → first edit upgrades to JSON
- [ ] Test: load malformed JSON → graceful fallback (no crash)
- [ ] Test: extractCleanText on document with tracked deletes → deletes excluded

**Verify:** `cd frontend && npx vitest run src/components/editor/__tests__/trackChangesIntegration.test.ts`

**Steps:**

- [ ] **Step 1: Write integration tests**

These build on the spike test patterns but use the production extension (TrackChangesExtension) and verify:
- Round-trip persistence (save JSON, create new editor, changes preserved)
- Accept/reject resolve to correct document state
- Clean text extraction excludes deleted content
- Legacy plain text content loads correctly in tracked editor
- Malformed JSON handling

Each test creates a real TipTap editor (in jsdom), makes edits, and verifies the document state.

- [ ] **Step 2: Run and verify**

```bash
cd frontend && npx vitest run src/components/editor/__tests__/trackChangesIntegration.test.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "test: add behavioral integration tests for track changes migration"
```

---

## Post-Migration Verification Checklist

After all tasks are complete, manually verify:

- [ ] Toggle track changes on for a BookTranslation
- [ ] Edit text — deleted text stays in place with red strikethrough
- [ ] Inserted text shows green with underline
- [ ] Paragraph spacing preserved when deleting across paragraph boundaries
- [ ] No text fragmentation during typing (the decoration-era bug is gone)
- [ ] Auto-save fires and preserves marks (reload page, marks still present)
- [ ] Accept a change — text becomes permanent or removed
- [ ] Reject a change — insertion removed, deletion restored
- [ ] Accept/reject triggers immediate save (not delayed)
- [ ] Toggle track changes off — editing returns to normal
- [ ] Legacy plain-text segments render correctly
- [ ] First tracked edit on a plain-text segment upgrades to JSON format
- [ ] `previous_text` captured on first tracked save
- [ ] Read-only InlineDiff shows correct diff against `previous_text`
- [ ] Version history loads and diffs correctly for both formats
- [ ] Find/replace works for both content formats
- [ ] Comments still work (create, reply, resolve, emoji reactions)
- [ ] No console errors during normal operation
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` all tests pass

---

## Reconciliation Notes

The design spec (`2026-04-08-notion-style-track-changes-design.md`) should be updated to reflect:
1. `onSaveRef` / `hasChangesRef` are **kept** in SegmentEditor (they solve real timing issues independent of track changes)
2. `previous_text` lifecycle is: captured once on first tracked save, never updated, used only for read-only InlineDiff
3. Accept/reject triggers immediate save, not auto-save timer
4. Content format is a permanent dual-format system (no batch migration planned)
