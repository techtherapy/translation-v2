# Editor Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add segment comments, persistent track changes, and a formatting toolbar to close the gap between the BITS web editor and Microsoft Word.

**Architecture:** Three independent features built sequentially. Comments require a new model/router/component chain. Track changes persistence fixes the existing system by adding a `previous_text` column and syncing state to the DB. Formatting toolbar is a self-contained SegmentEditor enhancement.

**Tech Stack:** Python/FastAPI, SQLAlchemy 2.0 (async), React 18, TipTap, TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-30-editor-improvements-design.md`

---

## File Map

### New files
| File | Responsibility |
|------|----------------|
| `backend/app/models/segment_comment.py` | SQLAlchemy model for SegmentComment |
| `backend/app/schemas/segment_comment.py` | Pydantic request/response schemas |
| `backend/app/api/comments.py` | FastAPI router for comment CRUD + resolve |
| `frontend/src/api/comments.ts` | Axios API client for comments |
| `frontend/src/components/editor/SegmentCommentThread.tsx` | Comment thread UI component |

### Modified files
| File | Changes |
|------|---------|
| `backend/app/core/database.py` | Migration: `segment_comments` table + `translations.previous_text` column |
| `backend/app/api/__init__.py` | Register comments router |
| `backend/app/api/translate.py` | Fix resolve endpoint; manage `previous_text` on save |
| `backend/app/api/book_translations.py` | Snapshot/clear `previous_text` on TC toggle |
| `backend/app/api/books.py` | Simplify `previous_text` loading (read column directly) |
| `backend/app/models/translation.py` | Add `previous_text` mapped column |
| `frontend/src/types/index.ts` | Add `SegmentComment` interface |
| `frontend/src/components/editor/TranslationEditor.tsx` | Comments state, filter chip, TC sync to DB |
| `frontend/src/components/editor/SegmentEditor.tsx` | Formatting toolbar (Bold/Italic/Undo/Redo) |
| `frontend/src/data/releaseNotes.ts` | New release notes entry |
| `frontend/package.json` | Version bump |

---

## Task 1: Backend — SegmentComment model + migration

**Files:**
- Create: `backend/app/models/segment_comment.py`
- Modify: `backend/app/core/database.py`
- Modify: `backend/app/models/translation.py`

- [ ] **Step 1: Create the SegmentComment model**

Create `backend/app/models/segment_comment.py`:

```python
from datetime import datetime

from sqlalchemy import (
    Integer, ForeignKey, DateTime, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SegmentComment(Base):
    """Threaded comment on a segment's translation."""

    __tablename__ = "segment_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    segment_id: Mapped[int] = mapped_column(
        ForeignKey("segments.id", ondelete="CASCADE"), index=True,
    )
    language_id: Mapped[int] = mapped_column(
        ForeignKey("languages.id", ondelete="CASCADE"),
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("segment_comments.id", ondelete="CASCADE"), nullable=True,
    )
    is_resolved: Mapped[bool] = mapped_column(default=False)
    resolved_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])
    resolved_by_user: Mapped["User | None"] = relationship("User", foreign_keys=[resolved_by])
    replies: Mapped[list["SegmentComment"]] = relationship(
        "SegmentComment",
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="SegmentComment.created_at",
    )
    parent: Mapped["SegmentComment | None"] = relationship(
        "SegmentComment", back_populates="replies", remote_side=[id],
    )
```

- [ ] **Step 2: Add `previous_text` column to Translation model**

In `backend/app/models/translation.py`, add this line after the `updated_by` field (line 43):

```python
    previous_text: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 3: Add migration for both changes**

In `backend/app/core/database.py`, add to the `column_migrations` list (after the `track_changes` entry at line 114):

```python
        ("translations", "previous_text", "TEXT"),
```

Then add a new migration function after the existing migrations (after line ~126), before the closing of `_run_migrations()`:

```python
    # --- Create segment_comments table ---
    async def _create_segment_comments():
        async with engine.begin() as conn:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS segment_comments (
                    id SERIAL PRIMARY KEY,
                    segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
                    language_id INTEGER NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    text TEXT NOT NULL,
                    parent_id INTEGER REFERENCES segment_comments(id) ON DELETE CASCADE,
                    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
                    resolved_by INTEGER REFERENCES users(id),
                    resolved_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                )
            """))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_segment_comments_segment_language "
                "ON segment_comments(segment_id, language_id)"
            ))
    await _safe_execute("segment_comments table", _create_segment_comments())
```

- [ ] **Step 4: Verify the app starts without errors**

Run: `cd backend && python -c "from app.models.segment_comment import SegmentComment; from app.models.translation import Translation; print('Models OK')"`

