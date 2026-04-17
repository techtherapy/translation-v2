"""Phase 1 knowledge-base models: ContentType, StyleRule, GoldenExample.

Per the amended 2026-04-11 spec (Appendix A), every entity carries a `revision`
column that is bumped on every meaningful edit. This is what lets
`PipelineSegmentResult.evidence_snapshot` record the exact version of each input
that shaped a given translation — closing the reproducibility gap identified in
the spec-evaluation debate.

Convention: callers must increment `revision` by 1 on every update that changes
a field listed in the per-entity docstring. Do NOT use soft-delete via row
removal — deactivate with `is_active = false` so historical
`PipelineSegmentResult.evidence_snapshot` references remain resolvable.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ContentType(Base):
    """User-defined content category (dharma talk, meditation instruction, poetry, narrative…).

    Revision bumps on edits to `name` or `description`.
    """

    __tablename__ = "content_types"
    __table_args__ = (UniqueConstraint("name", name="uq_content_types_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StyleRule(Base):
    """Senior-translator-authored guidance applied during AI translation.

    Revision bumps on edits to `content`, `category`, or targeting fields
    (content_type_id, language_id).
    """

    __tablename__ = "style_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(50), default="style")
    content_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("content_types.id", ondelete="SET NULL"), default=None, index=True
    )
    language_id: Mapped[int | None] = mapped_column(
        ForeignKey("languages.id", ondelete="SET NULL"), default=None, index=True
    )
    priority: Mapped[int] = mapped_column(Integer, default=100)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    content_type: Mapped["ContentType | None"] = relationship("ContentType")


class GoldenExample(Base):
    """Hand-picked source/translation pair used as a few-shot example.

    Revision bumps on edits to `source_text`, `translated_text`, or `notes`.
    """

    __tablename__ = "golden_examples"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_text: Mapped[str] = mapped_column(Text)
    translated_text: Mapped[str] = mapped_column(Text)
    language_id: Mapped[int] = mapped_column(
        ForeignKey("languages.id", ondelete="CASCADE"), index=True
    )
    content_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("content_types.id", ondelete="SET NULL"), default=None, index=True
    )
    notes: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    nominated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    confirmed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    content_type: Mapped["ContentType | None"] = relationship("ContentType")
