# Track Changes Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the decoration-based track changes system (diff-match-patch + ProseMirror decorations) with `@manuscripts/track-changes-plugin` so that deletions stay in the document and changes are tracked at the transaction level.

**Architecture:** The `@manuscripts/track-changes-plugin` intercepts ProseMirror transactions and stores change metadata in `dataTracked` node/mark attributes. A TipTap extension wrapper integrates it into our per-segment editor. The save flow switches from plain text to ProseMirror JSON to preserve marks. The annotation margin reads changes from the plugin's `ChangeSet` instead of computing diffs.

**Tech Stack:** @manuscripts/track-changes-plugin 2.3.9, TipTap 2.11.5, ProseMirror, React 18, TypeScript

**Design Spec:** `docs/superpowers/specs/2026-04-08-notion-style-track-changes-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `frontend/src/components/editor/TrackChangesExtension.ts` | TipTap extension wrapping @manuscripts plugin, defines tracked marks and schema |
| `frontend/src/components/editor/__tests__/TrackChangesExtension.test.ts` | Tests for the extension (mark creation, accept/reject) |

### Modified Files

| File | Change |
|------|--------|
| `frontend/src/components/editor/SegmentEditor.tsx` | Replace `TrackChangesDecoration` with `TrackChangesExtension`; save as JSON when tracking enabled |
| `frontend/src/hooks/useTrackChanges.ts` | Rewrite — wrap plugin commands instead of managing diff state |
| `frontend/src/hooks/__tests__/useTrackChanges.test.ts` | Rewrite tests for new API |
| `frontend/src/components/editor/SegmentAnnotationMargin.tsx` | Read changes from ChangeSet instead of computing diffs |
| `frontend/src/components/editor/SegmentRow.tsx` | Pass editor instance to margin for ChangeSet access |
| `frontend/src/components/editor/TranslationEditor.tsx` | Update save flow, pass editor ref |
| `frontend/src/components/editor/TranslationDisplay.tsx` | Adapt non-editing display for JSON content |
| `frontend/src/api/translate.ts` | Update params to support `content_format` |
| `frontend/src/types/index.ts` | Add `content_format` to Translation interface |
| `frontend/src/index.css` | Add tracked change mark CSS |
| `frontend/package.json` | Add @manuscripts dependency, ProseMirror overrides |
| `backend/app/models/translation.py` | Add `content_format` column |
| `backend/app/schemas/book.py` | Add `content_format` to response |
| `backend/app/core/database.py` | Migration for `content_format` column |

### Deleted Files

| File | Reason |
|------|--------|
| `frontend/src/components/editor/trackChangesDecoration.ts` | Replaced by TrackChangesExtension |

---

## Task 0: Install Plugin + ProseMirror Deduplication

**Goal:** Install `@manuscripts/track-changes-plugin` and ensure ProseMirror packages are deduplicated to avoid class identity mismatches.

**Files:**
- Modify: `frontend/package.json`

**Acceptance Criteria:**
- [ ] Plugin installed at ^2.3.9
- [ ] ProseMirror overrides set in package.json to match @tiptap/pm versions
- [ ] `import { trackChangesPlugin } from '@manuscripts/track-changes-plugin'` works in a test file
- [ ] `npx tsc --noEmit` passes

**Verify:** `cd frontend && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Add ProseMirror overrides to package.json**

Add to `frontend/package.json` top-level:

```json
{
  "overrides": {
    "prosemirror-model": "1.25.4",
    "prosemirror-state": "1.4.4",
    "prosemirror-transform": "1.11.0",
    "prosemirror-view": "1.38.1"
  }
}
```

These versions match what `@tiptap/pm` 2.27.2 bundles. The overrides force all packages (including @manuscripts) to use the same ProseMirror instances.

- [ ] **Step 2: Install and reinstall to apply overrides**