Expected: `Models OK`

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/segment_comment.py backend/app/models/translation.py backend/app/core/database.py
git commit -m "feat: add SegmentComment model and previous_text column migration"
```

---

## Task 2: Backend — Comment schemas + API router

**Files:**
- Create: `backend/app/schemas/segment_comment.py`
- Create: `backend/app/api/comments.py`
- Modify: `backend/app/api/__init__.py`

- [ ] **Step 1: Create Pydantic schemas**

Create `backend/app/schemas/segment_comment.py`:

```python
from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel


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
    replies: list[CommentResponse] = []

    model_config = {"from_attributes": True}


class ChapterCommentsResponse(BaseModel):
    comments: list[CommentResponse]
    segment_comment_counts: dict[str, int]  # segment_id -> unresolved count
    unresolved_count: int
```

- [ ] **Step 2: Create the comments API router**

Create `backend/app/api/comments.py`:

```python
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.segment import Segment
from app.models.chapter import Chapter
from app.models.segment_comment import SegmentComment
from app.schemas.segment_comment import (
    CommentCreate, CommentUpdate, CommentResponse, ChapterCommentsResponse,
)

router = APIRouter()


def _build_response(comment: SegmentComment, username_map: dict[int, str]) -> CommentResponse:
    """Build a CommentResponse from a SegmentComment, recursively including replies."""
    return CommentResponse(
        id=comment.id,
        segment_id=comment.segment_id,
        language_id=comment.language_id,
        user_id=comment.user_id,
        username=username_map.get(comment.user_id, "unknown"),
        text=comment.text,
        parent_id=comment.parent_id,
        is_resolved=comment.is_resolved,
        resolved_by=comment.resolved_by,
        resolved_by_username=username_map.get(comment.resolved_by) if comment.resolved_by else None,
        resolved_at=comment.resolved_at,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        replies=[_build_response(r, username_map) for r in comment.replies],
    )


async def _get_username_map(db: AsyncSession, user_ids: set[int]) -> dict[int, str]:
    """Batch-load usernames for a set of user IDs."""
    if not user_ids:
        return {}
    result = await db.execute(select(User).where(User.id.in_(user_ids)))
    return {u.id: u.username for u in result.scalars().all()}


def _collect_user_ids(comments: list[SegmentComment]) -> set[int]:
    """Recursively collect all user IDs from comments and replies."""
    ids: set[int] = set()
    for c in comments:
        ids.add(c.user_id)
        if c.resolved_by:
            ids.add(c.resolved_by)
        ids.update(_collect_user_ids(c.replies))
    return ids


