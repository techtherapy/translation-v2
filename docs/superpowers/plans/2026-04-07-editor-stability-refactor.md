# Editor Stability Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 2,037-line TranslationEditor god component into focused, isolated modules so that changes to one feature (comments, track changes, display) cannot cascade into another.

**Architecture:** Extract the segment render loop into a memoized `SegmentRow` component, unify all diff computation into a single canonical module, and isolate track-changes and comments state into dedicated hooks provided through a shared `EditorContext`. Each extraction is independently deployable — no big-bang rewrite.

**Tech Stack:** React 18, TypeScript, TipTap/ProseMirror, diff-match-patch, vitest + @testing-library/react

---

## File Structure

### New Files

| File | Responsibility | ~Lines |
|------|---------------|--------|
| `frontend/src/components/editor/EditorContext.tsx` | React context providing shared editor state (language, user, permissions, track changes, comments) to all editor sub-components | ~60 |
| `frontend/src/components/editor/SegmentRow.tsx` | Memoized component rendering a single segment row (source + translation + annotation margin) | ~400 |
| `frontend/src/components/editor/TranslationDisplay.tsx` | Encapsulates the 3-way display mode branching (all-markup / no-markup / original) | ~90 |
| `frontend/src/hooks/useTrackChanges.ts` | Track changes state + handlers (toggle, accept, reject, display mode) | ~120 |
| `frontend/src/hooks/useEditorComments.ts` | Comments state + handlers (load, create, mutate, highlight) with declarative highlight state | ~130 |

### Modified Files

| File | Change |
|------|--------|
| `frontend/src/components/editor/TranslationEditor.tsx` | Drastically simplified — delegates to SegmentRow, uses hooks + context. Target: ~600 lines |
| `frontend/src/components/editor/diffUtils.ts` | Expanded from 51 to ~100 lines — becomes canonical diff source with `getHunkItems()` |
| `frontend/src/components/editor/SegmentAnnotationMargin.tsx` | Consumes EditorContext, uses diffUtils.getHunkItems() instead of inline diff computation |
| `frontend/src/components/editor/InlineDiff.tsx` | Uses diffUtils for hunk index computation instead of inline logic |
| `frontend/src/components/editor/ChangesPanel.tsx` | Uses diffUtils for hunk computation instead of inline DiffMatchPatch |

---

## Task 0: Expand diffUtils into Canonical Diff Module

**Goal:** Create a single source of truth for all diff computation so that hunk indices, hunk items, and resolved text always agree across all consumers.

**Files:**
- Modify: `frontend/src/components/editor/diffUtils.ts`
- Create: `frontend/src/components/editor/__tests__/diffUtils.test.ts`

**Acceptance Criteria:**
- [ ] `getHunkItems()` returns the same hunk structure currently computed inline in `SegmentAnnotationMargin.tsx:111-133`
- [ ] `computeHunkIndices()` returns the same index assignments currently computed inline in `InlineDiff.tsx:91-104`
- [ ] Existing `computeHunks()` and `buildResolvedText()` unchanged (backwards compatible)
- [ ] All new functions have unit tests with edge cases (empty text, no changes, replacement pairs, whitespace-only diffs)

**Verify:** `cd frontend && npx vitest run src/components/editor/__tests__/diffUtils.test.ts`

**Steps:**

- [ ] **Step 1: Write tests for `getHunkItems`**

```typescript
// frontend/src/components/editor/__tests__/diffUtils.test.ts
import { describe, it, expect } from 'vitest'
import { getHunkItems, computeHunkIndices, computeHunks, buildResolvedText } from '../diffUtils'

describe('getHunkItems', () => {
  it('returns empty array when texts are identical', () => {
    expect(getHunkItems('hello', 'hello')).toEqual([])
  })

  it('detects a simple insertion', () => {
    const items = getHunkItems('hello world', 'hello beautiful world')
    expect(items.length).toBe(1)
    expect(items[0].deleted).toBe('')
    expect(items[0].inserted).toContain('beautiful')
  })

  it('detects a simple deletion', () => {
    const items = getHunkItems('hello beautiful world', 'hello world')
    expect(items.length).toBe(1)
    expect(items[0].deleted).toContain('beautiful')
    expect(items[0].inserted).toBe('')
  })

  it('detects a replacement (paired delete+insert)', () => {
    const items = getHunkItems('hello world', 'hello universe')
    expect(items.length).toBe(1)
    expect(items[0].deleted).toBeTruthy()
    expect(items[0].inserted).toBeTruthy()
  })

  it('assigns sequential hunk indices', () => {
    const items = getHunkItems('aaa bbb ccc', 'aaa xxx ccc yyy')
    for (let i = 0; i < items.length; i++) {
      expect(items[i].hunkIdx).toBe(i)
    }
  })

  it('skips whitespace-only deletions', () => {
    const items = getHunkItems('hello  world', 'hello world')
    // whitespace-only trimmed items should not appear
    for (const item of items) {
      if (item.deleted) {
        expect(item.deleted.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('computeHunkIndices', () => {
  it('returns null for equal parts', () => {
    const indices = computeHunkIndices('hello world', 'hello beautiful world')
    expect(indices.some(idx => idx === null)).toBe(true)
  })

  it('assigns same index to paired delete+insert', () => {
    const indices = computeHunkIndices('hello world', 'hello universe')
    const nonNull = indices.filter(idx => idx !== null) as number[]
    // paired delete+insert share the same hunk index
    if (nonNull.length >= 2) {
      expect(nonNull[0]).toBe(nonNull[1])
    }
  })
})

describe('computeHunks (existing)', () => {
  it('groups replacement pairs with same groupId', () => {
    const hunks = computeHunks('cat', 'dog')
    const withGroup = hunks.filter(h => h.groupId !== undefined)
    expect(withGroup.length).toBe(2) // delete + insert pair
    expect(withGroup[0].groupId).toBe(withGroup[1].groupId)
  })
})

describe('buildResolvedText (existing)', () => {
  it('builds text from accepted inserts and rejected deletes', () => {
    const hunks = computeHunks('old text', 'new text')
    // Accept all changes
    for (const h of hunks) {
      if (h.type === 'insert') h.status = 'accepted'
      if (h.type === 'delete') h.status = 'accepted'
    }
    expect(buildResolvedText(hunks)).toBe('new text')
  })

  it('reverts to old text when all changes rejected', () => {
    const hunks = computeHunks('old text', 'new text')
    for (const h of hunks) {
      if (h.type === 'insert') h.status = 'rejected'
      if (h.type === 'delete') h.status = 'rejected'
    }
    expect(buildResolvedText(hunks)).toBe('old text')
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail (functions not yet exported)**

Run: `cd frontend && npx vitest run src/components/editor/__tests__/diffUtils.test.ts`
Expected: FAIL — `getHunkItems` and `computeHunkIndices` not found

- [ ] **Step 3: Implement `getHunkItems` and `computeHunkIndices` in diffUtils.ts**

```typescript
// Add to frontend/src/components/editor/diffUtils.ts
// (keep existing computeHunks and buildResolvedText unchanged)

export interface HunkItem {
  hunkIdx: number
  deleted: string
  inserted: string
}

/**
 * Extract human-readable hunk items from a diff.
 * Mirrors the logic previously inline in SegmentAnnotationMargin.
 * Skips whitespace-only deletions.
 */
export function getHunkItems(oldText: string, newText: string): HunkItem[] {
  if (oldText === newText) return []
  const dmp = new DiffMatchPatch()
  const diffs = dmp.diff_main(oldText, newText)
  dmp.diff_cleanupSemantic(diffs)

  const items: HunkItem[] = []
  let hunkIdx = 0
  for (let i = 0; i < diffs.length; i++) {
    const [op, text] = diffs[i]
    if (op === 0) continue
    if (op === -1) {
      const cur = hunkIdx
      const nextIns = i + 1 < diffs.length && diffs[i + 1][0] === 1
      if (!nextIns) hunkIdx++
      if (text.trim().length === 0) continue
      items.push({ hunkIdx: cur, deleted: text, inserted: nextIns ? diffs[i + 1][1] : '' })
      if (nextIns) i++
    } else if (op === 1) {
      const cur = hunkIdx
      hunkIdx++
      if (!(i > 0 && diffs[i - 1][0] === -1)) {
        items.push({ hunkIdx: cur, deleted: '', inserted: text })
      }
    }
  }
  return items
}

