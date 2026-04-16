import csv
import io

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, exists, and_
from sqlalchemy.orm import selectinload, aliased

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.permissions import require_permission
from app.models.user import User
from app.models.language import Language
from app.models.glossary import GlossaryTerm, GlossaryTranslation, GlossaryCategory, GlossaryProject
from app.schemas.glossary import (
    GlossaryTermCreate, GlossaryTermUpdate, GlossaryTermResponse,
    GlossaryListResponse, GlossaryTranslationCreate, GlossaryTranslationResponse,
    GlossaryTranslationUpdate, AICompleteRequest, AICompleteInlineRequest,
    AICompleteResponse, AIBatchRequest, AIBatchResponse, AIBatchItem,
    CSVImportResponse, AutocompleteSuggestion, AutocompleteResponse,
    GlossaryDetectRequest, DetectedTerm, GlossaryDetectResponse,
)
from app.services.glossary.ai_complete import ai_complete_term, ai_complete_batch
from app.services.glossary.term_detection import detect_terms_in_text, invalidate_cache

router = APIRouter()

# Whitelist of sortable columns
_SORT_COLUMNS = {
    "source_term": GlossaryTerm.source_term,
    "sanskrit_pali": GlossaryTerm.sanskrit_pali,
    "category": GlossaryTerm.category,
    "project_tags": GlossaryTerm.project_tags,
    "tradition_group": GlossaryTerm.tradition_group,
    "created_at": GlossaryTerm.created_at,
    "updated_at": GlossaryTerm.updated_at,
    "do_not_translate": GlossaryTerm.do_not_translate,
    "transliterate": GlossaryTerm.transliterate,
}


def _apply_filters(query, search, category, project, tradition, translation_status, language_id):
    """Apply shared filter logic to both data and count queries."""
    if search:
        search_pattern = f"%{search}%"
        has_matching_translation = exists(
            select(GlossaryTranslation.id).where(
                GlossaryTranslation.term_id == GlossaryTerm.id,
                GlossaryTranslation.translated_term.ilike(search_pattern),
            )
        )
        query = query.where(
            or_(
                GlossaryTerm.source_term.ilike(search_pattern),
                GlossaryTerm.sanskrit_pali.ilike(search_pattern),
                has_matching_translation,
            )
        )
    if category:
        query = query.where(GlossaryTerm.category == category)
    if project:
        query = query.where(GlossaryTerm.project_tags.ilike(f"%{project}%"))
    if tradition:
        query = query.where(GlossaryTerm.tradition_group.ilike(f"%{tradition}%"))
    if translation_status == "needs_review":
        query = query.where(
            exists(
                select(GlossaryTranslation.id).where(
                    GlossaryTranslation.term_id == GlossaryTerm.id,
                    GlossaryTranslation.translated_term.like("%?%"),
                    *([GlossaryTranslation.language_id == language_id] if language_id else []),
                )
            )
        )
    elif translation_status == "missing":
        # Match terms with no translations at all, OR translations with empty text
        lang_filter = [GlossaryTranslation.language_id == language_id] if language_id else []
        has_nonempty = exists(
            select(GlossaryTranslation.id).where(
                GlossaryTranslation.term_id == GlossaryTerm.id,
                GlossaryTranslation.translated_term != "",
                *lang_filter,
            )
        )
        query = query.where(~has_nonempty)
    return query


