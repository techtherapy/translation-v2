from datetime import datetime

from sqlalchemy import String, DateTime, Integer, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Language(Base):
    __tablename__ = "languages"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True, index=True)  # e.g. "en", "id", "fr"
    name: Mapped[str] = mapped_column(String(100))  # e.g. "English", "Indonesian"
    is_enabled: Mapped[bool] = mapped_column(default=True)
    reference_language_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("languages.id", ondelete="SET NULL"), default=None
    )
    prompt_template_override: Mapped[str | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
