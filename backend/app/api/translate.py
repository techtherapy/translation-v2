import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.permissions import require_permission
from app.models.user import User
from app.models.segment import Segment
from app.models.chapter import Chapter
from app.models.book import Book
from app.models.translation import Translation, TranslationVersion, SegmentStatus
from app.models.language import Language
from app.models.book_translation import BookTranslation
from app.schemas.translation import (
    TranslateRequest, TranslateResponse, BatchTranslateRequest,
    CreateTranslationRequest, UpdateTranslationRequest, TranslationVersionResponse, BatchStatusRequest,
    CompareRequest, CompareResponse, CompareVariant,
    PickWinnerRequest, BatchCompareRequest, BatchCompareResponse,
    BatchCompareSegmentResult, BatchPickRequest,
    TrackChangesResolveRequest,
)
from app.services.translation.prompts import (
    build_system_prompt, build_translation_prompt,
    build_pivot_system_prompt, build_pivot_translation_prompt,
)
from app.services.translation.llm import translate_text
from app.services.glossary.term_detection import detect_terms_in_text, detect_terms_for_pivot

router = APIRouter()


async def _resolve_bt(bt_id: int, db: AsyncSession) -> BookTranslation:
    """Fetch a BookTranslation or raise 404."""
    bt = await db.get(BookTranslation, bt_id)
    if not bt:
        raise HTTPException(status_code=404, detail="Translation instance not found")
    return bt


async def _get_context_segments(
    segment: Segment, db: AsyncSession, before: int = 3, after: int = 1,
    pivot_language_id: int | None = None,
) -> tuple[str, str]:
    """Get surrounding segments for context.

    If pivot_language_id is set, returns approved pivot translations as context
    instead of Chinese source text.
    """
    result = await db.execute(
        select(Segment).where(
            Segment.chapter_id == segment.chapter_id,
            Segment.order >= segment.order - before,
            Segment.order <= segment.order + after,
            Segment.id != segment.id,
        ).order_by(Segment.order)
    )
    siblings = result.scalars().all()

    if pivot_language_id:
        # Fetch approved pivot translations for context segments
        sibling_ids = [s.id for s in siblings]
        if sibling_ids:
            pivot_result = await db.execute(
                select(Translation).where(
                    Translation.segment_id.in_(sibling_ids),
                    Translation.language_id == pivot_language_id,
                    Translation.status == SegmentStatus.approved,
                )
            )
            pivot_map = {t.segment_id: t.translated_text for t in pivot_result.scalars().all()}
        else:
            pivot_map = {}

        before_texts = [pivot_map.get(s.id, "") for s in siblings if s.order < segment.order]
        after_texts = [pivot_map.get(s.id, "") for s in siblings if s.order > segment.order]
        # Filter out empty strings (segments without approved pivot)
        before_texts = [t for t in before_texts if t]
        after_texts = [t for t in after_texts if t]
    else:
        before_texts = [s.source_text for s in siblings if s.order < segment.order]
        after_texts = [s.source_text for s in siblings if s.order > segment.order]

    return "\n\n".join(before_texts), "\n\n".join(after_texts)


async def _resolve_pivot(
    segment: Segment, source_language_id: int, db: AsyncSession,
) -> tuple[Translation, Language]:
    """Resolve pivot source: find the approved translation in the source language.

    Returns the pivot Translation and source Language, or raises HTTP 400.
    """
    source_lang_result = await db.execute(
        select(Language).where(Language.id == source_language_id)
    )
    source_language = source_lang_result.scalar_one_or_none()
    if not source_language:
        raise HTTPException(status_code=404, detail="Source language not found")

    pivot_result = await db.execute(
        select(Translation).where(
            Translation.segment_id == segment.id,
            Translation.language_id == source_language_id,
            Translation.status == SegmentStatus.approved,
        )
    )
    pivot_translation = pivot_result.scalar_one_or_none()
    if not pivot_translation:
        raise HTTPException(
            status_code=400,
            detail=f"No approved {source_language.name} translation for this segment. "
                   f"Only approved translations can be used as pivot source.",
        )

    return pivot_translation, source_language


