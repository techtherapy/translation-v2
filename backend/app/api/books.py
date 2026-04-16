import io
import logging
import re
import zipfile
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from pydantic import BaseModel as PydanticBaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.permissions import require_permission
from app.models.user import User
from app.models.book import Book, BookStatus, EraTag, ContentType
from app.models.chapter import Chapter
from app.models.segment import Segment
from app.models.translation import Translation, SegmentStatus
from app.models.language import Language
from app.schemas.book import (
    BookCreate, BookUpdate, BookResponse, BookListResponse,
    ChapterResponse, ChapterDetailResponse, SegmentWithTranslationsResponse,
    TranslationResponse, SegmentSplitRequest,
    BulkImportFilePreview, BulkImportPreviewResponse,
    BulkImportMetadata, BulkImportResult, BulkImportResponse,
    BookProgressResponse, LanguageProgressDetail, PivotReadinessResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _segment_text(text: str, granularity: str = "sentence") -> list[dict]:
    """Split text into segments at the given granularity.

    Returns list of {"text": str, "paragraph_group": int} dicts.

    Granularity levels:
    - "sentence": split on punctuation boundaries (current behavior)
    - "paragraph": split on blank lines only
    - "chapter": entire text as one segment
    """
    if granularity == "chapter":
        return [{"text": text.strip(), "paragraph_group": 1}]

    # Split on blank lines to get paragraphs
    paragraphs = re.split(r'\n\s*\n', text.strip())
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    if granularity == "paragraph":
        return [
            {"text": para, "paragraph_group": i + 1}
            for i, para in enumerate(paragraphs)
        ]

    # Sentence-level: split each paragraph further
    results: list[dict] = []
    for pg_idx, para in enumerate(paragraphs):
        pg_num = pg_idx + 1

        # First, split out quoted speech 「...」 (with optional trailing punctuation) as separate segments
        quote_parts = re.split(r'(「[^」]*」[。！？]?)', para)
        quote_parts = [p.strip() for p in quote_parts if p.strip()]

        segments: list[str] = []
        for qpart in quote_parts:
            if qpart.startswith('「') and (qpart.endswith('」') or qpart[-2] == '」'):
                segments.append(qpart)
                continue

            parts = re.split(r'(?<=[。！？])', qpart)
            parts = [p.strip() for p in parts if p.strip()]

            expanded: list[str] = []
            for part in parts:
                if len(part) > 50 and '；' in part:
                    sub = re.split(r'(?<=；)', part)
                    expanded.extend(s.strip() for s in sub if s.strip())
                else:
                    expanded.append(part)

            merged: list[str] = []
            for seg in expanded:
                if merged and len(merged[-1]) < 15:
                    merged[-1] = merged[-1] + seg
                else:
                    merged.append(seg)

            segments.extend(merged)

        for seg_text in segments:
            results.append({"text": seg_text, "paragraph_group": pg_num})

    return results


def _detect_chapters(text: str) -> list[dict]:
    """Auto-detect chapter breaks from text.

    Returns list of {"title": str, "content": str} dicts.

    Detection priority:
    1. Numbered chapter lines like "001 祈禱要很真誠" (digits + space + title)
       — duplicates in a TOC block are skipped; only the last occurrence of
       each chapter number is used as the actual chapter boundary.
    2. Chinese chapter markers (第X章, 第X節, etc.)
    3. English chapter headings (Chapter 1, CHAPTER 1, etc.)
    4. Falls back to a single chapter if no markers found.
    """
    # 1) Lines like "001 祈禱要很真誠"
    numbered_pattern = re.compile(r'^\s*(\d{2,4})\s+(\S.*)$', re.MULTILINE)
    numbered_matches = list(numbered_pattern.finditer(text))

    if len(numbered_matches) >= 4:
        # Find the TOC block: a cluster of many consecutive matches with
        # very little text between them (just newlines).  Content lines
        # like "2018 年…" are isolated — they have large gaps before/after.
        toc_nums: set[str] = set()
        run_start = 0
        for i in range(1, len(numbered_matches)):
            gap_text = text[numbered_matches[i - 1].end():numbered_matches[i].start()]
            if len(gap_text.strip()) > 100:
                # Large gap = end of a cluster
                if i - run_start >= 5:  # 5+ consecutive entries = TOC
                    for j in range(run_start, i):
                        toc_nums.add(numbered_matches[j].group(1))
                run_start = i
        # Check final cluster
        if len(numbered_matches) - run_start >= 5:
            for j in range(run_start, len(numbered_matches)):
                toc_nums.add(numbered_matches[j].group(1))

        if toc_nums:
            # Keep only the LAST occurrence of each TOC chapter number
            last_by_num: dict[str, re.Match] = {}
            for m in numbered_matches:
                if m.group(1) in toc_nums:
                    last_by_num[m.group(1)] = m
            matches = sorted(last_by_num.values(), key=lambda m: m.start())
        else:
            # No TOC found — use all matches as-is
            matches = numbered_matches
    else:
        # 2) Chinese / English chapter patterns
        chapter_pattern = re.compile(
            r'^(第[一二三四五六七八九十百千\d]+[章節篇回].*|'
            r'Chapter\s+\d+.*|'
            r'CHAPTER\s+\d+.*)$',
            re.MULTILINE
        )
        matches = list(chapter_pattern.finditer(text))

    if not matches:
        return [{"title": "Chapter 1", "content": text.strip()}]

    chapters = []
    for i, match in enumerate(matches):
        title = match.group(0).strip()
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        content = text[start:end].strip()
        if content:
            chapters.append({"title": title, "content": content})

    # If there's content before the first chapter marker, add it as intro
    if matches and matches[0].start() > 0:
        intro = text[:matches[0].start()].strip()
        if intro:
            chapters.insert(0, {"title": "Introduction", "content": intro})

    return chapters if chapters else [{"title": "Chapter 1", "content": text.strip()}]


def _extract_text_from_docx(file_bytes: bytes) -> str:
    """Extract text from a DOCX file."""
    from docx import Document
    doc = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs]
    return "\n\n".join(p for p in paragraphs if p.strip())


