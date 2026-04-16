import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base, get_db
from app.core.security import create_access_token, hash_password
from app.models.user import User, UserRole
from app.models.language import Language

# Import all models so Base.metadata knows about every table
import app.models  # noqa: F401

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture()
async def db_engine():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture()
async def db_session(db_engine):
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture()
async def seed_data(db_session: AsyncSession):
    """Seed admin user and default languages."""
    admin = User(
        username="admin",
        email="admin@test.com",
        hashed_password=hash_password("admin"),
        full_name="Test Admin",
        role=UserRole.admin,
    )
    db_session.add(admin)

    translator = User(
        username="translator",
        email="translator@test.com",
        hashed_password=hash_password("translator"),
        full_name="Test Translator",
        role=UserRole.translator,
    )
    db_session.add(translator)

    reviewer = User(
        username="reviewer",
        email="reviewer@test.com",
        hashed_password=hash_password("reviewer"),
        full_name="Test Reviewer",
        role=UserRole.reviewer,
    )
    db_session.add(reviewer)

    en = Language(code="en", name="English")
    zh = Language(code="zh", name="Chinese")
    db_session.add_all([en, zh])

    await db_session.commit()
    return {"admin": admin, "translator": translator, "reviewer": reviewer, "en": en, "zh": zh}


@pytest.fixture()
async def client(db_engine, seed_data):
    """AsyncClient with DB dependency overridden to use test SQLite."""
    from app.main import app

    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture()
def admin_token(seed_data):
    return create_access_token({"sub": str(seed_data["admin"].id)})


@pytest.fixture()
def translator_token(seed_data):
    return create_access_token({"sub": str(seed_data["translator"].id)})


@pytest.fixture()
def reviewer_token(seed_data):
    return create_access_token({"sub": str(seed_data["reviewer"].id)})


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
