import enum
from datetime import datetime

from sqlalchemy import (
    Integer, String, ForeignKey, DateTime, Text, Enum, Boolean,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


# Keep TermCategory enum for migration reference only
class TermCategory(str, enum.Enum):
    dharma_concept = "dharma_concept"
    deity_buddha = "deity_buddha"
    mantra = "mantra"
    mudra = "mudra"
    practice_ritual = "practice_ritual"
    person = "person"
    place_temple = "place_temple"
    honorific = "honorific"
    general = "general"


class GlossaryCategory(Base):
    """User-manageable glossary category."""

    __tablename__ = "glossary_categories"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    label: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(50), default="gray")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)


class GlossaryProject(Base):
    """Named project for tagging glossary terms."""

    __tablename__ = "glossary_projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class GlossaryTerm(Base):
    """A glossary term in a source language (defaults to Chinese)."""

    __tablename__ = "glossary_terms"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_language_id: Mapped[int | None] = mapped_column(
        ForeignKey("languages.id", ondelete="SET NULL"), default=None, index=True,
    )
    source_term: Mapped[str] = mapped_column(String(500), index=True)
    sanskrit_pali: Mapped[str] = mapped_column(String(500), default="")
    category: Mapped[str] = mapped_column(String(50), default="general")
    tbs_notes: Mapped[str] = mapped_column(Text, default="")  # True Buddha School specific notes
    context_notes: Mapped[str] = mapped_column(Text, default="")
    do_not_translate: Mapped[bool] = mapped_column(Boolean, default=False)
    transliterate: Mapped[bool] = mapped_column(Boolean, default=False)
    project_tags: Mapped[str] = mapped_column(String(500), default="")
    source_reference: Mapped[str] = mapped_column(Text, default="")
    tradition_group: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    translations: Mapped[list["GlossaryTranslation"]] = relationship(
        "GlossaryTranslation", back_populates="term", cascade="all, delete-orphan"
    )


class GlossaryTranslation(Base):
    """Translation of a glossary term in a specific target language."""

    __tablename__ = "glossary_translations"
    __table_args__ = (
        UniqueConstraint("term_id", "language_id", "translated_term", name="uq_term_lang_translation"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    term_id: Mapped[int] = mapped_column(ForeignKey("glossary_terms.id", ondelete="CASCADE"), index=True)
    language_id: Mapped[int] = mapped_column(ForeignKey("languages.id", ondelete="CASCADE"), index=True)
    translated_term: Mapped[str] = mapped_column(Text)
    is_preferred: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    term: Mapped["GlossaryTerm"] = relationship("GlossaryTerm", back_populates="translations")
