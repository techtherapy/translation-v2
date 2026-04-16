import io

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.permissions import require_permission
from app.models.user import User
from app.models.language import Language
from app.models.tm import TMEntry
from app.schemas.tm import (
    TMEntryResponse, TMMatchResponse, TMSearchRequest,
    TMSeedingPairResponse, TMSeedingPairApproval,
)
from app.services.tm.alignment import align_texts
from app.services.tm.fuzzy import fuzzy_match

router = APIRouter()


@router.post("/search", response_model=list[TMMatchResponse])
async def search_tm(
    data: TMSearchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Search Translation Memory for fuzzy matches."""
    query = select(TMEntry).where(TMEntry.language_id == data.language_id)
    if data.source_language_id is not None:
        query = query.where(TMEntry.source_language_id == data.source_language_id)
    else:
        # Default: Chinese source (NULL source_language_id)
        query = query.where(TMEntry.source_language_id.is_(None))
    result = await db.execute(query)
    entries = result.scalars().all()

    candidates = [
        {
            "id": e.id,
            "source_text": e.source_text,
            "translated_text": e.translated_text,
            "language_id": e.language_id,
            "source_book_id": e.source_book_id,
            "alignment_confidence": e.alignment_confidence,
            "created_at": e.created_at,
        }
        for e in entries
    ]

    matches = fuzzy_match(data.source_text, candidates, data.threshold, data.limit)

    return [
        TMMatchResponse(
            tm_entry=TMEntryResponse(
                id=m["id"],
                source_text=m["source_text"],
                translated_text=m["translated_text"],
                language_id=m["language_id"],
                source_book_id=m["source_book_id"],
                alignment_confidence=m["alignment_confidence"],
                created_at=m["created_at"],
            ),
            similarity=m["similarity"],
        )
        for m in matches
    ]


@router.post("/seed/align", response_model=list[TMSeedingPairResponse])
async def seed_align(
    source_file: UploadFile = File(..., description="Chinese source text file"),
    translation_file: UploadFile = File(..., description="Translation text file"),
    _: User = Depends(require_permission("tm.seed")),
):
    """Upload a source and translation file pair and get proposed alignment.

    Returns aligned paragraph pairs for human review before committing to TM.
    """
    source_bytes = await source_file.read()
    translation_bytes = await translation_file.read()

    source_text = source_bytes.decode("utf-8", errors="replace")
    translation_text = translation_bytes.decode("utf-8", errors="replace")

    if not source_text.strip() or not translation_text.strip():
        raise HTTPException(status_code=400, detail="One or both files are empty")

    pairs = align_texts(source_text, translation_text)

    return [
        TMSeedingPairResponse(
            source_text=p["source_text"],
            translated_text=p["translated_text"],
            confidence=p["confidence"],
            source_index=p["source_index"],
            translation_index=p["translation_index"],
        )
        for p in pairs
    ]


@router.post("/seed/commit")
async def seed_commit(
    book_id: int = Query(..., description="Source book ID"),
    language_id: int = Query(..., description="Target language ID"),
    pairs: list[TMSeedingPairApproval] = [],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("tm.seed")),
):
    """Commit reviewed alignment pairs to Translation Memory."""
    # Validate language exists
    lang = await db.execute(select(Language).where(Language.id == language_id))
    if not lang.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Language not found")

    committed = 0
    for pair in pairs:
        if not pair.approved or not pair.source_text.strip() or not pair.translated_text.strip():
            continue

        entry = TMEntry(
            source_text=pair.source_text,
            translated_text=pair.translated_text,
            language_id=language_id,
            source_book_id=book_id,
            alignment_confidence=pair.confidence,
            created_by=user.id,
        )
        db.add(entry)
        committed += 1

    await db.flush()
    return {"committed": committed, "total_pairs": len(pairs)}


@router.get("/entries", response_model=list[TMEntryResponse])
async def list_tm_entries(
    language_id: int | None = Query(None),
    book_id: int | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List TM entries with optional filters."""
    query = select(TMEntry)
    if language_id:
        query = query.where(TMEntry.language_id == language_id)
    if book_id:
        query = query.where(TMEntry.source_book_id == book_id)

    result = await db.execute(query.order_by(TMEntry.id.desc()).offset(offset).limit(limit))
    return result.scalars().all()
