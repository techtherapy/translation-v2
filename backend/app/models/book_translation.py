import enum
from datetime import datetime

from sqlalchemy import (
    String, Integer, ForeignKey, DateTime, Text, Enum, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class BookTranslationStatus(str, enum.Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    under_review = "under_review"
    completed = "completed"


class BookTranslation(Base):
    """One translation instance per book per target language."""

    __tablename__ = "book_translations"
    __table_args__ = (
        UniqueConstraint("book_id", "target_language_id", name="uq_book_target_language"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    source_language_id: Mapped[int | None] = mapped_column(
        ForeignKey("languages.id", ondelete="SET NULL"), nullable=True,
    )  # NULL = use book's source language; non-null = pivot language override
    target_language_id: Mapped[int] = mapped_column(
        ForeignKey("languages.id", ondelete="CASCADE"), index=True,
    )
    status: Mapped[BookTranslationStatus] = mapped_column(
        Enum(BookTranslationStatus), default=BookTranslationStatus.not_started,
    )
    llm_model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    prompt_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    translated_title: Mapped[str] = mapped_column(String(500), default="")
    track_changes: Mapped[bool] = mapped_column(default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    book: Mapped["Book"] = relationship("Book")
    source_language: Mapped["Language | None"] = relationship("Language", foreign_keys=[source_language_id])
    target_language: Mapped["Language"] = relationship("Language", foreign_keys=[target_language_id])
