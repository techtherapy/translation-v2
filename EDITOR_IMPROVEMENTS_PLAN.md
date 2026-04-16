# Translation Editor UX Improvement Plan

## Context

The BITS translation editor is a side-by-side Chinese→English editor used by 2-5 translators processing 300+ Buddhist books. While the core infrastructure is solid (AI translation, glossary detection, model comparison, segment split/merge), the editing workflow has significant gaps compared to professional CAT tools. Translators must mouse-click for nearly every action, there's no auto-save, and version history is saved but invisible. These friction points compound across hundreds of segments per session.

**Key decision:** TM (Translation Memory) is deprioritized. Buddhist philosophical writing by a single author has varied, contextual prose — not the repetitive content where TM excels. The glossary is the higher-value asset for consistent terminology. Streaming translation is also dropped — not worth the complexity for 2-5 users.

---

## Phase 1: Core Workflow Acceleration (Highest Impact)

### 1.1 Keyboard Shortcuts
- **Ctrl+S** save, **Ctrl+Enter** translate, **Ctrl+↓/↑** or **Tab/Shift+Tab** navigate segments, **Ctrl+Shift+Enter** save + advance to next, **Enter** activate segment (replace double-click), **Escape** deselect
- Create `hooks/useEditorShortcuts.ts` hook, wire into `TranslationEditor.tsx`
- Intercept Ctrl+S in TipTap's `handleKeyDown` to prevent browser save dialog
- Change segment activation from double-click to single-click
- Add `?` shortcut cheat sheet overlay
- **Files:** `TranslationEditor.tsx`, `SegmentEditor.tsx`, new `hooks/useEditorShortcuts.ts`

### 1.2 Auto-Save with Debounce
- Save automatically after 2s of inactivity; save immediately on segment change
- Show subtle status indicator (Saving... / Saved / Error)
- **Critical fix:** Replace `loadChapter()` full-reload after save with optimistic local state update — prevents editor unmount/remount flicker
- Add `beforeunload` warning for unsaved changes
- **Files:** `SegmentEditor.tsx`, `TranslationEditor.tsx`

### 1.3 Enhanced Glossary in Editor
- **Glossary coverage stats:** Show per-chapter metrics — how many glossary terms appear, how many have translations in the target language, how many are missing from translations (builds on existing QA check)
- **Glossary autocomplete in editor:** When translator types in TipTap, suggest glossary term translations inline (e.g., typing "Bodhi" shows the preferred translation). Lightweight — queries the already-cached glossary terms, not a full TM search
- **Improved bottom panel:** Enhance Glossary tab to show all chapter-level glossary terms (not just active segment), grouped by category, with quick-filter to find terms. Add "copy translation" button for fast insertion
- **Files:** `EditorBottomPanel.tsx`, `TranslationEditor.tsx`, `SegmentEditor.tsx` (TipTap extension for autocomplete)

### 1.4 Segment Status Workflow Controls
- Add status dropdown/buttons next to status badge on active segment
- Allow translators to set draft/needs_revision, reviewers to set under_review/approved
- Keyboard shortcuts: Ctrl+1 through Ctrl+4 for quick status
- Color-code segment rows by status for visual scanning
- **Files:** `TranslationEditor.tsx` (backend already accepts `status` field on update)

---

## Phase 2: Editor Intelligence

### 2.1 Version History UI
- New endpoint `GET /api/translate/segment/{id}/versions` returning all `TranslationVersion` rows
- New endpoint `POST /api/translate/segment/{id}/restore/{version_id}` to revert
- History icon (lucide `History`) on active segment opens panel/modal
- Show versions with timestamp, model used, creator, and inline diff highlighting
- **Files:** `backend/app/api/translate.py`, `backend/app/schemas/translation.py`, new `VersionHistoryPanel.tsx`, `api/translate.ts`

### 2.2 Find and Replace
- Ctrl+F opens search bar above segment grid, searches source and/or translation text
- Highlights matching segments and text within them
- Ctrl+H for replace across matching segments
- Navigate matches with Enter/Ctrl+G
- Entirely frontend — all segment data already loaded client-side
- **Files:** new `FindReplaceBar.tsx`, `TranslationEditor.tsx`

---

## Phase 3: Professional Polish

### 3.1 Segment Filtering & Progress Overview
- Filter chips by status (empty, machine_translated, draft, approved, needs_revision)
- Compact progress bar: "45 approved / 12 draft / 3 needs revision / 2 empty"
- Frontend-only — filter `chapter.segments` before rendering
- **Files:** `TranslationEditor.tsx`, new `useSegmentFilter.ts`

### 3.2 Word/Character Count
- Per-segment: Chinese character count + English word count
- Chapter totals in toolbar
- Translation density ratio indicator
- **Files:** `TranslationEditor.tsx`

### 3.3 Batch Status Update
- Checkbox column on segment grid with select-all header
- Floating action bar: change status of selected segments, re-translate selected
- **Files:** `TranslationEditor.tsx` (builds on 1.4)

### 3.4 Editor Refactoring
- Extract from monolithic `TranslationEditor.tsx` (820+ lines):
  - `useEditorState` hook (chapter/book loading, language selection)
  - `useSegmentActions` hook (translate, save, split, merge)
  - `useGlossaryIntegration` hook (detection, QA, cross-highlight)
  - `SegmentRow` component (from inline `.map()` JSX)
  - `EditorToolbar` component
- Enables all Phase 4 work

---

## Phase 4: Advanced (Future)

### 4.1 Collaborative Editing Indicators
- Show which segments are locked by other users (uses existing `locked_by` column on Translation model)
- Polling or WebSocket for real-time updates

### 4.2 Glossary-Aware Inline Autocomplete
- TipTap extension showing glossary term translation suggestions as translator types
- Tab to accept, Escape to dismiss
- Uses cached glossary data (no network requests needed)

---

## Verification

After each phase:
1. Run `cd frontend && tsc -b` to verify no type errors
2. Run `cd frontend && npx vite build` to verify production build
3. Manual testing: open editor, activate segment, verify keyboard shortcuts / auto-save / TM tab / status controls work
4. Test dark mode for all new UI elements
5. Test with a real chapter (multiple segments) to verify batch operations
