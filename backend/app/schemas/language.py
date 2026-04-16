from datetime import datetime
from pydantic import BaseModel


class LanguageCreate(BaseModel):
    code: str
    name: str
    is_enabled: bool = True
    reference_language_id: int | None = None
    prompt_template_override: str | None = None


class LanguageUpdate(BaseModel):
    name: str | None = None
    is_enabled: bool | None = None
    reference_language_id: int | None = None
    prompt_template_override: str | None = None


class LanguageResponse(BaseModel):
    id: int
    code: str
    name: str
    is_enabled: bool
    reference_language_id: int | None
    prompt_template_override: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
