from __future__ import annotations

from pydantic import BaseModel


class SettingValue(BaseModel):
    key: str
    value: str  # masked on read, plain on write
    updated_at: str | None = None


class SettingsResponse(BaseModel):
    settings: list[SettingValue]


class SettingsUpdate(BaseModel):
    settings: list[SettingValue]


# ── Available Models ─────────────────────────────────────────

class ModelCost(BaseModel):
    input_per_million: float | None = None   # $ per 1M input tokens
    output_per_million: float | None = None  # $ per 1M output tokens


class ModelInfo(BaseModel):
    id: str    # LiteLLM identifier (e.g. "anthropic/claude-sonnet-4-6")
    name: str  # Display name (e.g. "Claude Sonnet 4.6")
    cost: ModelCost | None = None


class ProviderModels(BaseModel):
    provider: str       # e.g. "Anthropic", "OpenAI"
    api_key_set: bool   # Whether the corresponding API key env var is non-empty
    models: list[ModelInfo]


class AvailableModelsResponse(BaseModel):
    providers: list[ProviderModels]


# ── Model Catalog (admin management) ────────────────────────

class CatalogModel(BaseModel):
    id: str               # LiteLLM ID (e.g. "anthropic/claude-sonnet-4-6")
    name: str             # Display name
    provider: str         # Provider key (e.g. "anthropic")
    provider_display: str # Display name (e.g. "Anthropic")
    enabled: bool         # Whether currently enabled for use
    cost: ModelCost | None = None


class ProviderKeyStatus(BaseModel):
    provider: str
    api_key_set: bool


class ModelCatalogResponse(BaseModel):
    models: list[CatalogModel]
    provider_keys: list[ProviderKeyStatus]
    default_model: str


class EnableModelsRequest(BaseModel):
    model_ids: list[str]  # IDs to enable (replaces the full enabled set)


# ── Permissions ──────────────────────────────────────────────

class PermissionItem(BaseModel):
    key: str
    label: str


class PermissionGroup(BaseModel):
    name: str
    permissions: list[PermissionItem]


class RolePermissionsResponse(BaseModel):
    groups: list[PermissionGroup]
    role_permissions: dict[str, list[str]]


class RolePermissionsUpdate(BaseModel):
    role_permissions: dict[str, list[str]]