async def _build_prompts(
    segment: Segment, language: Language, book: Book, db: AsyncSession,
    extra_instructions: str = "",
    source_language_id: int | None = None,
) -> tuple[str, str, Translation | None]:
    """Build system + user prompts for a segment translation.

    If source_language_id is set, builds pivot prompts using the approved
    translation in that language as primary source with Chinese as reference.

    Returns (system_prompt, user_prompt, pivot_translation_or_none).
    """
    era_context = ""
    if book.era_tag:
        era_context = f"This text is from the author's {book.era_tag.value} period."

    custom_instructions = ""
    if book.prompt_template:
        custom_instructions = book.prompt_template
    if language.prompt_template_override:
        custom_instructions += f"\n{language.prompt_template_override}"

    # Resolve the book's source language name
    book_source_lang = await db.get(Language, book.source_language_id) if book.source_language_id else None
    book_source_lang_name = book_source_lang.name if book_source_lang else "Chinese"

    if source_language_id:
        # Pivot translation mode
        pivot_translation, source_language = await _resolve_pivot(
            segment, source_language_id, db
        )

        glossary_terms = await detect_terms_for_pivot(
            chinese_text=segment.source_text,
            pivot_text=pivot_translation.translated_text,
            pivot_language_id=source_language_id,
            target_language_id=language.id,
            db=db,
        )
        context_before, context_after = await _get_context_segments(
            segment, db, pivot_language_id=source_language_id,
        )

        system_prompt = build_pivot_system_prompt(
            source_language=source_language.name,
            target_language=language.name,
            era_context=era_context,
            glossary_terms=glossary_terms,
            custom_instructions=custom_instructions,
            original_language=book_source_lang_name,
        )
        user_prompt = build_pivot_translation_prompt(
            pivot_text=pivot_translation.translated_text,
            original_text=segment.source_text,
            source_language=source_language.name,
            target_language=language.name,
            context_before=context_before,
            context_after=context_after,
            extra_instructions=extra_instructions,
            original_language=book_source_lang_name,
        )
        return system_prompt, user_prompt, pivot_translation
    else:
        # Direct source → target translation
        glossary_terms = await detect_terms_in_text(segment.source_text, language.id, db)
        context_before, context_after = await _get_context_segments(segment, db)

        system_prompt = build_system_prompt(
            target_language=language.name,
            era_context=era_context,
            glossary_terms=glossary_terms,
            custom_instructions=custom_instructions,
            source_language=book_source_lang_name,
        )
        user_prompt = build_translation_prompt(
            source_text=segment.source_text,
            target_language=language.name,
            context_before=context_before,
            context_after=context_after,
            extra_instructions=extra_instructions,
            source_language=book_source_lang_name,
        )
        return system_prompt, user_prompt, None


