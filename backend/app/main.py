import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import init_db, async_session
from app.core.security import hash_password
from app.api import api_router

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables and seed default data
    # Each step is independent so a migration failure doesn't block settings loading
    try:
        await init_db()
    except Exception as exc:
        logger.error("Startup DB init failed: %s", exc)
    try:
        await _seed_defaults()
    except Exception as exc:
        logger.error("Startup seed failed: %s", exc)
    try:
        await _load_settings()
    except Exception as exc:
        logger.error("Startup settings load failed: %s", exc)
    yield


app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


async def _load_settings():
    """Hydrate os.environ with API keys stored in the DB."""
    from app.api.settings import load_settings_into_env
    async with async_session() as db:
        await load_settings_into_env(db)
    logger.info("Settings loaded from database")


async def _seed_defaults():
    """Create default admin user and English language if they don't exist."""
    from sqlalchemy import select
    from app.models.user import User, UserRole
    from app.models.language import Language

    async with async_session() as db:
        # Default admin
        result = await db.execute(select(User).where(User.username == "admin"))
        if not result.scalar_one_or_none():
            admin = User(
                username="admin",
                email="admin@example.com",
                hashed_password=hash_password("admin"),
                full_name="Administrator",
                role=UserRole.admin,
            )
            db.add(admin)

        # Default languages
        for code, name in [("en", "English"), ("zh", "Chinese")]:
            result = await db.execute(select(Language).where(Language.code == code))
            if not result.scalar_one_or_none():
                db.add(Language(code=code, name=name))

        await db.commit()