```bash
cd frontend
npm install @manuscripts/track-changes-plugin@^2.3.9
rm -rf node_modules package-lock.json
npm install
```

- [ ] **Step 3: Verify import works**

Create a quick test:
```bash
cd frontend && node -e "import('@manuscripts/track-changes-plugin').then(m => console.log('OK:', Object.keys(m).join(', ')))"
```

- [ ] **Step 4: Verify TypeScript compilation**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @manuscripts/track-changes-plugin with ProseMirror dedup"
```

---

## Task 1: Create TipTap TrackChanges Extension

**Goal:** Create a TipTap extension that wraps the @manuscripts plugin, defines the required schema (tracked marks + dataTracked attributes), and adds CSS for tracked changes styling.

**Files:**
- Create: `frontend/src/components/editor/TrackChangesExtension.ts`
- Create: `frontend/src/components/editor/__tests__/TrackChangesExtension.test.ts`
- Modify: `frontend/src/index.css`

**Acceptance Criteria:**
- [ ] Extension exports `TrackChangesExtension` configurable with `{ enabled, userID }`
- [ ] Schema includes `tracked_insert` and `tracked_delete` marks with `dataTracked` attribute
- [ ] Paragraph nodes get `dataTracked: null` attribute for structural change tracking
- [ ] CSS styles tracked insertions (green underline) and deletions (red strikethrough)
- [ ] Extension can be added to a TipTap editor without errors

**Verify:** `cd frontend && npx vitest run src/components/editor/__tests__/TrackChangesExtension.test.ts && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Create the extension**

```typescript
// frontend/src/components/editor/TrackChangesExtension.ts
import { Extension, Mark } from '@tiptap/core'
import {
  trackChangesPlugin,
  trackChangesPluginKey,
  trackCommands,
  ChangeSet,
  TrackChangesStatus,
  CHANGE_STATUS,
} from '@manuscripts/track-changes-plugin'
import type { TrackedAttrs, TrackedChange } from '@manuscripts/track-changes-plugin'

export { trackChangesPluginKey, trackCommands, ChangeSet, TrackChangesStatus, CHANGE_STATUS }
export type { TrackedAttrs, TrackedChange }

export interface TrackChangesOptions {
  enabled: boolean
  userID: string
}

export const TrackChangesExtension = Extension.create<TrackChangesOptions>({
  name: 'trackChanges',

  addOptions() {
    return {
      enabled: false,
      userID: 'anonymous',
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote'],
        attributes: {
          dataTracked: {
            default: null,
            parseHTML: (element) => {
              const attr = element.getAttribute('data-tracked')
              return attr ? JSON.parse(attr) : null
            },
            renderHTML: (attributes) => {
              if (!attributes.dataTracked) return {}
              return { 'data-tracked': JSON.stringify(attributes.dataTracked) }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    if (!this.options.enabled) return []
    return [
      trackChangesPlugin({
        userID: this.options.userID,
        initialStatus: TrackChangesStatus.enabled,
      }),
    ]
  },
})

// Mark definitions for tracked text changes
export const TrackedInsertMark = Mark.create({
  name: 'tracked_insert',
  addAttributes() {
    return {
      dataTracked: {
        default: null,
        parseHTML: (el) => {
          const attr = el.getAttribute('data-tracked')
          return attr ? JSON.parse(attr) : null
        },
        renderHTML: (attrs) => {
          if (!attrs.dataTracked) return {}
          return { 'data-tracked': JSON.stringify(attrs.dataTracked), class: 'tc-insert-mark' }
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span.tc-insert-mark' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'tc-insert-mark' }, 0]
  },
})

export const TrackedDeleteMark = Mark.create({
  name: 'tracked_delete',
  addAttributes() {
    return {
      dataTracked: {
        default: null,
        parseHTML: (el) => {
          const attr = el.getAttribute('data-tracked')
          return attr ? JSON.parse(attr) : null
        },
        renderHTML: (attrs) => {
          if (!attrs.dataTracked) return {}
          return { 'data-tracked': JSON.stringify(attrs.dataTracked), class: 'tc-delete-mark' }
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span.tc-delete-mark' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'tc-delete-mark' }, 0]
  },
})

/**
 * Get the ChangeSet from the current editor state.
 * Returns null if the track changes plugin is not active.
 */
export function getChangeSet(editorState: any): ChangeSet | null {
  const pluginState = trackChangesPluginKey.getState(editorState)
  return pluginState?.changeSet ?? null
}
```

