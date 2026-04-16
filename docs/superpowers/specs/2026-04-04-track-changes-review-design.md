# Track Changes Review System — Design Spec

**Date:** 2026-04-04
**Status:** Approved

## Problem

The current track changes feature shows inline diffs (strikethrough + colored text) but provides only a single accept/reject pair per segment. Reviewers cannot accept some changes and reject others within a segment. There is no way to see who made a change, navigate between changes, or view the original baseline text. The workflow does not match what reviewers expect from tools like Microsoft Word.

## Context

- 2-3+ editors make changes to AI-translated segments
- One approver reviews all edits, accepting or rejecting each change
- The approver needs to scan across many segments and selectively interact with individual changes
- The existing data model stores `previous_text` (baseline), `updated_by`, `updated_at` per translation, and full version history

## Design

### Two Independent Controls

Track changes separates **recording** from **viewing** — two independent toolbar controls, matching Microsoft Word's model.

**Toggle: "Track"** (on/off)
- On: new edits are recorded against the baseline (`previous_text` is set)
- Off: new edits go straight in, no tracking

**Dropdown: Display** (visible when any tracked changes exist in the chapter)
- **All Markup** — inline diffs visible + changes panel shown
- **No Markup** — current text only, no visual markup
- **Original** — baseline text (`previous_text`) displayed instead of current text; auto-switches to All Markup if the user starts editing

The toggle and dropdown are independent. Tracking can be off while viewing All Markup (see existing changes without tracking new edits), or tracking can be on while viewing No Markup (record changes without visual clutter).

### All Markup Mode — Inline Diff

The translation column shows inline diffs exactly as the current `InlineDiff` component renders them:
- Strikethrough + dimmed red for deletions
- Colored highlight for insertions

The inline diff is **read-only** — no buttons, no hover controls, no interactive elements in the text. It is purely a visual representation of changes. All interaction happens through the changes panel.

### Changes Panel

A narrow panel (approximately 280-320px wide) that appears as an additional column to the right of the translation column, visible only in All Markup mode. The source and translation columns shrink proportionally to accommodate it. Contains:

**Header:**
- Pending change counter: "3 of 12 changes"
- Previous / Next navigation buttons (step through pending changes in segment order, auto-scrolling the editor to bring the relevant segment into view)
- Undo button
- Accept All / Reject All for the entire chapter

**Change Cards — one per segment with pending changes:**
- Full inline diff (not truncated) — same strikethrough/highlight styling as the main editor
- Author name + relative timestamp ("admin · 3h ago") sourced from `updated_by_username` and `updated_at`
- Per-hunk Accept / Reject buttons when the segment has multiple distinct changes
- Per-segment Accept All / Reject All when multiple hunks exist

Each card is visually aligned with its corresponding segment in the editor. When navigating via Previous/Next, the active card and its segment are highlighted.

### Accept / Reject Behavior

**Immediate save.** Accepting or rejecting a hunk writes to the database immediately, matching the existing behavior. Accepted insertions become final text; rejected insertions are removed. Accepted deletions revert to original text; rejected deletions stay removed.

When all hunks in a segment are resolved, `previous_text` is cleared and the segment leaves the changes panel.

A version history snapshot is created before each write (existing behavior), providing a full audit trail.

**Undo.** A local action stack records recent accept/reject actions within the current session. The Undo button in the panel header (and Ctrl+Z / Cmd+Z keyboard shortcut) pops the last action and reverses it. The stack clears when the user navigates to a different chapter.

### Original Mode

Displays the `previous_text` (baseline) for each segment in place of the current translated text. The changes panel is hidden. The view is read-only in appearance, but if the user clicks to edit a segment, the mode auto-switches to All Markup and the editor opens normally.

For segments without `previous_text` (no tracked changes), the current translated text is shown as-is.

### No Markup Mode

Displays the current translated text with no visual diff markup. The changes panel is hidden. Editing works normally. If Track is on, edits continue to be recorded against the baseline.

## Components Affected

### Modified

- **TranslationEditor.tsx** — toolbar controls (replace current track changes dropdown with toggle + display dropdown), integrate changes panel, add Original mode rendering, add undo keyboard shortcut
- **InlineDiff.tsx** — no functional changes, already read-only

### New

- **ChangesPanel.tsx** — the right-side panel with change cards, navigation, bulk actions, undo button
- **ChangeCard.tsx** — individual change card with full diff, author info, per-hunk accept/reject (uses the hunk computation logic from existing `DiffReviewView`)

### Removed / Deprecated

- The per-segment Accept/Reject buttons currently rendered inline below each segment in the translation column (already hidden during editing; will be fully replaced by the changes panel)
- The existing `DiffReviewView` review mode trigger (the panel replaces this workflow). The `DiffReviewView` component's hunk computation logic (`computeHunks`, `buildResolvedText`) will be extracted and reused by `ChangeCard`.

## Data Model

No changes. The design uses existing fields:
- `translations.previous_text` — baseline text for diffing
- `translations.updated_by` / `updated_at` — author attribution
- `translation_versions` — undo audit trail
- `book_translations.track_changes` — recording toggle

## Out of Scope

- Mobile-specific layout (bottom sheet, swipe gestures)
- Multi-author per-segment attribution (showing individual edits by different editors within one diff)
- Real-time collaborative editing