@router.post("/segment", response_model=TranslateResponse)
async def translate_segment(
    data: TranslateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.ai_translate")),
):
    """Translate a single segment using AI."""
    # Resolve from BookTranslation if provided
    language_id = data.language_id
    source_language_id = data.source_language_id
    bt_model_override = None
    if data.book_translation_id:
        bt = await _resolve_bt(data.book_translation_id, db)
        language_id = bt.target_language_id
        source_language_id = bt.source_language_id
        bt_model_override = bt.llm_model

    if not language_id:
        raise HTTPException(status_code=400, detail="language_id or book_translation_id is required")

    # Load segment
    seg_result = await db.execute(select(Segment).where(Segment.id == data.segment_id))
    segment = seg_result.scalar_one_or_none()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    # Load language
    lang_result = await db.execute(select(Language).where(Language.id == language_id))
    language = lang_result.scalar_one_or_none()
    if not language:
        raise HTTPException(status_code=404, detail="Language not found")

    # Get book for model override and era context
    chapter = await db.execute(select(Chapter).where(Chapter.id == segment.chapter_id))
    chapter = chapter.scalar_one()
    book = await db.execute(select(Book).where(Book.id == chapter.book_id))
    book = book.scalar_one()

    # Build context (supports both direct Chinese and pivot translation)
    system_prompt, user_prompt, pivot_translation = await _build_prompts(
        segment, language, book, db,
        extra_instructions=data.extra_instructions,
        source_language_id=source_language_id,
    )

    # Determine model: request override > BookTranslation > Book > system default
    model = data.model or bt_model_override or book.llm_model or None

    # Call LLM
    try:
        result = await translate_text(system_prompt, user_prompt, model=model)
    except Exception as exc:
        error_msg = str(exc)
        if "AuthenticationError" in error_msg or "invalid x-api-key" in error_msg.lower():
            raise HTTPException(
                status_code=502,
                detail="LLM API key is missing or invalid. Go to Settings to configure your API key.",
            )
        raise HTTPException(status_code=502, detail=f"LLM translation failed: {error_msg}")

    # Save or update translation
    trans_result = await db.execute(
        select(Translation).where(
            Translation.segment_id == data.segment_id,
            Translation.language_id == language_id,
        )
    )
    translation = trans_result.scalar_one_or_none()

    if translation:
        # Save version before overwriting
        version_count = (await db.execute(
            select(TranslationVersion).where(TranslationVersion.translation_id == translation.id)
        )).scalars()
        max_version = max((v.version_number for v in version_count), default=0)

        version = TranslationVersion(
            translation_id=translation.id,
            version_number=max_version + 1,
            translated_text=translation.translated_text,
            content_format=translation.content_format,
            status=translation.status,
            created_by=user.id,
        )
        db.add(version)

        translation.translated_text = result["translated_text"]
        translation.content_format = "plain"  # AI always returns plain text
        translation.status = SegmentStatus.machine_translated
        translation.llm_model_used = result["model"]
        translation.token_count = result["token_count"]
        translation.source_language_id = source_language_id
        translation.pivot_translation_id = pivot_translation.id if pivot_translation else None
        translation.updated_by = user.id
    else:
        translation = Translation(
            segment_id=data.segment_id,
            language_id=language_id,
            translated_text=result["translated_text"],
            status=SegmentStatus.machine_translated,
            llm_model_used=result["model"],
            token_count=result["token_count"],
            source_language_id=source_language_id,
            pivot_translation_id=pivot_translation.id if pivot_translation else None,
            updated_by=user.id,
        )
        db.add(translation)

    await db.flush()
    await db.refresh(translation)

    return TranslateResponse(
        segment_id=data.segment_id,
        language_id=language_id,
        source_language_id=source_language_id,
        translated_text=result["translated_text"],
        model_used=result["model"],
        token_count=result["token_count"],
        status=translation.status.value,
    )


@router.post("/compare", response_model=CompareResponse)
async def compare_models(
    data: CompareRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.ai_translate")),
):
    """Translate a segment with multiple models for comparison. No DB writes."""
    if len(data.models) < 2 or len(data.models) > 4:
        raise HTTPException(status_code=400, detail="Provide 2-4 models")

    seg_result = await db.execute(select(Segment).where(Segment.id == data.segment_id))
    segment = seg_result.scalar_one_or_none()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    lang_result = await db.execute(select(Language).where(Language.id == data.language_id))
    language = lang_result.scalar_one_or_none()
    if not language:
        raise HTTPException(status_code=404, detail="Language not found")

    chapter = await db.execute(select(Chapter).where(Chapter.id == segment.chapter_id))
    chapter = chapter.scalar_one()
    book = await db.execute(select(Book).where(Book.id == chapter.book_id))
    book = book.scalar_one()

    system_prompt, user_prompt, _ = await _build_prompts(
        segment, language, book, db, data.extra_instructions,
        source_language_id=data.source_language_id,
    )

    async def call_model(model: str) -> CompareVariant:
        try:
            result = await translate_text(system_prompt, user_prompt, model=model)
            return CompareVariant(
                model=model,
                translated_text=result["translated_text"],
                token_count=result["token_count"],
            )
        except Exception as exc:
            return CompareVariant(model=model, error=str(exc))

    variants = await asyncio.gather(*[call_model(m) for m in data.models])

    return CompareResponse(
        segment_id=data.segment_id,
        language_id=data.language_id,
        variants=list(variants),
    )