- [ ] **Step 2: Add CSS for tracked marks**

Add to `frontend/src/index.css` (replace existing `.tc-insertion` / `.tc-deletion` styles):

```css
/* --- Track changes marks (transaction-intercepted) --- */
.tc-insert-mark {
  @apply text-green-700 underline decoration-green-500 decoration-1 underline-offset-2 rounded-sm;
}
.dark .tc-insert-mark {
  @apply text-green-400 decoration-green-400;
}
.tc-delete-mark {
  @apply text-red-700/60 line-through decoration-1 decoration-red-500/70 rounded-sm;
  pointer-events: none;
  user-select: none;
}
.dark .tc-delete-mark {
  @apply text-red-400/60 decoration-red-400/70;
}
```

- [ ] **Step 3: Write basic test**

```typescript
// frontend/src/components/editor/__tests__/TrackChangesExtension.test.ts
import { describe, it, expect } from 'vitest'
import { TrackChangesExtension, TrackedInsertMark, TrackedDeleteMark, TrackChangesStatus } from '../TrackChangesExtension'

describe('TrackChangesExtension', () => {
  it('exports the extension with correct name', () => {
    expect(TrackChangesExtension.name).toBe('trackChanges')
  })

  it('has default options', () => {
    const ext = TrackChangesExtension.configure({})
    expect(ext.options.enabled).toBe(false)
    expect(ext.options.userID).toBe('anonymous')
  })

  it('returns no plugins when disabled', () => {
    const ext = TrackChangesExtension.configure({ enabled: false, userID: 'test' })
    // When disabled, addProseMirrorPlugins returns []
    expect(ext.options.enabled).toBe(false)
  })

  it('exports mark definitions', () => {
    expect(TrackedInsertMark.name).toBe('tracked_insert')
    expect(TrackedDeleteMark.name).toBe('tracked_delete')
  })

  it('exports TrackChangesStatus enum', () => {
    expect(TrackChangesStatus.enabled).toBe('enabled')
    expect(TrackChangesStatus.disabled).toBe('disabled')
  })
})
```

- [ ] **Step 4: Verify**

```bash
cd frontend && npx vitest run src/components/editor/__tests__/TrackChangesExtension.test.ts && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/TrackChangesExtension.ts src/components/editor/__tests__/TrackChangesExtension.test.ts src/index.css
git commit -m "feat: create TipTap TrackChanges extension wrapping @manuscripts plugin"
```

---

## Task 2: Add content_format to Backend + Frontend Types

**Goal:** Add a `content_format` field to the Translation model so the frontend knows whether `translated_text` contains plain text or ProseMirror JSON. This enables incremental migration — existing translations stay as plain text, new tracked edits save as JSON.

**Files:**
- Modify: `backend/app/models/translation.py` — add `content_format` column
- Modify: `backend/app/schemas/book.py` — add to response
- Modify: `backend/app/core/database.py` — migration
- Modify: `backend/app/api/translate.py` — accept `content_format` in update
- Modify: `frontend/src/types/index.ts` — add to Translation interface
- Modify: `frontend/src/api/translate.ts` — add to update params

**Acceptance Criteria:**
- [ ] Translation model has `content_format` column (default: 'plain')
- [ ] API accepts and returns `content_format`
- [ ] Frontend Translation type includes `content_format?: 'plain' | 'prosemirror'`
- [ ] Existing translations continue to work (default 'plain')

