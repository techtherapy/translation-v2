from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, exists

from app.core.database import get_db
from app.core.security import get_current_user, require_role
from app.models.user import User
from app.models.language import Language
from app.models.glossary import GlossaryTranslation
from app.models.translation import Translation
from app.schemas.language import LanguageCreate, LanguageUpdate, LanguageResponse

router = APIRouter()


@router.get("", response_model=list[LanguageResponse])
async def list_languages(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Language).order_by(Language.code))
    return result.scalars().all()


@router.post("", response_model=LanguageResponse)
async def create_language(
    data: LanguageCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    existing = await db.execute(select(Language).where(Language.code == data.code))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Language code already exists")

    lang = Language(**data.model_dump())
    db.add(lang)
    await db.flush()
    await db.refresh(lang)
    return lang


@router.patch("/{language_id}", response_model=LanguageResponse)
async def update_language(
    language_id: int,
    data: LanguageUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    result = await db.execute(select(Language).where(Language.id == language_id))
    lang = result.scalar_one_or_none()
    if not lang:
        raise HTTPException(status_code=404, detail="Language not found")

    updates = data.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(lang, key, value)
    await db.flush()
    await db.refresh(lang)
    return lang


@router.delete("/{language_id}")
async def delete_language(
    language_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin")),
):
    result = await db.execute(select(Language).where(Language.id == language_id))
    lang = result.scalar_one_or_none()
    if not lang:
        raise HTTPException(status_code=404, detail="Language not found")

    # Check if any translations reference this language
    has_glossary = await db.scalar(
        select(exists().where(GlossaryTranslation.language_id == language_id))
    )
    has_translations = await db.scalar(
        select(exists().where(Translation.language_id == language_id))
    )
    if has_glossary or has_translations:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete language — it has existing translations. Disable it instead.",
        )

    await db.delete(lang)
    await db.flush()
    return {"ok": True}
