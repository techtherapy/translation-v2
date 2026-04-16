import enum
from datetime import datetime

from sqlalchemy import (
    String, Integer, ForeignKey, DateTime, Text, Enum, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SegmentStatus(str, enum.Enum):
    empty = "empty"
    machine_translated = "machine_translated"
    draft = "draft"
    under_review = "under_review"
    approved = "approved"
    needs_revision = "needs_revision"


class Translation(Base):
    """One translation per segment per target language."""

    __tablename__ = "translations"
    __table_args__ = (
        UniqueConstraint("segment_id", "language_id", name="uq_segment_language"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    segment_id: Mapped[int] = mapped_column(ForeignKey("segments.id", ondelete="CASCADE"), index=True)
    language_id: Mapped[int] = mapped_column(ForeignKey("languages.id", ondelete="CASCADE"), index=True)
    translated_text: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[SegmentStatus] = mapped_column(Enum(SegmentStatus), default=SegmentStatus.empty)
    llm_model_used: Mapped[str | None] = mapped_column(String(200), nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    source_language_id: Mapped[int | None] = mapped_column(
        ForeignKey("languages.id", ondelete="SET NULL"), nullable=True,
    )  # NULL = Chinese original; non-null = pivot language used as source
    pivot_translation_id: Mapped[int | None] = mapped_column(
        ForeignKey("translations.id", ondelete="SET NULL"), nullable=True,
    )  # Points to the approved translation used as pivot source (audit trail)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    previous_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_format: Mapped[str] = mapped_column(String(20), default="plain")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    segment: Mapped["Segment"] = relationship("Segment", back_populates="translations")
    versions: Mapped[list["TranslationVersion"]] = relationship(
        "TranslationVersion", back_populates="translation", cascade="all, delete-orphan",
        order_by="TranslationVersion.version_number.desc()"
    )


class TranslationVersion(Base):
    """Version history for a translation."""

    __tablename__ = "translation_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    translation_id: Mapped[int] = mapped_column(ForeignKey("translations.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    translated_text: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[SegmentStatus] = mapped_column(Enum(SegmentStatus))
    llm_model_used: Mapped[str | None] = mapped_column(String(200), nullable=True)
    content_format: Mapped[str] = mapped_column(String(20), default="plain")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    translation: Mapped["Translation"] = relationship("Translation", back_populates="versions")
