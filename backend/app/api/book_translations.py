from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.book import Book
from app.models.chapter import Chapter
from app.models.segment import Segment
from app.models.translation import Translation, SegmentStatus
from app.models.language import Language
from app.models.book_translation import BookTranslation, BookTranslationStatus
from app.schemas.book_translation import (
    BookTranslationCreate, BookTranslationUpdate,
    BookTranslationResponse, BookTranslationListResponse,
)
from app.schemas.book import ChapterResponse

router = APIRouter()


async def _enrich_response(bt: BookTranslation, db: AsyncSession) -> BookTranslationResponse:
    """Build enriched response with book info, language names, and progress."""
    # Book info
    book = await db.get(Book, bt.book_id)
    book_title_source = book.title_source if book else ""
    book_title_translated = book.title_translated if book else ""
    book_number = book.book_number if book else None
    content_type = book.content_type.value if book else "book"

    # Language names
    target_lang = await db.get(Language, bt.target_language_id)
    source_lang = await db.get(Language, bt.source_language_id) if bt.source_language_id else None
    # Fall back to book's source language when no pivot override
    if not source_lang and book and book.source_language_id:
        source_lang = await db.get(Language, book.source_language_id)

    # Progress: count segments and translation statuses
    seg_ids = select(Segment.id).join(
        Chapter, Segment.chapter_id == Chapter.id
    ).where(Chapter.book_id == bt.book_id)

    total_segments = (await db.execute(
        select(func.count()).select_from(Segment).join(
            Chapter, Segment.chapter_id == Chapter.id
        ).where(Chapter.book_id == bt.book_id)
    )).scalar() or 0

    status_result = await db.execute(
        select(Translation.status, func.count()).where(
            Translation.segment_id.in_(seg_ids),
            Translation.language_id == bt.target_language_id,
        ).group_by(Translation.status)
    )
    translated = 0
    approved = 0
    for status, count in status_result.all():
        status_val = status.value if hasattr(status, 'value') else status
        if status_val != "empty":
            translated += count
        if status_val == "approved":
            approved += count

    return BookTranslationResponse(
        id=bt.id,
        book_id=bt.book_id,
        source_language_id=bt.source_language_id,
        target_language_id=bt.target_language_id,
        status=bt.status.value if hasattr(bt.status, 'value') else bt.status,
        llm_model=bt.llm_model,
        prompt_template=bt.prompt_template,
        translated_title=getattr(bt, 'translated_title', ''),
        track_changes=getattr(bt, 'track_changes', False),
        notes=bt.notes,
        created_at=bt.created_at,
        updated_at=bt.updated_at,
        book_title_source=book_title_source,
        book_title_translated=book_title_translated,
        book_number=book_number,
        content_type=content_type,
        source_language_code=source_lang.code if source_lang else None,
        source_language_name=source_lang.name if source_lang else None,
        target_language_code=target_lang.code if target_lang else "",
        target_language_name=target_lang.name if target_lang else "",
        total_segments=total_segments,
        translated_segments=translated,
        approved_segments=approved,
        percent_complete=round(translated / total_segments * 100, 1) if total_segments else 0,
    )


