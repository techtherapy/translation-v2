"""LLM integration via LiteLLM."""

import os
import re

import litellm
from app.core.config import get_settings

settings = get_settings()

# Disable LiteLLM telemetry
litellm.telemetry = False

# Bare model names that need a provider prefix for LiteLLM
_PREFIX_RULES: list[tuple[str, str]] = [
    ("claude-", "anthropic/"),
    ("deepseek-", "deepseek/"),
    ("gemini-", "gemini/"),
    # OpenAI models (gpt-*, o1-*, o3-*, o4-*) work without a prefix in LiteLLM
]


def _ensure_provider_prefix(model: str) -> str:
    """Add the LiteLLM provider prefix if the model name is bare."""
    if "/" in model:
        return model
    for starts_with, prefix in _PREFIX_RULES:
        if model.startswith(starts_with):
            return prefix + model
    return model


# Models that rejected custom temperature — skip it on future calls
_no_temperature_models: set[str] = set()

# Pattern to strip common LLM preamble headers from translation output
_HEADER_PATTERN = re.compile(
    r"^(?:#+ *)?(?:translation|translated text|here is the translation|output)[:\s]*\n*",
    re.IGNORECASE,
)


def _clean_response(text: str) -> str:
    """Strip unwanted headers/wrappers that some models add to translations."""
    text = text.strip()
    # Remove markdown header-style prefixes like "# Translation\n"
    text = _HEADER_PATTERN.sub("", text).strip()
    # Remove wrapping quotes if the entire response is quoted
    if len(text) > 1 and text[0] == text[-1] and text[0] in ('"', "'", "\u201c"):
        text = text[1:-1].strip()
    return text


async def translate_text(
    system_prompt: str,
    user_prompt: str,
    model: str | None = None,
) -> dict:
    """Call LLM to translate text.

    Returns dict with keys: translated_text, model, token_count
    """
    model = model or os.environ.get("DEFAULT_LLM_MODEL") or settings.default_llm_model
    model = _ensure_provider_prefix(model)

    params: dict = dict(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_completion_tokens=4096,
    )
    if model not in _no_temperature_models:
        params["temperature"] = 0.3

    try:
        response = await litellm.acompletion(**params)
    except litellm.BadRequestError as e:
        if "temperature" in str(e) and "temperature" in params:
            _no_temperature_models.add(model)
            params.pop("temperature")
            response = await litellm.acompletion(**params)
        else:
            raise

    translated_text = _clean_response(response.choices[0].message.content)
    token_count = response.usage.total_tokens if response.usage else 0

    return {
        "translated_text": translated_text,
        "model": model,
        "token_count": token_count,
    }
