# Editor Improvements: Comments, Track Changes Persistence, Formatting Toolbar

**Date:** 2026-03-30
**Status:** Design approved

## Goal

Close the gap between the BITS web editor and Microsoft Word so that reviewers and translators no longer feel the need to roundtrip files through Word/OneDrive. Three features, in priority order:

1. **Segment Comments** — Google Docs-style threaded comments per segment
2. **Track Changes Persistence** — move track changes state from localStorage to the database
3. **Formatting Toolbar** — visible Bold/Italic toolbar when editing a segment

## 1. Segment Comments

### Data Model

New tables:

```sql
CREATE TABLE segment_comments (
    id SERIAL PRIMARY KEY,
    segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    parent_id INTEGER REFERENCES segment_comments(id) ON DELETE CASCADE,  -- NULL = top-level, non-NULL = reply
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_segment_comments_segment_language ON segment_comments(segment_id, language_id);
```

**Why `language_id`?** Comments are scoped to a translation context. A comment on the English translation of segment 42 is not relevant to the Indonesian translation of segment 42.

**Thread model:** Flat with one level of nesting. `parent_id = NULL` starts a thread. Replies set `parent_id` to the top-level comment's ID. No deeper nesting — keeps UI simple.

**Resolution:** Only top-level comments can be resolved (resolving a thread). `is_resolved` on the top-level comment resolves the entire thread. Replies inherit the parent's resolved status implicitly.

### SQLAlchemy Model

```python
class SegmentComment(Base):
    __tablename__ = "segment_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    segment_id: Mapped[int] = mapped_column(ForeignKey("segments.id", ondelete="CASCADE"), index=True)
    language_id: Mapped[int] = mapped_column(ForeignKey("languages.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("segment_comments.id", ondelete="CASCADE"), nullable=True)
    is_resolved: Mapped[bool] = mapped_column(default=False)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

### API Endpoints

All under `/api/comments`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/comments?segment_id={id}&language_id={id}` | List comments for a segment+language (threaded) |
| GET | `/comments/chapter/{chapter_id}?language_id={id}` | List all comments in a chapter (for count badges + filter) |
| POST | `/comments` | Create comment (top-level or reply) |
| PATCH | `/comments/{id}` | Edit comment text (own comments only) |
| DELETE | `/comments/{id}` | Delete comment (own comments or admin) |
| POST | `/comments/{id}/resolve` | Resolve a thread |
| POST | `/comments/{id}/unresolve` | Unresolve a thread |

**Chapter-level endpoint** returns a summary shape:

```json
{
  "comments": [...],
  "segment_comment_counts": { "42": 2, "57": 1 },
  "unresolved_count": 3
}
```

This powers the comment count badges on each segment row and the "Comments (N)" filter chip without per-segment API calls.

### Pydantic Schemas

```python
class CommentCreate(BaseModel):
    segment_id: int
    language_id: int
    text: str
    parent_id: int | None = None

class CommentUpdate(BaseModel):
    text: str

class CommentResponse(BaseModel):
    id: int
    segment_id: int
    language_id: int
    user_id: int
    username: str
    text: str
    parent_id: int | None
    is_resolved: bool
    resolved_by: int | None
    resolved_by_username: str | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime
    replies: list["CommentResponse"] = []

    model_config = {"from_attributes": True}
```

### Frontend

**TypeScript interfaces** (in `types/index.ts`):

```typescript
interface SegmentComment {
  id: number
  segment_id: number
  language_id: number
  user_id: number
  username: string
  text: string
  parent_id: number | null
  is_resolved: boolean
  resolved_by: number | null
  resolved_by_username: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  replies: SegmentComment[]
}
```

**API client** (`api/comments.ts`): Standard CRUD matching the endpoints above.

**UI changes in TranslationEditor.tsx:**

1. **Comment icon per segment row** — MessageSquare icon from lucide-react. Shows red badge with unresolved count. Click toggles the comment thread inline below the translation text.

