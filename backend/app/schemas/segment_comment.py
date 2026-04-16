from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel


class CommentCreate(BaseModel):
    segment_id: int
    language_id: int
    text: str
    parent_id: int | None = None
    quoted_text: str | None = None


class CommentUpdate(BaseModel):
    text: str


class ReactionCreate(BaseModel):
    emoji: str


class ReactionUserInfo(BaseModel):
    id: int
    username: str


class ReactionSummary(BaseModel):
    emoji: str
    count: int
    users: list[ReactionUserInfo]
    reacted_by_me: bool


class CommentResponse(BaseModel):
    id: int
    segment_id: int
    language_id: int
    user_id: int
    username: str
    text: str
    quoted_text: str | None
    parent_id: int | None
    is_resolved: bool
    resolved_by: int | None
    resolved_by_username: str | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime
    replies: list[CommentResponse] = []
    reactions: list[ReactionSummary] = []

    model_config = {"from_attributes": True}


class ChapterCommentsResponse(BaseModel):
    comments: list[CommentResponse]
    segment_comment_counts: dict[str, int]
    unresolved_count: int