@router.get("", response_model=BookTranslationListResponse)
async def list_book_translations(
    book_id: int | None = Query(None),
    target_language_id: int | None = Query(None),
    source_language_id: int | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None, description="Search by book title"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = select(BookTranslation).join(Book, BookTranslation.book_id == Book.id)
    if book_id is not None:
        query = query.where(BookTranslation.book_id == book_id)
    if target_language_id is not None:
        query = query.where(BookTranslation.target_language_id == target_language_id)
    if source_language_id is not None:
        query = query.where(BookTranslation.source_language_id == source_language_id)
    if status:
        query = query.where(BookTranslation.status == status)
    if search:
        query = query.where(
            Book.title_source.ilike(f"%{search}%")
            | Book.title_translated.ilike(f"%{search}%")
            | BookTranslation.translated_title.ilike(f"%{search}%")
        )

    # Order by book number, then target language
    query = query.order_by(
        Book.book_number.asc().nulls_last(), Book.title_source, BookTranslation.target_language_id,
    )

    result = await db.execute(query)
    items = result.scalars().all()

    responses = [await _enrich_response(bt, db) for bt in items]
    return BookTranslationListResponse(items=responses, total=len(responses))


@router.post("", response_model=BookTranslationResponse, status_code=201)
async def create_book_translation(
    data: BookTranslationCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # Validate book exists
    book = await db.get(Book, data.book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # Validate target language exists
    target_lang = await db.get(Language, data.target_language_id)
    if not target_lang:
        raise HTTPException(status_code=404, detail="Target language not found")

    # Validate source language if provided
    if data.source_language_id is not None:
        source_lang = await db.get(Language, data.source_language_id)
        if not source_lang:
            raise HTTPException(status_code=404, detail="Source language not found")

    # Check uniqueness
    existing = await db.execute(
        select(BookTranslation).where(
            BookTranslation.book_id == data.book_id,
            BookTranslation.target_language_id == data.target_language_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"A translation instance already exists for this book and target language ({target_lang.name})",
        )

    # Auto-translate title if not provided
    translated_title = data.translated_title
    if not translated_title and book.title_source:
        try:
            from app.services.translation.llm import translate_text
            result = await translate_text(
                system_prompt=(
                    f"You are a translator. Translate the following book title to {target_lang.name}. "
                    "Return ONLY the translated title, nothing else."
                ),
                user_prompt=book.title_source,
            )
            translated_title = result["translated_text"].strip().strip('"').strip("'")
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Auto-translate title failed: %s", exc)

    try:
        bt = BookTranslation(
            book_id=data.book_id,
            source_language_id=data.source_language_id,
            target_language_id=data.target_language_id,
            translated_title=translated_title,
            status=BookTranslationStatus.not_started,
        )
        db.add(bt)
        await db.flush()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create: {exc}")
    return await _enrich_response(bt, db)


@router.get("/{bt_id}", response_model=BookTranslationResponse)
async def get_book_translation(
    bt_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    bt = await db.get(BookTranslation, bt_id)
    if not bt:
        raise HTTPException(status_code=404, detail="Translation instance not found")
    return await _enrich_response(bt, db)


@router.patch("/{bt_id}", response_model=BookTranslationResponse)
async def update_book_translation(
    bt_id: int,
    data: BookTranslationUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    bt = await db.get(BookTranslation, bt_id)
    if not bt:
        raise HTTPException(status_code=404, detail="Translation instance not found")

    update_data = data.model_dump(exclude_unset=True)

    # Detect track_changes toggle
    tc_toggling_on = 'track_changes' in update_data and update_data['track_changes'] and not bt.track_changes
    tc_toggling_off = 'track_changes' in update_data and not update_data['track_changes'] and bt.track_changes

    # Only set fields that exist on the model to avoid errors with pending migrations
    for field, value in update_data.items():
        if hasattr(bt, field):
            setattr(bt, field, value)

    # Snapshot or clear previous_text based on TC toggle
    if tc_toggling_on or tc_toggling_off:
        from app.models.chapter import Chapter
        from app.models.segment import Segment
        from app.models.translation import Translation

        chapter_ids_q = select(Chapter.id).where(Chapter.book_id == bt.book_id)
        seg_ids_q = select(Segment.id).where(Segment.chapter_id.in_(chapter_ids_q))

        t_result = await db.execute(
            select(Translation).where(
                Translation.segment_id.in_(seg_ids_q),
                Translation.language_id == bt.target_language_id,
            )
        )
        translations = t_result.scalars().all()

        for t in translations:
            if tc_toggling_on:
                # Snapshot current text as baseline
                if t.translated_text and t.previous_text is None:
                    t.previous_text = t.translated_text
            else:
                # Clear all baselines
                t.previous_text = None

    try:
        await db.flush()
        await db.refresh(bt)
    except Exception as exc:
        _logger.exception(f"flush failed for bt_id={bt_id}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save: {exc}")
    return await _enrich_response(bt, db)


@router.delete("/{bt_id}", status_code=204)
async def delete_book_translation(
    bt_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Delete the translation instance wrapper. Does NOT delete segment-level translations."""
    bt = await db.get(BookTranslation, bt_id)
    if not bt:
        raise HTTPException(status_code=404, detail="Translation instance not found")
    await db.delete(bt)


@router.get("/{bt_id}/chapters", response_model=list[ChapterResponse])
async def list_bt_chapters(
    bt_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """List chapters for a translation instance, with progress scoped to its target language."""
    bt = await db.get(BookTranslation, bt_id)
    if not bt:
        raise HTTPException(status_code=404, detail="Translation instance not found")

    result = await db.execute(
        select(Chapter).where(Chapter.book_id == bt.book_id).order_by(Chapter.order)
    )
    chapters = result.scalars().all()

    responses = []
    for ch in chapters:
        seg_count = (await db.execute(
            select(func.count()).where(Segment.chapter_id == ch.id)
        )).scalar() or 0

        seg_ids = select(Segment.id).where(Segment.chapter_id == ch.id)

        status_result = await db.execute(
            select(Translation.status, func.count()).where(
                Translation.segment_id.in_(seg_ids),
                Translation.language_id == bt.target_language_id,
            ).group_by(Translation.status)
        )
        status_counts = {}
        translated_count = 0
        for status, count in status_result.all():
            status_counts[status.value if hasattr(status, 'value') else status] = count
            if status != SegmentStatus.empty:
                translated_count += count

        responses.append(ChapterResponse(
            id=ch.id, book_id=ch.book_id, title=ch.title,
            order=ch.order, segment_count=seg_count,
            translated_count=translated_count,
            status_counts=status_counts,
            created_at=ch.created_at,
        ))
    return responses