@router.get("", response_model=GlossaryListResponse)
async def list_terms(
    search: str = Query("", description="Search in source term or translations"),
    category: str | None = Query(None),
    project: str | None = Query(None, description="Filter by project tag"),
    tradition: str | None = Query(None, description="Filter by tradition/group"),
    language_id: int | None = Query(None, description="Filter by translation language"),
    reference_language_id: int | None = Query(None, description="Include translations for a reference language"),
    translation_status: str | None = Query(None, description="Filter: 'needs_review' or 'missing'"),
    sort_by: str = Query("source_term", description="Column to sort by"),
    sort_order: str = Query("asc", description="asc or desc"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = select(GlossaryTerm).options(selectinload(GlossaryTerm.translations))
    query = _apply_filters(query, search, category, project, tradition, translation_status, language_id)

    count_base = select(GlossaryTerm)
    count_base = _apply_filters(count_base, search, category, project, tradition, translation_status, language_id)
    count_q = select(func.count()).select_from(count_base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Dynamic sorting
    if sort_by == "translated_term":
        trans_sort = aliased(GlossaryTranslation)
        join_conds = [trans_sort.term_id == GlossaryTerm.id, trans_sort.is_preferred == True]
        if language_id:
            join_conds.append(trans_sort.language_id == language_id)
        query = query.outerjoin(trans_sort, and_(*join_conds))
        sort_col = trans_sort.translated_term
    else:
        sort_col = _SORT_COLUMNS.get(sort_by, GlossaryTerm.source_term)

    order = sort_col.desc() if sort_order == "desc" else sort_col.asc()
    result = await db.execute(query.order_by(order).offset(offset).limit(limit))
    terms = result.scalars().unique().all()

    term_responses = [_term_to_response(term, language_id, reference_language_id) for term in terms]

    return GlossaryListResponse(terms=term_responses, total=total)


@router.post("", response_model=GlossaryTermResponse)
async def create_term(
    data: GlossaryTermCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.create")),
):
    term = GlossaryTerm(
        source_term=data.source_term,
        sanskrit_pali=data.sanskrit_pali,
        category=data.category,
        tbs_notes=data.tbs_notes,
        context_notes=data.context_notes,
        do_not_translate=data.do_not_translate,
        transliterate=data.transliterate,
        project_tags=data.project_tags,
        source_reference=data.source_reference,
        tradition_group=data.tradition_group,
    )
    db.add(term)
    await db.flush()

    for t_data in data.translations:
        gt = GlossaryTranslation(
            term_id=term.id,
            language_id=t_data.language_id,
            translated_term=t_data.translated_term,
            is_preferred=t_data.is_preferred,
            notes=t_data.notes,
        )
        db.add(gt)

    await db.flush()
    await db.refresh(term)

    # Reload with translations
    result = await db.execute(
        select(GlossaryTerm).options(selectinload(GlossaryTerm.translations)).where(GlossaryTerm.id == term.id)
    )
    term = result.scalar_one()
    invalidate_cache()
    return _term_to_response(term)


# Translation CRUD - registered before /{term_id} to avoid path conflicts
@router.patch("/translations/{translation_id}", response_model=GlossaryTranslationResponse)
async def update_translation(
    translation_id: int,
    data: GlossaryTranslationUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.edit")),
):
    result = await db.execute(
        select(GlossaryTranslation).where(GlossaryTranslation.id == translation_id)
    )
    translation = result.scalar_one_or_none()
    if not translation:
        raise HTTPException(status_code=404, detail="Translation not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(translation, key, value)

    await db.flush()
    await db.refresh(translation)
    invalidate_cache()
    return translation


@router.delete("/translations/{translation_id}")
async def delete_translation(
    translation_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.delete")),
):
    result = await db.execute(
        select(GlossaryTranslation).where(GlossaryTranslation.id == translation_id)
    )
    translation = result.scalar_one_or_none()
    if not translation:
        raise HTTPException(status_code=404, detail="Translation not found")
    await db.delete(translation)
    invalidate_cache()
    return {"ok": True}


# Autocomplete endpoint - registered before /{term_id} to avoid path conflicts
@router.get("/autocomplete", response_model=AutocompleteResponse)
async def autocomplete(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    language_id: int | None = Query(None, description="Filter by translation language"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Lightweight autocomplete search across source terms, translations, and Sanskrit."""
    search_pattern = f"%{q}%"
    q_lower = q.lower()

    # Build filter: match source_term, sanskrit_pali, or any translation
    has_matching_translation = exists(
        select(GlossaryTranslation.id).where(
            GlossaryTranslation.term_id == GlossaryTerm.id,
            GlossaryTranslation.translated_term.ilike(search_pattern),
            *([GlossaryTranslation.language_id == language_id] if language_id else []),
        )
    )

    match_filter = or_(
        GlossaryTerm.source_term.ilike(search_pattern),
        GlossaryTerm.sanskrit_pali.ilike(search_pattern),
        has_matching_translation,
    )

    # Use scalar subquery for translated_term to avoid row multiplication from joins
    lang_filter = [GlossaryTranslation.language_id == language_id] if language_id else []
    translated_subq = (
        select(GlossaryTranslation.translated_term)
        .where(
            GlossaryTranslation.term_id == GlossaryTerm.id,
            GlossaryTranslation.is_preferred == True,
            *lang_filter,
        )
        .correlate(GlossaryTerm)
        .limit(1)
        .scalar_subquery()
        .label("translated_term")
    )

    # Count total matches
    count_q = select(func.count()).select_from(
        select(GlossaryTerm.id).where(match_filter).subquery()
    )
    total = (await db.execute(count_q)).scalar() or 0

    # Fetch suggestions — one row per term, no dedup needed
    query = (
        select(
            GlossaryTerm.id,
            GlossaryTerm.source_term,
            GlossaryTerm.sanskrit_pali,
            translated_subq,
        )
        .where(match_filter)
        .order_by(GlossaryTerm.source_term)
        .offset(offset)
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.all()

    suggestions = []
    for row in rows:
        # Determine which field matched
        if q_lower in (row.source_term or "").lower():
            match_field = "source_term"
        elif q_lower in (row.translated_term or "").lower():
            match_field = "translated_term"
        elif q_lower in (row.sanskrit_pali or "").lower():
            match_field = "sanskrit_pali"
        else:
            match_field = "source_term"

        suggestions.append(AutocompleteSuggestion(
            id=row.id,
            source_term=row.source_term,
            translated_term=row.translated_term or "",
            match_field=match_field,
        ))

    return AutocompleteResponse(suggestions=suggestions, total=total)


# AI completion endpoints - registered before /{term_id} to avoid path conflicts
@router.post("/ai-batch", response_model=AIBatchResponse)
async def batch_ai_complete(
    data: AIBatchRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.ai")),
):
    """AI-complete multiple glossary terms at once."""
    if len(data.term_ids) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 terms per batch")

    # Load all requested terms
    result = await db.execute(
        select(GlossaryTerm).options(selectinload(GlossaryTerm.translations))
        .where(GlossaryTerm.id.in_(data.term_ids))
    )
    terms = result.scalars().unique().all()
    terms_by_id = {t.id: t for t in terms}

    # Build batch input
    batch_input = []
    for tid in data.term_ids:
        term = terms_by_id.get(tid)
        if not term:
            continue
        en_trans = next(
            (t for t in term.translations if t.is_preferred),
            next(iter(term.translations), None),
        )
        batch_input.append({
            "term_id": term.id,
            "source_term": term.source_term,
            "english": en_trans.translated_term if en_trans else "",
            "sanskrit": term.sanskrit_pali or "",
        })

    if not batch_input:
        return AIBatchResponse(results=[], model=None)

    try:
        suggestions = await ai_complete_batch(batch_input, model=data.model)
    except Exception as exc:
        error_msg = str(exc)
        if "AuthenticationError" in error_msg or "invalid x-api-key" in error_msg.lower():
            raise HTTPException(
                status_code=502,
                detail="LLM API key is missing or invalid. Go to Settings to configure your API key.",
            )
        raise HTTPException(status_code=502, detail=f"AI completion failed: {error_msg}")

    results = []
    model_used = None
    for s in suggestions:
        model_used = s.get("model", model_used)
        results.append(AIBatchItem(
            term_id=s.get("term_id", 0),
            english=s.get("english"),
            sanskrit=s.get("sanskrit"),
            category=s.get("category"),
            confidence=s.get("confidence", 0.0),
        ))

    return AIBatchResponse(results=results, model=model_used)


@router.post("/ai-complete", response_model=AICompleteResponse)
async def ai_complete_inline(
    data: AICompleteInlineRequest,
    _: User = Depends(require_permission("glossary.ai")),
):
    """Use AI to suggest completions from raw term data (no saved term required)."""
    try:
        suggestions = await ai_complete_term(
            source_term=data.source_term,
            english=data.english,
            sanskrit=data.sanskrit,
            category=data.category,
            context_notes=data.context_notes,
            tbs_notes=data.tbs_notes,
            project_tags=data.project_tags,
            tradition_group=data.tradition_group,
            fields=data.fields,
            model=data.model,
            target_language=data.target_language or "English",
        )
    except Exception as exc:
        error_msg = str(exc)
        if "AuthenticationError" in error_msg or "invalid x-api-key" in error_msg.lower():
            raise HTTPException(
                status_code=502,
                detail="LLM API key is missing or invalid. Go to Settings to configure your API key.",
            )
        raise HTTPException(status_code=502, detail=f"AI completion failed: {error_msg}")

    return AICompleteResponse(
        english=suggestions.get("english"),
        sanskrit=suggestions.get("sanskrit"),
        category=suggestions.get("category"),
        confidence=suggestions.get("confidence", 0.0),
        model=suggestions.get("model"),
        token_count=suggestions.get("token_count", 0),
    )


@router.post("/detect", response_model=GlossaryDetectResponse)
async def detect_glossary_terms(
    data: GlossaryDetectRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Detect glossary terms in source text. Used by editor for highlighting."""
    matched = await detect_terms_in_text(data.text, data.language_id, db)
    terms = [DetectedTerm(**m) for m in matched]
    return GlossaryDetectResponse(terms=terms)


@router.get("/{term_id}", response_model=GlossaryTermResponse)
async def get_term(
    term_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GlossaryTerm).options(selectinload(GlossaryTerm.translations)).where(GlossaryTerm.id == term_id)
    )
    term = result.scalar_one_or_none()
    if not term:
        raise HTTPException(status_code=404, detail="Term not found")
    return _term_to_response(term)


@router.patch("/{term_id}", response_model=GlossaryTermResponse)
async def update_term(
    term_id: int,
    data: GlossaryTermUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.edit")),
):
    result = await db.execute(
        select(GlossaryTerm).options(selectinload(GlossaryTerm.translations)).where(GlossaryTerm.id == term_id)
    )
    term = result.scalar_one_or_none()
    if not term:
        raise HTTPException(status_code=404, detail="Term not found")

    update_data = data.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(term, key, value)

    await db.flush()
    await db.refresh(term)
    invalidate_cache()
    return _term_to_response(term)


@router.delete("/{term_id}")
async def delete_term(
    term_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.delete")),
):
    result = await db.execute(select(GlossaryTerm).where(GlossaryTerm.id == term_id))
    term = result.scalar_one_or_none()
    if not term:
        raise HTTPException(status_code=404, detail="Term not found")
    await db.delete(term)
    invalidate_cache()
    return {"ok": True}


@router.post("/{term_id}/translations", response_model=GlossaryTranslationResponse)
async def add_term_translation(
    term_id: int,
    data: GlossaryTranslationCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.create")),
):
    # Verify term exists
    result = await db.execute(select(GlossaryTerm).where(GlossaryTerm.id == term_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Term not found")

    gt = GlossaryTranslation(
        term_id=term_id,
        language_id=data.language_id,
        translated_term=data.translated_term,
        is_preferred=data.is_preferred,
        notes=data.notes,
    )
    db.add(gt)
    await db.flush()
    await db.refresh(gt)
    invalidate_cache()
    return gt


@router.post("/{term_id}/ai-complete", response_model=AICompleteResponse)
async def ai_complete(
    term_id: int,
    data: AICompleteRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.ai")),
):
    """Use AI to suggest completions for empty fields of a glossary term."""
    result = await db.execute(
        select(GlossaryTerm).options(selectinload(GlossaryTerm.translations))
        .where(GlossaryTerm.id == term_id)
    )
    term = result.scalar_one_or_none()
    if not term:
        raise HTTPException(status_code=404, detail="Term not found")

    # Resolve target language name
    target_language = "English"
    if data.target_language:
        target_language = data.target_language
    # Find existing translation for the target language (by name lookup)
    target_lang_obj = None
    if target_language != "English":
        lang_result = await db.execute(select(Language).where(Language.name == target_language))
        target_lang_obj = lang_result.scalar_one_or_none()

    if target_lang_obj:
        current_translation = next(
            (t for t in term.translations if t.language_id == target_lang_obj.id and t.is_preferred),
            next((t for t in term.translations if t.language_id == target_lang_obj.id), None),
        )
    else:
        current_translation = next(
            (t for t in term.translations if t.is_preferred),
            next(iter(term.translations), None),
        )

    try:
        suggestions = await ai_complete_term(
            source_term=term.source_term,
            english=current_translation.translated_term if current_translation else "",
            sanskrit=term.sanskrit_pali or "",
            category=term.category or "",
            context_notes=term.context_notes or "",
            tbs_notes=term.tbs_notes or "",
            project_tags=term.project_tags or "",
            tradition_group=term.tradition_group or "",
            fields=data.fields,
            model=data.model,
            target_language=target_language,
        )
    except Exception as exc:
        error_msg = str(exc)
        if "AuthenticationError" in error_msg or "invalid x-api-key" in error_msg.lower():
            raise HTTPException(
                status_code=502,
                detail="LLM API key is missing or invalid. Go to Settings to configure your API key.",
            )
        raise HTTPException(status_code=502, detail=f"AI completion failed: {error_msg}")

    return AICompleteResponse(
        english=suggestions.get("english"),
        sanskrit=suggestions.get("sanskrit"),
        category=suggestions.get("category"),
        confidence=suggestions.get("confidence", 0.0),
        model=suggestions.get("model"),
        token_count=suggestions.get("token_count", 0),
    )


# Column header mapping: CSV header (lowered) -> internal field name
_COLUMN_MAP = {
    # Buddhist glossary CSV format
    "chinese": "source_term",
    "english": "translated_term",
    "sanskrit/pali/tibetan/pinyin/others": "sanskrit_pali",
    "related information": "context_notes",
    "category": "category",
    "projects": "project_tags",
    "source": "source_reference",
    "group": "tradition_group",
    # Original format (still supported)
    "source_term": "source_term",
    "translated_term": "translated_term",
    "sanskrit_pali": "sanskrit_pali",
    "notes": "context_notes",
}

# Category value mapping: CSV value (lowered) -> category key string
_CATEGORY_MAP = {
    "term": "dharma_concept",
    "phrase": "dharma_concept",
    "practice": "practice_ritual",
    "deity": "deity_buddha",
    "person": "person",
    "place": "place_temple",
    "mantra": "mantra",
    "mudra": "mudra",
    "honorific": "honorific",
    "other": "general",
    "general": "general",
}

# Known built-in category keys for validation
_BUILTIN_CATEGORIES = {
    "dharma_concept", "deity_buddha", "mantra", "mudra",
    "practice_ritual", "person", "place_temple", "honorific", "general",
}


def _resolve_category(raw: str) -> str:
    """Resolve a CSV category value to a category key string.

    Known aliases (e.g. "term" -> "dharma_concept") are mapped first.
    Built-in keys pass through unchanged.
    Unrecognised non-empty values are kept as custom category keys
    (lowercased, spaces replaced with underscores) so they can be
    auto-created during import.  Only truly empty values fall back
    to "general".
    """
    value = raw.strip().lower()
    if not value:
        return "general"
    if value in _CATEGORY_MAP:
        return _CATEGORY_MAP[value]
    if value in _BUILTIN_CATEGORIES:
        return value
    # Preserve as custom category key
    import re
    key = re.sub(r'[^a-z0-9]+', '_', value).strip('_')
    return key if key else "general"


def _normalize_row(row: dict[str, str]) -> dict[str, str]:
    """Map CSV column headers to internal field names."""
    normalized = {}
    for header, value in row.items():
        key = _COLUMN_MAP.get(header.strip().lower())
        if key and value:
            normalized[key] = value.strip()
    return normalized


@router.post("/import/csv", response_model=CSVImportResponse)
async def import_csv(
    file: UploadFile = File(...),
    language_code: str = Query("en", description="Target language code for translations"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.import")),
):
    """Import glossary terms from CSV.

    Supports two CSV formats:
    - Original: source_term, translated_term, sanskrit_pali, category, notes
    - Buddhist glossary: CHINESE, ENGLISH, SANSKRIT/PALI/..., CATEGORY, PROJECTS, SOURCE, GROUP, RELATED INFORMATION

    Minimum required: source_term/CHINESE and translated_term/ENGLISH

    Uses batch DB operations for performance: pre-loads existing terms and
    translations, then bulk-creates new records in two flushes.
    """
    MAX_IMPORT_ROWS = 20_000
    CHUNK_SIZE = 500

    # --- Phase 1: Parse and validate CSV ---
    try:
        raw = await file.read()
        content = raw.decode("utf-8-sig", errors="replace")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read file. Ensure it is a valid UTF-8 CSV.")

    reader = csv.DictReader(io.StringIO(content))

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file has no headers or is empty.")

    # Validate that at least one header is recognized
    recognized = {h.strip().lower() for h in reader.fieldnames} & set(_COLUMN_MAP.keys())
    if not recognized:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No recognized columns found. Expected headers include: "
                f"CHINESE, ENGLISH, source_term, translated_term. "
                f"Found: {', '.join(reader.fieldnames)}"
            ),
        )

    valid_rows: list[dict[str, str]] = []
    skipped = 0
    errors: list[str] = []

    for i, row in enumerate(reader, start=2):  # row 1 is header
        if len(valid_rows) >= MAX_IMPORT_ROWS:
            errors.append(f"File exceeds {MAX_IMPORT_ROWS} row limit; remaining rows were not processed.")
            break
        mapped = _normalize_row(row)
        source = mapped.get("source_term", "")
        translated = mapped.get("translated_term", "")
        if not source or not translated:
            skipped += 1
            continue
        # Truncate fields that have VARCHAR limits in the database
        if len(source) > 500:
            mapped["source_term"] = source[:500]
        sanskrit = mapped.get("sanskrit_pali", "")
        if len(sanskrit) > 500:
            mapped["sanskrit_pali"] = sanskrit[:500]
        tags = mapped.get("project_tags", "")
        if len(tags) > 500:
            mapped["project_tags"] = tags[:500]
        tradition = mapped.get("tradition_group", "")
        if len(tradition) > 200:
            mapped["tradition_group"] = tradition[:200]
        valid_rows.append(mapped)

    if not valid_rows:
        return CSVImportResponse(imported=0, skipped=skipped, errors=errors or ["No valid rows found in CSV."])

    # --- Phase 2: Resolve language, pre-load existing terms ---
    lang_result = await db.execute(select(Language).where(Language.code == language_code))
    language = lang_result.scalar_one_or_none()
    if not language:
        language = Language(code=language_code, name=language_code.upper())
        db.add(language)
        await db.flush()

    unique_sources = list({r["source_term"] for r in valid_rows})

    existing_terms: dict[str, GlossaryTerm] = {}
    for i in range(0, len(unique_sources), CHUNK_SIZE):
        chunk = unique_sources[i : i + CHUNK_SIZE]
        result = await db.execute(
            select(GlossaryTerm).where(GlossaryTerm.source_term.in_(chunk))
        )
        for term in result.scalars().all():
            existing_terms[term.source_term] = term

    # --- Phase 2b: Auto-create missing categories and projects ---
    # Collect all resolved category keys from import data
    imported_category_keys = {_resolve_category(r.get("category", "")) for r in valid_rows}
    imported_category_keys.discard("general")  # always exists as default

    categories_created = 0
    if imported_category_keys:
        existing_cat_result = await db.execute(
            select(GlossaryCategory.key).where(GlossaryCategory.key.in_(list(imported_category_keys)))
        )
        existing_cat_keys = {row[0] for row in existing_cat_result.all()}
        missing_cat_keys = imported_category_keys - existing_cat_keys
        if missing_cat_keys:
            new_cats = []
            for cat_key in sorted(missing_cat_keys):
                label = cat_key.replace("_", " ").title()
                new_cats.append(GlossaryCategory(key=cat_key, label=label, color="gray", sort_order=0, is_builtin=False))
            db.add_all(new_cats)
            await db.flush()
            categories_created = len(new_cats)

    # Collect all project names from import data
    imported_project_names: set[str] = set()
    for r in valid_rows:
        tags = r.get("project_tags", "")
        if tags:
            for tag in tags.split(","):
                trimmed = tag.strip()
                if trimmed:
                    imported_project_names.add(trimmed)

    projects_created = 0
    if imported_project_names:
        existing_proj_result = await db.execute(
            select(GlossaryProject.name).where(GlossaryProject.name.in_(list(imported_project_names)))
        )
        existing_proj_names = {row[0] for row in existing_proj_result.all()}
        missing_proj_names = imported_project_names - existing_proj_names
        if missing_proj_names:
            new_projs = [GlossaryProject(name=name) for name in sorted(missing_proj_names)]
            db.add_all(new_projs)
            await db.flush()
            projects_created = len(new_projs)

    # --- Phase 3: Bulk-create new terms (single flush) ---
    new_term_objects = []
    seen_new_sources: set[str] = set()
    for r in valid_rows:
        src = r["source_term"]
        if src not in existing_terms and src not in seen_new_sources:
            seen_new_sources.add(src)
            new_term_objects.append(GlossaryTerm(
                source_term=src,
                sanskrit_pali=r.get("sanskrit_pali", ""),
                category=_resolve_category(r.get("category", "")),
                context_notes=r.get("context_notes", ""),
                project_tags=r.get("project_tags", ""),
                source_reference=r.get("source_reference", ""),
                tradition_group=r.get("tradition_group", ""),
            ))

    if new_term_objects:
        db.add_all(new_term_objects)
        await db.flush()
        for t in new_term_objects:
            existing_terms[t.source_term] = t

    # --- Phase 4: Pre-load existing translations ---
    all_term_ids = list({existing_terms[r["source_term"]].id for r in valid_rows})
    existing_trans_set: set[tuple[int, int, str]] = set()
    for i in range(0, len(all_term_ids), CHUNK_SIZE):
        chunk = all_term_ids[i : i + CHUNK_SIZE]
        result = await db.execute(
            select(GlossaryTranslation).where(
                GlossaryTranslation.term_id.in_(chunk),
                GlossaryTranslation.language_id == language.id,
            )
        )
        for tr in result.scalars().all():
            existing_trans_set.add((tr.term_id, tr.language_id, tr.translated_term))

    # --- Phase 5: Bulk-create new translations (single flush) ---
    imported = 0
    new_translations = []
    for r in valid_rows:
        term = existing_terms[r["source_term"]]
        translated = r["translated_term"]
        key = (term.id, language.id, translated)
        if key not in existing_trans_set:
            new_translations.append(GlossaryTranslation(
                term_id=term.id,
                language_id=language.id,
                translated_term=translated,
                is_preferred=True,
            ))
            existing_trans_set.add(key)  # prevent duplicates within CSV
            imported += 1
        else:
            skipped += 1

    if new_translations:
        db.add_all(new_translations)
        await db.flush()

    # Commit explicitly so categories/projects are visible to subsequent
    # API calls the frontend fires immediately after receiving this response.
    # (The get_db() dependency cleanup commits after the response is sent,
    # which can race with the frontend's reload requests.)
    await db.commit()
    invalidate_cache()

    return CSVImportResponse(
        imported=imported,
        skipped=skipped,
        errors=errors,
        categories_created=categories_created,
        projects_created=projects_created,
    )


def _term_to_response(term: GlossaryTerm, language_id: int | None = None, reference_language_id: int | None = None) -> GlossaryTermResponse:
    translations = term.translations
    if language_id:
        lang_ids = {language_id}
        if reference_language_id:
            lang_ids.add(reference_language_id)
        translations = [t for t in translations if t.language_id in lang_ids]
    return GlossaryTermResponse(
        id=term.id,
        source_term=term.source_term,
        source_language_id=term.source_language_id,
        sanskrit_pali=term.sanskrit_pali,
        category=term.category or "general",
        tbs_notes=term.tbs_notes,
        context_notes=term.context_notes,
        do_not_translate=term.do_not_translate,
        transliterate=term.transliterate,
        project_tags=term.project_tags,
        source_reference=term.source_reference,
        tradition_group=term.tradition_group,
        translations=[GlossaryTranslationResponse(
            id=t.id, term_id=t.term_id, language_id=t.language_id,
            translated_term=t.translated_term, is_preferred=t.is_preferred, notes=t.notes,
        ) for t in translations],
        created_at=term.created_at,
        updated_at=term.updated_at,
    )