**Verify:** `cd backend && python -c "from app.models.translation import Translation; print('OK')"` and `cd frontend && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Add column to Translation model**

In `backend/app/models/translation.py`, add after the `previous_text` column:

```python
content_format: Mapped[str] = mapped_column(String(20), default="plain")  # 'plain' or 'prosemirror'
```

- [ ] **Step 2: Add migration in database.py**

In `backend/app/core/database.py` `_run_migrations()`, add:

```python
# Add content_format column to translations
await _add_column(conn, 'translations', 'content_format', "VARCHAR(20) DEFAULT 'plain'")
await _add_column(conn, 'translation_versions', 'content_format', "VARCHAR(20) DEFAULT 'plain'")
```

- [ ] **Step 3: Add to response schema**

In `backend/app/schemas/book.py` `TranslationResponse`, add:

```python
content_format: str = "plain"
```

- [ ] **Step 4: Accept in update endpoint**

In `backend/app/api/translate.py`, the update translation endpoint — add `content_format` to the accepted fields in the update request schema and apply it:

```python
if data.content_format:
    translation.content_format = data.content_format
```

- [ ] **Step 5: Update frontend types**

In `frontend/src/types/index.ts` Translation interface, add:

```typescript
content_format?: 'plain' | 'prosemirror'
```

In `frontend/src/api/translate.ts` `updateTranslation` params, add:

```typescript
params: { translated_text: string; status?: string; previous_text?: string | null; content_format?: string }
```

- [ ] **Step 6: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git add -A && git commit -m "feat: add content_format field to Translation model for JSON content support"
```

---

## Task 3: Integrate TrackChanges Extension into SegmentEditor

**Goal:** Replace the old `TrackChangesDecoration` plugin with the new `TrackChangesExtension` in SegmentEditor. When track changes is enabled, the editor uses the @manuscripts plugin. Save outputs ProseMirror JSON (with marks) instead of plain text.

**Files:**
- Modify: `frontend/src/components/editor/SegmentEditor.tsx`

**Acceptance Criteria:**
- [ ] `TrackChangesDecoration` import removed, `TrackChangesExtension` + marks added to extensions
- [ ] When `trackingEnabled` is true, the plugin intercepts edits (deletions stay in document as marks)
- [ ] `doSave` outputs `editor.getJSON()` when tracking is enabled, `editor.getText()` when not
- [ ] The old decoration debounce logic (`REBUILD_META`, `needsRebuild`, `view` hook) is removed
- [ ] Comment highlight plugin remains unchanged
- [ ] Editor loads ProseMirror JSON content when `content_format === 'prosemirror'`

**Verify:** `cd frontend && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Replace extension imports and setup**

Remove:
```typescript
import { TrackChangesDecoration, trackChangesPluginKey } from './trackChangesDecoration'
```

Add:
```typescript
import { TrackChangesExtension, TrackedInsertMark, TrackedDeleteMark, trackChangesPluginKey } from './TrackChangesExtension'
```

- [ ] **Step 2: Update useEditor extensions**

Replace the `TrackChangesDecoration.configure(...)` entry with:

```typescript
TrackChangesExtension.configure({
  enabled: !!previousText || false, // Active when tracking is on (previousText is non-null)
  userID: String(currentUserId),
}),
TrackedInsertMark,
TrackedDeleteMark,
```

Note: `currentUserId` needs to come from `useEditorContext()` — add it to the component's context consumption.

- [ ] **Step 3: Update content loading**

Replace the content initialization:

```typescript
content: translation.content_format === 'prosemirror' && translation.translated_text
  ? JSON.parse(translation.translated_text)
  : translation.translated_text
    ? `<p>${translation.translated_text.replace(/\n/g, '</p><p>')}</p>`
    : '',