/**
 * Compute per-diff-part hunk indices matching the InlineDiff/ChangesPanel convention.
 * Returns an array parallel to dmp.diff_main output: null for equal parts, hunkIdx for changes.
 */
export function computeHunkIndices(oldText: string, newText: string): (number | null)[] {
  if (oldText === newText) return []
  const dmp = new DiffMatchPatch()
  const diffs = dmp.diff_main(oldText, newText)
  dmp.diff_cleanupSemantic(diffs)

  let hunkIdx = 0
  return diffs.map(([op], i) => {
    if (op === 0) return null
    if (op === -1) {
      const currentHunk = hunkIdx
      const nextIsInsert = i + 1 < diffs.length && diffs[i + 1][0] === 1
      if (!nextIsInsert) hunkIdx++
      return currentHunk
    }
    // op === 1
    const currentHunk = hunkIdx
    hunkIdx++
    return currentHunk
  })
}

/**
 * Run diff and return raw diffs array (cached computation for consumers that need both
 * the raw diffs and hunk indices).
 */
export function computeDiffs(oldText: string, newText: string): [number, string][] {
  const dmp = new DiffMatchPatch()
  const diffs = dmp.diff_main(oldText, newText)
  dmp.diff_cleanupSemantic(diffs)
  return diffs
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run: `cd frontend && npx vitest run src/components/editor/__tests__/diffUtils.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Verify TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/components/editor/diffUtils.ts src/components/editor/__tests__/diffUtils.test.ts
git commit -m "feat: expand diffUtils into canonical diff module with getHunkItems and computeHunkIndices"
```

---

## Task 1: Create EditorContext for Shared State

**Goal:** Create a React context that provides frequently-accessed editor state to all sub-components, eliminating 6-8 props from each segment's component chain.

**Files:**
- Create: `frontend/src/components/editor/EditorContext.tsx`
- Create: `frontend/src/components/editor/__tests__/EditorContext.test.tsx`
- Modify: `frontend/src/components/editor/TranslationEditor.tsx` (wrap children in provider)

**Acceptance Criteria:**
- [ ] `EditorContext` provides: `selectedLanguageId`, `currentUserId`, `trackingEnabled`, `displayMode`, `sourceFont`, `hasPermission`, `highlightedCommentId`, `setHighlightedCommentId`
- [ ] `useEditorContext()` hook throws if used outside provider
- [ ] TranslationEditor wraps its content in `<EditorProvider>`
- [ ] Existing functionality unchanged (all values still flow correctly)

**Verify:** `cd frontend && npx vitest run src/components/editor/__tests__/EditorContext.test.tsx && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Write test for EditorContext**

```tsx
// frontend/src/components/editor/__tests__/EditorContext.test.tsx
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { EditorProvider, useEditorContext } from '../EditorContext'
import React from 'react'

describe('EditorContext', () => {
  it('throws when used outside provider', () => {
    expect(() => {
      renderHook(() => useEditorContext())
    }).toThrow('useEditorContext must be used within EditorProvider')
  })

  it('provides values when inside provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EditorProvider
        selectedLanguageId={1}
        currentUserId={42}
        trackingEnabled={true}
        displayMode="all-markup"
        sourceFont="font-chinese"
        hasPermission={() => true}
        highlightedCommentId={null}
        setHighlightedCommentId={() => {}}
      >
        {children}
      </EditorProvider>
    )
    const { result } = renderHook(() => useEditorContext(), { wrapper })
    expect(result.current.selectedLanguageId).toBe(1)
    expect(result.current.currentUserId).toBe(42)
    expect(result.current.trackingEnabled).toBe(true)
    expect(result.current.displayMode).toBe('all-markup')
  })
})
```

- [ ] **Step 2: Run test — confirm it fails**

Run: `cd frontend && npx vitest run src/components/editor/__tests__/EditorContext.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement EditorContext**

```tsx
// frontend/src/components/editor/EditorContext.tsx
import { createContext, useContext } from 'react'

type DisplayMode = 'no-markup' | 'all-markup' | 'original'

interface EditorContextValue {
  selectedLanguageId: number
  currentUserId: number
  trackingEnabled: boolean
  displayMode: DisplayMode
  sourceFont: string
  hasPermission: (permission: string) => boolean
  highlightedCommentId: number | null
  setHighlightedCommentId: (id: number | null) => void
}

const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditorContext must be used within EditorProvider')
  return ctx
}

interface EditorProviderProps extends EditorContextValue {
  children: React.ReactNode
}

export function EditorProvider({ children, ...value }: EditorProviderProps) {
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}
```

- [ ] **Step 4: Run test — confirm it passes**

Run: `cd frontend && npx vitest run src/components/editor/__tests__/EditorContext.test.tsx`
Expected: All tests PASS

- [ ] **Step 5: Add `highlightedCommentId` state and wrap TranslationEditor in EditorProvider**

In `TranslationEditor.tsx`, add state and wrap the return JSX:

```tsx
// Near other state declarations (around line 283):
const [highlightedCommentId, setHighlightedCommentId] = useState<number | null>(null)

// Auto-clear highlight after 2 seconds
useEffect(() => {
  if (highlightedCommentId === null) return
  const timer = setTimeout(() => setHighlightedCommentId(null), 2000)
  return () => clearTimeout(timer)
}, [highlightedCommentId])
```

Wrap the return JSX (line 997) in the provider:

```tsx
return (
  <EditorProvider
    selectedLanguageId={selectedLanguageId}
    currentUserId={user?.id || 0}
    trackingEnabled={trackingEnabled}
    displayMode={displayMode}
    sourceFont={sourceFont}
    hasPermission={hasPermission}
    highlightedCommentId={highlightedCommentId}
    setHighlightedCommentId={setHighlightedCommentId}
  >
    <div className="h-[calc(100vh-57px)] flex flex-col">
      {/* ... existing JSX unchanged ... */}
    </div>
  </EditorProvider>
)
```

- [ ] **Step 6: Replace DOM manipulation with `setHighlightedCommentId`**

Replace all 3 instances of the `requestAnimationFrame` + `classList.add('ring-2', 'ring-amber-400')` pattern:

**Instance 1** (line ~1716, InlineDiff `onClickComment`):
```tsx
// Before:
onClickComment={(commentId) => {
  setShowCommentsMargin(true)
  localStorage.setItem('show_comments_margin', 'true')
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-panel-comment-id="${commentId}"]`)
    if (el) {
      el.classList.add('ring-2', 'ring-amber-400', 'rounded')
      setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400', 'rounded'), 2000)
    }
  })
}}

// After:
onClickComment={(commentId) => {
  setShowCommentsMargin(true)
  localStorage.setItem('show_comments_margin', 'true')
  setHighlightedCommentId(commentId)
}}
```

**Instance 2** (line ~1760, TextHighlighter `onClickHighlight`):
```tsx
// Before:
onClickHighlight={(commentId) => {
  setShowCommentsMargin(true)
  localStorage.setItem('show_comments_margin', 'true')
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-panel-comment-id="${commentId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      el.classList.add('ring-2', 'ring-amber-400', 'rounded')
      setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400', 'rounded'), 2000)
    }
  })
}}

// After:
onClickHighlight={(commentId) => {
  setShowCommentsMargin(true)
  localStorage.setItem('show_comments_margin', 'true')
  setHighlightedCommentId(commentId)
}}
```

**Instance 3** (line ~1846, `onNavigateToComment` in SegmentAnnotationMargin):
```tsx
// Before:
onNavigateToComment={(commentId) => {
  const highlight = document.querySelector(`[data-comment-id="${commentId}"]`)
  if (highlight) { highlight.scrollIntoView({ behavior: 'smooth', block: 'center' }); highlight.classList.add('ring-2', 'ring-amber-400'); setTimeout(() => highlight.classList.remove('ring-2', 'ring-amber-400'), 2000) }
}}

