import json
import os
import re

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import get_settings as get_settings_config
from app.core.database import get_db
from app.core.security import get_current_user, require_role
from app.core.permissions import (
    PERMISSION_GROUPS, PERMISSION_KEYS, ROLE_PERMISSIONS_KEY,
    get_role_permissions,
)
from app.models.user import User
from app.models.setting import Setting
from app.schemas.settings import (
    SettingValue, SettingsResponse, SettingsUpdate,
    RolePermissionsResponse, RolePermissionsUpdate,
    ModelInfo, ModelCost, ProviderModels, AvailableModelsResponse,
    CatalogModel, ModelCatalogResponse, EnableModelsRequest, ProviderKeyStatus,
)

router = APIRouter()

# Keys that are treated as secrets (masked on read)
SECRET_KEYS = {
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "GOOGLE_API_KEY",
}

# All recognised setting keys and their descriptions
KNOWN_SETTINGS = {
    "ANTHROPIC_API_KEY": "Anthropic API key for Claude models",
    "OPENAI_API_KEY": "OpenAI API key for GPT models",
    "DEEPSEEK_API_KEY": "DeepSeek API key",
    "GOOGLE_API_KEY": "Google API key for Gemini models",
    "DEFAULT_LLM_MODEL": "Default LLM model in LiteLLM format (e.g. anthropic/claude-sonnet-4-20250514)",
    "CHINESE_FONT": "Chinese font family for display (noto-serif-sc, noto-sans-sc, lxgw-wenkai)",
}

# Non-secret settings readable by any authenticated user
PUBLIC_KEYS = {"CHINESE_FONT"}


def _mask(value: str) -> str:
    """Show only last 4 characters of a secret."""
    if len(value) <= 4:
        return "••••"
    return "•" * 8 + value[-4:]


def _apply_to_env(key: str, value: str) -> None:
    """Push a setting into the process environment so LiteLLM picks it up."""
    if value:
        os.environ[key] = value
    elif key in os.environ:
        del os.environ[key]


@router.get("", response_model=SettingsResponse)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    """Return all known settings. Secrets are masked."""
    result = await db.execute(select(Setting))
    saved = {s.key: s for s in result.scalars().all()}

    # Defaults for settings that have a meaningful fallback
    defaults = {
        "DEFAULT_LLM_MODEL": get_settings_config().default_llm_model,
        "CHINESE_FONT": "noto-serif-sc",
    }

    items = []
    for key in KNOWN_SETTINGS:
        setting = saved.get(key)
        value = setting.value if setting else defaults.get(key, "")
        display_value = _mask(value) if (key in SECRET_KEYS and value) else value
        items.append(SettingValue(
            key=key,
            value=display_value,
            updated_at=setting.updated_at.isoformat() if setting else None,
        ))
    return SettingsResponse(settings=items)


@router.get("/public", response_model=SettingsResponse)
async def get_public_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return public display settings. Available to all authenticated users."""
    result = await db.execute(select(Setting).where(Setting.key.in_(PUBLIC_KEYS)))
    saved = {s.key: s for s in result.scalars().all()}

    defaults = {"CHINESE_FONT": "noto-serif-sc"}

    items = []
    for key in PUBLIC_KEYS:
        setting = saved.get(key)
        value = setting.value if setting else defaults.get(key, "")
        items.append(SettingValue(
            key=key,
            value=value,
            updated_at=setting.updated_at.isoformat() if setting else None,
        ))
    return SettingsResponse(settings=items)


@router.put("", response_model=SettingsResponse)
async def update_settings(
    data: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    """Update one or more settings. Empty strings clear the value.

    Values that look masked (start with '••') are treated as unchanged
    so the frontend can safely round-trip without overwriting secrets.
    """
    for item in data.settings:
        if item.key not in KNOWN_SETTINGS:
            continue
        # Skip masked values — means the user didn't change the field
        if item.value.startswith("••"):
            continue

        result = await db.execute(select(Setting).where(Setting.key == item.key))
        setting = result.scalar_one_or_none()

        if setting:
            setting.value = item.value
        else:
            setting = Setting(key=item.key, value=item.value)
            db.add(setting)

        _apply_to_env(item.key, item.value)

    await db.flush()
    # Return the updated list
    return await get_settings(db, _)


@router.get("/permissions", response_model=RolePermissionsResponse)
async def get_permissions(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return permission groups and current role permissions.

    Available to all authenticated users so the frontend can show/hide
    UI elements based on the current user's role permissions.
    """
    role_perms = await get_role_permissions(db)
    return RolePermissionsResponse(
        groups=PERMISSION_GROUPS,
        role_permissions=role_perms,
    )


