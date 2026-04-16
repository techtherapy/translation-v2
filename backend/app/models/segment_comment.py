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
    quoted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
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
