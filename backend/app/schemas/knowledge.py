"""Pydantic schemas for Phase 1 knowledge-base entities."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# ----- ContentType -----

class ContentTypeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""


class ContentTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    is_active: bool | None = None


class ContentTypeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    is_active: bool
    revision: int
    created_by: int | None
    created_at: datetime
    updated_at: datetime


# ----- StyleRule -----

class StyleRuleCreate(BaseModel):
    content: str = Field(..., min_length=1)
    category: str = "style"
    content_type_id: int | None = None
    language_id: int | None = None
    priority: int = 100


class StyleRuleUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1)
    category: str | None = None
    content_type_id: int | None = None
    language_id: int | None = None
    priority: int | None = None
    is_active: bool | None = None


class StyleRuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    content: str
    category: str
    content_type_id: int | None
    language_id: int | None
    priority: int
    is_active: bool
    revision: int
    created_by: int | None
    created_at: datetime
    updated_at: datetime


# ----- GoldenExample -----

class GoldenExampleCreate(BaseModel):
    source_text: str = Field(..., min_length=1)
    translated_text: str = Field(..., min_length=1)
    language_id: int
    content_type_id: int | None = None
    notes: str = ""


class GoldenExampleUpdate(BaseModel):
    source_text: str | None = Field(default=None, min_length=1)
    translated_text: str | None = Field(default=None, min_length=1)
    language_id: int | None = None
    content_type_id: int | None = None
    notes: str | None = None
    is_active: bool | None = None
    confirmed_by: int | None = None


class GoldenExampleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_text: str
    translated_text: str
    language_id: int
    content_type_id: int | None
    notes: str
    is_active: bool
    revision: int
    nominated_by: int | None
    confirmed_by: int | None
    created_at: datetime
    updated_at: datetime
