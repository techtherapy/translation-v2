from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.segment import Segment
from app.models.chapter import Chapter
from app.models.segment_comment import SegmentComment
from app.models.comment_reaction import CommentReaction
from app.schemas.segment_comment import (
    CommentCreate, CommentUpdate, CommentResponse, ChapterCommentsResponse,
    ReactionCreate, ReactionSummary, ReactionUserInfo,
)

router = APIRouter()

ALLOWED_EMOJI = {"👍", "👎", "✅", "❓", "🙏"}


def _build_response(
    comment: SegmentComment,
    username_map: dict[int, str],
    all_reactions: list[CommentReaction],
    current_user_id: int,
) -> CommentResponse:
    """Build a CommentResponse from a SegmentComment, recursively including replies."""
    return CommentResponse(
        id=comment.id,
        segment_id=comment.segment_id,
        language_id=comment.language_id,
        user_id=comment.user_id,
        username=username_map.get(comment.user_id, "unknown"),
        text=comment.text,
        quoted_text=comment.quoted_text,
        parent_id=comment.parent_id,
        is_resolved=comment.is_resolved,
        resolved_by=comment.resolved_by,
        resolved_by_username=username_map.get(comment.resolved_by) if comment.resolved_by else None,
        resolved_at=comment.resolved_at,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        replies=[_build_response(r, username_map, all_reactions, current_user_id) for r in comment.replies],
        reactions=_build_reactions(comment.id, all_reactions, username_map, current_user_id),
    )


async def _get_comment_with_replies(db: AsyncSession, comment_id: int) -> SegmentComment | None:
    """Fetch a single comment with replies eagerly loaded (avoids lazy-load in async)."""
    result = await db.execute(
        select(SegmentComment)
        .where(SegmentComment.id == comment_id)
        .options(selectinload(SegmentComment.replies))
    )
    return result.scalar_one_or_none()


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


async def _load_reactions(db: AsyncSession, comment_ids: set[int]) -> list[CommentReaction]:
    """Load all reactions for a set of comment IDs."""
    if not comment_ids:
        return []
    result = await db.execute(
        select(CommentReaction).where(CommentReaction.comment_id.in_(comment_ids))
    )
    return list(result.scalars().all())


def _collect_comment_ids(comments: list[SegmentComment]) -> set[int]:
    """Recursively collect all comment IDs (including replies)."""
    ids: set[int] = set()
    for c in comments:
        ids.add(c.id)
        ids.update(_collect_comment_ids(c.replies))
    return ids


def _build_reactions(
    comment_id: int,
    reactions: list[CommentReaction],
    username_map: dict[int, str],
    current_user_id: int,
) -> list[ReactionSummary]:
    """Build reaction summaries for a comment."""
    emoji_groups: dict[str, list[CommentReaction]] = {}
    for r in reactions:
        if r.comment_id == comment_id:
            emoji_groups.setdefault(r.emoji, []).append(r)
    summaries = []
    for emoji, group in emoji_groups.items():
        summaries.append(ReactionSummary(
            emoji=emoji,
            count=len(group),
            users=[ReactionUserInfo(id=r.user_id, username=username_map.get(r.user_id, "unknown")) for r in group],
            reacted_by_me=any(r.user_id == current_user_id for r in group),
        ))
    return summaries


@router.get("/chapter/{chapter_id}", response_model=ChapterCommentsResponse)
async def list_chapter_comments(
    chapter_id: int,
    language_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
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
        .options(selectinload(SegmentComment.replies).selectinload(SegmentComment.replies))
        .order_by(SegmentComment.created_at)
    )
    top_level = result.scalars().unique().all()

    user_ids = _collect_user_ids(top_level)
    username_map = await _get_username_map(db, user_ids)

    all_comment_ids = _collect_comment_ids(top_level)
    all_reactions = await _load_reactions(db, all_comment_ids)

    comments = [_build_response(c, username_map, all_reactions, user.id) for c in top_level]

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
        quoted_text=data.quoted_text,
    )
    db.add(comment)
    await db.commit()

    # Re-fetch with replies eagerly loaded (async SQLAlchemy can't lazy-load)
    comment = await _get_comment_with_replies(db, comment.id)
    username_map = await _get_username_map(db, {user.id})
    reactions = await _load_reactions(db, {comment.id})
    return _build_response(comment, username_map, reactions, user.id)


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
    await db.commit()

    comment = await _get_comment_with_replies(db, comment.id)
    user_ids = _collect_user_ids([comment])
    user_ids.add(user.id)
    username_map = await _get_username_map(db, user_ids)
    comment_ids = _collect_comment_ids([comment])
    reactions = await _load_reactions(db, comment_ids)
    return _build_response(comment, username_map, reactions, user.id)


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
    await db.commit()


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
    await db.commit()

    comment = await _get_comment_with_replies(db, comment.id)
    user_ids = _collect_user_ids([comment])
    user_ids.add(user.id)
    username_map = await _get_username_map(db, user_ids)
    comment_ids = _collect_comment_ids([comment])
    reactions = await _load_reactions(db, comment_ids)
    return _build_response(comment, username_map, reactions, user.id)


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
    await db.commit()

    comment = await _get_comment_with_replies(db, comment.id)
    user_ids = _collect_user_ids([comment])
    user_ids.add(user.id)
    username_map = await _get_username_map(db, user_ids)
    comment_ids = _collect_comment_ids([comment])
    reactions = await _load_reactions(db, comment_ids)
    return _build_response(comment, username_map, reactions, user.id)


@router.post("/{comment_id}/reactions", response_model=list[ReactionSummary])
async def add_reaction(
    comment_id: int,
    data: ReactionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Add an emoji reaction to a comment."""
    if data.emoji not in ALLOWED_EMOJI:
        raise HTTPException(status_code=400, detail=f"Emoji must be one of: {', '.join(ALLOWED_EMOJI)}")
    comment = await db.get(SegmentComment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    existing = await db.execute(
        select(CommentReaction).where(
            CommentReaction.comment_id == comment_id,
            CommentReaction.user_id == user.id,
            CommentReaction.emoji == data.emoji,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Already reacted with this emoji")

    reaction = CommentReaction(comment_id=comment_id, user_id=user.id, emoji=data.emoji)
    db.add(reaction)
    await db.commit()

    reactions = await _load_reactions(db, {comment_id})
    username_map = await _get_username_map(db, {r.user_id for r in reactions})
    return _build_reactions(comment_id, reactions, username_map, user.id)


@router.delete("/{comment_id}/reactions/{emoji}", response_model=list[ReactionSummary])
async def remove_reaction(
    comment_id: int,
    emoji: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remove your emoji reaction from a comment."""
    result = await db.execute(
        select(CommentReaction).where(
            CommentReaction.comment_id == comment_id,
            CommentReaction.user_id == user.id,
            CommentReaction.emoji == emoji,
        )
    )
    reaction = result.scalar_one_or_none()
    if not reaction:
        raise HTTPException(status_code=404, detail="Reaction not found")
    await db.delete(reaction)
    await db.commit()

    reactions = await _load_reactions(db, {comment_id})
    username_map = await _get_username_map(db, {r.user_id for r in reactions})
    return _build_reactions(comment_id, reactions, username_map, user.id)