// After:
onNavigateToComment={(commentId) => {
  setHighlightedCommentId(commentId)
  const highlight = document.querySelector(`[data-comment-id="${commentId}"]`)
  if (highlight) highlight.scrollIntoView({ behavior: 'smooth', block: 'center' })
}}
```

Then in `SegmentAnnotationMargin.tsx` (and any comment card component), consume the highlight state:

```tsx
// In comment card rendering, add conditional ring:
data-panel-comment-id={c.id}
className={`... ${highlightedCommentId === c.id ? 'ring-2 ring-amber-400 rounded' : ''}`}
```

- [ ] **Step 7: Verify build and run**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: No type errors, all tests pass

- [ ] **Step 8: Commit**

```bash
cd frontend
git add src/components/editor/EditorContext.tsx src/components/editor/__tests__/EditorContext.test.tsx src/components/editor/TranslationEditor.tsx
git commit -m "feat: add EditorContext and replace DOM manipulation with declarative highlighting"
```

---

## Task 2: Extract SegmentRow Component

**Goal:** Extract the 460-line segment render loop body (TranslationEditor.tsx lines 1404-1867) into a memoized `SegmentRow` component so that state changes in one segment don't re-render every other segment.

**Files:**
- Create: `frontend/src/components/editor/SegmentRow.tsx`
- Create: `frontend/src/components/editor/__tests__/SegmentRow.test.tsx`
- Modify: `frontend/src/components/editor/TranslationEditor.tsx` (replace inline JSX with `<SegmentRow>`)

**Acceptance Criteria:**
- [ ] Each segment is rendered by a `SegmentRow` component wrapped in `React.memo`
- [ ] `SegmentRow` consumes `EditorContext` for shared state (language, permissions, etc.)
- [ ] All callbacks passed to `SegmentRow` are wrapped in `useCallback` in TranslationEditor
- [ ] TranslationEditor's segment map is reduced to ~20 lines
- [ ] Existing visual behavior identical (no UI changes)

**Verify:** `cd frontend && npx tsc --noEmit && npx vitest run`

**Steps:**

- [ ] **Step 1: Define SegmentRow props interface**

```tsx
// frontend/src/components/editor/SegmentRow.tsx
import React, { memo } from 'react'
import type { Segment, SegmentComment, DetectedTerm, GlossaryTerm } from '../../types'
import type { EditorSelectionInfo, SegmentEditorHandle } from './SegmentEditor'

interface SegmentRowProps {
  segment: Segment
  segIdx: number
  isLastSegment: boolean
  isNewParagraphGroup: boolean
  segComments: SegmentComment[]

  // Active/editing state for THIS segment
  isActive: boolean
  isEditing: boolean
  isSplitting: boolean
  isSelected: boolean
  isHovered: boolean

  // Callbacks (all must be stable — wrapped in useCallback by parent)
  onActivate: (segmentId: number) => void
  onHover: (segmentId: number | null) => void
  onToggleSelect: (segmentId: number) => void
  onSplit: (segmentId: number, position: number) => void
  onMerge: (segmentId: number) => void
  onSaveTranslation: (translationId: number, text: string) => Promise<void>
  onCreateTranslation: (segmentId: number, text: string) => Promise<void>
  onStatusChange: (translationId: number, status: string) => void
  onTranslate: (segmentId: number) => void
  onCompare: (segment: Segment) => void
  onOpenReview: (segmentId: number, translation: { id: number; translated_text: string }) => void
  onVersionHistory: (translation: { id: number; text: string }) => void
  onAcceptChange: (segmentId: number, translationId: number) => void
  onRejectChange: (segmentId: number, translationId: number, previousText: string) => void
  onSetPendingQuotedText: (data: { segmentId: number; text: string } | null) => void
  onEditorSelectionChange: (data: { segmentId: number; info: EditorSelectionInfo } | null) => void
  onSaveStatusChange: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  onEditingSegmentChange: (segmentId: number | null) => void
  onCrossHighlightChange: (data: { segmentId: number; sourceTerms: string[] } | null) => void

  // Editor ref (only passed to active editing segment)
  segmentEditorRef: React.RefObject<SegmentEditorHandle | null>

  // Glossary
  detectedTerms: DetectedTerm[]
  onAddToGlossary: (text: string) => void
  lookupGlossary: (text: string) => Promise<any[]>
  onEditTerm: (termId: number) => void
  crossHighlight: { segmentId: number; sourceTerms: string[] } | null

  // Pivot translations
  pivotTranslation?: { text: string; status: string }
  pivotLanguageName?: string

  // Annotation margin
  showCommentsMargin: boolean
  showChangesMargin: boolean
  pendingQuotedText?: string
  editorSelection: { segmentId: number; info: EditorSelectionInfo } | null
  onAnnotationUpdate: () => void
  onCommentCreated: (comment: SegmentComment) => void
  onCommentMutate: (updater: (comments: SegmentComment[]) => SegmentComment[]) => void
  onPendingQuotedTextConsumed: () => void
  onNavigateToComment: (commentId: number) => void
  onEnsureCommentsVisible: () => void
  onHunkResolve: (segId: number, transId: number, newText: string, newPrev: string | null) => Promise<void>

  // Batch translate indicator
  translating: number | null
  batchRunning: boolean
}
```

- [ ] **Step 2: Move the segment rendering logic from TranslationEditor into SegmentRow**

Move the entire body of the `filteredSegments.map((segment, segIdx) => { ... })` block (TranslationEditor.tsx lines 1404-1867) into the `SegmentRow` component function. This is a mechanical extraction — the JSX stays the same, but reads shared values from `useEditorContext()` instead of closure variables.

Key changes inside SegmentRow:
- Replace `selectedLanguageId` closure → `const { selectedLanguageId, trackingEnabled, displayMode, sourceFont, hasPermission, currentUserId, highlightedCommentId, setHighlightedCommentId } = useEditorContext()`
- Replace inline `user?.id || 0` → `currentUserId` from context
- Replace `sourceFont` closure → from context
- Replace `trackingEnabled`, `displayMode` closures → from context
- Import and use shared sub-components: `StatusDropdown`, `SplitView`, `HighlightSubstrings` (export from TranslationEditor or move to SegmentRow)

- [ ] **Step 3: Move local helper components into SegmentRow or shared file**

Move `StatusDropdown`, `SplitView`, and `HighlightSubstrings` out of TranslationEditor.tsx:
- `StatusDropdown` → keep as private function inside `SegmentRow.tsx` (only used there)
- `SplitView` → keep as private function inside `SegmentRow.tsx`
- `HighlightSubstrings` → keep as private function inside `SegmentRow.tsx`

- [ ] **Step 4: Wrap SegmentRow in React.memo**

```tsx
export default memo(SegmentRow)
```

- [ ] **Step 5: Stabilize all callbacks in TranslationEditor with useCallback**

In `TranslationEditor.tsx`, wrap every handler passed to SegmentRow:

```tsx
const handleActivateSegment = useCallback((segmentId: number) => {
  setActiveSegment(segmentId)
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) {
    setEditingSegment(segmentId)
  }
  setCrossHighlight(null)
  if (splitMode !== segmentId) setSplitMode(null)
  if (trackingEnabled && displayMode === 'original') {
    setDisplayMode('all-markup')
    localStorage.setItem('tc_display_mode', 'all-markup')
  }
}, [splitMode, trackingEnabled, displayMode])

const handleHoverSegment = useCallback((segmentId: number | null) => {
  setHoveredSegment(segmentId)
}, [])

const handleToggleSelect = useCallback((segmentId: number) => {
  setSelectedSegments(prev => {
    const next = new Set(prev)
    if (next.has(segmentId)) next.delete(segmentId)
    else next.add(segmentId)
    return next
  })
}, [])

const stableSaveTranslation = useCallback(async (translationId: number, text: string) => {
  return handleSaveTranslation(translationId, text)
}, [handleSaveTranslation])

const stableCreateTranslation = useCallback(async (segmentId: number, text: string) => {
  return handleCreateTranslation(segmentId, text)
}, [handleCreateTranslation])

const stableAcceptChange = useCallback((segmentId: number, translationId: number) => {
  handleAcceptChange(segmentId, translationId)
}, [handleAcceptChange])

const stableRejectChange = useCallback((segmentId: number, translationId: number, previousText: string) => {
  handleRejectChange(segmentId, translationId, previousText)
}, [handleRejectChange])

const handleAnnotationUpdate = useCallback(() => {
  loadComments(300)
}, [loadComments])

const handleCommentCreated = useCallback((newComment: SegmentComment) => {
  setChapterComments(prev => {
    if (!prev) return { comments: [newComment], segment_comment_counts: { [String(newComment.segment_id)]: 1 }, unresolved_count: 1 }
    return {
      ...prev,
      comments: [...prev.comments, newComment],
      segment_comment_counts: {
        ...prev.segment_comment_counts,
        [String(newComment.segment_id)]: (prev.segment_comment_counts[String(newComment.segment_id)] || 0) + 1,
      },
      unresolved_count: prev.unresolved_count + 1,
    }
  })
}, [])