def _parse_book_filename(filename: str) -> dict:
    """Parse a book filename like '001 Title.txt' into book_number and title."""
    stem = Path(filename).stem
    m = re.match(r'^(\d{1,4})[_\s\-]+(.+)$', stem)
    if m:
        return {"book_number": int(m.group(1)), "title_source": m.group(2).strip()}
    return {"book_number": None, "title_source": stem.strip()}


def _is_likely_english(text: str) -> bool:
    """Check if text appears to already be in English/Latin script."""
    return all(ord(c) < 0x3000 for c in text if not c.isspace())


async def _read_and_expand_files(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    """Read uploaded files, expanding ZIP archives into individual files."""
    result = []
    for f in files:
        file_bytes = await f.read()
        filename = f.filename or "unknown"

        if filename.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
                    for name in zf.namelist():
                        # Skip directories and hidden files
                        if name.endswith('/') or name.startswith('__MACOSX') or '/.' in name:
                            continue
                        lower = name.lower()
                        if lower.endswith('.txt') or lower.endswith('.docx'):
                            inner_bytes = zf.read(name)
                            # Use just the filename, not the full path within zip
                            inner_name = Path(name).name
                            result.append((inner_name, inner_bytes))
            except zipfile.BadZipFile:
                result.append((filename, file_bytes))
        else:
            result.append((filename, file_bytes))

    return result


async def _build_book_response(book: Book, db: AsyncSession, ch_count: int = -1, seg_count: int = -1) -> BookResponse:
    """Build a BookResponse with source language info and counts."""
    if ch_count < 0:
        ch_count = (await db.execute(
            select(func.count()).where(Chapter.book_id == book.id)
        )).scalar() or 0
    if seg_count < 0:
        seg_count = (await db.execute(
            select(func.count()).select_from(
                select(Segment.id).join(Chapter).where(Chapter.book_id == book.id).subquery()
            )
        )).scalar() or 0

    source_lang = await db.get(Language, book.source_language_id) if book.source_language_id else None

    return BookResponse(
        id=book.id,
        content_type=book.content_type.value,
        title_source=book.title_source,
        title_translated=book.title_translated,
        book_number=book.book_number,
        year_published=book.year_published,
        category=book.category,
        era_tag=book.era_tag.value if book.era_tag else None,
        series=book.series,
        status=book.status.value,
        notes=book.notes,
        llm_model=book.llm_model,
        prompt_template=book.prompt_template,
        source_language_id=book.source_language_id,
        source_language_code=source_lang.code if source_lang else None,
        source_language_name=source_lang.name if source_lang else None,
        chapter_count=ch_count,
        segment_count=seg_count,
        created_at=book.created_at,
        updated_at=book.updated_at,
    )


# --- Routes ---


@router.get("", response_model=BookListResponse)
async def list_books(
    search: str = Query("", description="Search in title"),
    status: str | None = Query(None),
    category: str | None = Query(None),
    content_type: str | None = Query(None, description="Filter by content type: book or article"),
    sort: str = Query("created_desc", description="Sort order: created_desc, book_number_asc, title_asc"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = select(Book)

    if search:
        query = query.where(
            Book.title_source.ilike(f"%{search}%") | Book.title_translated.ilike(f"%{search}%")
        )
    if status:
        query = query.where(Book.status == BookStatus(status))
    if category:
        query = query.where(Book.category == category)
    if content_type:
        query = query.where(Book.content_type == ContentType(content_type))

    # Get total count
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Sort order
    if sort == "book_number_asc":
        order = Book.book_number.asc().nullslast()
    elif sort == "title_asc":
        order = Book.title_source.asc()
    else:
        order = Book.id.desc()

    # Fetch books
    result = await db.execute(query.order_by(order).offset(offset).limit(limit))
    books = result.scalars().all()

    # Enrich with counts
    book_responses = []
    for book in books:
        book_responses.append(await _build_book_response(book, db))

    return BookListResponse(books=book_responses, total=total)


@router.post("", response_model=BookResponse)
async def create_book(
    data: BookCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("books.create")),
):
    ct = ContentType(data.content_type) if data.content_type else ContentType.book
    # Articles don't use era_tag
    era = EraTag(data.era_tag) if data.era_tag and ct == ContentType.book else None

    book = Book(
        content_type=ct,
        book_number=data.book_number,
        title_source=data.title_source,
        title_translated=data.title_translated,
        year_published=data.year_published,
        category=data.category,
        era_tag=era,
        series=data.series,
        notes=data.notes,
        llm_model=data.llm_model,
        prompt_template=data.prompt_template,
        source_language_id=data.source_language_id,
    )
    db.add(book)
    await db.flush()
    await db.refresh(book)

    return await _build_book_response(book, db, ch_count=0, seg_count=0)


@router.post("/bulk-import/preview", response_model=BulkImportPreviewResponse)
async def bulk_import_preview(
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("books.create")),
):
    """Parse uploaded filenames and check for duplicates. Supports ZIP files."""
    expanded = await _read_and_expand_files(files)

    # Get existing book numbers
    existing_nums_result = await db.execute(
        select(Book.book_number).where(Book.book_number.isnot(None))
    )
    existing_nums = {r[0] for r in existing_nums_result.fetchall()}

    # Get existing titles for duplicate warnings
    existing_titles_result = await db.execute(select(Book.title_source))
    existing_titles = {r[0].lower() for r in existing_titles_result.fetchall()}

    previews = []
    seen_nums = set()
    for filename, _ in expanded:
        parsed = _parse_book_filename(filename)
        warnings = []

        bn = parsed["book_number"]
        title = parsed["title_source"]

        if bn is not None:
            if bn in existing_nums:
                warnings.append(f"Book #{bn} already exists in the library")
            if bn in seen_nums:
                warnings.append(f"Duplicate book number #{bn} in this batch")
            seen_nums.add(bn)

        if title.lower() in existing_titles:
            warnings.append(f"A book with a similar title already exists")

        previews.append(BulkImportFilePreview(
            filename=filename,
            book_number=bn,
            title_source=title,
            title_translated="",
            content_type="book",
            parse_success=True,
            warnings=warnings,
        ))

    return BulkImportPreviewResponse(previews=previews)


@router.post("/bulk-import/confirm", response_model=BulkImportResponse)
async def bulk_import_confirm(
    files: List[UploadFile] = File(...),
    metadata: str = Form(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("books.create")),
):
    """Create books from uploaded files with metadata. Supports ZIP files."""
    try:
        meta = BulkImportMetadata.model_validate_json(metadata)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid metadata JSON: {e}")

    expanded = await _read_and_expand_files(files)
    file_map = {name: data for name, data in expanded}

    # Build lookup from metadata
    item_map = {item.filename: item for item in meta.items}

    results = []
    succeeded = 0
    failed = 0

    for filename, file_bytes in expanded:
        item = item_map.get(filename)
        if not item:
            results.append(BulkImportResult(
                filename=filename, title_source=filename,
                status="error", error="No metadata found for this file",
            ))
            failed += 1
            continue

        try:
            # Read file content
            lower = filename.lower()
            if lower.endswith(".docx"):
                text = _extract_text_from_docx(file_bytes)
            elif lower.endswith(".txt"):
                text = file_bytes.decode("utf-8", errors="replace")
            else:
                results.append(BulkImportResult(
                    filename=filename, title_source=item.title_source,
                    status="error", error="Unsupported file type (use .txt or .docx)",
                ))
                failed += 1
                continue

            if not text.strip():
                results.append(BulkImportResult(
                    filename=filename, title_source=item.title_source,
                    status="error", error="File is empty",
                ))
                failed += 1
                continue

            # Optionally translate title
            title_translated = item.title_translated
            if meta.translate_titles and not title_translated and not _is_likely_english(item.title_source):
                try:
                    from app.services.translation.llm import translate_text
                    result = await translate_text(
                        system_prompt="You are a translation assistant. Translate the given book title to English. Return only the translated title, nothing else.",
                        user_prompt=item.title_source,
                    )
                    title_translated = result.get("translated_text", "").strip()
                except Exception as e:
                    logger.warning(f"Title translation failed for '{item.title_source}': {e}")

            # Create the book
            ct = ContentType(item.content_type) if item.content_type else ContentType.book
            book = Book(
                content_type=ct,
                book_number=item.book_number,
                title_source=item.title_source,
                title_translated=title_translated,
            )
            db.add(book)
            await db.flush()
            await db.refresh(book)

            # Detect chapters and create segments
            if ct == ContentType.article:
                chapters_data = [{"title": "_default", "content": text.strip()}]
            else:
                chapters_data = _detect_chapters(text)

            total_segments = 0
            for i, ch_data in enumerate(chapters_data):
                chapter = Chapter(
                    book_id=book.id,
                    title=ch_data["title"],
                    order=i + 1,
                )
                db.add(chapter)
                await db.flush()

                seg_items = _segment_text(ch_data["content"], meta.granularity)
                for j, item in enumerate(seg_items):
                    segment = Segment(
                        chapter_id=chapter.id,
                        order=j + 1,
                        paragraph_group=item["paragraph_group"],
                        source_text=item["text"],
                    )
                    db.add(segment)
                total_segments += len(seg_items)

            await db.flush()

            results.append(BulkImportResult(
                filename=filename,
                book_id=book.id,
                book_number=book.book_number,
                title_source=book.title_source,
                title_translated=book.title_translated,
                chapter_count=len(chapters_data),
                segment_count=total_segments,
                status="success",
            ))
            succeeded += 1

        except Exception as e:
            logger.error(f"Bulk import error for {filename}: {e}")
            results.append(BulkImportResult(
                filename=filename,
                book_number=item.book_number,
                title_source=item.title_source,
                status="error",
                error=str(e),
            ))
            failed += 1

    return BulkImportResponse(
        results=results,
        total=len(results),
        succeeded=succeeded,
        failed=failed,
    )


@router.get("/{book_id}", response_model=BookResponse)
async def get_book(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    return await _build_book_response(book, db)


@router.patch("/{book_id}", response_model=BookResponse)
async def update_book(
    book_id: int,
    data: BookUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("books.edit")),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    update_data = data.model_dump(exclude_unset=True)
    if "era_tag" in update_data and update_data["era_tag"] is not None:
        update_data["era_tag"] = EraTag(update_data["era_tag"])
    if "status" in update_data and update_data["status"] is not None:
        update_data["status"] = BookStatus(update_data["status"])

    for key, value in update_data.items():
        setattr(book, key, value)

    await db.flush()
    await db.refresh(book)

    return await get_book(book_id, db, _)


@router.delete("/{book_id}")
async def delete_book(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("books.delete")),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    # Use raw DELETE to let DB-level ON DELETE CASCADE handle children.
    # ORM's db.delete() triggers lazy-loading which fails in async mode.
    from sqlalchemy import delete
    await db.execute(delete(Book).where(Book.id == book_id))
    return {"ok": True}


@router.post("/{book_id}/import", response_model=BookResponse)
async def import_file_to_book(
    book_id: int,
    file: UploadFile = File(...),
    granularity: str = Form("sentence"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("books.import")),
):
    """Import a TXT or DOCX file into an existing book, creating chapters and segments."""
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    file_bytes = await file.read()
    filename = file.filename or ""

    if filename.lower().endswith(".docx"):
        text = _extract_text_from_docx(file_bytes)
    elif filename.lower().endswith(".txt"):
        text = file_bytes.decode("utf-8", errors="replace")
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use .txt or .docx")

    if not text.strip():
        raise HTTPException(status_code=400, detail="File is empty")

    # For articles: single hidden chapter; for books: auto-detect chapters
    if book.content_type == ContentType.article:
        chapters_data = [{"title": "_default", "content": text.strip()}]
    else:
        chapters_data = _detect_chapters(text)

    # Get current max chapter order
    max_order_result = await db.execute(
        select(func.coalesce(func.max(Chapter.order), 0)).where(Chapter.book_id == book_id)
    )
    chapter_offset = max_order_result.scalar() or 0

    for i, ch_data in enumerate(chapters_data):
        chapter = Chapter(
            book_id=book_id,
            title=ch_data["title"],
            order=chapter_offset + i + 1,
        )
        db.add(chapter)
        await db.flush()

        # Segment the chapter content into paragraphs
        seg_items = _segment_text(ch_data["content"], granularity)
        for j, item in enumerate(seg_items):
            segment = Segment(
                chapter_id=chapter.id,
                order=j + 1,
                paragraph_group=item["paragraph_group"],
                source_text=item["text"],
            )
            db.add(segment)

    # Update book status
    if book.status == BookStatus.not_started:
        book.status = BookStatus.in_progress

    await db.flush()
    return await get_book(book_id, db, user)


class ImportTextRequest(PydanticBaseModel):
    text: str
    granularity: str = "sentence"


class ResegmentRequest(PydanticBaseModel):
    granularity: str = "sentence"  # "sentence" | "paragraph" | "chapter"


@router.post("/{book_id}/import-text", response_model=BookResponse)
async def import_text_to_book(
    book_id: int,
    data: ImportTextRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("books.import")),
):
    """Import raw text into an existing book, creating chapters and segments."""
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if not data.text.strip():
        raise HTTPException(status_code=400, detail="Text is empty")

    if book.content_type == ContentType.article:
        chapters_data = [{"title": "_default", "content": data.text.strip()}]
    else:
        chapters_data = _detect_chapters(data.text)

    max_order_result = await db.execute(
        select(func.coalesce(func.max(Chapter.order), 0)).where(Chapter.book_id == book_id)
    )
    chapter_offset = max_order_result.scalar() or 0

    for i, ch_data in enumerate(chapters_data):
        chapter = Chapter(
            book_id=book_id,
            title=ch_data["title"],
            order=chapter_offset + i + 1,
        )
        db.add(chapter)
        await db.flush()

        seg_items = _segment_text(ch_data["content"], data.granularity)
        for j, item in enumerate(seg_items):
            db.add(Segment(
                chapter_id=chapter.id,
                order=j + 1,
                paragraph_group=item["paragraph_group"],
                source_text=item["text"],
            ))

    if book.status == BookStatus.not_started:
        book.status = BookStatus.in_progress

    await db.flush()
    return await get_book(book_id, db, user)


@router.get("/{book_id}/default-chapter", response_model=ChapterResponse)
async def get_default_chapter(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return the first chapter of a book. Used by frontend for article direct-navigation."""
    result = await db.execute(
        select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order).limit(1)
    )
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="No chapter found")

    seg_count = (await db.execute(
        select(func.count()).where(Segment.chapter_id == chapter.id)
    )).scalar() or 0

    return ChapterResponse(
        id=chapter.id, book_id=chapter.book_id, title=chapter.title,
        order=chapter.order, segment_count=seg_count, created_at=chapter.created_at,
    )


# --- Chapter routes ---


@router.get("/{book_id}/chapters", response_model=list[ChapterResponse])
async def list_chapters(
    book_id: int,
    language_id: int | None = Query(None, description="Filter counts by target language"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order)
    )
    chapters = result.scalars().all()

    responses = []
    for ch in chapters:
        seg_count = (await db.execute(
            select(func.count()).where(Segment.chapter_id == ch.id)
        )).scalar() or 0

        seg_ids = select(Segment.id).where(Segment.chapter_id == ch.id)

        if language_id:
            # Language-specific counts with status breakdown
            status_result = await db.execute(
                select(Translation.status, func.count()).where(
                    Translation.segment_id.in_(seg_ids),
                    Translation.language_id == language_id,
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
        else:
            translated_count = (await db.execute(
                select(func.count(func.distinct(Translation.segment_id))).where(
                    Translation.segment_id.in_(seg_ids),
                    Translation.status != SegmentStatus.empty,
                )
            )).scalar() or 0

            responses.append(ChapterResponse(
                id=ch.id, book_id=ch.book_id, title=ch.title,
                order=ch.order, segment_count=seg_count,
                translated_count=translated_count, created_at=ch.created_at,
            ))
    return responses


@router.get("/{book_id}/progress", response_model=BookProgressResponse)
async def get_book_progress(
    book_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Per-language translation progress for a book."""
    # Verify book exists
    book = await db.execute(select(Book).where(Book.id == book_id))
    if not book.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Book not found")

    # Total segments
    total_segments = (await db.execute(
        select(func.count()).select_from(Segment).join(
            Chapter, Segment.chapter_id == Chapter.id
        ).where(Chapter.book_id == book_id)
    )).scalar() or 0

    # Per-language, per-status counts
    seg_ids = select(Segment.id).join(
        Chapter, Segment.chapter_id == Chapter.id
    ).where(Chapter.book_id == book_id)

    status_result = await db.execute(
        select(
            Translation.language_id,
            Translation.status,
            func.count(),
        ).where(
            Translation.segment_id.in_(seg_ids),
        ).group_by(Translation.language_id, Translation.status)
    )

    # Build per-language data
    lang_data: dict[int, dict[str, int]] = {}
    for lang_id, status, count in status_result.all():
        if lang_id not in lang_data:
            lang_data[lang_id] = {}
        lang_data[lang_id][status.value if hasattr(status, 'value') else status] = count

    # Fetch language info
    lang_ids = list(lang_data.keys())
    languages_list = []
    if lang_ids:
        lang_result = await db.execute(
            select(Language).where(Language.id.in_(lang_ids)).order_by(Language.code)
        )
        for lang in lang_result.scalars().all():
            counts = lang_data.get(lang.id, {})
            total_translated = sum(
                v for k, v in counts.items() if k != "empty"
            )
            languages_list.append(LanguageProgressDetail(
                language_id=lang.id,
                language_code=lang.code,
                language_name=lang.name,
                counts=counts,
                total_translated=total_translated,
                percent_complete=round(total_translated / total_segments * 100, 1) if total_segments else 0,
            ))

    return BookProgressResponse(
        book_id=book_id,
        total_segments=total_segments,
        languages=languages_list,
    )


@router.get("/{book_id}/pivot-readiness", response_model=PivotReadinessResponse)
async def get_pivot_readiness(
    book_id: int,
    source_language_id: int = Query(..., description="Source language to check readiness for"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """How many segments have approved translations in the source language."""
    seg_ids = select(Segment.id).join(
        Chapter, Segment.chapter_id == Chapter.id
    ).where(Chapter.book_id == book_id)

    total_segments = (await db.execute(
        select(func.count()).select_from(Segment).join(
            Chapter, Segment.chapter_id == Chapter.id
        ).where(Chapter.book_id == book_id)
    )).scalar() or 0

    approved_count = (await db.execute(
        select(func.count()).where(
            Translation.segment_id.in_(seg_ids),
            Translation.language_id == source_language_id,
            Translation.status == SegmentStatus.approved,
        )
    )).scalar() or 0

    return PivotReadinessResponse(
        total_segments=total_segments,
        approved_in_source=approved_count,
        percent_ready=round(approved_count / total_segments * 100, 1) if total_segments else 0,
    )


@router.get("/{book_id}/chapters/{chapter_id}", response_model=ChapterDetailResponse)
async def get_chapter_detail(
    book_id: int,
    chapter_id: int,
    language_id: int | None = Query(None, description="Filter translations by language"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id, Chapter.book_id == book_id)
    )
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Load segments
    seg_result = await db.execute(
        select(Segment).where(Segment.chapter_id == chapter_id).order_by(Segment.order)
    )
    segments = seg_result.scalars().all()

    from app.models.translation import TranslationVersion

    # Batch-load all translations for this chapter to get updated_by user IDs
    all_seg_ids = [seg.id for seg in segments]
    all_trans_query = select(Translation).where(Translation.segment_id.in_(all_seg_ids))
    if language_id:
        all_trans_query = all_trans_query.where(Translation.language_id == language_id)
    all_trans_result = await db.execute(all_trans_query)
    all_translations = all_trans_result.scalars().all()

    # Build username map for updated_by IDs
    user_ids = {t.updated_by for t in all_translations if t.updated_by}
    username_map: dict[int, str] = {}
    if user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        for u in users_result.scalars().all():
            username_map[u.id] = u.username

    # Index translations by segment_id
    trans_by_seg: dict[int, list] = {}
    for t in all_translations:
        trans_by_seg.setdefault(t.segment_id, []).append(t)

    # previous_text is now a column on Translation — no version query needed
    prev_text_map: dict[int, str | None] = {t.id: t.previous_text for t in all_translations if t.previous_text}

    segment_responses = []
    for seg in segments:
        translations = trans_by_seg.get(seg.id, [])

        trans_responses = []
        for t in translations:
            trans_responses.append(TranslationResponse(
                id=t.id, segment_id=t.segment_id, language_id=t.language_id,
                translated_text=t.translated_text, status=t.status.value,
                llm_model_used=t.llm_model_used, token_count=t.token_count,
                updated_by=t.updated_by,
                updated_by_username=username_map.get(t.updated_by) if t.updated_by else None,
                updated_at=t.updated_at,
                previous_text=prev_text_map.get(t.id),
            ))

        segment_responses.append(SegmentWithTranslationsResponse(
            id=seg.id,
            chapter_id=seg.chapter_id,
            order=seg.order,
            paragraph_group=seg.paragraph_group,
            source_text=seg.source_text,
            translations=trans_responses,
            created_at=seg.created_at,
        ))

    return ChapterDetailResponse(
        id=chapter.id, book_id=chapter.book_id, title=chapter.title,
        order=chapter.order, segments=segment_responses, created_at=chapter.created_at,
    )


# --- Segment split / merge ---


@router.post("/{book_id}/chapters/{chapter_id}/segments/{segment_id}/split")
async def split_segment(
    book_id: int,
    chapter_id: int,
    segment_id: int,
    body: SegmentSplitRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("segments.split_merge")),
):
    """Split a segment at the given character position."""
    import logging
    _logger = logging.getLogger(__name__)

    try:
        from sqlalchemy import delete as sa_delete, update as sa_update

        result = await db.execute(
            select(Segment).where(Segment.id == segment_id, Segment.chapter_id == chapter_id)
        )
        segment = result.scalar_one_or_none()
        if not segment:
            raise HTTPException(status_code=404, detail="Segment not found")

        src_text = segment.source_text
        pos = body.position
        if pos <= 0 or pos >= len(src_text):
            raise HTTPException(status_code=400, detail="Position out of range")

        left = src_text[:pos]
        right = src_text[pos:]

        # Bump order of all subsequent segments
        await db.execute(
            sa_update(Segment)
            .where(Segment.chapter_id == chapter_id, Segment.order > segment.order)
            .values(order=Segment.order + 1)
        )

        # Update original segment
        segment.source_text = left

        # Delete translations on the original (text changed)
        await db.execute(sa_delete(Translation).where(Translation.segment_id == segment.id))

        # Create new segment
        new_seg = Segment(
            chapter_id=chapter_id,
            order=segment.order + 1,
            source_text=right,
        )
        db.add(new_seg)
        await db.flush()

        # Reload chapter
        return await get_chapter_detail(book_id, chapter_id, language_id=None, db=db, _=user)
    except HTTPException:
        raise
    except Exception as exc:
        _logger.exception("split_segment failed")
        raise HTTPException(status_code=500, detail=f"Split failed: {exc}")


@router.post("/{book_id}/chapters/{chapter_id}/segments/{segment_id}/merge")
async def merge_segment(
    book_id: int,
    chapter_id: int,
    segment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("segments.split_merge")),
):
    """Merge a segment with the next segment (by order)."""
    from sqlalchemy import delete as sa_delete, update as sa_update

    result = await db.execute(
        select(Segment).where(Segment.id == segment_id, Segment.chapter_id == chapter_id)
    )
    segment = result.scalar_one_or_none()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    # Find the next segment by order
    next_result = await db.execute(
        select(Segment)
        .where(Segment.chapter_id == chapter_id, Segment.order > segment.order)
        .order_by(Segment.order)
        .limit(1)
    )
    next_seg = next_result.scalar_one_or_none()
    if not next_seg:
        raise HTTPException(status_code=400, detail="No next segment to merge with")

    # Append next segment's text (no separator for Chinese)
    segment.source_text = segment.source_text + next_seg.source_text

    # Delete translations on the merged segment (text changed)
    await db.execute(sa_delete(Translation).where(Translation.segment_id == segment.id))

    # Delete the next segment (cascade deletes its translations)
    next_seg_id = next_seg.id
    await db.execute(sa_delete(Segment).where(Segment.id == next_seg_id))

    # Decrement order of subsequent segments
    await db.execute(
        sa_update(Segment)
        .where(Segment.chapter_id == chapter_id, Segment.order > next_seg.order)
        .values(order=Segment.order - 1)
    )

    await db.flush()
    return await get_chapter_detail(book_id, chapter_id, language_id=None, db=db, _=user)


CJK_LANGUAGE_CODES = {"zh", "ja"}


@router.post("/{book_id}/chapters/{chapter_id}/re-segment")
async def resegment_chapter(
    book_id: int,
    chapter_id: int,
    body: ResegmentRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("segments.split_merge")),
):
    """Re-segment an entire chapter at a new granularity level."""
    from sqlalchemy import delete as sa_delete

    if body.granularity not in ("sentence", "paragraph", "chapter"):
        raise HTTPException(status_code=400, detail="Invalid granularity. Use: sentence, paragraph, chapter")

    # Verify chapter exists
    result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id, Chapter.book_id == book_id)
    )
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Load all segments ordered
    seg_result = await db.execute(
        select(Segment).where(Segment.chapter_id == chapter_id).order_by(Segment.order)
    )
    old_segments = seg_result.scalars().all()
    if not old_segments:
        raise HTTPException(status_code=400, detail="Chapter has no segments")

    # Load all translations for these segments, grouped by language
    old_seg_ids = [s.id for s in old_segments]
    trans_result = await db.execute(
        select(Translation).where(Translation.segment_id.in_(old_seg_ids))
    )
    all_translations = trans_result.scalars().all()

    # Build translation lookup: {segment_id: {language_id: translated_text}}
    trans_by_seg: dict[int, dict[int, str]] = {}
    for t in all_translations:
        trans_by_seg.setdefault(t.segment_id, {})[t.language_id] = t.translated_text

    # Collect all language IDs that have translations
    all_lang_ids = set()
    for t in all_translations:
        all_lang_ids.add(t.language_id)

    # Load language codes for CJK detection
    lang_codes: dict[int, str] = {}
    if all_lang_ids:
        lang_result = await db.execute(
            select(Language).where(Language.id.in_(list(all_lang_ids)))
        )
        for lang in lang_result.scalars().all():
            lang_codes[lang.id] = lang.code

    # --- Determine new segments based on granularity ---
    if body.granularity == "paragraph":
        distinct_groups = {s.paragraph_group for s in old_segments}

        if len(distinct_groups) <= 1 and len(old_segments) == 1:
            # Single segment (chapter-level) — re-split source text on blank lines.
            full_text = old_segments[0].source_text
            seg_items = _segment_text(full_text, "paragraph")

            # Single source segment: assign its translations to each new paragraph
            # (only meaningful if there was one translation covering everything)
            single_seg_trans = trans_by_seg.get(old_segments[0].id, {})
            new_seg_data = []
            for item in seg_items:
                new_seg_data.append({
                    "source_text": item["text"],
                    "paragraph_group": item["paragraph_group"],
                    "translations": {},  # can't split one translation across paragraphs
                })
        else:
            # Group old segments by paragraph_group
            groups: dict[int, list] = {}
            for seg in old_segments:
                groups.setdefault(seg.paragraph_group, []).append(seg)

            new_seg_data = []
            for pg_num in sorted(groups.keys()):
                group_segs = groups[pg_num]
                # Join with newline to preserve line-by-line structure
                source_text = "\n".join(s.source_text for s in group_segs)

                # Concatenate translations per language
                lang_texts: dict[int, str] = {}
                for lang_id in all_lang_ids:
                    parts = []
                    for s in group_segs:
                        txt = trans_by_seg.get(s.id, {}).get(lang_id)
                        if txt and txt.strip():
                            parts.append(txt)
                    if parts:
                        sep = "" if lang_codes.get(lang_id, "")[:2] in CJK_LANGUAGE_CODES else " "
                        lang_texts[lang_id] = sep.join(parts)

                new_seg_data.append({
                    "source_text": source_text,
                    "paragraph_group": pg_num,
                    "translations": lang_texts,
                })

    elif body.granularity == "chapter":
        # Merge everything into one segment, preserving paragraph breaks
        source_parts = []
        current_pg = old_segments[0].paragraph_group
        for seg in old_segments:
            if seg.paragraph_group != current_pg:
                source_parts.append("\n\n")
                current_pg = seg.paragraph_group
            source_parts.append(seg.source_text)
        source_text = "".join(source_parts)
        lang_texts: dict[int, str] = {}
        for lang_id in all_lang_ids:
            parts = []
            for s in old_segments:
                txt = trans_by_seg.get(s.id, {}).get(lang_id)
                if txt and txt.strip():
                    parts.append(txt)
            if parts:
                sep = "" if lang_codes.get(lang_id, "")[:2] in CJK_LANGUAGE_CODES else "\n\n"
                lang_texts[lang_id] = sep.join(parts)

        new_seg_data = [{
            "source_text": source_text,
            "paragraph_group": 1,
            "translations": lang_texts,
        }]

    else:
        # "sentence" — reconstruct full text with paragraph breaks, then re-split
        current_pg = old_segments[0].paragraph_group
        text_parts = []
        for seg in old_segments:
            if seg.paragraph_group != current_pg:
                text_parts.append("\n\n")
                current_pg = seg.paragraph_group
            text_parts.append(seg.source_text)
        full_text = "".join(text_parts)

        # Re-segment source text
        seg_items = _segment_text(full_text, "sentence")

        # For sentence re-segmentation, translations can't be mapped back to new
        # sentence boundaries reliably. Leave translations empty — user must re-translate.
        new_seg_data = []
        for i, item in enumerate(seg_items):
            new_seg_data.append({
                "source_text": item["text"],
                "paragraph_group": item["paragraph_group"],
                "translations": {},  # empty — user must re-translate at sentence level
            })

    # --- Delete old segments (cascade deletes translations) ---
    await db.execute(sa_delete(Segment).where(Segment.chapter_id == chapter_id))
    await db.flush()

    # --- Create new segments and translations ---
    for i, seg_data in enumerate(new_seg_data):
        new_seg = Segment(
            chapter_id=chapter_id,
            order=i + 1,
            paragraph_group=seg_data["paragraph_group"],
            source_text=seg_data["source_text"],
        )
        db.add(new_seg)
        await db.flush()

        for lang_id, trans_text in seg_data["translations"].items():
            if trans_text and trans_text.strip():
                new_trans = Translation(
                    segment_id=new_seg.id,
                    language_id=lang_id,
                    translated_text=trans_text,
                    status=SegmentStatus.draft,
                )
                db.add(new_trans)

    await db.flush()
    return await get_chapter_detail(book_id, chapter_id, language_id=None, db=db, _=user)
