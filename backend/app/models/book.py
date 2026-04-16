import enum
from datetime import datetime

from sqlalchemy import String, Integer, ForeignKey, Enum, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ContentType(str, enum.Enum):
    book = "book"
    article = "article"


class BookStatus(str, enum.Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    under_review = "under_review"
    published = "published"


class EraTag(str, enum.Enum):
    early = "early"
    middle = "middle"
    recent = "recent"


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    content_type: Mapped[ContentType] = mapped_column(
        Enum(ContentType), default=ContentType.book, server_default="book"
    )
    book_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title_source: Mapped[str] = mapped_column(String(500))
    title_translated: Mapped[str] = mapped_column(String(500), default="")
    year_published: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category: Mapped[str] = mapped_column(String(200), default="")
    era_tag: Mapped[EraTag | None] = mapped_column(Enum(EraTag), nullable=True)
    series: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[BookStatus] = mapped_column(Enum(BookStatus), default=BookStatus.not_started)
    notes: Mapped[str] = mapped_column(Text, default="")
    llm_model: Mapped[str | None] = mapped_column(String(200), nullable=True)  # per-book model override
    prompt_template: Mapped[str | None] = mapped_column(Text, nullable=True)  # per-book prompt override
    source_language_id: Mapped[int | None] = mapped_column(
        ForeignKey("languages.id", ondelete="SET NULL"), nullable=True,
    )  # source language of the book's text
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    source_language: Mapped["Language | None"] = relationship("Language", foreign_keys=[source_language_id])

    chapters: Mapped[list["Chapter"]] = relationship(
        "Chapter", back_populates="book", cascade="all, delete-orphan", order_by="Chapter.order"
    )