const handleCommentMutate = useCallback((updater: (c: SegmentComment[]) => SegmentComment[]) => {
  setChapterComments(prev => {
    if (!prev) return prev
    const updated = updater(prev.comments)
    const counts: Record<string, number> = {}
    for (const c of updated) {
      if (!c.is_resolved) {
        counts[String(c.segment_id)] = (counts[String(c.segment_id)] || 0) + 1
      }
    }
    return { ...prev, comments: updated, segment_comment_counts: counts, unresolved_count: Object.values(counts).reduce((a, b) => a + b, 0) }
  })
}, [])

const handleEnsureCommentsVisible = useCallback(() => {
  setShowCommentsMargin(true)
  localStorage.setItem('show_comments_margin', 'true')
}, [])

const handleSetPendingQuotedText = useCallback((data: { segmentId: number; text: string } | null) => {
  setPendingQuotedText(data)
  if (data) {
    setShowCommentsMargin(true)
    localStorage.setItem('show_comments_margin', 'true')
  }
}, [])

const handlePendingQuotedTextConsumed = useCallback(() => {
  setPendingQuotedText(null)
}, [])

const handleHunkResolve = useCallback(async (segId: number, transId: number, newTranslatedText: string, newPreviousText: string | null) => {
  try {
    if (editingSegment === segId) setEditingSegment(null)
    await updateTranslation(transId, { translated_text: newTranslatedText, status: 'draft', previous_text: newPreviousText })
    setChapter(prev => {
      if (!prev) return prev
      return {
        ...prev,
        segments: prev.segments.map(s =>
          s.id === segId ? {
            ...s,
            translations: s.translations.map(tr =>
              tr.id === transId ? { ...tr, translated_text: newTranslatedText, previous_text: newPreviousText } : tr
            ),
          } : s
        ),
      }
    })
  } catch (err) {
    console.error('Hunk resolve failed:', err)
  }
}, [editingSegment])
```

- [ ] **Step 6: Replace the inline segment map with SegmentRow**

In `TranslationEditor.tsx`, replace the ~460-line map body with:

```tsx
{filteredSegments.map((segment, segIdx) => {
  const prevSegment = segIdx > 0 ? filteredSegments[segIdx - 1] : null
  const segComments = (chapterComments?.comments || []).filter(c => c.segment_id === segment.id)
  const hasPending = pendingQuotedText?.segmentId === segment.id

  return (
    <SegmentRow
      key={segment.id}
      segment={segment}
      segIdx={segIdx}
      isLastSegment={segIdx === filteredSegments.length - 1}
      isNewParagraphGroup={!!prevSegment && segment.paragraph_group !== prevSegment.paragraph_group}
      segComments={segComments}
      isActive={activeSegment === segment.id}
      isEditing={editingSegment === segment.id}
      isSplitting={splitMode === segment.id}
      isSelected={selectedSegments.has(segment.id)}
      isHovered={hoveredSegment === segment.id}
      onActivate={handleActivateSegment}
      onHover={handleHoverSegment}
      onToggleSelect={handleToggleSelect}
      onSplit={handleSplit}
      onMerge={handleMerge}
      onSaveTranslation={stableSaveTranslation}
      onCreateTranslation={stableCreateTranslation}
      onStatusChange={handleStatusChange}
      onTranslate={handleTranslateSegment}
      onCompare={setComparingSegment}
      onOpenReview={handleOpenReview}
      onVersionHistory={setVersionHistoryTranslation}
      onAcceptChange={stableAcceptChange}
      onRejectChange={stableRejectChange}
      onSetPendingQuotedText={handleSetPendingQuotedText}
      onEditorSelectionChange={(data) => setEditorSelection(data)}
      onSaveStatusChange={setEditorSaveStatus}
      onEditingSegmentChange={setEditingSegment}
      onCrossHighlightChange={setCrossHighlight}
      segmentEditorRef={editingSegment === segment.id ? segmentEditorRef : { current: null }}
      detectedTerms={activeSegment === segment.id ? detectedTerms : []}
      onAddToGlossary={(text) => setQuickAddTerm({ source_term: text })}
      lookupGlossary={lookupGlossary}
      onEditTerm={handleEditTerm}
      crossHighlight={crossHighlight}
      pivotTranslation={pivotTranslations.get(segment.id)}
      pivotLanguageName={languages.find(l => l.id === sourceLanguageId)?.name}
      showCommentsMargin={showCommentsMargin}
      showChangesMargin={showChangesMargin}
      pendingQuotedText={hasPending ? pendingQuotedText!.text : undefined}
      editorSelection={editorSelection}
      onAnnotationUpdate={handleAnnotationUpdate}
      onCommentCreated={handleCommentCreated}
      onCommentMutate={handleCommentMutate}
      onPendingQuotedTextConsumed={handlePendingQuotedTextConsumed}
      onNavigateToComment={setHighlightedCommentId}
      onEnsureCommentsVisible={handleEnsureCommentsVisible}
      onHunkResolve={handleHunkResolve}
      translating={translating}
      batchRunning={batchRunning}
    />
  )
})}
```

- [ ] **Step 7: Write smoke test for SegmentRow**

```tsx
// frontend/src/components/editor/__tests__/SegmentRow.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorProvider } from '../EditorContext'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

// We test that SegmentRow renders without crashing for basic segment data
describe('SegmentRow', () => {
  it('renders source text for a segment', async () => {
    // Dynamic import to avoid issues with TipTap in test environment
    const { default: SegmentRow } = await import('../SegmentRow')
    const segment = {
      id: 1,
      chapter_id: 1,
      source_text: 'Test source text',
      order: 1,
      paragraph_group: 0,
      translations: [],
    }
    const noop = () => {}
    const noopAsync = async () => {}

    render(
      <MemoryRouter>
        <EditorProvider
          selectedLanguageId={1}
          currentUserId={1}
          trackingEnabled={false}
          displayMode="all-markup"
          sourceFont="font-body"
          hasPermission={() => true}
          highlightedCommentId={null}
          setHighlightedCommentId={noop}
        >
          <SegmentRow
            segment={segment as any}
            segIdx={0}
            isLastSegment={false}
            isNewParagraphGroup={false}
            segComments={[]}
            isActive={false}
            isEditing={false}
            isSplitting={false}
            isSelected={false}
            isHovered={false}
            onActivate={noop}
            onHover={noop}
            onToggleSelect={noop}
            onSplit={noop}
            onMerge={noop}
            onSaveTranslation={noopAsync}
            onCreateTranslation={noopAsync}
            onStatusChange={noop}
            onTranslate={noop}
            onCompare={noop}
            onOpenReview={noop}
            onVersionHistory={noop}
            onAcceptChange={noop}
            onRejectChange={noop}
            onSetPendingQuotedText={noop}
            onEditorSelectionChange={noop}
            onSaveStatusChange={noop}
            onEditingSegmentChange={noop}
            onCrossHighlightChange={noop}
            segmentEditorRef={{ current: null }}
            detectedTerms={[]}
            onAddToGlossary={noop}
            lookupGlossary={async () => []}
            onEditTerm={noop}
            crossHighlight={null}
            showCommentsMargin={false}
            showChangesMargin={false}
            editorSelection={null}
            onAnnotationUpdate={noop}
            onCommentCreated={noop}
            onCommentMutate={noop}
            onPendingQuotedTextConsumed={noop}
            onNavigateToComment={noop}
            onEnsureCommentsVisible={noop}
            onHunkResolve={noopAsync}
            translating={null}
            batchRunning={false}
          />
        </EditorProvider>
      </MemoryRouter>
    )

    expect(screen.getByText('Test source text')).toBeInTheDocument()
  })
})
```

- [ ] **Step 8: Verify build and all tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: No type errors, all tests pass

- [ ] **Step 9: Commit**

```bash
cd frontend
git add src/components/editor/SegmentRow.tsx src/components/editor/__tests__/SegmentRow.test.tsx src/components/editor/TranslationEditor.tsx
git commit -m "refactor: extract SegmentRow with React.memo and stable callbacks"
```

---

## Task 3: Extract useTrackChanges Hook

**Goal:** Move track changes state and handlers out of TranslationEditor into a focused hook, reducing TranslationEditor's state count by 4 and isolating track changes logic.

**Files:**
- Create: `frontend/src/hooks/useTrackChanges.ts`
- Create: `frontend/src/hooks/__tests__/useTrackChanges.test.ts`
- Modify: `frontend/src/components/editor/TranslationEditor.tsx` (replace inline state with hook)

**Acceptance Criteria:**
- [ ] `useTrackChanges` manages: `trackingEnabled`, `displayMode`, `activeHunkIdx`
- [ ] Exposes: `toggleTracking`, `cycleDisplayMode`, `hasVisibleChanges(translation)`, `handleAcceptChange`, `handleRejectChange`
- [ ] TranslationEditor calls `useTrackChanges()` instead of managing track changes state directly
- [ ] Track changes toggle, display mode cycle, accept/reject all work identically

**Verify:** `cd frontend && npx vitest run src/hooks/__tests__/useTrackChanges.test.ts && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Write tests for useTrackChanges**

