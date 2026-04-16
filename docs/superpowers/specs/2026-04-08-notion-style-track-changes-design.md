# Notion-Style Track Changes & Comments — Design Spec

## Goal

Replace the decoration-based track changes system with a transaction-intercepting architecture (via `@manuscripts/track-changes-plugin`) and improve the comment/annotation UX to match Notion's suggested edits and inline comments model. The result is a reliable track changes system where deletions stay in the document, plus polished comment cards with connector lines, Notion-style hover menus, margin filtering, and a sidebar version history panel.

## Motivation

The current decoration-based approach (diff-match-patch + ProseMirror decorations) has been the source of recurring bugs:
- Text fragmentation during typing (diff recomputes on every keystroke)
- Paragraph spacing collapse (deleted text is removed from the DOM)
- Stale closure bugs (save callbacks capture wrong state)
- Hunk index disagreements between components

These are architectural problems, not implementation problems. Matching Notion's model — where edits are intercepted at the transaction level and deletions are marked rather than removed — eliminates this entire class of bugs by design.

## Reference

Notion's suggested edits and inline comments spec: see `/Users/it1/Downloads/notion-suggested-edits-and-comments-spec.md`

---

## 1. Track Changes Architecture

### Current → New

Replace `trackChangesDecoration.ts` (decoration-based diffing) with `@manuscripts/track-changes-plugin` (transaction interception).

**Before:** User edits → text modified in ProseMirror → auto-save captures `previous_text` → diff computed later → decorations overlaid as widgets

**After:** User edits → plugin intercepts transaction → deletions marked (text stays in document) → insertions marked → marks styled via CSS → accept/reject operates on marks directly

### Schema Changes

Add to the TipTap/ProseMirror schema for SegmentEditor:

- `tracked_insert` mark — wraps inserted text, carries metadata (change ID, user, timestamp)
- `tracked_delete` mark — wraps deleted text (text stays in DOM), carries same metadata
- `dataTracked: null` attribute on paragraph and text nodes (required by the plugin)

### Plugin Integration

Wrap `@manuscripts/track-changes-plugin` as a TipTap Extension:

```typescript
const TrackChanges = Extension.create({
  name: 'trackChanges',
  addProseMirrorPlugins() {
    return [trackChangesPlugin({ userID: currentUserId })]
  }
})
```

The plugin runs per-segment — each segment's TipTap editor instance gets an independent plugin. When `BookTranslation.track_changes` is true, the plugin is active for all segment editors.

### CSS Styling

- `tracked_insert` mark: green text with green underline (matches current green addition style)
- `tracked_delete` mark: red text with red strikethrough, slightly dimmed (matches current red deletion style)
- Both marks are inline — they do not affect paragraph structure or spacing

### Activation

Track changes is a project-level setting (`BookTranslation.track_changes` field in the database, toggled via the FileDiff toolbar button). When enabled, all segment editors in that BookTranslation activate the plugin. This is unchanged from the current model.

---

## 2. Change Representation & Storage

### In the Editor

When the plugin is active and a user deletes text, the ProseMirror document retains the text wrapped in a `tracked_delete` mark:

```
Someone once asked me: "What was your first <tracked_delete>impression of </tracked_delete>
```

The mark carries metadata:
```json
{ "id": "change-1", "user": "admin", "timestamp": 1712505600000, "operation": "delete" }
```

Insertions get a `tracked_insert` mark with the same metadata structure.

### Saving to Backend

When auto-save fires, `translated_text` stores the full document content including marks as ProseMirror JSON (serialized via `editor.getJSON()`). This preserves mark metadata that HTML cannot represent cleanly. The backend stores this as a JSON text column. This means:
- `translated_text` contains both visible text AND tracked deletions/insertions with their marks
- `previous_text` is set once when tracking is first enabled (used for the read-only InlineDiff view outside edit mode)

### Accept/Reject

- **Accept insertion:** Remove the `tracked_insert` mark → text becomes permanent
- **Accept deletion:** Remove the marked text entirely from the document
- **Reject insertion:** Remove the marked text from the document
- **Reject deletion:** Remove the `tracked_delete` mark → text is restored to normal

