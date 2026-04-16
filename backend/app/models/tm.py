from datetime import datetime

from sqlalchemy import (
    String, Integer, Float, ForeignKey, DateTime, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TMEntry(Base):
    """Translation Memory entry — a confirmed source-translation pair."""

    __tablename__ = "tm_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_text: Mapped[str] = mapped_column(Text, index=True)
    translated_text: Mapped[str] = mapped_column(Text)
    language_id: Mapped[int] = mapped_column(ForeignKey("languages.id", ondelete="CASCADE"), index=True)
    source_book_id: Mapped[int | None] = mapped_column(ForeignKey("books.id", ondelete="SET NULL"), nullable=True)
    source_chapter_id: Mapped[int | None] = mapped_column(ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True)
    source_language_id: Mapped[int | None] = mapped_column(
        ForeignKey("languages.id", ondelete="SET NULL"), nullable=True,
    )  # NULL = Chinese original; non-null = pivot source language
    alignment_confidence: Mapped[float] = mapped_column(Float, default=1.0)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