```typescript
// frontend/src/hooks/__tests__/useTrackChanges.test.ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTrackChanges } from '../useTrackChanges'

describe('useTrackChanges', () => {
  const mockUpdateBT = vi.fn().mockResolvedValue(undefined)
  const mockReloadChapter = vi.fn().mockResolvedValue(undefined)
  const mockUpdateTranslation = vi.fn().mockResolvedValue({ translated_text: 'text', status: 'draft' })

  it('initializes with provided values', () => {
    const { result } = renderHook(() => useTrackChanges({
      initialEnabled: true,
      btId: 1,
      updateBookTranslation: mockUpdateBT,
      reloadChapter: mockReloadChapter,
      updateTranslation: mockUpdateTranslation,
      setChapter: vi.fn(),
      setEditingSegment: vi.fn(),
    }))
    expect(result.current.trackingEnabled).toBe(true)
  })

  it('toggles tracking on/off', async () => {
    const { result } = renderHook(() => useTrackChanges({
      initialEnabled: false,
      btId: 1,
      updateBookTranslation: mockUpdateBT,
      reloadChapter: mockReloadChapter,
      updateTranslation: mockUpdateTranslation,
      setChapter: vi.fn(),
      setEditingSegment: vi.fn(),
    }))

    await act(async () => {
      await result.current.toggleTracking()
    })
    expect(result.current.trackingEnabled).toBe(true)
    expect(mockUpdateBT).toHaveBeenCalledWith(1, { track_changes: true })
  })

  it('cycles display mode: all-markup → no-markup → original → all-markup', () => {
    const { result } = renderHook(() => useTrackChanges({
      initialEnabled: true,
      btId: 1,
      updateBookTranslation: mockUpdateBT,
      reloadChapter: mockReloadChapter,
      updateTranslation: mockUpdateTranslation,
      setChapter: vi.fn(),
      setEditingSegment: vi.fn(),
    }))

    expect(result.current.displayMode).toBe('all-markup')
    act(() => result.current.cycleDisplayMode())
    expect(result.current.displayMode).toBe('no-markup')
    act(() => result.current.cycleDisplayMode())
    expect(result.current.displayMode).toBe('original')
    act(() => result.current.cycleDisplayMode())
    expect(result.current.displayMode).toBe('all-markup')
  })

  it('hasVisibleChanges returns true when previous_text differs', () => {
    const { result } = renderHook(() => useTrackChanges({
      initialEnabled: true,
      btId: 1,
      updateBookTranslation: mockUpdateBT,
      reloadChapter: mockReloadChapter,
      updateTranslation: mockUpdateTranslation,
      setChapter: vi.fn(),
      setEditingSegment: vi.fn(),
    }))

    expect(result.current.hasVisibleChanges({ previous_text: 'old', translated_text: 'new' } as any)).toBe(true)
    expect(result.current.hasVisibleChanges({ previous_text: 'same', translated_text: 'same' } as any)).toBe(false)
    expect(result.current.hasVisibleChanges({ previous_text: null, translated_text: 'text' } as any)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useTrackChanges.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useTrackChanges hook**

```typescript
// frontend/src/hooks/useTrackChanges.ts
import { useState, useCallback } from 'react'
import type { Translation, ChapterDetail } from '../types'

type DisplayMode = 'no-markup' | 'all-markup' | 'original'

interface UseTrackChangesOptions {
  initialEnabled: boolean
  btId: number | null
  updateBookTranslation: (id: number, data: { track_changes: boolean }) => Promise<any>
  reloadChapter: () => Promise<void>
  updateTranslation: (id: number, data: { translated_text: string; status: string; previous_text?: string | null }) => Promise<any>
  setChapter: React.Dispatch<React.SetStateAction<ChapterDetail | null>>
  setEditingSegment: React.Dispatch<React.SetStateAction<number | null>>
}