@router.post("/compare/pick", response_model=TranslateResponse)
async def pick_winner(
    data: PickWinnerRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.ai_translate")),
):
    """Save the winning translation and store losers as version history."""
    # Save or update the winning translation (same logic as translate_segment)
    trans_result = await db.execute(
        select(Translation).where(
            Translation.segment_id == data.segment_id,
            Translation.language_id == data.language_id,
        )
    )
    translation = trans_result.scalar_one_or_none()

    if translation:
        # Save current text as a version before overwriting
        version_count = (await db.execute(
            select(TranslationVersion).where(TranslationVersion.translation_id == translation.id)
        )).scalars()
        max_version = max((v.version_number for v in version_count), default=0)

        version = TranslationVersion(
            translation_id=translation.id,
            version_number=max_version + 1,
            translated_text=translation.translated_text,
            content_format=translation.content_format,
            status=translation.status,
            llm_model_used=translation.llm_model_used,
            created_by=user.id,
        )
        db.add(version)

        translation.translated_text = data.winning_text
        translation.content_format = "plain"
        translation.status = SegmentStatus.machine_translated
        translation.llm_model_used = data.winning_model
        translation.updated_by = user.id
    else:
        translation = Translation(
            segment_id=data.segment_id,
            language_id=data.language_id,
            translated_text=data.winning_text,
            status=SegmentStatus.machine_translated,
            llm_model_used=data.winning_model,
            updated_by=user.id,
        )
        db.add(translation)

    await db.flush()
    await db.refresh(translation)

    # Save losing variants as version history
    versions = (await db.execute(
        select(TranslationVersion).where(TranslationVersion.translation_id == translation.id)
    )).scalars()
    max_version = max((v.version_number for v in versions), default=0)

    for i, loser in enumerate(data.losing_variants):
        if loser.error:
            continue  # skip failed variants
        version = TranslationVersion(
            translation_id=translation.id,
            version_number=max_version + 1 + i,
            translated_text=loser.translated_text,
            status=SegmentStatus.machine_translated,
            llm_model_used=loser.model,
            created_by=user.id,
        )
        db.add(version)

    await db.flush()

    return TranslateResponse(
        segment_id=data.segment_id,
        language_id=data.language_id,
        translated_text=data.winning_text,
        model_used=data.winning_model,
        token_count=0,
        status=translation.status.value,
    )


@router.post("/compare/batch")
async def batch_compare(
    data: BatchCompareRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.ai_translate")),
):
    """Compare multiple models across all segments in a chapter. Streams NDJSON."""
    if len(data.models) < 2 or len(data.models) > 4:
        raise HTTPException(status_code=400, detail="Provide 2-4 models")

    seg_result = await db.execute(
        select(Segment).where(Segment.chapter_id == data.chapter_id).order_by(Segment.order)
    )
    segments = seg_result.scalars().all()
    if not segments:
        raise HTTPException(status_code=404, detail="Chapter has no segments")

    lang_result = await db.execute(select(Language).where(Language.id == data.language_id))
    language = lang_result.scalar_one_or_none()
    if not language:
        raise HTTPException(status_code=404, detail="Language not found")

    # Get book via first segment's chapter
    chapter = await db.execute(select(Chapter).where(Chapter.id == data.chapter_id))
    chapter = chapter.scalar_one()
    book = await db.execute(select(Book).where(Book.id == chapter.book_id))
    book = book.scalar_one()

    # Filter segments to compare (skip existing unless overwrite requested)
    segments_to_compare = []
    for segment in segments:
        if not data.overwrite_existing:
            existing = await db.execute(
                select(Translation).where(
                    Translation.segment_id == segment.id,
                    Translation.language_id == data.language_id,
                    Translation.status != SegmentStatus.empty,
                )
            )
            if existing.scalar_one_or_none():
                continue
        segments_to_compare.append(segment)

    total = len(segments_to_compare)

    async def generate():
        yield json.dumps({"type": "progress", "total": total, "completed": 0}) + "\n"

        for idx, segment in enumerate(segments_to_compare):
            system_prompt, user_prompt, _ = await _build_prompts(
                segment, language, book, db,
                source_language_id=data.source_language_id,
            )

            async def call_model(model: str) -> CompareVariant:
                try:
                    result = await translate_text(system_prompt, user_prompt, model=model)
                    return CompareVariant(
                        model=model,
                        translated_text=result["translated_text"],
                        token_count=result["token_count"],
                    )
                except Exception as exc:
                    return CompareVariant(model=model, error=str(exc))

            variants = await asyncio.gather(*[call_model(m) for m in data.models])

            seg_result = BatchCompareSegmentResult(
                segment_id=segment.id,
                order=segment.order,
                source_text=segment.source_text,
                variants=list(variants),
            )

            yield json.dumps({
                "type": "segment",
                "total": total,
                "completed": idx + 1,
                "result": seg_result.model_dump(),
            }) + "\n"

        yield json.dumps({"type": "done", "total": total, "completed": total}) + "\n"

    return StreamingResponse(content=generate(), media_type="application/x-ndjson")