2. **Comment thread component** — New `SegmentCommentThread.tsx`:
   - Lists comments with user avatar (first letter + color), username, relative timestamp
   - Reply input at bottom
   - "Resolve" button on top-level comments (green checkmark)
   - Resolved threads shown collapsed with "Resolved" badge, expandable

3. **"Comments" filter chip** — Added to the filter bar after the status chips, separated by a divider. Shows count of segments with unresolved comments. Clicking it filters to those segments.

4. **State management:**
   - `chapterComments` state loaded once via the chapter-level endpoint when chapter loads
   - Updated optimistically on create/resolve/delete
   - `segmentCommentCounts` derived from `chapterComments` for badge rendering

### Permissions

- Any authenticated user can create comments and replies
- Users can edit/delete their own comments
- Admins can delete any comment
- Any authenticated user can resolve/unresolve threads

## 2. Track Changes Persistence

### Problem

Track changes currently works at the UI level but has persistence issues:

1. **TC mode** (off/markup/clean) is stored in localStorage, not synced to the DB `track_changes` boolean that already exists on `BookTranslation`
2. **`previous_text`** is derived by comparing `translation.translated_text` against the latest `TranslationVersion.translated_text` — this is fragile because any save creates a new version, so the diff baseline keeps shifting
3. **The resolve endpoint has a bug**: both `accept_all` and `reject_all` create the same version entry. The `accept_all` branch should just clear the baseline without creating a redundant version.

### Solution

#### 2a. Sync TC mode to DB

The `BookTranslation.track_changes` boolean column already exists. Currently:
- Frontend reads TC mode from localStorage
- DB field exists but is only used for display

**Change:** Replace the localStorage-based mode with the DB field. Since the DB field is boolean (on/off) but the UI has three modes (off/markup/clean), the approach is:

- DB `track_changes` boolean = whether tracking is active (captures diffs)
- UI display mode (markup vs clean) stays in localStorage — this is a per-user view preference, not shared state
- When `track_changes` is toggled **on** via the dropdown, PATCH the BookTranslation to set `track_changes: true`
- When toggled **off**, PATCH to `track_changes: false`

#### 2b. Add `previous_text` column to translations table

Add a real `previous_text` column instead of deriving it from version history:

```sql
ALTER TABLE translations ADD COLUMN previous_text TEXT;
```

Migration in `_run_migrations()`:
```python
("translations", "previous_text", "TEXT"),
```

**Behavior:**
- When track changes is **enabled** on a BookTranslation: snapshot all existing `translated_text` values into `previous_text` for that book+language's translations (bulk UPDATE)
- When a segment is **saved** with TC on: the update endpoint checks if `previous_text` is NULL; if so, it sets `previous_text` to the current `translated_text` before writing the new text. If `previous_text` is already set, it's left alone — the baseline stays at the original snapshot point, accumulating all changes since TC was enabled
- When track changes is **disabled**: clear all `previous_text` to NULL for that book+language
- **Accept** a change: set `previous_text = NULL` (or `previous_text = translated_text`)
- **Reject** a change: set `translated_text = previous_text`, then `previous_text = NULL`

#### 2c. Fix resolve endpoint

```python
@router.post("/track-changes/resolve")
async def resolve_track_changes(data, db, user):
    # For each translation in the chapter+language:
    if data.action == 'accept_all':
        # Keep current text, clear baseline
        translation.previous_text = None
    else:  # reject_all
        # Revert to baseline, clear it
        translation.translated_text = translation.previous_text
        translation.previous_text = None
        translation.updated_by = user.id
    # Create version entry for audit trail in both cases
```

#### 2d. Backend returns `previous_text` authoritatively

The chapter detail endpoint already returns `previous_text` (via `prev_text_map`). After adding the column, this simplifies to just reading `translation.previous_text` directly instead of querying TranslationVersion.

Frontend removes all local `previous_text` management from optimistic updates — just uses what the backend returns, refreshing after save.

#### 2e. Snapshot on TC enable

