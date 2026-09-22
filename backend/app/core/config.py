from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://translation:translation_dev@localhost:5432/translation_tool"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # JWT
    jwt_secret: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24 hours

    # File uploads
    upload_dir: str = "./uploads"
    max_upload_size_mb: int = 50

    # LLM
    default_llm_model: str = "anthropic/claude-sonnet-4-20250514"
    litellm_api_key: str = ""  # Set via env var ANTHROPIC_API_KEY or per-provider keys

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:3000"  # comma-separated

    # Google Docs review prototype: opt in explicitly.
    docs_review_enabled: bool = False
    docs_review_live_ai: bool = False
    # Operator-selected, versioned prices; no inferred or downloaded pricing.
    docs_review_price_schedules: dict[str, dict] = {}
    docs_review_account_spend_limit_confirmed: bool = False
    docs_review_account_spend_limit_usd: float = 0
    docs_review_max_input_tokens: int = 24000
    docs_review_max_output_tokens: int = 4000
    docs_review_max_cost_usd: float = 1

    # App
    app_name: str = "BITS — Buddha Intelligence Translation System"
    debug: bool = True

    model_config = {"env_prefix": "", "case_sensitive": False}


@lru_cache
def get_settings() -> Settings:
    return Settings()
