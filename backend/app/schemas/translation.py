from datetime import datetime
from pydantic import BaseModel


class TranslationVersionResponse(BaseModel):
    id: int
    version_number: int
    translated_text: str
    status: str
    llm_model_used: str | None = None
    content_format: str = "plain"
    created_by: int | None = None
    created_by_username: str | None = None
    created_at: datetime


class TranslateRequest(BaseModel):
    segment_id: int
    language_id: int | None = None  # resolved from book_translation_id if not provided
    source_language_id: int | None = None  # None = Chinese original; set to use pivot
    book_translation_id: int | None = None  # if set, resolves language_id + source_language_id + model
    model: str | None = None  # override model for this request
    extra_instructions: str = ""  # e.g. "make this more formal"


class TranslateResponse(BaseModel):
    translation_id: int | None = None  # included when available (create, update)
    segment_id: int
    language_id: int
    source_language_id: int | None = None
    translated_text: str
    model_used: str
    token_count: int
    status: str


class BatchTranslateRequest(BaseModel):
    chapter_id: int
    language_id: int | None = None  # resolved from book_translation_id if not provided
    source_language_id: int | None = None  # None = Chinese original; set to use pivot
    book_translation_id: int | None = None  # if set, resolves language_id + source_language_id + model
    model: str | None = None
    overwrite_existing: bool = False  # skip segments that already have translations


class BatchTranslateProgress(BaseModel):
    chapter_id: int
    total_segments: int
    translated: int
    status: str  # "running", "completed", "failed"


class CreateTranslationRequest(BaseModel):
    segment_id: int
    language_id: int
    translated_text: str
    status: str | None = None
    content_format: str | None = None  # 'plain' or 'prosemirror'


class UpdateTranslationRequest(BaseModel):
    translated_text: str
    status: str | None = None  # optionally update status too
    previous_text: str | None = None  # update baseline for per-hunk track changes
    content_format: str | None = None  # 'plain' or 'prosemirror'


class CompareRequest(BaseModel):
    segment_id: int
    language_id: int
    source_language_id: int | None = None
    models: list[str]
    extra_instructions: str = ""


class CompareVariant(BaseModel):
    model: str
    translated_text: str = ""
    token_count: int = 0
    error: str | None = None


class CompareResponse(BaseModel):
    segment_id: int
    language_id: int
    variants: list[CompareVariant]


class PickWinnerRequest(BaseModel):
    segment_id: int
    language_id: int
    winning_model: str
    winning_text: str
    losing_variants: list[CompareVariant]


class BatchCompareRequest(BaseModel):
    chapter_id: int
    language_id: int
    source_language_id: int | None = None
    models: list[str]
    overwrite_existing: bool = False


class BatchCompareSegmentResult(BaseModel):
    segment_id: int
    order: int
    source_text: str
    variants: list[CompareVariant]


class BatchCompareResponse(BaseModel):
    chapter_id: int
    segments: list[BatchCompareSegmentResult]


class SegmentPick(BaseModel):
    segment_id: int
    winning_model: str
    winning_text: str
    losing_variants: list[CompareVariant]


class BatchPickRequest(BaseModel):
    chapter_id: int
    language_id: int
    picks: list[SegmentPick]


class BatchStatusRequest(BaseModel):
    translation_ids: list[int]
    status: str


class TrackChangesResolveRequest(BaseModel):
    chapter_id: int
    language_id: int
    action: str  # 'accept_all' or 'reject_all'