@router.get("/chapter/{chapter_id}", response_model=ChapterCommentsResponse)
async def list_chapter_comments(
    chapter_id: int,
    language_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List all comments in a chapter for a given language, with counts per segment."""
    seg_ids_query = select(Segment.id).where(Segment.chapter_id == chapter_id)
    result = await db.execute(
        select(SegmentComment)
        .where(
            SegmentComment.segment_id.in_(seg_ids_query),
            SegmentComment.language_id == language_id,
            SegmentComment.parent_id.is_(None),  # top-level only
        )
        .order_by(SegmentComment.created_at)
    )
    top_level = result.scalars().unique().all()

    user_ids = _collect_user_ids(top_level)
    username_map = await _get_username_map(db, user_ids)

    comments = [_build_response(c, username_map) for c in top_level]

    # Count unresolved comments per segment
    segment_counts: dict[str, int] = {}
    for c in top_level:
        if not c.is_resolved:
            key = str(c.segment_id)
            segment_counts[key] = segment_counts.get(key, 0) + 1

    return ChapterCommentsResponse(
        comments=comments,
        segment_comment_counts=segment_counts,
        unresolved_count=sum(segment_counts.values()),
    )


@router.post("", response_model=CommentResponse, status_code=201)
async def create_comment(
    data: CommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new comment or reply."""
    if data.parent_id:
        parent = await db.get(SegmentComment, data.parent_id)
        if not parent:
            raise HTTPException(status_code=404, detail="Parent comment not found")
        if parent.parent_id is not None:
            raise HTTPException(status_code=400, detail="Cannot reply to a reply (one level of nesting only)")

    comment = SegmentComment(
        segment_id=data.segment_id,
        language_id=data.language_id,
        user_id=user.id,
        text=data.text,
        parent_id=data.parent_id,
    )
    db.add(comment)
    await db.flush()
    await db.refresh(comment)

    username_map = await _get_username_map(db, {user.id})
    return _build_response(comment, username_map)


@router.patch("/{comment_id}", response_model=CommentResponse)
async def update_comment(
    comment_id: int,
    data: CommentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Edit a comment's text. Only the author can edit."""
    comment = await db.get(SegmentComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.user_id != user.id:
        raise HTTPException(status_code=403, detail="Can only edit your own comments")
    comment.text = data.text
    await db.flush()
    await db.refresh(comment)
    username_map = await _get_username_map(db, {user.id})
    return _build_response(comment, username_map)


@router.delete("/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a comment. Author or admin only."""
    comment = await db.get(SegmentComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Can only delete your own comments")
    await db.delete(comment)


@router.post("/{comment_id}/resolve", response_model=CommentResponse)
async def resolve_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Resolve a top-level comment thread."""
    comment = await db.get(SegmentComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.parent_id is not None:
        raise HTTPException(status_code=400, detail="Can only resolve top-level comments")
    comment.is_resolved = True
    comment.resolved_by = user.id
    comment.resolved_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(comment)
    user_ids = _collect_user_ids([comment])
    user_ids.add(user.id)
    username_map = await _get_username_map(db, user_ids)
    return _build_response(comment, username_map)


@router.post("/{comment_id}/unresolve", response_model=CommentResponse)
async def unresolve_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Unresolve a top-level comment thread."""
    comment = await db.get(SegmentComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.parent_id is not None:
        raise HTTPException(status_code=400, detail="Can only unresolve top-level comments")
    comment.is_resolved = False
    comment.resolved_by = None
    comment.resolved_at = None
    await db.flush()
    await db.refresh(comment)
    user_ids = _collect_user_ids([comment])
    username_map = await _get_username_map(db, user_ids)
    return _build_response(comment, username_map)
```

- [ ] **Step 3: Register the router**

In `backend/app/api/__init__.py`, add the import after the existing imports:

```python
from app.api.comments import router as comments_router
```

And add the router registration after the existing `include_router` calls:

```python
api_router.include_router(comments_router, prefix="/comments", tags=["comments"])
```

- [ ] **Step 4: Verify the app starts and endpoint is registered**

Run: `cd backend && python -c "from app.api.comments import router; print(f'{len(router.routes)} routes registered')"`

Expected: `7 routes registered`

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/segment_comment.py backend/app/api/comments.py backend/app/api/__init__.py
git commit -m "feat: add comments API with CRUD, resolve/unresolve, and chapter-level listing"
```

---

## Task 3: Backend — Track changes persistence

**Files:**
- Modify: `backend/app/api/translate.py`
- Modify: `backend/app/api/book_translations.py`
- Modify: `backend/app/api/books.py`

- [ ] **Step 1: Update the translation save endpoint to manage `previous_text`**

In `backend/app/api/translate.py`, in the `update_translation` function (around line 700), add track-changes logic after the version is saved and before `translation.translated_text` is updated.

Replace lines 726-731 (where `translated_text` and `status` are set):

```python
    translation.translated_text = data.translated_text
    if data.status:
        translation.status = SegmentStatus(data.status)
    else:
        translation.status = SegmentStatus.draft
    translation.updated_by = user.id
```

With:

```python
    # Track changes: set previous_text baseline if TC is on and no baseline exists
    if translation.previous_text is None:
        # Check if track_changes is enabled for this translation's book
        from app.models.book_translation import BookTranslation
        from app.models.chapter import Chapter
        from app.models.segment import Segment as SegModel
        seg = await db.get(SegModel, translation.segment_id)
        if seg:
            ch = await db.get(Chapter, seg.chapter_id)
            if ch:
                bt_result = await db.execute(
                    select(BookTranslation).where(
                        BookTranslation.book_id == ch.book_id,
                        BookTranslation.target_language_id == translation.language_id,
                    )
                )
                bt = bt_result.scalar_one_or_none()
                if bt and bt.track_changes and translation.translated_text:
                    translation.previous_text = translation.translated_text

    translation.translated_text = data.translated_text
    if data.status:
        translation.status = SegmentStatus(data.status)
    else:
        translation.status = SegmentStatus.draft
    translation.updated_by = user.id
```

- [ ] **Step 2: Fix the resolve_track_changes endpoint**

In `backend/app/api/translate.py`, replace the `resolve_track_changes` function (lines 873-930) with:

```python
@router.post("/track-changes/resolve", response_model=dict)
async def resolve_track_changes(
    data: TrackChangesResolveRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.edit")),
):
    """Accept or reject all tracked changes in a chapter."""
    if data.action not in ('accept_all', 'reject_all'):
        raise HTTPException(status_code=400, detail="action must be 'accept_all' or 'reject_all'")

    seg_result = await db.execute(
        select(Segment).where(Segment.chapter_id == data.chapter_id).order_by(Segment.order)
    )
    segments = seg_result.scalars().all()

    resolved = 0
    for seg in segments:
        t_result = await db.execute(
            select(Translation).where(
                Translation.segment_id == seg.id,
                Translation.language_id == data.language_id,
            )
        )
        translation = t_result.scalar_one_or_none()
        if not translation or not translation.previous_text:
            continue
        if translation.previous_text == translation.translated_text:
            # No actual change — just clear baseline
            translation.previous_text = None
            continue

        if data.action == 'accept_all':
            # Keep current text, clear baseline
            translation.previous_text = None
        else:
            # Revert to baseline text
            # Save current text as a version first for audit
            v_result = await db.execute(
                select(func.max(TranslationVersion.version_number))
                .where(TranslationVersion.translation_id == translation.id)
            )
            max_ver = v_result.scalar() or 0
            db.add(TranslationVersion(
                translation_id=translation.id,
                version_number=max_ver + 1,
                translated_text=translation.translated_text,
                status=translation.status,
                created_by=user.id,
            ))
            translation.translated_text = translation.previous_text
            translation.previous_text = None
            translation.updated_by = user.id
        resolved += 1

    return {"resolved": resolved, "action": data.action}
```

- [ ] **Step 3: Add TC snapshot/clear on BookTranslation toggle**

In `backend/app/api/book_translations.py`, update the `update_book_translation` function. Add the snapshot logic after `setattr` loop and before `db.flush()`. Replace lines 218-228:

```python
    update_data = data.model_dump(exclude_unset=True)
    # Only set fields that exist on the model to avoid errors with pending migrations
    for field, value in update_data.items():
        if hasattr(bt, field):
            setattr(bt, field, value)

    try:
        await db.flush()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save: {exc}")
    return await _enrich_response(bt, db)
```

With:

```python
    update_data = data.model_dump(exclude_unset=True)

    # Detect track_changes toggle
    tc_toggling_on = 'track_changes' in update_data and update_data['track_changes'] and not bt.track_changes
    tc_toggling_off = 'track_changes' in update_data and not update_data['track_changes'] and bt.track_changes

    # Only set fields that exist on the model to avoid errors with pending migrations
    for field, value in update_data.items():
        if hasattr(bt, field):
            setattr(bt, field, value)

    # Snapshot or clear previous_text based on TC toggle
    if tc_toggling_on or tc_toggling_off:
        from app.models.chapter import Chapter
        from app.models.segment import Segment
        from app.models.translation import Translation

        chapter_ids_q = select(Chapter.id).where(Chapter.book_id == bt.book_id)
        seg_ids_q = select(Segment.id).where(Segment.chapter_id.in_(chapter_ids_q))

        t_result = await db.execute(
            select(Translation).where(
                Translation.segment_id.in_(seg_ids_q),
                Translation.language_id == bt.target_language_id,
            )
        )
        translations = t_result.scalars().all()

        for t in translations:
            if tc_toggling_on:
                # Snapshot current text as baseline
                if t.translated_text and t.previous_text is None:
                    t.previous_text = t.translated_text
            else:
                # Clear all baselines
                t.previous_text = None

    try:
        await db.flush()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save: {exc}")
    return await _enrich_response(bt, db)
```

- [ ] **Step 4: Simplify `previous_text` loading in chapter detail**

In `backend/app/api/books.py`, the chapter detail endpoint currently derives `previous_text` from TranslationVersion queries (lines 910-922). Replace that block:

```python
    # Batch-load latest version text for each translation (for track changes diff)
    all_trans_ids = [t.id for t in all_translations]
    prev_text_map: dict[int, str] = {}
    if all_trans_ids:
        # Use ORM query with distinct_on (PostgreSQL DISTINCT ON via SQLAlchemy)
        ver_result = await db.execute(
            select(TranslationVersion.translation_id, TranslationVersion.translated_text)
            .where(TranslationVersion.translation_id.in_(all_trans_ids))
            .distinct(TranslationVersion.translation_id)
            .order_by(TranslationVersion.translation_id, TranslationVersion.version_number.desc())
        )
        for tid, txt in ver_result.all():
            prev_text_map[tid] = txt
```

With:

```python
    # previous_text is now a column on Translation — no version query needed
    prev_text_map: dict[int, str | None] = {t.id: t.previous_text for t in all_translations if t.previous_text}
```

And the line that uses it (line 937) stays the same:
```python
                previous_text=prev_text_map.get(t.id),
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/translate.py backend/app/api/book_translations.py backend/app/api/books.py
git commit -m "feat: persist track changes — previous_text column, fix resolve endpoint, snapshot on TC toggle"
```

---

## Task 4: Frontend — Comments API client + TypeScript types

**Files:**
- Create: `frontend/src/api/comments.ts`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add SegmentComment interface**

In `frontend/src/types/index.ts`, add after the `QAIssue` interface (at the end of the file):

```typescript
export interface SegmentComment {
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

export interface ChapterCommentsData {
  comments: SegmentComment[]
  segment_comment_counts: Record<string, number>
  unresolved_count: number
}
```

- [ ] **Step 2: Create the comments API client**

Create `frontend/src/api/comments.ts`:

```typescript
import api from './client'
import type { SegmentComment, ChapterCommentsData } from '../types'

export async function getChapterComments(
  chapterId: number,
  languageId: number,
): Promise<ChapterCommentsData> {
  const { data } = await api.get(`/comments/chapter/${chapterId}`, {
    params: { language_id: languageId },
  })
  return data
}

export async function createComment(params: {
  segment_id: number
  language_id: number
  text: string
  parent_id?: number | null
}): Promise<SegmentComment> {
  const { data } = await api.post('/comments', params)
  return data
}

export async function updateComment(
  commentId: number,
  text: string,
): Promise<SegmentComment> {
  const { data } = await api.patch(`/comments/${commentId}`, { text })
  return data
}

export async function deleteComment(commentId: number): Promise<void> {
  await api.delete(`/comments/${commentId}`)
}

export async function resolveComment(commentId: number): Promise<SegmentComment> {
  const { data } = await api.post(`/comments/${commentId}/resolve`)
  return data
}

export async function unresolveComment(commentId: number): Promise<SegmentComment> {
  const { data } = await api.post(`/comments/${commentId}/unresolve`)
  return data
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/comments.ts
git commit -m "feat: add SegmentComment types and API client"
```

---

## Task 5: Frontend — SegmentCommentThread component

**Files:**
- Create: `frontend/src/components/editor/SegmentCommentThread.tsx`

- [ ] **Step 1: Create the comment thread component**

Create `frontend/src/components/editor/SegmentCommentThread.tsx`:

```tsx
import React, { useState } from 'react'
import { Check, X, Send, RotateCcw } from 'lucide-react'
import { createComment, resolveComment, unresolveComment, deleteComment } from '../../api/comments'
import type { SegmentComment } from '../../types'

const AVATAR_COLORS = [
  'bg-blue-600', 'bg-purple-600', 'bg-teal-600', 'bg-orange-600', 'bg-green-600',
  'bg-rose-600', 'bg-indigo-600', 'bg-amber-600',
]

function avatarColor(userId: number): string {
  return AVATAR_COLORS[userId % AVATAR_COLORS.length]
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

interface Props {
  comments: SegmentComment[]
  segmentId: number
  languageId: number
  currentUserId: number
  onUpdate: () => void
}

export default function SegmentCommentThread({
  comments,
  segmentId,
  languageId,
  currentUserId,
  onUpdate,
}: Props) {
  const [newText, setNewText] = useState('')
  const [replyingTo, setReplyingTo] = useState<number | null>(null)
  const [replyText, setReplyText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleCreate(parentId: number | null, text: string) {
    if (!text.trim()) return
    setSubmitting(true)
    try {
      await createComment({ segment_id: segmentId, language_id: languageId, text: text.trim(), parent_id: parentId })
      if (parentId) { setReplyText(''); setReplyingTo(null) }
      else setNewText('')
      onUpdate()
    } finally { setSubmitting(false) }
  }

  async function handleResolve(commentId: number) {
    await resolveComment(commentId)
    onUpdate()
  }

  async function handleUnresolve(commentId: number) {
    await unresolveComment(commentId)
    onUpdate()
  }

  async function handleDelete(commentId: number) {
    if (!confirm('Delete this comment?')) return
    await deleteComment(commentId)
    onUpdate()
  }

  function renderComment(c: SegmentComment, isReply = false) {
    const isOwn = c.user_id === currentUserId
    return (
      <div key={c.id} className={`${isReply ? 'ml-6' : ''} mb-2`}>
        <div className="flex items-start gap-2">
          <div className={`${avatarColor(c.user_id)} text-white text-[9px] w-5 h-5 rounded-full flex items-center justify-center font-semibold flex-shrink-0 mt-0.5`}>
            {c.username.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-ink-850 dark:text-cream">{c.username}</span>
              <span className="text-[10px] text-parchment-500 dark:text-cream-muted">{timeAgo(c.created_at)}</span>
              {isOwn && (
                <button onClick={() => handleDelete(c.id)} className="text-[10px] text-parchment-400 hover:text-red-500 dark:text-cream-muted dark:hover:text-red-400 ml-auto" title="Delete">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <p className="text-xs text-ink-700 dark:text-cream-dim leading-relaxed mt-0.5 font-body">{c.text}</p>

            {/* Actions for top-level comments */}
            {!isReply && (
              <div className="flex items-center gap-2 mt-1">
                {!c.is_resolved && (
                  <>
                    <button
                      onClick={() => setReplyingTo(replyingTo === c.id ? null : c.id)}
                      className="text-[10px] text-parchment-500 hover:text-gold dark:text-cream-muted dark:hover:text-gold-light font-body"
                    >
                      Reply
                    </button>
                    <button
                      onClick={() => handleResolve(c.id)}
                      className="flex items-center gap-0.5 text-[10px] text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 font-body"
                    >
                      <Check className="w-3 h-3" /> Resolve
                    </button>
                  </>
                )}
                {c.is_resolved && (
                  <button
                    onClick={() => handleUnresolve(c.id)}
                    className="flex items-center gap-0.5 text-[10px] text-parchment-500 hover:text-gold dark:text-cream-muted dark:hover:text-gold-light font-body"
                  >
                    <RotateCcw className="w-3 h-3" /> Unresolve
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Replies */}
        {c.replies.map(r => renderComment(r, true))}

        {/* Reply input */}
        {replyingTo === c.id && (
          <div className="ml-6 mt-1 flex gap-1">
            <input
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleCreate(c.id, replyText)}
              placeholder="Reply..."
              className="flex-1 text-[11px] px-2 py-1 border border-parchment-200 dark:border-ink-600 rounded bg-white dark:bg-ink-800 text-ink-700 dark:text-cream-dim font-body focus:outline-none focus:border-gold"
              autoFocus
            />
            <button
              onClick={() => handleCreate(c.id, replyText)}
              disabled={submitting || !replyText.trim()}
              className="p-1 text-gold hover:text-gold-dark dark:hover:text-gold-light disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    )
  }

  // Split into unresolved and resolved
  const unresolved = comments.filter(c => !c.is_resolved)
  const resolved = comments.filter(c => c.is_resolved)

  return (
    <div className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/30 rounded-lg p-2.5 mt-1">
      {unresolved.map(c => renderComment(c))}
      {resolved.length > 0 && (
        <details className="mt-1">
          <summary className="text-[10px] text-parchment-400 dark:text-cream-muted cursor-pointer font-body">
            {resolved.length} resolved {resolved.length === 1 ? 'thread' : 'threads'}
          </summary>
          <div className="mt-1 opacity-60">
            {resolved.map(c => renderComment(c))}
          </div>
        </details>
      )}

      {/* New comment input */}
      <div className="flex gap-1 mt-2 pt-2 border-t border-amber-200/30 dark:border-amber-800/20">
        <input
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleCreate(null, newText)}
          placeholder="Add a comment..."
          className="flex-1 text-[11px] px-2 py-1 border border-parchment-200 dark:border-ink-600 rounded bg-white dark:bg-ink-800 text-ink-700 dark:text-cream-dim font-body focus:outline-none focus:border-gold"
        />
        <button
          onClick={() => handleCreate(null, newText)}
          disabled={submitting || !newText.trim()}
          className="p-1 text-gold hover:text-gold-dark dark:hover:text-gold-light disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/editor/SegmentCommentThread.tsx
git commit -m "feat: add SegmentCommentThread component with reply, resolve, and delete"
```

---

## Task 6: Frontend — Integrate comments into TranslationEditor

**Files:**
- Modify: `frontend/src/components/editor/TranslationEditor.tsx`

This is the largest integration task. Changes are grouped by concern.

- [ ] **Step 1: Add imports and state**

At the top of `TranslationEditor.tsx`, add the import for the comments API and component. After the existing imports (around line 15):

```typescript
import { getChapterComments } from '../../api/comments'
import SegmentCommentThread from './SegmentCommentThread'
import type { SegmentComment, ChapterCommentsData } from '../../types'
```

Add the `MessageSquare` icon to the lucide-react import (line 7-8):

```typescript
import {
  // ... existing icons ...,
  MessageSquare,
} from 'lucide-react'
```

Add state variables alongside the existing ones (after the `selectedSegments` state around line 244):

```typescript
  // Comments
  const [chapterComments, setChapterComments] = useState<ChapterCommentsData | null>(null)
  const [expandedComments, setExpandedComments] = useState<Set<number>>(new Set())
  const [commentFilter, setCommentFilter] = useState(false)
```

- [ ] **Step 2: Load comments when chapter loads**

In the `loadChapter` function (or after it), add a comment-loading call. Find where `loadChapter` is defined and add a `loadComments` function nearby:

```typescript
  async function loadComments() {
    if (!chapterId || !selectedLanguageId) return
    try {
      const data = await getChapterComments(parseInt(chapterId), selectedLanguageId)
      setChapterComments(data)
    } catch (err) {
      console.warn('Failed to load comments:', err)
    }
  }
```

Call `loadComments()` at the end of the `loadChapter` function (after `setChapter(chapterData)` succeeds) and also on language change.

Add a `useEffect` that calls `loadComments` whenever `selectedLanguageId` or `chapterId` changes:

```typescript
  useEffect(() => { loadComments() }, [selectedLanguageId, chapterId])
```

- [ ] **Step 3: Add "Comments" filter chip**

In the filter bar section (where the status filter chips are rendered), add a comments filter chip after the status chips. Find the existing filter chips section and add after the last status chip, separated by a divider:

```tsx
{chapterComments && chapterComments.unresolved_count > 0 && (
  <>
    <div className="w-px h-5 bg-parchment-200 dark:bg-ink-600/30 self-center" />
    <button
      onClick={() => setCommentFilter(!commentFilter)}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-body font-medium transition-colors ${
        commentFilter
          ? 'bg-gold text-white'
          : 'bg-parchment-100 dark:bg-ink-700 text-parchment-500 dark:text-cream-muted hover:bg-parchment-200 dark:hover:bg-ink-600'
      }`}
    >
      <MessageSquare className="w-3 h-3" />
      Comments ({chapterComments.unresolved_count})
    </button>
  </>
)}
```

In the segment filtering logic, add the comments filter. Where `filteredSegments` is computed, add:

```typescript
// After existing status filter:
if (commentFilter && chapterComments) {
  filtered = filtered.filter(s => chapterComments.segment_comment_counts[String(s.id)])
}
```

- [ ] **Step 4: Add comment icon badge per segment row**

In the segment list rendering (the row for each segment), add a comment icon with count badge. Find where each segment row renders its status badges or action buttons and add:

```tsx
{(() => {
  const count = chapterComments?.segment_comment_counts[String(segment.id)] || 0
  if (count === 0 && !expandedComments.has(segment.id)) return null
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        setExpandedComments(prev => {
          const next = new Set(prev)
          if (next.has(segment.id)) next.delete(segment.id)
          else next.add(segment.id)
          return next
        })
      }}
      className="relative p-0.5 text-parchment-400 hover:text-gold dark:text-cream-muted dark:hover:text-gold-light"
      title={`${count} unresolved comment${count !== 1 ? 's' : ''}`}
    >
      <MessageSquare className="w-4 h-4" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1.5 bg-red-500 text-white text-[8px] w-3.5 h-3.5 rounded-full flex items-center justify-center font-semibold">
          {count}
        </span>
      )}
    </button>
  )
})()}
```

- [ ] **Step 5: Render comment thread below translation text**

After the translation text display (after the InlineDiff or SourceTextSelection rendering, and after the per-segment Accept/Reject buttons), add the comment thread:

```tsx
{expandedComments.has(segment.id) && (
  <SegmentCommentThread
    comments={(chapterComments?.comments || []).filter(c => c.segment_id === segment.id)}
    segmentId={segment.id}
    languageId={selectedLanguageId}
    currentUserId={user?.id || 0}
    onUpdate={loadComments}
  />
)}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/editor/TranslationEditor.tsx
git commit -m "feat: integrate segment comments into editor — badges, filter, and thread UI"
```

---

## Task 7: Frontend — Sync track changes mode to DB

**Files:**
- Modify: `frontend/src/components/editor/TranslationEditor.tsx`

- [ ] **Step 1: Replace localStorage TC mode with DB-backed state**

In the track changes initialization (around line 342), replace:

```typescript
        const storedTC = localStorage.getItem(`track_changes_${btId}`)
        if (storedTC && (storedTC === 'off' || storedTC === 'markup' || storedTC === 'clean')) {
          setTrackChanges(storedTC)
        } else if (storedTC === 'true') {
```

With initialization from the DB field:

```typescript
        // Initialize TC mode from DB field + localStorage view preference
        if (btData.track_changes) {
          const viewPref = localStorage.getItem(`tc_view_${btId}`)
          setTrackChanges(viewPref === 'clean' ? 'clean' : 'markup')
        } else {
          setTrackChanges('off')
        }
```

- [ ] **Step 2: Update the mode setter to sync to DB**

In the `setMode` function inside the track changes dropdown (around line 960), replace:

```typescript
            function setMode(mode: 'off' | 'markup' | 'clean') {
              setTrackChanges(mode)
              localStorage.setItem(`track_changes_${btId}`, mode)
            }
```

With:

```typescript
            async function setMode(mode: 'off' | 'markup' | 'clean') {
              const wasOff = trackChanges === 'off'
              const turningOff = mode === 'off'
              setTrackChanges(mode)

              // Save view preference (markup vs clean) to localStorage
              if (mode !== 'off') {
                localStorage.setItem(`tc_view_${btId}`, mode)
              }

              // Sync enabled state to DB when toggling on/off
              if (wasOff && !turningOff) {
                await updateBookTranslation(parseInt(btId!), { track_changes: true })
                await loadChapter()  // reload to get snapshotted previous_text values
              } else if (!wasOff && turningOff) {
                await updateBookTranslation(parseInt(btId!), { track_changes: false })
                await loadChapter()  // reload to get cleared previous_text values
              }
            }
```

- [ ] **Step 3: Remove optimistic previous_text management from handleSaveTranslation**

In `handleSaveTranslation` (around line 470), simplify the optimistic update. Replace the block that manages `previous_text` in local state:

```typescript
                // Only update previous_text when track changes is active
                previous_text: trackChanges !== 'off' && t.translated_text !== result.translated_text
                  ? t.translated_text
                  : trackChanges === 'off' ? result.translated_text : t.previous_text,
```

With:

```typescript
                // previous_text is managed by the backend — keep existing value,
                // it will be refreshed on next chapter load
                previous_text: trackChanges !== 'off' && !t.previous_text && t.translated_text !== result.translated_text
                  ? t.translated_text
                  : t.previous_text,
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/editor/TranslationEditor.tsx
git commit -m "feat: sync track changes mode to DB, remove localStorage dependency"
```

---

## Task 8: Frontend — Formatting toolbar in SegmentEditor

**Files:**
- Modify: `frontend/src/components/editor/SegmentEditor.tsx`

- [ ] **Step 1: Add toolbar imports**

At the top of `SegmentEditor.tsx`, add the `Undo2` and `Redo2` icons to the import:

```typescript
import { Loader2, Check, AlertCircle, Undo2, Redo2 } from 'lucide-react'
```

- [ ] **Step 2: Add the formatting toolbar**

Replace the editor render section (lines 136-139):

```tsx
      <div className="relative">
        <div className="border border-gold/30 rounded-md bg-white dark:bg-ink-800 overflow-hidden shadow-gold-sm">
          <EditorContent editor={editor} className="px-3 py-2" />
        </div>
```

With:

```tsx
      <div className="relative">
        <div className="border border-gold/30 rounded-md bg-white dark:bg-ink-800 overflow-hidden shadow-gold-sm">
          {/* Formatting toolbar */}
          {editor && (
            <div className="flex items-center gap-0.5 px-2 py-1 border-b border-gold/10 bg-parchment-50/50 dark:bg-ink-700/50">
              <button
                onClick={() => editor.chain().focus().toggleBold().run()}
                className={`w-7 h-6 flex items-center justify-center rounded text-xs font-serif font-bold transition-colors ${
                  editor.isActive('bold')
                    ? 'bg-gold/20 text-gold-dark dark:text-gold-light'
                    : 'text-parchment-500 dark:text-cream-muted hover:bg-parchment-100 dark:hover:bg-ink-600'
                }`}
                title="Bold (Ctrl+B)"
              >
                B
              </button>
              <button
                onClick={() => editor.chain().focus().toggleItalic().run()}
                className={`w-7 h-6 flex items-center justify-center rounded text-xs font-serif italic transition-colors ${
                  editor.isActive('italic')
                    ? 'bg-gold/20 text-gold-dark dark:text-gold-light'
                    : 'text-parchment-500 dark:text-cream-muted hover:bg-parchment-100 dark:hover:bg-ink-600'
                }`}
                title="Italic (Ctrl+I)"
              >
                I
              </button>
              <div className="w-px h-4 bg-parchment-200 dark:bg-ink-600 mx-0.5" />
              <button
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
                className="w-7 h-6 flex items-center justify-center rounded text-parchment-500 dark:text-cream-muted hover:bg-parchment-100 dark:hover:bg-ink-600 disabled:opacity-30 transition-colors"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
                className="w-7 h-6 flex items-center justify-center rounded text-parchment-500 dark:text-cream-muted hover:bg-parchment-100 dark:hover:bg-ink-600 disabled:opacity-30 transition-colors"
                title="Redo (Ctrl+Shift+Z)"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
              <div className="flex-1" />
              <span className="text-[9px] text-parchment-400 dark:text-cream-muted font-body">
                {(() => {
                  const text = editor.getText()
                  const words = text.trim() ? text.trim().split(/\s+/).length : 0
                  return `${words} word${words !== 1 ? 's' : ''} · ${text.length} char${text.length !== 1 ? 's' : ''}`
                })()}
              </span>
            </div>
          )}
          <EditorContent editor={editor} className="px-3 py-2" />
        </div>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/editor/SegmentEditor.tsx
git commit -m "feat: add formatting toolbar with Bold, Italic, Undo, Redo, and word count"
```

---

## Task 9: Release notes + version bump

**Files:**
- Modify: `frontend/src/data/releaseNotes.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Bump version in package.json**

In `frontend/package.json`, change the version from the current value to `0.15.0`.

- [ ] **Step 2: Add release notes entry**

In `frontend/src/data/releaseNotes.ts`, add a new entry at the top of the `releaseNotes` array (after line 7):

```typescript
  {
    version: '0.15.0',
    date: '2026-03-30',
    highlights: [
      'Segment comments — leave threaded comments on any segment for reviewers and translators to discuss',
      'Comment filter — quickly find segments with unresolved comments using the new Comments chip in the filter bar',
      'Track changes now persists across sessions — no more losing tracked changes when you close the browser',
      'Formatting toolbar — Bold, Italic, Undo, Redo, and word count now visible when editing a segment',
    ],
  },
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/data/releaseNotes.ts frontend/package.json
git commit -m "chore: bump version to 0.15.0, add release notes for editor improvements"
```

---

## Task 10: Build verification

- [ ] **Step 1: Run frontend build**

Run: `cd frontend && npm run build`

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Run backend import check**

Run: `cd backend && python -c "from app.api import api_router; print(f'All routers registered: {len(api_router.routes)} routes')"`

Expected: Prints route count without import errors.

- [ ] **Step 3: Final commit if any fixes were needed**

If the build revealed issues, fix and commit:

```bash
git add -A
git commit -m "fix: resolve build issues from editor improvements"
```
