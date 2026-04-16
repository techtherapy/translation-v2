from datetime import datetime
from pydantic import BaseModel


class GlossaryTranslationCreate(BaseModel):
    language_id: int
    translated_term: str
    is_preferred: bool = False
    notes: str = ""


class GlossaryTranslationResponse(BaseModel):
    id: int
    term_id: int
    language_id: int
    translated_term: str
    is_preferred: bool
    notes: str

    model_config = {"from_attributes": True}


class GlossaryTermCreate(BaseModel):
    source_term: str
    source_language_id: int | None = None
    sanskrit_pali: str = ""
    category: str = "general"
    tbs_notes: str = ""
    context_notes: str = ""
    do_not_translate: bool = False
    transliterate: bool = False
    project_tags: str = ""
    source_reference: str = ""
    tradition_group: str = ""
    translations: list[GlossaryTranslationCreate] = []


class GlossaryTranslationUpdate(BaseModel):
    translated_term: str | None = None
    is_preferred: bool | None = None
    notes: str | None = None


class GlossaryTermUpdate(BaseModel):
    source_term: str | None = None
    source_language_id: int | None = None
    sanskrit_pali: str | None = None
    category: str | None = None
    tbs_notes: str | None = None
    context_notes: str | None = None
    do_not_translate: bool | None = None
    transliterate: bool | None = None
    project_tags: str | None = None
    source_reference: str | None = None
    tradition_group: str | None = None


class GlossaryTermResponse(BaseModel):
    id: int
    source_term: str
    source_language_id: int | None = None
    sanskrit_pali: str
    category: str
    tbs_notes: str
    context_notes: str
    do_not_translate: bool
    transliterate: bool
    project_tags: str
    source_reference: str
    tradition_group: str
    translations: list[GlossaryTranslationResponse] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class GlossaryListResponse(BaseModel):
    terms: list[GlossaryTermResponse]
    total: int


# AI completion schemas

class AICompleteRequest(BaseModel):
    fields: list[str] | None = None  # Fields to complete; None = auto-detect empty fields
    model: str | None = None  # LLM model override
    target_language: str | None = None  # e.g. "Spanish"; defaults to "English"


class AICompleteInlineRequest(BaseModel):
    """AI completion from raw term data (no saved term required)."""
    source_term: str
    english: str = ""
    sanskrit: str = ""
    category: str = ""
    context_notes: str = ""
    tbs_notes: str = ""
    project_tags: str = ""
    tradition_group: str = ""
    fields: list[str] | None = None
    model: str | None = None
    target_language: str | None = None


class AICompleteResponse(BaseModel):
    english: str | None = None
    sanskrit: str | None = None
    category: str | None = None
    confidence: float = 0.0
    model: str | None = None
    token_count: int = 0


class AIBatchRequest(BaseModel):
    term_ids: list[int]
    model: str | None = None


class AIBatchItem(BaseModel):
    term_id: int
    english: str | None = None
    sanskrit: str | None = None
    category: str | None = None
    confidence: float = 0.0


class AIBatchResponse(BaseModel):
    results: list[AIBatchItem]
    model: str | None = None


class CSVImportResponse(BaseModel):
    imported: int
    skipped: int
    errors: list[str] = []
    categories_created: int = 0
    projects_created: int = 0


# Autocomplete schemas

class AutocompleteSuggestion(BaseModel):
    id: int
    source_term: str
    translated_term: str = ""
    match_field: str = ""  # "source_term", "translated_term", or "sanskrit_pali"

    model_config = {"from_attributes": True}


class AutocompleteResponse(BaseModel):
    suggestions: list[AutocompleteSuggestion]
    total: int = 0


# Category management schemas

class GlossaryCategoryCreate(BaseModel):
    key: str
    label: str
    color: str = "gray"
    sort_order: int = 0


class GlossaryCategoryUpdate(BaseModel):
    label: str | None = None
    color: str | None = None
    sort_order: int | None = None


class GlossaryCategoryResponse(BaseModel):
    key: str
    label: str
    color: str
    sort_order: int
    is_builtin: bool

    model_config = {"from_attributes": True}


# Project management schemas

class GlossaryProjectCreate(BaseModel):
    name: str
    description: str = ""
    is_active: bool = True


class GlossaryProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None


class GlossaryProjectResponse(BaseModel):
    id: int
    name: str
    description: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# Term detection schemas (used by editor for highlighting)

class TermPosition(BaseModel):
    start: int
    end: int


class GlossaryDetectRequest(BaseModel):
    text: str
    language_id: int


class DetectedTerm(BaseModel):
    term_id: int
    source: str
    translation: str | None = None
    sanskrit: str | None = None
    do_not_translate: bool = False
    transliterate: bool = False
    tbs_notes: str | None = None
    context_notes: str | None = None
    category: str | None = None
    positions: list[TermPosition] = []


class GlossaryDetectResponse(BaseModel):
    terms: list[DetectedTerm]