```

- [ ] **Step 4: Update doSave to output correct format**

```typescript
const doSave = useCallback(async (text: string) => {
  clearTimeout(autoSaveTimer.current)
  try {
    await onSaveRef.current(text)
    setHasChanges(false)
    hasChangesRef.current = false
    setSaveStatus('saved')
  } catch {
    setSaveStatus('error')
    clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaveStatus('idle'), 4000)
  }
}, [])
```

Update the `onUpdate` callback to output JSON when tracking is active:

```typescript
onUpdate: ({ editor: ed }) => {
  setHasChanges(true)
  hasChangesRef.current = true
  setSaveStatus('idle')
  // Save as JSON when tracking plugin is active, plain text otherwise
  const tcState = trackChangesPluginKey.getState(ed.state)
  const isTracking = tcState?.status === 'enabled'
  latestTextRef.current = isTracking
    ? JSON.stringify(ed.getJSON())
    : ed.getText({ blockSeparator: '\n' })
  latestFormatRef.current = isTracking ? 'prosemirror' : 'plain'

  if (autoSave) {
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      doSave(latestTextRef.current)
    }, autoSaveDelay)
  }
},
```

Add a `latestFormatRef`:
```typescript
const latestFormatRef = useRef<'plain' | 'prosemirror'>('plain')
```

- [ ] **Step 5: Remove old decoration-specific code**

Remove:
- The `previousText` useEffect that dispatched baseline updates via `setMeta(trackChangesPluginKey, baseline)`
- Any references to `TrackChangesDecoration`
- The `REBUILD_META` / debounce-related code (this is in `trackChangesDecoration.ts` which will be deleted in Task 6)

- [ ] **Step 6: Update onSave signature to include format**

The `onSave` prop and `onSaveRef` now need to pass the content format. Update the Props interface:

```typescript
onSave: (text: string, format?: 'plain' | 'prosemirror') => Promise<void> | void
```

And update the save calls:
```typescript
await onSaveRef.current(latestTextRef.current, latestFormatRef.current)
```

- [ ] **Step 7: Expose editor state for margin card consumption**

Add to the imperative handle:

```typescript
useImperativeHandle(ref, () => ({
  save: () => { /* ... */ },
  getText: () => editor?.getText({ blockSeparator: '\n' }) || '',
  hasUnsavedChanges: () => hasChangesRef.current,
  getEditor: () => editor,
  getSaveStatus: () => saveStatus,
  getChangeSet: () => {
    if (!editor) return null
    const state = trackChangesPluginKey.getState(editor.state)
    return state?.changeSet ?? null
  },
}), [editor, doSave, saveStatus])
```

- [ ] **Step 8: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git commit -m "feat: integrate @manuscripts track changes plugin into SegmentEditor"
```

---

## Task 4: Update Save Flow in TranslationEditor

**Goal:** Update `handleSaveTranslation` and `handleCreateTranslation` to pass `content_format` to the API. Remove the client-side `previous_text` capture logic (the plugin handles tracking now).

**Files:**
- Modify: `frontend/src/components/editor/TranslationEditor.tsx`
- Modify: `frontend/src/components/editor/SegmentRow.tsx`

**Acceptance Criteria:**
- [ ] `handleSaveTranslation` sends `content_format` to API
- [ ] The `previous_text` capture condition (`trackingEnabled && !t.previous_text && ...`) is removed — the backend handles this
- [ ] `onSave` prop chain passes format from SegmentEditor → SegmentRow → TranslationEditor
- [ ] Existing non-tracked saves continue to work (format: 'plain')