export function useTrackChanges({
  initialEnabled,
  btId,
  updateBookTranslation,
  reloadChapter,
  updateTranslation,
  setChapter,
  setEditingSegment,
}: UseTrackChangesOptions) {
  const [trackingEnabled, setTrackingEnabled] = useState(initialEnabled)
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    const saved = localStorage.getItem('tc_display_mode')
    if (saved === 'no-markup' || saved === 'original') return saved
    return 'all-markup'
  })
  const [activeHunkIdx, setActiveHunkIdx] = useState<number | null>(null)

  const toggleTracking = useCallback(async () => {
    const newVal = !trackingEnabled
    setTrackingEnabled(newVal)
    if (btId) {
      await updateBookTranslation(btId, { track_changes: newVal })
      await reloadChapter()
    }
  }, [trackingEnabled, btId, updateBookTranslation, reloadChapter])

  const cycleDisplayMode = useCallback(() => {
    const order: DisplayMode[] = ['all-markup', 'no-markup', 'original']
    setDisplayMode(prev => {
      const idx = order.indexOf(prev)
      const next = order[(idx + 1) % order.length]
      localStorage.setItem('tc_display_mode', next)
      return next
    })
  }, [])

  const switchToMarkupIfOriginal = useCallback(() => {
    setDisplayMode(prev => {
      if (prev === 'original') {
        localStorage.setItem('tc_display_mode', 'all-markup')
        return 'all-markup'
      }
      return prev
    })
  }, [])

  const hasVisibleChanges = useCallback((translation: Translation | undefined | null): boolean => {
    if (!trackingEnabled || displayMode !== 'all-markup') return false
    if (!translation?.previous_text) return false
    return translation.previous_text !== translation.translated_text
  }, [trackingEnabled, displayMode])

  const handleAcceptChange = useCallback(async (segmentId: number, translationId: number, currentText: string) => {
    await updateTranslation(translationId, { translated_text: currentText, status: 'draft' })
    setEditingSegment(prev => prev === segmentId ? null : prev)
    setChapter(prev => {
      if (!prev) return prev
      return {
        ...prev,
        segments: prev.segments.map(s => s.id === segmentId ? {
          ...s,
          translations: s.translations.map(tr => tr.id === translationId ? { ...tr, previous_text: tr.translated_text } : tr),
        } : s),
      }
    })
  }, [updateTranslation, setChapter, setEditingSegment])

  const handleRejectChange = useCallback(async (segmentId: number, translationId: number, previousText: string) => {
    await updateTranslation(translationId, { translated_text: previousText, status: 'draft' })
    setEditingSegment(prev => prev === segmentId ? null : prev)
    setChapter(prev => {
      if (!prev) return prev
      return {
        ...prev,
        segments: prev.segments.map(s => s.id === segmentId ? {
          ...s,
          translations: s.translations.map(tr => tr.id === translationId ? { ...tr, translated_text: previousText, previous_text: previousText } : tr),
        } : s),
      }
    })
  }, [updateTranslation, setChapter, setEditingSegment])

  // Sync when initialEnabled changes (e.g., after loadInitial)
  const syncEnabled = useCallback((enabled: boolean) => {
    setTrackingEnabled(enabled)
  }, [])

  return {
    trackingEnabled,
    displayMode,
    activeHunkIdx,
    setActiveHunkIdx,
    toggleTracking,
    cycleDisplayMode,
    switchToMarkupIfOriginal,
    hasVisibleChanges,
    handleAcceptChange,
    handleRejectChange,
    syncEnabled,
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useTrackChanges.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Integrate hook into TranslationEditor**

In `TranslationEditor.tsx`, replace the inline state declarations (lines 259-262) and handlers (lines 586-625, 1157-1170) with:

```tsx
const tc = useTrackChanges({
  initialEnabled: false, // updated in loadInitial via tc.syncEnabled
  btId: btId ? parseInt(btId) : null,
  updateBookTranslation,
  reloadChapter: loadChapter,
  updateTranslation,
  setChapter,
  setEditingSegment,
})
```

Then replace all references:
- `trackingEnabled` → `tc.trackingEnabled`
- `displayMode` → `tc.displayMode`
- `activeHunkIdx` → `tc.activeHunkIdx`
- `setActiveHunkIdx(...)` → `tc.setActiveHunkIdx(...)`
- `handleAcceptChange(...)` → `tc.handleAcceptChange(...)`
- `handleRejectChange(...)` → `tc.handleRejectChange(...)`
- In `loadInitial`: `setTrackingEnabled(!!btData.track_changes)` → `tc.syncEnabled(!!btData.track_changes)`
- In `toggleTracking()` → `tc.toggleTracking()`
- In `cycleDisplayMode()` → `tc.cycleDisplayMode()`

Update EditorProvider to use `tc.trackingEnabled` and `tc.displayMode`.

Delete the inline `toggleTracking`, `cycleDisplayMode`, `handleAcceptChange`, `handleRejectChange` functions.

- [ ] **Step 6: Verify build and all tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: No type errors, all tests pass

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/hooks/useTrackChanges.ts src/hooks/__tests__/useTrackChanges.test.ts src/components/editor/TranslationEditor.tsx
git commit -m "refactor: extract useTrackChanges hook from TranslationEditor"
```

---

## Task 4: Extract useEditorComments Hook

**Goal:** Move comment state and handlers out of TranslationEditor into a focused hook, reducing TranslationEditor's state count by 5 and isolating comment logic.

**Files:**
- Create: `frontend/src/hooks/useEditorComments.ts`
- Create: `frontend/src/hooks/__tests__/useEditorComments.test.ts`
- Modify: `frontend/src/components/editor/TranslationEditor.tsx` (replace inline state with hook)

**Acceptance Criteria:**
- [ ] `useEditorComments` manages: `chapterComments`, `pendingQuotedText`, `editorSelection`, `commentFilter`, `showCommentsMargin`, `showChangesMargin`
- [ ] Exposes stable callbacks: `loadComments`, `handleCommentCreated`, `handleCommentMutate`, `setShowCommentsMargin`, etc.
- [ ] All callbacks are wrapped in `useCallback` (stable identities)
- [ ] TranslationEditor calls `useEditorComments()` instead of managing comment state directly

**Verify:** `cd frontend && npx vitest run src/hooks/__tests__/useEditorComments.test.ts && npx tsc --noEmit`

**Steps:**

- [ ] **Step 1: Write tests for useEditorComments**

```typescript
// frontend/src/hooks/__tests__/useEditorComments.test.ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorComments } from '../useEditorComments'

describe('useEditorComments', () => {
  const mockGetChapterComments = vi.fn().mockResolvedValue({
    comments: [],
    segment_comment_counts: {},
    unresolved_count: 0,
  })

  it('loads comments for a chapter', async () => {
    const { result } = renderHook(() => useEditorComments({
      chapterId: 1,
      languageId: 2,
      getChapterComments: mockGetChapterComments,
    }))

    await act(async () => {
      await result.current.loadComments()
    })

    expect(mockGetChapterComments).toHaveBeenCalledWith(1, 2)
    expect(result.current.chapterComments).toBeTruthy()
  })

  it('handleCommentCreated adds comment optimistically', () => {
    const { result } = renderHook(() => useEditorComments({
      chapterId: 1,
      languageId: 2,
      getChapterComments: mockGetChapterComments,
    }))

    const newComment = {
      id: 99,
      segment_id: 5,
      language_id: 2,
      user_id: 1,
      username: 'test',
      text: 'new comment',
      is_resolved: false,
      replies: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    act(() => {
      result.current.handleCommentCreated(newComment as any)
    })

    expect(result.current.chapterComments?.comments).toContainEqual(newComment)
    expect(result.current.chapterComments?.segment_comment_counts['5']).toBe(1)
  })

  it('toggles comment filter', () => {
    const { result } = renderHook(() => useEditorComments({
      chapterId: 1,
      languageId: 2,
      getChapterComments: mockGetChapterComments,
    }))

    expect(result.current.commentFilter).toBe(false)
    act(() => result.current.setCommentFilter(true))
    expect(result.current.commentFilter).toBe(true)
  })

  it('manages pendingQuotedText', () => {
    const { result } = renderHook(() => useEditorComments({
      chapterId: 1,
      languageId: 2,
      getChapterComments: mockGetChapterComments,
    }))

    act(() => result.current.setPendingQuotedText({ segmentId: 1, text: 'quoted' }))
    expect(result.current.pendingQuotedText).toEqual({ segmentId: 1, text: 'quoted' })

    act(() => result.current.consumePendingQuotedText())
    expect(result.current.pendingQuotedText).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useEditorComments.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useEditorComments hook**

```typescript
// frontend/src/hooks/useEditorComments.ts
import { useState, useCallback } from 'react'
import type { ChapterCommentsData, SegmentComment } from '../types'
import type { EditorSelectionInfo } from '../components/editor/SegmentEditor'

interface UseEditorCommentsOptions {
  chapterId: number | null
  languageId: number
  getChapterComments: (chapterId: number, languageId: number) => Promise<ChapterCommentsData>
}

export function useEditorComments({ chapterId, languageId, getChapterComments }: UseEditorCommentsOptions) {
  const [chapterComments, setChapterComments] = useState<ChapterCommentsData | null>(null)
  const [commentFilter, setCommentFilter] = useState(false)
  const [pendingQuotedText, setPendingQuotedText] = useState<{ segmentId: number; text: string } | null>(null)
  const [editorSelection, setEditorSelection] = useState<{ segmentId: number; info: EditorSelectionInfo } | null>(null)
  const [showCommentsMargin, setShowCommentsMargin] = useState(() => localStorage.getItem('show_comments_margin') !== 'false')
  const [showChangesMargin, setShowChangesMargin] = useState(() => localStorage.getItem('show_changes_margin') !== 'false')

  const loadComments = useCallback(async (delay = 0) => {
    if (!chapterId || !languageId) return
    if (delay > 0) await new Promise(r => setTimeout(r, delay))
    try {
      const data = await getChapterComments(chapterId, languageId)
      setChapterComments(data)
    } catch (err) {
      console.warn('Failed to load comments:', err)
    }
  }, [chapterId, languageId, getChapterComments])

  const handleCommentCreated = useCallback((newComment: SegmentComment) => {
    setChapterComments(prev => {
      if (!prev) {
        return {
          comments: [newComment],
          segment_comment_counts: { [String(newComment.segment_id)]: 1 },
          unresolved_count: 1,
        }
      }
      return {
        ...prev,
        comments: [...prev.comments, newComment],
        segment_comment_counts: {
          ...prev.segment_comment_counts,
          [String(newComment.segment_id)]: (prev.segment_comment_counts[String(newComment.segment_id)] || 0) + 1,
        },
        unresolved_count: prev.unresolved_count + 1,
      }
    })
  }, [])

  const handleCommentMutate = useCallback((updater: (c: SegmentComment[]) => SegmentComment[]) => {
    setChapterComments(prev => {
      if (!prev) return prev
      const updated = updater(prev.comments)
      const counts: Record<string, number> = {}
      for (const c of updated) {
        if (!c.is_resolved) {
          counts[String(c.segment_id)] = (counts[String(c.segment_id)] || 0) + 1
        }
      }
      return {
        ...prev,
        comments: updated,
        segment_comment_counts: counts,
        unresolved_count: Object.values(counts).reduce((a, b) => a + b, 0),
      }
    })
  }, [])

  const consumePendingQuotedText = useCallback(() => {
    setPendingQuotedText(null)
  }, [])

  const ensureCommentsVisible = useCallback(() => {
    setShowCommentsMargin(true)
    localStorage.setItem('show_comments_margin', 'true')
  }, [])

  const toggleCommentsMargin = useCallback(() => {
    setShowCommentsMargin(prev => {
      const next = !prev
      localStorage.setItem('show_comments_margin', String(next))
      return next
    })
  }, [])

  const toggleChangesMargin = useCallback(() => {
    setShowChangesMargin(prev => {
      const next = !prev
      localStorage.setItem('show_changes_margin', String(next))
      return next
    })
  }, [])

  const getSegmentComments = useCallback((segmentId: number): SegmentComment[] => {
    return (chapterComments?.comments || []).filter(c => c.segment_id === segmentId)
  }, [chapterComments])

  return {
    chapterComments,
    commentFilter,
    setCommentFilter,
    pendingQuotedText,
    setPendingQuotedText,
    consumePendingQuotedText,
    editorSelection,
    setEditorSelection,
    showCommentsMargin,
    showChangesMargin,
    setShowCommentsMargin,
    setShowChangesMargin,
    toggleCommentsMargin,
    toggleChangesMargin,
    loadComments,
    handleCommentCreated,
    handleCommentMutate,
    ensureCommentsVisible,
    getSegmentComments,
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useEditorComments.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Integrate hook into TranslationEditor**

Replace the comment state declarations (lines 278-283) and `loadComments` function (lines 458-467) with:

```tsx
const comments = useEditorComments({
  chapterId: chapterId ? parseInt(chapterId) : null,
  languageId: selectedLanguageId,
  getChapterComments,
})
```

Then replace all references:
- `chapterComments` → `comments.chapterComments`
- `setChapterComments(...)` → handled internally
- `commentFilter` → `comments.commentFilter`
- `setCommentFilter(...)` → `comments.setCommentFilter(...)`
- `pendingQuotedText` → `comments.pendingQuotedText`
- `setPendingQuotedText(...)` → `comments.setPendingQuotedText(...)`
- `editorSelection` → `comments.editorSelection`
- `setEditorSelection(...)` → `comments.setEditorSelection(...)`
- `showCommentsMargin` → `comments.showCommentsMargin`
- `showChangesMargin` → `comments.showChangesMargin`
- `loadComments(...)` → `comments.loadComments(...)`
- Inline `onCommentCreated` callback → `comments.handleCommentCreated`
- Inline `onMutate` callback → `comments.handleCommentMutate`

Delete the inline `loadComments` function and the comment-related `useEffect` at line 350.

Update `loadChapter` to call `comments.loadComments()` after fetching chapter data.

- [ ] **Step 6: Verify build and all tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: No type errors, all tests pass

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/hooks/useEditorComments.ts src/hooks/__tests__/useEditorComments.test.ts src/components/editor/TranslationEditor.tsx
git commit -m "refactor: extract useEditorComments hook from TranslationEditor"
```

---

## Task 5: Migrate Diff Consumers to Canonical diffUtils

**Goal:** Replace the 3 independent DiffMatchPatch computations in SegmentAnnotationMargin, InlineDiff, and ChangesPanel with shared functions from `diffUtils.ts`.

**Files:**
- Modify: `frontend/src/components/editor/SegmentAnnotationMargin.tsx:111-133` (replace `getHunkItems()` with `diffUtils.getHunkItems()`)
- Modify: `frontend/src/components/editor/InlineDiff.tsx:91-104` (replace inline hunk index computation with `diffUtils.computeHunkIndices()`)
- Modify: `frontend/src/components/editor/ChangesPanel.tsx:48-80` (replace inline DiffMatchPatch with `diffUtils.getHunkItems()`)

**Acceptance Criteria:**
- [ ] SegmentAnnotationMargin uses `getHunkItems` from diffUtils instead of inline DiffMatchPatch
- [ ] InlineDiff uses `computeHunkIndices` from diffUtils instead of inline logic
- [ ] ChangesPanel uses `getHunkItems` from diffUtils instead of inline DiffMatchPatch
- [ ] Hunk indices are identical across all three components (verified by existing tests)
- [ ] No `new DiffMatchPatch()` in any of these 3 files (only in diffUtils.ts and trackChangesDecoration.ts)

**Verify:** `cd frontend && npx tsc --noEmit && npx vitest run`

**Steps:**

- [ ] **Step 1: Update SegmentAnnotationMargin to use diffUtils.getHunkItems**

In `SegmentAnnotationMargin.tsx`, replace lines 111-133 (the inline `getHunkItems` function):

```tsx
// Before: inline function with new DiffMatchPatch()
// After: import from diffUtils
import { getHunkItems as computeHunkItems } from './diffUtils'

// Replace the getHunkItems function body:
function getHunkItems() {
  if (!hasTrackChanges || !translation?.previous_text) return []
  return computeHunkItems(translation.previous_text, translation.translated_text)
}
```

Also replace the inline `handleHunkAction` function (lines 135-172) which creates its own DiffMatchPatch. This function reconstructs text after accepting/rejecting a hunk — it should use `computeHunks` + `buildResolvedText` from diffUtils:

```tsx
import { getHunkItems as computeHunkItems, computeHunks, buildResolvedText } from './diffUtils'

function handleHunkAction(targetHunkIdx: number, action: 'accept' | 'reject') {
  if (!translation?.previous_text || !onHunkResolve) return
  const hunks = computeHunks(translation.previous_text, translation.translated_text)

  // Find the hunks matching targetHunkIdx (may be a paired delete+insert)
  let hunkCounter = 0
  for (const h of hunks) {
    if (h.type === 'equal') continue
    if (h.type === 'delete') {
      const isPaired = h.groupId !== undefined
      if (hunkCounter === targetHunkIdx) {
        if (action === 'accept') {
          h.status = 'accepted'
          // If paired, also accept the insert
          if (isPaired) {
            const paired = hunks.find(p => p.groupId === h.groupId && p.type === 'insert')
            if (paired) paired.status = 'accepted'
          }
        } else {
          h.status = 'rejected'
          if (isPaired) {
            const paired = hunks.find(p => p.groupId === h.groupId && p.type === 'insert')
            if (paired) paired.status = 'rejected'
          }
        }
      }
      if (!isPaired) hunkCounter++
      else {
        // Skip the paired insert in counter since getHunkItems treats pair as one
        hunkCounter++
      }
      continue
    }
    if (h.type === 'insert' && h.groupId === undefined) {
      if (hunkCounter === targetHunkIdx) {
        h.status = action === 'accept' ? 'accepted' : 'rejected'
      }
      hunkCounter++
    }
  }

  const newTrans = buildResolvedText(hunks)
  // For the new previous_text, build what "accept" means:
  // accepted changes become part of the new baseline
  const baselineHunks = computeHunks(translation.previous_text, translation.translated_text)
  // ... rebuild previous text similarly

  if (action === 'accept') {
    const newPrev = newTrans === translation.translated_text ? null : translation.previous_text
    onHunkResolve(segment.id, translation.id, translation.translated_text, newPrev === translation.translated_text ? null : newPrev || null)
  } else {
    onHunkResolve(segment.id, translation.id, newTrans, translation.previous_text === newTrans ? null : translation.previous_text || null)
  }
}
```

Note: The exact `handleHunkAction` rewrite depends on maintaining identical behavior. The implementer should verify by testing with the existing inline logic side-by-side before replacing it. Keep the original logic as a comment during development for comparison.

Remove the `import DiffMatchPatch from 'diff-match-patch'` line from SegmentAnnotationMargin.tsx.

- [ ] **Step 2: Update InlineDiff to use diffUtils.computeHunkIndices**

In `InlineDiff.tsx`, replace lines 90-104 (inline hunk index computation):

```tsx
import { computeDiffs, computeHunkIndices } from './diffUtils'

// Replace the useMemo for parts:
const { parts, hunkIndices } = useMemo(() => {
  if (oldText === newText) return { parts: null, hunkIndices: [] }
  const diffs = computeDiffs(oldText, newText)
  const indices = computeHunkIndices(oldText, newText)
  return { parts: diffs, hunkIndices: indices }
}, [oldText, newText])
```

Remove lines 91-104 (the inline `hunkIdx` assignment loop) since `hunkIndices` now comes from the useMemo above.

Remove `import DiffMatchPatch from 'diff-match-patch'` from InlineDiff.tsx.

- [ ] **Step 3: Update ChangesPanel to use diffUtils**

In `ChangesPanel.tsx`, replace the inline hunk computation (lines 48-80):

```tsx
import { getHunkItems } from './diffUtils'

// Replace the useMemo:
const hunkItems = useMemo(() => {
  const items: HunkItem[] = []
  for (const seg of segments) {
    const t = seg.translations[0]
    if (!t?.previous_text || t.previous_text === t.translated_text) continue
    const segHunks = getHunkItems(t.previous_text, t.translated_text)
    for (const hunk of segHunks) {
      items.push({
        segmentId: seg.id,
        segmentOrder: seg.order,
        hunkIdx: hunk.hunkIdx,
        deleted: hunk.deleted,
        inserted: hunk.inserted,
        authorName: t.updated_by_username || 'Unknown',
      })
    }
  }
  return items
}, [segments])
```

Remove `import DiffMatchPatch from 'diff-match-patch'` from ChangesPanel.tsx.

- [ ] **Step 4: Verify no DiffMatchPatch imports remain in the 3 files**

Run: `cd frontend && grep -l "from 'diff-match-patch'" src/components/editor/SegmentAnnotationMargin.tsx src/components/editor/InlineDiff.tsx src/components/editor/ChangesPanel.tsx`
Expected: No output (no files contain the import)

Only `diffUtils.ts` and `trackChangesDecoration.ts` should import DiffMatchPatch directly.

- [ ] **Step 5: Verify build and all tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: No type errors, all tests pass

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/components/editor/SegmentAnnotationMargin.tsx src/components/editor/InlineDiff.tsx src/components/editor/ChangesPanel.tsx
git commit -m "refactor: migrate diff consumers to canonical diffUtils module"
```

---

## Task 6: Extract TranslationDisplay Component

**Goal:** Encapsulate the 3-way display mode branching (all-markup / no-markup / original) into a dedicated component, eliminating the deeply nested ternary in SegmentRow.

**Files:**
- Create: `frontend/src/components/editor/TranslationDisplay.tsx`
- Modify: `frontend/src/components/editor/SegmentRow.tsx` (replace inline ternary with `<TranslationDisplay>`)

**Acceptance Criteria:**
- [ ] `TranslationDisplay` renders the correct view based on `trackingEnabled` + `displayMode` from EditorContext
- [ ] Editing mode renders `SegmentEditor` (passed as children or via render prop)
- [ ] Non-editing mode renders: InlineDiff (all-markup), plain text (no-markup/original), or TextHighlighter (default)
- [ ] Accept/Reject buttons appear when appropriate
- [ ] SegmentRow's translation column JSX reduced from ~120 lines to ~15 lines

**Verify:** `cd frontend && npx tsc --noEmit && npx vitest run`

**Steps:**

- [ ] **Step 1: Create TranslationDisplay component**

```tsx
// frontend/src/components/editor/TranslationDisplay.tsx
import React from 'react'
import { CheckCircle, AlertCircle } from 'lucide-react'
import { useEditorContext } from './EditorContext'
import InlineDiff from './InlineDiff'
import TextHighlighter from './TextHighlighter'
import SourceTextSelection from './SourceTextSelection'
import type { Translation, SegmentComment } from '../../types'

interface Props {
  translation: Translation | undefined
  segmentId: number
  isEditing: boolean
  comments: SegmentComment[]
  children?: React.ReactNode // SegmentEditor when editing
  onAcceptChange: (segmentId: number, translationId: number) => void
  onRejectChange: (segmentId: number, translationId: number, previousText: string) => void
  onSetPendingQuotedText: (data: { segmentId: number; text: string }) => void
  onClickComment: (commentId: number) => void
  onLookupResults?: (results: any[] | null) => void
}

export default function TranslationDisplay({
  translation,
  segmentId,
  isEditing,
  comments,
  children,
  onAcceptChange,
  onRejectChange,
  onSetPendingQuotedText,
  onClickComment,
  onLookupResults,
}: Props) {
  const { trackingEnabled, displayMode } = useEditorContext()

  // No translation yet
  if (!translation?.translated_text && !isEditing) {
    return (
      <p className="text-sm text-ink-700 dark:text-cream-dim leading-relaxed whitespace-pre-wrap font-body">
        <span className="text-parchment-300 dark:text-ink-400 italic">No translation yet</span>
      </p>
    )
  }

  // Editing mode — render the editor (passed as children)
  if (isEditing) {
    return <>{children}</>
  }

  const hasChanges = trackingEnabled && !!translation?.previous_text && translation.previous_text !== translation.translated_text

  const handleComment = (selectedText: string) => {
    onSetPendingQuotedText({ segmentId, text: selectedText })
  }

  // All-markup mode with changes
  if (displayMode === 'all-markup' && hasChanges) {
    return (
      <>
        <SourceTextSelection onComment={handleComment}>
          <InlineDiff
            oldText={translation!.previous_text!}
            newText={translation!.translated_text}
            authorId={translation!.updated_by}
            comments={comments}
            onClickComment={onClickComment}
          />
        </SourceTextSelection>
        <AcceptRejectButtons
          segmentId={segmentId}
          translation={translation!}
          onAccept={onAcceptChange}
          onReject={onRejectChange}
        />
      </>
    )
  }

  // Original mode — show baseline text
  if (displayMode === 'original' && trackingEnabled && translation?.previous_text) {
    return (
      <SourceTextSelection onComment={handleComment}>
        <p className="text-sm text-ink-700 dark:text-cream-dim leading-relaxed whitespace-pre-wrap font-body">
          {translation.previous_text}
        </p>
      </SourceTextSelection>
    )
  }

  // Default: clean text with comment highlights
  return (
    <SourceTextSelection
      onComment={handleComment}
      onLookupResults={onLookupResults}
    >
      <TextHighlighter
        text={translation!.translated_text}
        comments={comments}
        onClickHighlight={onClickComment}
        className="text-sm text-ink-700 dark:text-cream-dim leading-relaxed whitespace-pre-wrap font-body"
      />
    </SourceTextSelection>
  )
}

function AcceptRejectButtons({
  segmentId,
  translation,
  onAccept,
  onReject,
}: {
  segmentId: number
  translation: Translation
  onAccept: (segmentId: number, translationId: number) => void
  onReject: (segmentId: number, translationId: number, previousText: string) => void
}) {
  return (
    <div className="flex items-center gap-1 mt-1.5">
      <button
        onClick={(e) => { e.stopPropagation(); onAccept(segmentId, translation.id) }}
        className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-body font-medium rounded bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
      >
        <CheckCircle className="w-2.5 h-2.5" /> Accept
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onReject(segmentId, translation.id, translation.previous_text!) }}
        className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-body font-medium rounded bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
      >
        <AlertCircle className="w-2.5 h-2.5" /> Reject
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Replace the display mode branching in SegmentRow**

In `SegmentRow.tsx`, replace the ~120-line ternary chain in the translation column with:

```tsx
<TranslationDisplay
  translation={translation}
  segmentId={segment.id}
  isEditing={isEditing && hasPermission('translations.edit')}
  comments={segComments}
  onAcceptChange={onAcceptChange}
  onRejectChange={onRejectChange}
  onSetPendingQuotedText={onSetPendingQuotedText}
  onClickComment={setHighlightedCommentId}
  onLookupResults={(results) => {
    if (results?.length) {
      onCrossHighlightChange({ segmentId: segment.id, sourceTerms: [...new Set(results.map(r => r.source_term))] })
    } else {
      onCrossHighlightChange(null)
    }
  }}
>
  {/* Editor slot — only rendered when isEditing */}
  <SegmentEditor
    ref={segmentEditorRef}
    translation={translation || { id: 0, segment_id: segment.id, language_id: selectedLanguageId, translated_text: '', status: 'empty' as any, llm_model_used: null, token_count: 0, updated_at: '' }}
    onSave={(text) => translation ? onSaveTranslation(translation.id, text) : onCreateTranslation(segment.id, text)}
    previousText={trackingEnabled ? translation?.previous_text : null}
    onSaveStatusChange={onSaveStatusChange}
    onSelectionChange={(info) => onEditorSelectionChange(info ? { segmentId: segment.id, info } : null)}
    comments={segComments}
  />
</TranslationDisplay>
```

- [ ] **Step 3: Verify build and all tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: No type errors, all tests pass

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/editor/TranslationDisplay.tsx src/components/editor/SegmentRow.tsx
git commit -m "refactor: extract TranslationDisplay to encapsulate display mode branching"
```

---

## Post-Refactor Verification Checklist

After all tasks are complete, manually verify:

- [ ] Track changes toggle works (enable/disable)
- [ ] Display mode cycles correctly (all-markup → no-markup → original)
- [ ] Inline diffs show green/red markup in all-markup mode
- [ ] Accept/reject buttons work at segment level
- [ ] Per-hunk accept/reject works in annotation margin
- [ ] Creating a comment with quoted text works
- [ ] Comment highlight (amber ring) appears and auto-clears
- [ ] Emoji reactions on change cards work
- [ ] Find/replace works across segments
- [ ] Keyboard shortcuts (Ctrl+S, Tab, Ctrl+Enter) work
- [ ] Compact mode toggle works
- [ ] Batch translate works
- [ ] Version history panel opens and restores
- [ ] No console errors during normal operation
- [ ] TypeScript compilation clean: `cd frontend && npx tsc --noEmit`
- [ ] All tests pass: `cd frontend && npx vitest run`
