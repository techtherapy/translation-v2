from datetime import datetime
from pydantic import BaseModel


class BookCreate(BaseModel):
    content_type: str = "book"
    book_number: int | None = None
    title_source: str
    title_translated: str = ""
    year_published: int | None = None
    category: str = ""
    era_tag: str | None = None
    series: str = ""
    notes: str = ""
    llm_model: str | None = None
    prompt_template: str | None = None
    source_language_id: int | None = None


class BookUpdate(BaseModel):
    book_number: int | None = None
    title_source: str | None = None
    title_translated: str | None = None
    year_published: int | None = None
    category: str | None = None
    era_tag: str | None = None
    series: str | None = None
    status: str | None = None
    notes: str | None = None
    llm_model: str | None = None
    prompt_template: str | None = None
    source_language_id: int | None = None


class ChapterResponse(BaseModel):
    id: int
    book_id: int
    title: str
    order: int
    segment_count: int = 0
    translated_count: int = 0
    status_counts: dict[str, int] | None = None  # per-status breakdown when language_id filter is used
    created_at: datetime

    model_config = {"from_attributes": True}


class BookResponse(BaseModel):
    id: int
    content_type: str = "book"
    title_source: str
    title_translated: str
    book_number: int | None = None
    year_published: int | None
    category: str
    era_tag: str | None
    series: str
    status: str
    notes: str
    llm_model: str | None
    prompt_template: str | None
    source_language_id: int | None = None
    source_language_code: str | None = None
    source_language_name: str | None = None
    chapter_count: int = 0
    segment_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BookListResponse(BaseModel):
    books: list[BookResponse]
    total: int


class SegmentResponse(BaseModel):
    id: int
    chapter_id: int
    order: int
    paragraph_group: int = 1
    source_text: str
    created_at: datetime

    model_config = {"from_attributes": True}


class LanguageProgressDetail(BaseModel):
    language_id: int
    language_code: str
    language_name: str
    counts: dict[str, int]  # status -> count
    total_translated: int
    percent_complete: float


class BookProgressResponse(BaseModel):
    book_id: int
    total_segments: int
    languages: list[LanguageProgressDetail]


class PivotReadinessResponse(BaseModel):
    total_segments: int
    approved_in_source: int
    percent_ready: float


class TranslationResponse(BaseModel):
    id: int
    segment_id: int
    language_id: int
    translated_text: str
    status: str
    llm_model_used: str | None
    token_count: int
    updated_by: int | None = None
    updated_by_username: str | None = None
    updated_at: datetime
    previous_text: str | None = None  # latest version text for track changes diff
    content_format: str = "plain"

    model_config = {"from_attributes": True}


class SegmentWithTranslationsResponse(BaseModel):
    id: int
    chapter_id: int
    order: int
    paragraph_group: int = 1
    source_text: str
    translations: list[TranslationResponse] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class ChapterDetailResponse(BaseModel):
    id: int
    book_id: int
    title: str
    order: int
    segments: list[SegmentWithTranslationsResponse] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class SegmentSplitRequest(BaseModel):
    position: int


# --- Bulk Import ---

class BulkImportFilePreview(BaseModel):
    filename: str
    book_number: int | None = None
    title_source: str = ""
    title_translated: str = ""
    content_type: str = "book"
    parse_success: bool = True
    error: str | None = None
    warnings: list[str] = []


class BulkImportPreviewResponse(BaseModel):
    previews: list[BulkImportFilePreview]


class BulkImportFileItem(BaseModel):
    filename: str
    book_number: int | None = None
    title_source: str
    title_translated: str = ""
    content_type: str = "book"


class BulkImportMetadata(BaseModel):
    translate_titles: bool = True
    granularity: str = "sentence"
    items: list[BulkImportFileItem]


class BulkImportResult(BaseModel):
    filename: str
    book_id: int | None = None
    book_number: int | None = None
    title_source: str
    title_translated: str = ""
    chapter_count: int = 0
    segment_count: int = 0
    status: str  # "success" | "error"
    error: str | None = None


class BulkImportResponse(BaseModel):
    results: list[BulkImportResult]
    total: int
    succeeded: int
    failed: int