@router.post("/compare/batch/pick", response_model=dict)
async def batch_pick_winners(
    data: BatchPickRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.ai_translate")),
):
    """Save winners for multiple segments from a batch comparison."""
    saved = 0
    errors = 0

    for pick in data.picks:
        try:
            await pick_winner(
                PickWinnerRequest(
                    segment_id=pick.segment_id,
                    language_id=data.language_id,
                    winning_model=pick.winning_model,
                    winning_text=pick.winning_text,
                    losing_variants=pick.losing_variants,
                ),
                db,
                user,
            )
            await db.commit()
            saved += 1
        except Exception:
            await db.rollback()
            errors += 1

    return {
        "chapter_id": data.chapter_id,
        "total": len(data.picks),
        "saved": saved,
        "errors": errors,
    }


@router.post("/batch", response_model=dict)
async def batch_translate(
    data: BatchTranslateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.ai_translate")),
):
    """Translate all segments in a chapter."""
    # Resolve from BookTranslation if provided
    language_id = data.language_id
    source_language_id = data.source_language_id
    bt_model_override = None
    if data.book_translation_id:
        bt = await _resolve_bt(data.book_translation_id, db)
        language_id = bt.target_language_id
        source_language_id = bt.source_language_id
        bt_model_override = bt.llm_model

    if not language_id:
        raise HTTPException(status_code=400, detail="language_id or book_translation_id is required")

    # Load chapter segments
    seg_result = await db.execute(
        select(Segment).where(Segment.chapter_id == data.chapter_id).order_by(Segment.order)
    )
    segments = seg_result.scalars().all()
    if not segments:
        raise HTTPException(status_code=404, detail="Chapter has no segments")

    translated = 0
    skipped = 0
    errors = 0

    for segment in segments:
        # Skip if translation exists and overwrite not requested
        if not data.overwrite_existing:
            existing = await db.execute(
                select(Translation).where(
                    Translation.segment_id == segment.id,
                    Translation.language_id == language_id,
                    Translation.status != SegmentStatus.empty,
                )
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue

        try:
            req = TranslateRequest(
                segment_id=segment.id,
                language_id=language_id,
                source_language_id=source_language_id,
                model=data.model or bt_model_override,
            )
            await translate_segment(req, db, user)
            await db.commit()
            translated += 1
        except HTTPException as exc:
            await db.rollback()
            if source_language_id and exc.status_code == 400:
                # Pivot source not approved for this segment — skip it
                skipped += 1
            else:
                errors += 1
        except Exception:
            await db.rollback()
            errors += 1

    return {
        "chapter_id": data.chapter_id,
        "total_segments": len(segments),
        "translated": translated,
        "skipped": skipped,
        "errors": errors,
        "status": "completed",
    }


@router.post("/segment/create", response_model=TranslateResponse)
async def create_translation(
    data: CreateTranslationRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.edit")),
):
    """Create a new translation row for a segment (for manual/human entry)."""
    # Check if one already exists
    existing = await db.execute(
        select(Translation).where(
            Translation.segment_id == data.segment_id,
            Translation.language_id == data.language_id,
        )
    )
    translation = existing.scalar_one_or_none()

    if translation:
        # Already exists — update it instead
        translation.translated_text = data.translated_text
        translation.content_format = data.content_format or "plain"
        translation.status = SegmentStatus(data.status) if data.status else SegmentStatus.draft
        translation.updated_by = user.id
    else:
        translation = Translation(
            segment_id=data.segment_id,
            language_id=data.language_id,
            translated_text=data.translated_text,
            content_format=data.content_format or "plain",
            status=SegmentStatus(data.status) if data.status else SegmentStatus.draft,
            llm_model_used=None,
            token_count=0,
            updated_by=user.id,
        )
        db.add(translation)

    await db.flush()
    await db.refresh(translation)

    return TranslateResponse(
        translation_id=translation.id,
        segment_id=translation.segment_id,
        language_id=translation.language_id,
        translated_text=translation.translated_text,
        model_used="human",
        token_count=0,
        status=translation.status.value,
    )


@router.put("/segment/{translation_id}", response_model=TranslateResponse)
async def update_translation(
    translation_id: int,
    data: UpdateTranslationRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.edit")),
):
    """Manually update a translation (human edit)."""
    result = await db.execute(select(Translation).where(Translation.id == translation_id))
    translation = result.scalar_one_or_none()
    if not translation:
        raise HTTPException(status_code=404, detail="Translation not found")

    # Save version before overwriting
    versions = await db.execute(
        select(TranslationVersion).where(TranslationVersion.translation_id == translation.id)
    )
    max_version = max((v.version_number for v in versions.scalars()), default=0)

    version = TranslationVersion(
        translation_id=translation.id,
        version_number=max_version + 1,
        translated_text=translation.translated_text,
        content_format=translation.content_format,
        status=translation.status,
        created_by=user.id,
    )
    db.add(version)

    # previous_text invariant: capture immutable plain-text baseline BEFORE switching
    # format. Only captures when existing content is plain text — if it's already
    # prosemirror JSON, we skip (previous_text must always be plain text).
    if (data.content_format == 'prosemirror'
            and translation.previous_text is None
            and translation.translated_text
            and translation.content_format != 'prosemirror'):
        translation.previous_text = translation.translated_text

    # Legacy TC baseline: if no content_format switch but TC is on, preserve old behavior
    if data.content_format is None and translation.previous_text is None:
        from app.models.book_translation import BookTranslation
        from app.models.chapter import Chapter
        from app.models.segment import Segment as SegModel
        seg = await db.get(SegModel, translation.segment_id)
        if seg:
            ch = await db.get(Chapter, seg.chapter_id)
            if ch:
                bt_result = await db.execute(
                    select(BookTranslation).where(
                        BookTranslation.book_id == ch.book_id,
                        BookTranslation.target_language_id == translation.language_id,
                    )
                )
                bt = bt_result.scalar_one_or_none()
                if bt and bt.track_changes and translation.translated_text:
                    translation.previous_text = translation.translated_text

    # Apply content_format if provided
    if data.content_format:
        translation.content_format = data.content_format

    translation.translated_text = data.translated_text
    # Per-hunk track changes: allow explicit previous_text update
    if data.previous_text is not None:
        translation.previous_text = data.previous_text if data.previous_text else None
    if data.status:
        translation.status = SegmentStatus(data.status)
    else:
        translation.status = SegmentStatus.draft
    translation.updated_by = user.id

    await db.flush()
    await db.refresh(translation)

    return TranslateResponse(
        segment_id=translation.segment_id,
        language_id=translation.language_id,
        translated_text=translation.translated_text,
        model_used=translation.llm_model_used or "human",
        token_count=translation.token_count,
        status=translation.status.value,
    )


@router.put("/batch-status", response_model=dict)
async def batch_update_status(
    data: BatchStatusRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.edit")),
):
    """Update status for multiple translations at once."""
    updated = 0
    new_status = SegmentStatus(data.status)
    for tid in data.translation_ids:
        result = await db.execute(select(Translation).where(Translation.id == tid))
        translation = result.scalar_one_or_none()
        if translation:
            translation.status = new_status
            translation.updated_by = user.id
            updated += 1
    await db.flush()
    return {"updated": updated}


@router.get("/segment/{translation_id}/versions", response_model=list[TranslationVersionResponse])
async def get_translation_versions(
    translation_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.edit")),
):
    """Get all version history for a translation."""
    # Verify translation exists
    result = await db.execute(select(Translation).where(Translation.id == translation_id))
    translation = result.scalar_one_or_none()
    if not translation:
        raise HTTPException(status_code=404, detail="Translation not found")

    # Fetch versions ordered by version_number descending
    versions_result = await db.execute(
        select(TranslationVersion)
        .where(TranslationVersion.translation_id == translation_id)
        .order_by(TranslationVersion.version_number.desc())
    )
    versions = versions_result.scalars().all()

    # Batch-load usernames for created_by IDs
    user_ids = {v.created_by for v in versions if v.created_by}
    if translation.updated_by:
        user_ids.add(translation.updated_by)
    username_map: dict[int, str] = {}
    if user_ids:
        users_result = await db.execute(
            select(User).where(User.id.in_(user_ids))
        )
        for u in users_result.scalars().all():
            username_map[u.id] = u.username

    return [
        TranslationVersionResponse(
            id=v.id,
            version_number=v.version_number,
            translated_text=v.translated_text,
            status=v.status.value,
            llm_model_used=v.llm_model_used,
            content_format=v.content_format,
            created_by=v.created_by,
            created_by_username=username_map.get(v.created_by) if v.created_by else None,
            created_at=v.created_at,
        )
        for v in versions
    ]


@router.post("/segment/{translation_id}/restore/{version_id}", response_model=TranslateResponse)
async def restore_translation_version(
    translation_id: int,
    version_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.edit")),
):
    """Restore a specific version: save current text as a new version, then overwrite with restored version."""
    # Load translation
    result = await db.execute(select(Translation).where(Translation.id == translation_id))
    translation = result.scalar_one_or_none()
    if not translation:
        raise HTTPException(status_code=404, detail="Translation not found")

    # Load the version to restore
    ver_result = await db.execute(
        select(TranslationVersion).where(
            TranslationVersion.id == version_id,
            TranslationVersion.translation_id == translation_id,
        )
    )
    version_to_restore = ver_result.scalar_one_or_none()
    if not version_to_restore:
        raise HTTPException(status_code=404, detail="Version not found")

    # Save current translation text as a new version before overwriting
    versions_result = await db.execute(
        select(TranslationVersion).where(TranslationVersion.translation_id == translation_id)
    )
    max_version = max((v.version_number for v in versions_result.scalars()), default=0)

    current_version = TranslationVersion(
        translation_id=translation.id,
        version_number=max_version + 1,
        translated_text=translation.translated_text,
        content_format=translation.content_format,
        status=translation.status,
        llm_model_used=translation.llm_model_used,
        created_by=user.id,
    )
    db.add(current_version)

    # Overwrite translation with restored version
    translation.translated_text = version_to_restore.translated_text
    translation.content_format = version_to_restore.content_format
    translation.status = version_to_restore.status
    translation.updated_by = user.id

    await db.flush()
    await db.refresh(translation)

    return TranslateResponse(
        segment_id=translation.segment_id,
        language_id=translation.language_id,
        translated_text=translation.translated_text,
        model_used=translation.llm_model_used or "human",
        token_count=translation.token_count,
        status=translation.status.value,
    )


@router.post("/track-changes/resolve", response_model=dict)
async def resolve_track_changes(
    data: TrackChangesResolveRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("translations.edit")),
):
    """Accept or reject all tracked changes in a chapter."""
    if data.action not in ('accept_all', 'reject_all'):
        raise HTTPException(status_code=400, detail="action must be 'accept_all' or 'reject_all'")

    seg_result = await db.execute(
        select(Segment).where(Segment.chapter_id == data.chapter_id).order_by(Segment.order)
    )
    segments = seg_result.scalars().all()

    resolved = 0
    for seg in segments:
        t_result = await db.execute(
            select(Translation).where(
                Translation.segment_id == seg.id,
                Translation.language_id == data.language_id,
            )
        )
        translation = t_result.scalar_one_or_none()
        if not translation or not translation.previous_text:
            continue
        if translation.previous_text == translation.translated_text:
            # No actual change — just clear baseline
            translation.previous_text = None
            continue

        if data.action == 'accept_all':
            # Keep current text, clear baseline
            # Note: if content_format is 'prosemirror', the frontend should have
            # already resolved changes and saved as plain. Clear baseline only.
            translation.previous_text = None
        else:
            # Revert to baseline text
            # Save current text as a version first for audit
            v_result = await db.execute(
                select(func.max(TranslationVersion.version_number))
                .where(TranslationVersion.translation_id == translation.id)
            )
            max_ver = v_result.scalar() or 0
            db.add(TranslationVersion(
                translation_id=translation.id,
                version_number=max_ver + 1,
                translated_text=translation.translated_text,
                content_format=translation.content_format,
                status=translation.status,
                created_by=user.id,
            ))
            translation.translated_text = translation.previous_text
            translation.content_format = "plain"  # previous_text is always plain
            translation.previous_text = None
            translation.updated_by = user.id
        resolved += 1

    await db.commit()
    return {"resolved": resolved, "action": data.action}