These operations use the plugin's `setChangeStatuses` command.

### Reading Changes for Margin Cards

The `SegmentAnnotationMargin` reads `tracked_insert` and `tracked_delete` marks directly from the editor's document state via the plugin's `ChangeSet` utility class. Each mark has the change ID, user, and timestamp. No diffing needed.

---

## 3. Comment System Improvements

### Connector Lines

- Thin 1px grey horizontal line from the left edge of each margin card to the right edge of its highlighted text anchor in the editor
- Drawn via a lightweight SVG overlay (absolute-positioned between the editor column and margin column)
- Updates on scroll, resize, and card repositioning
- Only visible for the active segment's cards

### Hover Menus (Notion Pattern)

**Change cards (hover toolbar):**
- Accept (checkmark) · Reject (X) · Emoji (smiley)

**Top-level comments (hover toolbar):**
- Resolve (checkmark) · Emoji (smiley) · `···` menu → Edit, Delete

**Replies (hover toolbar):**
- Emoji (smiley) · `···` menu → Edit, Delete

Key behaviors:
- Action buttons appear on hover only (progressive disclosure)
- Only the comment owner sees Edit/Delete in the `···` menu
- Resolve is available to anyone with edit permission

### Keyboard Shortcut

`Cmd/Ctrl+Shift+M` creates a comment on selected text. Added to `useEditorShortcuts` hook.

### Margin Card Vertical Alignment

Cards are positioned vertically to align with their corresponding change/comment in the editor text (already partially implemented). Connector lines reinforce this visual link.

### Thread Collapsing

First + last reply always visible. Middle replies collapsed with "Show N replies" link. Replies render in compact mode (no avatar indent). Already implemented.

---

## 4. Annotation Margin Controls

### Filter Bar

Small control bar at the top of the Annotations column:

```
[ ≡ All (5) ] [ ⎘ Changes (3) ] [ 💬 Comments (2) ] [ 👁 ]
```

- **Filter icons with counts:** All (list icon) / Changes (file-diff icon) / Comments (message-square icon)
- **Show resolved toggle:** Eye icon — when on, resolved comments and accepted/rejected changes appear dimmed at the bottom
- Counts update live as changes are accepted/resolved
- Icons are compact, fitting in the ~300px margin width

### Margin Visibility

- The margin column is visible when there's any content (changes or comments) OR when the panel toggle is on
- PanelRight toggle button in the main toolbar controls visibility (already implemented)
- Toggle state persists in localStorage

---

## 5. Version History Panel

### Layout

- Right sidebar panel (~300px wide), replaces the annotation margin when open
- Header: "Version history" with close (X) button
- Timeline list: each entry shows timestamp + author name/email
- "Restore" button pinned at bottom of panel
- Versions grouped by day ("Today", "Yesterday", "April 6")

### Behavior

- Click a version → editor shows that version's text with diffs highlighted inline (green additions, red strikethrough deletions) compared to current version
- Editor becomes read-only while version history is open
- Click "Restore" → restores selected version (with confirmation via useConfirm)
- Close panel → returns to normal editing with annotation margin

### Per-Segment Model

- Version history is per-segment (each translation has its own version history)
- Opened via the clock icon on the segment toolbar
- Sidebar shows versions for the active segment only
- Active segment shows diff inline; other segments stay normal

### Auto-Save Grouping

- Multiple auto-saves within a 5-minute window from the same user collapse into one entry (showing the latest timestamp)
- Prevents the list from being cluttered with frequent auto-save entries

### Mark Handling

- Versions are saved with marks intact (tracked changes included in snapshot)
- When displaying diffs in the version list, marks are stripped before diffing so the comparison shows actual content changes
- Restoring a version restores the full document state including any pending tracked changes

---

## 6. Seamless Segment Editing

### Navigation

- Arrow keys at the top/bottom edge of one segment's editor move focus to the adjacent segment
- `Tab` advances to next segment (already implemented)
- Clicking anywhere in the translation column activates that segment's editor inline

### Visual Polish