New endpoint or extend the PATCH handler for BookTranslation:

When `track_changes` changes from `false` to `true`:
```sql
UPDATE translations
SET previous_text = translated_text
WHERE segment_id IN (SELECT id FROM segments WHERE chapter_id IN
    (SELECT id FROM chapters WHERE book_id = :book_id))
AND language_id = :target_language_id
AND translated_text IS NOT NULL
AND previous_text IS NULL;
```

When `track_changes` changes from `true` to `false`:
```sql
UPDATE translations
SET previous_text = NULL
WHERE segment_id IN (SELECT id FROM segments WHERE chapter_id IN
    (SELECT id FROM chapters WHERE book_id = :book_id))
AND language_id = :target_language_id;
```

### Frontend Changes

- Remove localStorage read/write for `track_changes_${btId}`
- Read TC enabled state from `bt.track_changes`
- Display mode (markup/clean) stays in localStorage (view preference)
- On mode change: if switching from off to markup/clean, PATCH `bt.track_changes = true`; if switching to off, PATCH `bt.track_changes = false`
- Remove optimistic `previous_text` management from `handleSaveTranslation` — reload segment data after save instead, or have the update endpoint return the updated `previous_text`

## 3. Formatting Toolbar

### Implementation

Minimal change to `SegmentEditor.tsx`:

1. **Add toolbar div** above the TipTap `EditorContent` component
2. **Two buttons:** Bold (B) and Italic (I)
3. **Active state:** Highlight button when formatting is active at cursor position
4. **Undo/Redo buttons:** Already available via StarterKit, just expose as toolbar buttons
5. **Keyboard hint:** Small text showing "Ctrl+B / Ctrl+I" as a reminder

### TipTap Integration

```typescript
// Bold button
<button
  onClick={() => editor.chain().focus().toggleBold().run()}
  className={editor.isActive('bold') ? 'bg-active' : ''}
>B</button>

// Italic button
<button
  onClick={() => editor.chain().focus().toggleItalic().run()}
  className={editor.isActive('italic') ? 'bg-active' : ''}
>I</button>

// Undo/Redo
<button onClick={() => editor.chain().focus().undo().run()}>Undo</button>
<button onClick={() => editor.chain().focus().redo().run()}>Redo</button>
```

### Visibility

- Toolbar only renders when the segment is in **edit mode** (`isEditing === true`)
- Collapses away when not editing to keep the segment list clean

### Word/Character Count

Add to the toolbar's right side:
```typescript
const text = editor.getText()
const words = text.trim().split(/\s+/).filter(Boolean).length
const chars = text.length
// Display: "12 words · 78 chars"
```

This already exists in the chapter-level progress but not per-segment during editing.

## Architecture Summary

```
New files:
  backend/app/models/segment_comment.py    — SQLAlchemy model
  backend/app/schemas/segment_comment.py   — Pydantic schemas
  backend/app/api/comments.py              — API router
  frontend/src/api/comments.ts             — API client
  frontend/src/components/editor/SegmentCommentThread.tsx — Comment thread UI

Modified files:
  backend/app/core/database.py             — Migration for segment_comments table + translations.previous_text column
  backend/app/api/__init__.py              — Register comments router
  backend/app/api/translate.py             — Fix resolve endpoint, update save to manage previous_text
  backend/app/api/book_translations.py     — Snapshot/clear previous_text on TC toggle
  backend/app/api/books.py                 — Simplify previous_text loading (read column directly)
  frontend/src/types/index.ts              — SegmentComment interface
  frontend/src/components/editor/TranslationEditor.tsx — Comments state, filter chip, TC sync, comment icons
  frontend/src/components/editor/SegmentEditor.tsx     — Formatting toolbar
```

## Out of Scope

- Inline text-level comments (highlighting specific words) — segment-level threads are sufficient for this team size
- Real-time collaborative editing (Yjs/CRDT)
- Email/push notifications for new comments
- Spell check integration (separate future feature)
- Underline, superscript, subscript formatting