**Verify:** `cd frontend && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Update handleSaveTranslation**

```typescript
const handleSaveTranslation = useCallback(async (translationId: number, text: string, format?: 'plain' | 'prosemirror') => {
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
            return {
              ...t,
              translated_text: result.translated_text,
              status: result.status as any,
              content_format: format || t.content_format,
            }
          }),
        })),
      }
    })
    // ... QA check remains
  } catch (err) {
    showError(err)
    throw err
  }
}, [selectedLanguageId])
```

Note: `trackingEnabled` is removed from the deps — no longer needed in the save logic.

- [ ] **Step 2: Update SegmentRow onSave prop**

Update the inline `onSave` in SegmentRow to pass format:

```typescript
onSave={(text, format) => translation
  ? onSaveTranslation(translation.id, text, format)
  : onCreateTranslation(segment.id, text, format)
}
```

And update the `onSaveTranslation` prop type in SegmentRowProps:

```typescript
onSaveTranslation: (translationId: number, text: string, format?: 'plain' | 'prosemirror') => Promise<void>
```

- [ ] **Step 3: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git commit -m "feat: update save flow to pass content_format to API"
```

---

## Task 5: Adapt SegmentAnnotationMargin to Read from ChangeSet

**Goal:** Replace the diff-based hunk computation in SegmentAnnotationMargin with direct reading from the @manuscripts plugin's `ChangeSet`. Change cards now reflect the actual tracked marks in the document, not computed diffs.

**Files:**
- Modify: `frontend/src/components/editor/SegmentAnnotationMargin.tsx`
- Modify: `frontend/src/components/editor/SegmentRow.tsx` (pass editor ref/changeSet)

**Acceptance Criteria:**
- [ ] Margin reads changes from the plugin's ChangeSet (via editor state)
- [ ] Each change card shows the correct operation (insert/delete), text, author, and timestamp
- [ ] Accept/reject buttons dispatch plugin commands (setChangeStatuses)
- [ ] Falls back to old diff-based rendering when plugin is not active (non-tracked segments)
- [ ] Diff-based imports (`getHunkItems`, `computeDiffs`) removed from this file

**Verify:** `cd frontend && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Add changeSet prop to SegmentAnnotationMargin**

Add to Props interface:

```typescript
changeSet?: ChangeSet | null
editorView?: any  // ProseMirror EditorView for dispatching commands
```

- [ ] **Step 2: Replace getHunkItems with ChangeSet reading**

Replace the `getHunkItems()` function:

```typescript
function getChangeItems() {
  if (!changeSet || changeSet.isEmpty) return []
  return changeSet.textChanges
    .filter(c => c.dataTracked.status === CHANGE_STATUS.pending)
    .map(c => ({
      id: c.dataTracked.id,
      operation: c.dataTracked.operation as 'insert' | 'delete',
      text: c.text,
      authorID: c.dataTracked.authorID,
      createdAt: c.dataTracked.createdAt,
      from: c.from,
      to: c.to,
    }))
}
```

- [ ] **Step 3: Update accept/reject to use plugin commands**

Replace `handleHunkAction` with:

```typescript
function handleAcceptChange(changeId: string) {
  if (!editorView) return
  const cmd = trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, [changeId])
  cmd(editorView.state, editorView.dispatch)
}

function handleRejectChange(changeId: string) {
  if (!editorView) return
  const cmd = trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, [changeId])
  cmd(editorView.state, editorView.dispatch)
}
```

- [ ] **Step 4: Update card rendering to use change items**

Adapt the `hunkItems.map(...)` rendering to use the new `getChangeItems()` output. Each card renders:
- Author name (from `authorID` → look up user)
- Timestamp (from `createdAt`)
- Operation text (the changed text)
- Accept/reject buttons calling `handleAcceptChange(id)` / `handleRejectChange(id)`

- [ ] **Step 5: Pass changeSet from SegmentRow**

In SegmentRow, when rendering SegmentAnnotationMargin, pass the changeSet:

```typescript
<SegmentAnnotationMargin
  // ... existing props
  changeSet={isEditing ? segmentEditorRef.current?.getChangeSet?.() ?? null : null}
  editorView={isEditing ? segmentEditorRef.current?.getEditor?.()?.view ?? null : null}
