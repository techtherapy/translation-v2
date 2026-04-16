"""Pydantic schemas for QA endpoints."""

from pydantic import BaseModel


class GlossaryCheckRequest(BaseModel):
    source_text: str
    translated_text: str
    language_id: int


class QAIssue(BaseModel):
    term_id: int
    source_term: str
    expected_translation: str
    found: bool
    do_not_translate: bool = False
    transliterate: bool = False


class GlossaryCheckResponse(BaseModel):
    issues: list[QAIssue]
