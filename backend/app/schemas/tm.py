from datetime import datetime
from pydantic import BaseModel


class TMEntryResponse(BaseModel):
    id: int
    source_text: str
    translated_text: str
    language_id: int
    source_book_id: int | None
    alignment_confidence: float
    created_at: datetime

    model_config = {"from_attributes": True}


class TMMatchResponse(BaseModel):
    tm_entry: TMEntryResponse
    similarity: float  # 0.0 to 1.0


class TMSearchRequest(BaseModel):
    source_text: str
    language_id: int
    source_language_id: int | None = None  # None = Chinese original
    threshold: float = 0.75
    limit: int = 5


class TMSeedingPairResponse(BaseModel):
    """A proposed source-translation alignment pair for human review."""
    source_text: str
    translated_text: str
    confidence: float
    source_index: int
    translation_index: int


class TMSeedingPairApproval(BaseModel):
    source_text: str
    translated_text: str
    approved: bool
    confidence: float = 1.0


class TMSeedingReviewRequest(BaseModel):
    """Submit reviewed alignment pairs to commit to TM."""
    book_id: int
    language_id: int
    pairs: list[TMSeedingPairApproval]