- Minimal dividers between segments (faint dotted line instead of full borders)
- No distinct background change when a segment is active — editor appears in place
- Source column scrolls in sync, keeping active segment's source visible
- Formatting toolbar appears when a segment is active (already implemented)

### Per-Segment Independence

- Auto-save continues per-segment (2s debounce)
- Track changes plugin runs independently per segment editor instance
- Comments and annotations are per-segment

---

## 7. Code Removal

The migration removes significant fragile code:

| File/Code | Action |
|-----------|--------|
| `trackChangesDecoration.ts` | **Delete** — replaced by @manuscripts plugin |
| `diff-match-patch` in save flow | **Remove** — no more diffing on save |
| `previous_text` capture in `handleSaveTranslation` | **Simplify** — just save, no baseline computation |
| `onSaveRef` / `hasChangesRef` workarounds | **Remove** — stale closure bugs eliminated |
| Debounce logic (REBUILD_META) | **Remove** — no decoration rebuilds |
| `useTrackChanges` hook | **Rewrite** — wraps plugin commands instead of managing diff state |
| `getHunkItems` / `computeHunkIndices` in diffUtils | **Keep** — used by InlineDiff for read-only view |
| `InlineDiff.tsx` | **Keep** — used when segment is not being edited |
| `SegmentAnnotationMargin.tsx` | **Adapt** — reads marks from editor state instead of computing diffs |
| `VersionHistoryPanel.tsx` | **Rewrite** — sidebar panel replacing modal, with version grouping |

Net effect: ~400 lines of workaround code removed, replaced by ~100 lines of plugin integration. The bugs fixed this session (stale closures, debounce, paragraph spacing) become structurally impossible.

---

## 8. Technical Dependencies

### New Package

```
@manuscripts/track-changes-plugin ^2.3.9
```

### ProseMirror Deduplication (Critical)

The plugin requires ProseMirror package deduplication. TipTap bundles ProseMirror via `@tiptap/pm`. If versions conflict, add to `package.json`:

```json
{
  "overrides": {
    "prosemirror-model": "<version from @tiptap/pm>",
    "prosemirror-transform": "<version from @tiptap/pm>",
    "prosemirror-state": "<version from @tiptap/pm>"
  }
}
```

### Files Preserved

- `EditorContext.tsx` — shared editor state
- `SegmentRow.tsx` — memoized segment rendering
- `TranslationDisplay.tsx` — display mode branching
- `useEditorComments.ts` — comment state management
- `diffUtils.ts` — kept for InlineDiff read-only view
- All comment components (CommentThread, CommentInput, CommentReactions)
- `SegmentEditor.tsx` — adapted to use new plugin instead of decoration plugin

### Backend Changes

- **Storage format change:** `translated_text` column changes from plain text to ProseMirror JSON (string). The column type (`Text`) is sufficient — JSON is stored as a string. A migration adds a `content_format` field (`'plain' | 'prosemirror'`) to the Translation model so the frontend knows how to render legacy vs new content.
- **Accept/reject:** The existing `updateTranslation` endpoint is sufficient. When the frontend accepts/rejects a change, it applies the plugin command locally, then saves the updated document (with marks removed/modified) via the normal save flow. No new endpoints needed for mark-level operations.
- **Version history:** No API changes needed. Versions store `translated_text` snapshots which now contain ProseMirror JSON.
- **`previous_text`:** Continues to store plain text (the clean baseline from when tracking was enabled). Set once on first save after tracking is toggled on. Used for the read-only InlineDiff view outside edit mode.

### Implementation Order

This spec decomposes into four independent workstreams, each getting its own implementation plan:

1. **Track changes migration** — Install plugin, schema changes, adapt SegmentEditor, adapt SegmentAnnotationMargin, remove old decoration code. This is the critical path.
2. **Comment/margin improvements** — Connector lines, Notion-style hover menus, margin filter controls, `Cmd+Shift+M` shortcut. Independent of track changes migration.
3. **Version history rewrite** — Sidebar panel replacing modal, version grouping, inline diff display. Independent of other workstreams.
4. **Seamless editing polish** — Segment navigation, visual dividers, sync scrolling. Independent of other workstreams.