/>
```

- [ ] **Step 6: Remove old diff imports**

Remove from SegmentAnnotationMargin:
```typescript
import { getHunkItems as computeHunkItemsFn, computeDiffs } from './diffUtils'
```

Keep only what's needed for the fallback (non-tracked segments).

- [ ] **Step 7: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
git commit -m "feat: adapt SegmentAnnotationMargin to read from ChangeSet"
```

---

## Task 6: Rewrite useTrackChanges Hook

**Goal:** Simplify the `useTrackChanges` hook to wrap the plugin's commands instead of managing diff state. Remove accept/reject handlers that operated on `previous_text` — these now dispatch plugin commands.

**Files:**
- Rewrite: `frontend/src/hooks/useTrackChanges.ts`
- Rewrite: `frontend/src/hooks/__tests__/useTrackChanges.test.ts`

**Acceptance Criteria:**
- [ ] Hook manages: `trackingEnabled`, `displayMode`
- [ ] `activeHunkIdx` removed (plugin uses change IDs, not hunk indices)
- [ ] `handleAcceptChange` and `handleRejectChange` removed from hook (moved to margin component)
- [ ] `hasVisibleChanges` checks for pending changes in the ChangeSet instead of comparing previous_text
- [ ] `syncEnabled` still works for initial load
- [ ] Tests cover the new simplified interface

**Verify:** `cd frontend && npx vitest run src/hooks/__tests__/useTrackChanges.test.ts && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Rewrite the hook**

```typescript
// frontend/src/hooks/useTrackChanges.ts
import { useState, useCallback } from 'react'
import { updateBookTranslation } from '../api/bookTranslations'

type DisplayMode = 'no-markup' | 'all-markup' | 'original'

export interface UseTrackChangesOptions {
  btId: string | undefined
  loadChapter: () => Promise<void>
}

export interface UseTrackChangesReturn {
  trackingEnabled: boolean
  displayMode: DisplayMode
  syncEnabled: (enabled: boolean) => void
  toggleTracking: () => Promise<void>
  cycleDisplayMode: () => void
  switchToMarkupIfOriginal: () => void
}

