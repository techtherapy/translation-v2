from datetime import datetime
from pydantic import BaseModel


class BookTranslationCreate(BaseModel):
    book_id: int
    source_language_id: int | None = None  # None = Chinese original
    target_language_id: int
    translated_title: str = ""  # title in the target language


class BookTranslationUpdate(BaseModel):
    source_language_id: int | None = None
    status: str | None = None
    llm_model: str | None = None
    prompt_template: str | None = None
    translated_title: str | None = None
    track_changes: bool | None = None
    notes: str | None = None


class BookTranslationResponse(BaseModel):
    id: int
    book_id: int
    source_language_id: int | None
    target_language_id: int
    status: str
    llm_model: str | None
    prompt_template: str | None
    translated_title: str = ""
    track_changes: bool = False
    notes: str
    created_at: datetime
    updated_at: datetime
    # Enriched fields
    book_title_source: str = ""
    book_title_translated: str = ""
    book_number: int | None = None
    content_type: str = "book"
    source_language_code: str | None = None
    source_language_name: str | None = None
    target_language_code: str = ""
    target_language_name: str = ""
    # Progress
    total_segments: int = 0
    translated_segments: int = 0
    approved_segments: int = 0
    percent_complete: float = 0.0

    model_config = {"from_attributes": True}


class BookTranslationListResponse(BaseModel):
    items: list[BookTranslationResponse]
    total: int