@router.put("/permissions", response_model=RolePermissionsResponse)
async def update_permissions(
    data: RolePermissionsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    """Update role permissions. Admin always retains all permissions."""
    # Validate permission keys
    for role, perms in data.role_permissions.items():
        for p in perms:
            if p not in PERMISSION_KEYS:
                from fastapi import HTTPException
                raise HTTPException(status_code=400, detail=f"Unknown permission: {p}")

    # Ensure admin always has all permissions
    cleaned = dict(data.role_permissions)
    cleaned["admin"] = list(PERMISSION_KEYS)

    value = json.dumps(cleaned)
    result = await db.execute(
        select(Setting).where(Setting.key == ROLE_PERMISSIONS_KEY)
    )
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        setting = Setting(key=ROLE_PERMISSIONS_KEY, value=value)
        db.add(setting)

    await db.flush()

    role_perms = await get_role_permissions(db)
    return RolePermissionsResponse(
        groups=PERMISSION_GROUPS,
        role_permissions=role_perms,
    )


# ── Available Models ──────────────────────────────────────────

ENABLED_MODELS_KEY = "ENABLED_MODELS"


async def _get_enabled_model_ids(db: AsyncSession) -> set[str] | None:
    """Return enabled model IDs from DB, or None if not yet configured."""
    result = await db.execute(
        select(Setting).where(Setting.key == ENABLED_MODELS_KEY)
    )
    setting = result.scalar_one_or_none()
    if setting and setting.value:
        return set(json.loads(setting.value))
    return None  # Not yet configured — use default filtering


def _get_model_cost(info: dict) -> ModelCost | None:
    """Extract cost info from a litellm model_cost entry."""
    input_cost = info.get("input_cost_per_token")
    output_cost = info.get("output_cost_per_token")
    if input_cost is not None or output_cost is not None:
        return ModelCost(
            input_per_million=round(input_cost * 1_000_000, 4) if input_cost else None,
            output_per_million=round(output_cost * 1_000_000, 4) if output_cost else None,
        )
    return None

# Mapping from litellm_provider value → env var and display info
_PROVIDER_CONFIG = {
    "anthropic": {
        "env_key": "ANTHROPIC_API_KEY",
        "display_name": "Anthropic",
        "id_prefix": "anthropic/",  # model_cost keys lack this prefix
    },
    "openai": {
        "env_key": "OPENAI_API_KEY",
        "display_name": "OpenAI",
        "id_prefix": "",
    },
    "deepseek": {
        "env_key": "DEEPSEEK_API_KEY",
        "display_name": "DeepSeek",
        "id_prefix": "",
    },
    "gemini": {
        "env_key": "GOOGLE_API_KEY",
        "display_name": "Google Gemini",
        "id_prefix": "",
    },
}

# Patterns to exclude from the model list (applied to the model_cost key)
_EXCLUDE_PATTERNS: list[re.Pattern[str]] = [
    # Anthropic: region/speed-specific variants, unstable -latest aliases
    re.compile(r"^(fast|us|eu)/"),
    re.compile(r"-latest$"),
    # OpenAI: fine-tune placeholders, audio, realtime, search, vision, old 3.5, container
    re.compile(r"^ft:"),
    re.compile(r"gpt-.*audio"),
    re.compile(r"gpt-.*realtime"),
    re.compile(r"gpt-.*search"),
    re.compile(r"vision-preview"),
    re.compile(r"^gpt-3\.5-turbo"),
    re.compile(r"^openai/"),
    # DeepSeek: bare names that duplicate deepseek/-prefixed versions
    re.compile(r"^deepseek-(chat|reasoner)$"),
    # Gemini: bare names (without gemini/ prefix), experimental, special-purpose
    re.compile(r"^gemini-(?!/)"),  # bare gemini-* without the gemini/ prefix
    re.compile(r"gemma"),
    re.compile(r"learnlm"),
    re.compile(r"robotics"),
    re.compile(r"live-"),
    re.compile(r"computer-use"),
    re.compile(r"native-audio"),
    re.compile(r"image-generation"),
    re.compile(r"-tts"),
    re.compile(r"pro-vision"),
    re.compile(r"-exp-\d"),
    re.compile(r"thinking-exp"),
]


def _should_exclude(model_key: str) -> bool:
    return any(p.search(model_key) for p in _EXCLUDE_PATTERNS)


def _make_display_name(model_key: str, provider: str) -> str:
    """Convert a model_cost key to a human-readable display name."""
    # Strip provider prefix if present (e.g. "deepseek/" or "gemini/")
    name = model_key
    for prefix in ("deepseek/deepseek-", "deepseek/", "gemini/gemini-", "gemini/"):
        if name.startswith(prefix):
            name = name[len(prefix):]
            break

    if provider == "anthropic":
        # claude-sonnet-4-6 → Claude Sonnet 4.6
        # Convert short version segments: "4-6" → "4.6" (but not dates like -20250514)
        name = re.sub(r"(\d{1,2})-(\d{1,2})(?=-|$)", r"\1.\2", name)
        # Title-case each hyphen-separated word
        parts = name.split("-")
        parts = [p.capitalize() if p[0:1].isalpha() else p for p in parts]
        return " ".join(parts)

    if provider == "openai":
        # gpt-4o → GPT-4o, o3-mini → O3 Mini, chatgpt-4o-latest → ChatGPT-4o Latest
        if name.startswith("chatgpt-"):
            name = "ChatGPT-" + name[8:]
        elif name.startswith("gpt-"):
            name = "GPT-" + name[4:]
        elif name.startswith("o") and not name.startswith("op"):
            # o1, o3, o4-mini etc. — capitalise first letter only
            name = name[0].upper() + name[1:]
        parts = name.split("-")
        result = [parts[0]]
        for p in parts[1:]:
            if p[0:1].isalpha():
                result.append(p.capitalize())
            else:
                result.append(p)
        return " ".join(result)

    if provider == "deepseek":
        return "DeepSeek " + name.replace("-", " ").title()

    if provider == "gemini":
        # Keep "8b" as "8B" not "8B" after title()
        name = name.replace("-", " ").title()
        name = re.sub(r"(\d+)b\b", lambda m: m.group(1) + "B", name, flags=re.IGNORECASE)
        return "Gemini " + name

    return name


def _model_sort_key(model_id: str) -> tuple[int, str]:
    """Sort canonical names before dated variants."""
    # Dated variants (contain a long date like -20250514) sort after canonical
    has_date = bool(re.search(r"-\d{8}", model_id))
    return (1 if has_date else 0, model_id)


@router.get("/available-models", response_model=AvailableModelsResponse)
async def get_available_models(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return LLM models grouped by provider — only enabled models."""
    import litellm

    enabled_ids = await _get_enabled_model_ids(db)

    providers = []
    for provider_key, config in _PROVIDER_CONFIG.items():
        api_key_set = bool(os.environ.get(config["env_key"], "").strip())

        models: list[ModelInfo] = []
        for model_key, info in litellm.model_cost.items():
            if info.get("litellm_provider") != provider_key:
                continue
            if info.get("mode") != "chat":
                continue

            litellm_id = config["id_prefix"] + model_key

            if enabled_ids is not None:
                if litellm_id not in enabled_ids:
                    continue
            else:
                # Legacy mode: use exclusion patterns when no curation exists
                if _should_exclude(model_key):
                    continue

            display_name = _make_display_name(model_key, provider_key)
            cost = _get_model_cost(info)
            models.append(ModelInfo(id=litellm_id, name=display_name, cost=cost))

        models.sort(key=lambda m: _model_sort_key(m.id))

        providers.append(ProviderModels(
            provider=config["display_name"],
            api_key_set=api_key_set,
            models=models,
        ))

    return AvailableModelsResponse(providers=providers)


@router.get("/model-catalog", response_model=ModelCatalogResponse)
async def get_model_catalog(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    """Return the full model catalog with enabled/disabled status (admin only)."""
    import litellm

    enabled_ids = await _get_enabled_model_ids(db)

    models: list[CatalogModel] = []
    for provider_key, config in _PROVIDER_CONFIG.items():
        for model_key, info in litellm.model_cost.items():
            if info.get("litellm_provider") != provider_key:
                continue
            if info.get("mode") != "chat":
                continue
            if _should_exclude(model_key):
                continue

            litellm_id = config["id_prefix"] + model_key

            if enabled_ids is not None:
                is_enabled = litellm_id in enabled_ids
            else:
                is_enabled = True

            display_name = _make_display_name(model_key, provider_key)
            cost = _get_model_cost(info)

            models.append(CatalogModel(
                id=litellm_id,
                name=display_name,
                provider=provider_key,
                provider_display=config["display_name"],
                enabled=is_enabled,
                cost=cost,
            ))

    models.sort(key=lambda m: (not m.enabled, m.provider, _model_sort_key(m.id)))

    provider_keys = [
        ProviderKeyStatus(
            provider=pk,
            api_key_set=bool(os.environ.get(cfg["env_key"], "").strip()),
        )
        for pk, cfg in _PROVIDER_CONFIG.items()
    ]

    # Fetch the current default model
    result = await db.execute(select(Setting).where(Setting.key == "DEFAULT_LLM_MODEL"))
    default_setting = result.scalar_one_or_none()
    default_model = default_setting.value if default_setting and default_setting.value else get_settings_config().default_llm_model

    return ModelCatalogResponse(
        models=models,
        provider_keys=provider_keys,
        default_model=default_model,
    )


@router.put("/enabled-models")
async def update_enabled_models(
    data: EnableModelsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    """Save the set of enabled model IDs (admin only)."""
    value = json.dumps(data.model_ids)
    result = await db.execute(
        select(Setting).where(Setting.key == ENABLED_MODELS_KEY)
    )
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        setting = Setting(key=ENABLED_MODELS_KEY, value=value)
        db.add(setting)
    await db.flush()
    return {"enabled_count": len(data.model_ids)}


@router.post("/refresh-model-catalog")
async def refresh_model_catalog(
    _: User = Depends(require_role("admin")),
):
    """Refresh litellm model cost data from the remote source (admin only)."""
    import litellm
    import httpx

    url = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, timeout=15.0)
        resp.raise_for_status()
        new_costs = resp.json()
    litellm.model_cost = new_costs
    return {"model_count": len(new_costs), "refreshed": True}


async def load_settings_into_env(db: AsyncSession) -> None:
    """Called on startup to hydrate os.environ from the DB."""
    result = await db.execute(select(Setting))
    for setting in result.scalars().all():
        if setting.value:
            _apply_to_env(setting.key, setting.value)


# ── Prompt Templates ──────────────────────────────────

from app.services.translation.prompts import (
    SYSTEM_PROMPT, TRANSLATION_PROMPT,
    PIVOT_SYSTEM_PROMPT, PIVOT_TRANSLATION_PROMPT,
)

PROMPT_KEYS = {
    "PROMPT_SYSTEM_DIRECT": SYSTEM_PROMPT,
    "PROMPT_USER_DIRECT": TRANSLATION_PROMPT,
    "PROMPT_SYSTEM_PIVOT": PIVOT_SYSTEM_PROMPT,
    "PROMPT_USER_PIVOT": PIVOT_TRANSLATION_PROMPT,
}

PROMPT_LABELS = {
    "PROMPT_SYSTEM_DIRECT": "System Prompt (Chinese → Target)",
    "PROMPT_USER_DIRECT": "User Prompt (Chinese → Target)",
    "PROMPT_SYSTEM_PIVOT": "System Prompt (Pivot Translation)",
    "PROMPT_USER_PIVOT": "User Prompt (Pivot Translation)",
}


@router.get("/prompts")
async def get_prompt_templates(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    """Get current prompt templates (from DB or defaults)."""
    prompts = []
    for key, default in PROMPT_KEYS.items():
        result = await db.execute(select(Setting).where(Setting.key == key))
        setting = result.scalar_one_or_none()
        prompts.append({
            "key": key,
            "label": PROMPT_LABELS[key],
            "value": setting.value if setting and setting.value else default,
            "is_default": not setting or not setting.value,
        })
    return {"prompts": prompts}


@router.put("/prompts")
async def update_prompt_templates(
    data: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    """Update prompt templates. Send {prompts: [{key, value}, ...]}."""
    updated = 0
    for item in data.get("prompts", []):
        key = item.get("key")
        value = item.get("value", "")
        if key not in PROMPT_KEYS:
            continue
        result = await db.execute(select(Setting).where(Setting.key == key))
        setting = result.scalar_one_or_none()
        if setting:
            setting.value = value
        else:
            db.add(Setting(key=key, value=value))
        updated += 1
    return {"updated": updated}