export function useTrackChanges({
  btId,
  loadChapter,
}: UseTrackChangesOptions): UseTrackChangesReturn {
  const [trackingEnabled, setTrackingEnabled] = useState(false)
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    const saved = localStorage.getItem('tc_display_mode')
    if (saved === 'no-markup' || saved === 'original') return saved
    return 'all-markup'
  })

  const syncEnabled = useCallback((enabled: boolean) => {
    setTrackingEnabled(enabled)
  }, [])

  const toggleTracking = useCallback(async () => {
    if (!btId) return
    const newVal = !trackingEnabled
    setTrackingEnabled(newVal)
    await updateBookTranslation(parseInt(btId), { track_changes: newVal })
    await loadChapter()
  }, [btId, trackingEnabled, loadChapter])

  const cycleDisplayMode = useCallback(() => {
    const order: DisplayMode[] = ['all-markup', 'no-markup', 'original']
    setDisplayMode((prev) => {
      const idx = order.indexOf(prev)
      const next = order[(idx + 1) % order.length]
      localStorage.setItem('tc_display_mode', next)
      return next
    })
  }, [])

  const switchToMarkupIfOriginal = useCallback(() => {
    setDisplayMode((prev) => {
      if (trackingEnabled && prev === 'original') {
        localStorage.setItem('tc_display_mode', 'all-markup')
        return 'all-markup'
      }
      return prev
    })
  }, [trackingEnabled])

  return {
    trackingEnabled,
    displayMode,
    syncEnabled,
    toggleTracking,
    cycleDisplayMode,
    switchToMarkupIfOriginal,
  }
}
```

- [ ] **Step 2: Write tests**

Test the simplified interface: toggle, cycle, syncEnabled. Remove tests for handleAcceptChange/handleRejectChange (moved to margin).

- [ ] **Step 3: Update TranslationEditor to use simplified hook**

Remove references to `handleAcceptChange`, `handleRejectChange`, `activeHunkIdx`, `setActiveHunkIdx` from the hook destructuring. Update the EditorProvider and SegmentRow props accordingly.

- [ ] **Step 4: Verify and commit**

```bash
cd frontend && npx vitest run src/hooks/__tests__/useTrackChanges.test.ts && npx tsc --noEmit
git commit -m "refactor: simplify useTrackChanges hook — plugin handles accept/reject"
```

---

## Task 7: Remove Old Decoration Code + Cleanup

**Goal:** Delete the old track changes decoration system and all associated workarounds. Clean up unused imports and dead code.

**Files:**
- Delete: `frontend/src/components/editor/trackChangesDecoration.ts`
- Modify: `frontend/src/components/editor/SegmentEditor.tsx` (remove any remaining references)
- Modify: `frontend/src/components/editor/TranslationEditor.tsx` (remove previous_text capture logic)
- Modify: `frontend/src/index.css` (remove old `.tc-insertion`, `.tc-deletion` decoration styles, keep new mark styles)
- Modify: `frontend/src/components/editor/__tests__/SegmentEditor.save.test.ts` (update if needed)

**Acceptance Criteria:**
- [ ] `trackChangesDecoration.ts` deleted
- [ ] No imports of `TrackChangesDecoration` anywhere in the codebase
- [ ] Old `.tc-insertion` and `.tc-deletion` decoration CSS removed (new `.tc-insert-mark` and `.tc-delete-mark` remain)
- [ ] `onSaveRef` / `hasChangesRef` pattern still works (needed for auto-save, independent of track changes)
- [ ] `diff-match-patch` only imported in `diffUtils.ts`, `InlineDiff.tsx`, `VersionHistoryPanel.tsx`, `ChangesPanel.tsx` (read-only views)
- [ ] All tests pass, TypeScript compiles

**Verify:** `cd frontend && npx tsc --noEmit && npx vitest run`

**Steps:**

- [ ] **Step 1: Delete the old decoration file**

```bash
rm frontend/src/components/editor/trackChangesDecoration.ts
```

- [ ] **Step 2: Remove old CSS**

In `frontend/src/index.css`, remove:
```css
.tc-insertion { ... }
.dark .tc-insertion { ... }
.tc-deletion { ... }
.dark .tc-deletion { ... }
.tc-collapsed-p { ... }
```

Keep the new `.tc-insert-mark` and `.tc-delete-mark` styles from Task 1.

- [ ] **Step 3: Grep for stale references**

```bash
grep -r "TrackChangesDecoration\|trackChangesDecoration\|tc-insertion\|tc-deletion\|tc-collapsed\|REBUILD_META\|tc-rebuild" frontend/src/ --include="*.ts" --include="*.tsx" --include="*.css"
```

Fix any remaining references.

- [ ] **Step 4: Verify everything compiles and tests pass**

```bash
cd frontend && npx tsc --noEmit && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove old decoration-based track changes system"
```

---

## Post-Migration Verification Checklist

After all tasks are complete, manually verify:

- [ ] Toggle track changes on for a BookTranslation
- [ ] Edit text in a segment — deleted text stays in place with red strikethrough
- [ ] Inserted text shows green with underline
- [ ] Change cards appear in the annotation margin with correct author/timestamp
- [ ] Accept a change — mark removed, text becomes permanent (or deleted)
- [ ] Reject a change — insertion removed, deletion restored
- [ ] Auto-save fires and preserves marks (reload page, marks still present)
- [ ] Toggle track changes off — editing returns to normal (no marks)
- [ ] Legacy segments (plain text) still render correctly
- [ ] Comments still work (create, reply, resolve, emoji reactions)
- [ ] Version history still works
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — all tests pass
- [ ] No console errors during normal operation
