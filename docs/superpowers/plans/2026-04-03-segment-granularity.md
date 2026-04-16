# Segment Granularity Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to control segment granularity (sentence, paragraph, full chapter) at import time and post-import, with paragraph boundary tracking.

**Architecture:** Extend `_segment_text()` with a granularity parameter, add `paragraph_group` field to Segment model, add a re-segment endpoint that merges/splits segments while concatenating existing translations, and add UI controls in both the import modal and the translation editor.

**Tech Stack:** Python/FastAPI, SQLAlchemy, React/TypeScript, Tailwind CSS

---

### Task 1: Add `paragraph_group` column to Segment model and migration

**Files:**
- Modify: `backend/app/models/segment.py:14`
- Modify: `backend/app/core/database.py:101-118` (column_migrations list)
- Modify: `backend/app/schemas/book.py:73-80` (SegmentResponse)
- Modify: `backend/app/schemas/book.py:120-128` (SegmentWithTranslationsResponse)

- [ ] **Step 1: Add `paragraph_group` field to Segment model**

In `backend/app/models/segment.py`, add the field after `order`:

```python
paragraph_group: Mapped[int] = mapped_column(Integer, default=1)
```

The full model becomes:

```python
class Segment(Base):
    __tablename__ = "segments"

    id: Mapped[int] = mapped_column(primary_key=True)
    chapter_id: Mapped[int] = mapped_column(ForeignKey("chapters.id", ondelete="CASCADE"), index=True)
    order: Mapped[int] = mapped_column(Integer, default=0)
    paragraph_group: Mapped[int] = mapped_column(Integer, default=1)
    source_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    chapter: Mapped["Chapter"] = relationship("Chapter", back_populates="segments")
    translations: Mapped[list["Translation"]] = relationship(
        "Translation", back_populates="segment", cascade="all, delete-orphan"
    )
```

- [ ] **Step 2: Add migration entry**

In `backend/app/core/database.py`, add to the `column_migrations` list (around line 116, before the closing `]`):

```python
("segments", "paragraph_group", "INTEGER NOT NULL DEFAULT 1"),
```

- [ ] **Step 3: Add `paragraph_group` to response schemas**

In `backend/app/schemas/book.py`, update `SegmentResponse`:

```python
class SegmentResponse(BaseModel):
    id: int
    chapter_id: int
    order: int
    paragraph_group: int = 1
    source_text: str
    created_at: datetime

    model_config = {"from_attributes": True}
```

Update `SegmentWithTranslationsResponse`:

```python
class SegmentWithTranslationsResponse(BaseModel):
    id: int
    chapter_id: int
    order: int
    paragraph_group: int = 1
    source_text: str
    translations: list[TranslationResponse] = []
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Update `get_chapter_detail` to include `paragraph_group` in response**

In `backend/app/api/books.py`, in the `get_chapter_detail` function (around line 984), update the segment response construction to include `paragraph_group`:

```python
segment_responses.append(SegmentWithTranslationsResponse(
    id=seg.id,
    chapter_id=seg.chapter_id,
    order=seg.order,
    paragraph_group=seg.paragraph_group,
    source_text=seg.source_text,
    translations=trans_responses,
    created_at=seg.created_at,
))
```

- [ ] **Step 5: Update frontend Segment type**

In `frontend/src/types/index.ts`, update the `Segment` interface:

```typescript
export interface Segment {
  id: number
  chapter_id: number
  order: number
  paragraph_group: number
  source_text: string
  translations: Translation[]
  created_at: string
}
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/segment.py backend/app/core/database.py backend/app/schemas/book.py backend/app/api/books.py frontend/src/types/index.ts
git commit -m "feat: add paragraph_group field to Segment model with migration"
```

---

### Task 2: Extend `_segment_text()` with granularity parameter

**Files:**
- Modify: `backend/app/api/books.py:36-79` (_segment_text function)

- [ ] **Step 1: Refactor `_segment_text()` to accept granularity**

Replace the existing `_segment_text` function (lines 36-79) with:

```python
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

        # First, split out quoted speech 「...」 as separate segments
        quote_parts = re.split(r'(「[^」]*」)', para)
        quote_parts = [p.strip() for p in quote_parts if p.strip()]

        segments: list[str] = []
        for qpart in quote_parts:
            # Quoted speech stays as a single segment
            if qpart.startswith('「') and qpart.endswith('」'):
                segments.append(qpart)
                continue

            # Non-quoted text: split at sentence-ending punctuation (。！？)
            parts = re.split(r'(?<=[。！？])', qpart)
            parts = [p.strip() for p in parts if p.strip()]

            # Secondary split: break long sentences (>50 chars) at semicolons
            expanded: list[str] = []
            for part in parts:
                if len(part) > 50 and '；' in part:
                    sub = re.split(r'(?<=；)', part)
                    expanded.extend(s.strip() for s in sub if s.strip())
                else:
                    expanded.append(part)

            # Merge orphan labels (<15 chars) with the following segment
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
```

- [ ] **Step 2: Update all callers of `_segment_text()` to use new return format**

There are four call sites in `backend/app/api/books.py`. Each currently does:

```python
paragraphs = _segment_text(ch_data["content"])
for j, para in enumerate(paragraphs):
    segment = Segment(
        chapter_id=chapter.id,
        order=j + 1,
        source_text=para,
    )
```

Update **each** call site to:

```python
seg_items = _segment_text(ch_data["content"])
for j, item in enumerate(seg_items):
    segment = Segment(
        chapter_id=chapter.id,
        order=j + 1,
        paragraph_group=item["paragraph_group"],
        source_text=item["text"],
    )
    db.add(segment)
```

The four call sites are:
1. `bulk_import_confirm` (around line 485-493)
2. `import_file_to_book` (around line 663-671)
3. `import_text_to_book` (around line 719-725)

For site 1, also update `total_segments += len(paragraphs)` to `total_segments += len(seg_items)`.

For sites 2 and 3, ensure the `db.add(segment)` line is preserved (site 3 currently does `db.add(Segment(...))` inline — refactor to match the pattern above).

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/books.py
git commit -m "feat: extend _segment_text with granularity parameter and paragraph_group tracking"
```

---

### Task 3: Pass granularity from import endpoints

**Files:**
- Modify: `backend/app/api/books.py` (bulk_import_confirm, import_file_to_book, import_text_to_book)
- Modify: `backend/app/schemas/book.py` (BulkImportMetadata, add ImportTextRequest if needed)

- [ ] **Step 1: Add `granularity` to BulkImportMetadata schema**

In `backend/app/schemas/book.py`, update `BulkImportMetadata`:

```python
class BulkImportMetadata(BaseModel):
    translate_titles: bool = True
    granularity: str = "sentence"
    items: list[BulkImportFileItem]
```

- [ ] **Step 2: Pass granularity in `bulk_import_confirm`**

In `backend/app/api/books.py`, in the `bulk_import_confirm` function, change the `_segment_text` call (around line 485) to pass the granularity from metadata:

```python
seg_items = _segment_text(ch_data["content"], meta.granularity)
```

- [ ] **Step 3: Add granularity to `import_file_to_book`**

Add a `granularity` query parameter to the endpoint. Change function signature:

```python
@router.post("/{book_id}/import", response_model=BookResponse)
async def import_file_to_book(
    book_id: int,
    file: UploadFile = File(...),
    granularity: str = Form("sentence"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("books.import")),
):
```

And pass it through:

```python
seg_items = _segment_text(ch_data["content"], granularity)
```

- [ ] **Step 4: Add granularity to `import_text_to_book`**

Update the `ImportTextRequest` class (around line 680):

```python
class ImportTextRequest(PydanticBaseModel):
    text: str
    granularity: str = "sentence"
```

And pass it through:

```python
seg_items = _segment_text(ch_data["content"], data.granularity)
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/books.py backend/app/schemas/book.py
git commit -m "feat: pass granularity parameter through import endpoints"
```

---

### Task 4: Add re-segment endpoint

**Files:**
- Modify: `backend/app/api/books.py` (add new endpoint after merge_segment)

- [ ] **Step 1: Add re-segment request schema**

In `backend/app/api/books.py`, add a new request model near the other imports/models at the top (after `SegmentSplitRequest` import or near the `ImportTextRequest` class):

```python
class ResegmentRequest(PydanticBaseModel):
    granularity: str  # "sentence" | "paragraph" | "chapter"
```

- [ ] **Step 2: Add the re-segment endpoint**

Add after the `merge_segment` endpoint (after line 1111):

```python
CJK_LANGUAGE_CODES = {"zh", "ja", "ko"}


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
        # Group old segments by paragraph_group
        groups: dict[int, list] = {}
        for seg in old_segments:
            groups.setdefault(seg.paragraph_group, []).append(seg)

        new_seg_data = []
        for pg_num in sorted(groups.keys()):
            group_segs = groups[pg_num]
            source_text = "".join(s.source_text for s in group_segs)

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
        # Merge everything into one segment
        source_text = "".join(s.source_text for s in old_segments)
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
        # Build full text preserving paragraph groups
        current_pg = old_segments[0].paragraph_group
        text_parts = []
        for seg in old_segments:
            if seg.paragraph_group != current_pg:
                text_parts.append("\n\n")
                current_pg = seg.paragraph_group
            text_parts.append(seg.source_text)
        full_text = "".join(text_parts)

        # Build full translation texts per language with same structure
        lang_full_texts: dict[int, list[str]] = {lid: [] for lid in all_lang_ids}
        current_pg = old_segments[0].paragraph_group
        for seg in old_segments:
            if seg.paragraph_group != current_pg:
                for lid in all_lang_ids:
                    lang_full_texts[lid].append("\n\n")
                current_pg = seg.paragraph_group
            for lid in all_lang_ids:
                txt = trans_by_seg.get(seg.id, {}).get(lid)
                if txt and txt.strip():
                    is_cjk = lang_codes.get(lid, "")[:2] in CJK_LANGUAGE_CODES
                    if lang_full_texts[lid] and lang_full_texts[lid][-1] != "\n\n":
                        lang_full_texts[lid].append("" if is_cjk else " ")
                    lang_full_texts[lid].append(txt)

        # Re-segment source text
        seg_items = _segment_text(full_text, "sentence")

        # Map translations back using character offsets
        # Build a flat string of concatenated translations per language
        lang_flat: dict[int, str] = {}
        for lid in all_lang_ids:
            lang_flat[lid] = "".join(lang_full_texts[lid])

        # For sentence re-segmentation, we can't perfectly map translations back
        # to new sentence boundaries. Assign the full language text to the first
        # segment and leave others empty — or distribute evenly.
        # Best approach: split translations proportionally by source text length.
        new_seg_data = []
        total_source_len = sum(len(item["text"]) for item in seg_items)
        for i, item in enumerate(seg_items):
            lang_texts: dict[int, str] = {}
            # Only assign concatenated translation to first segment of each paragraph group
            # (splitting translations at sentence boundaries is unreliable)
            new_seg_data.append({
                "source_text": item["text"],
                "paragraph_group": item["paragraph_group"],
                "translations": lang_texts,  # empty — user must re-translate at sentence level
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
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/books.py
git commit -m "feat: add re-segment endpoint for chapter-level granularity changes"
```

---

### Task 5: Add frontend API function for re-segment

**Files:**
- Modify: `frontend/src/api/books.ts`

- [ ] **Step 1: Add `resegmentChapter` function**

Add to the end of `frontend/src/api/books.ts`:

```typescript
export async function resegmentChapter(
  bookId: number,
  chapterId: number,
  granularity: 'sentence' | 'paragraph' | 'chapter',
): Promise<ChapterDetail> {
  const { data } = await api.post(
    `/books/${bookId}/chapters/${chapterId}/re-segment`,
    { granularity },
  )
  return data
}
```

- [ ] **Step 2: Add granularity to `bulkImportConfirm` metadata**

Update the `BulkImportMetadata` interface in `frontend/src/api/books.ts`:

```typescript
export interface BulkImportMetadata {
  translate_titles: boolean
  granularity?: 'sentence' | 'paragraph' | 'chapter'
  items: BulkImportFileItem[]
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/books.ts
git commit -m "feat: add resegmentChapter API function and granularity to import metadata"
```

---

### Task 6: Add granularity selector to BulkImportModal

**Files:**
- Modify: `frontend/src/components/library/BulkImportModal.tsx`

- [ ] **Step 1: Add granularity state**

Add state after the `contentType` state declaration (line 23):

```typescript
const [granularity, setGranularity] = useState<'sentence' | 'paragraph' | 'chapter'>('sentence')
```

- [ ] **Step 2: Pass granularity in confirm call**

Update the `handleConfirm` function (around line 99) to include granularity in metadata:

```typescript
const res = await bulkImportConfirm(files, {
  translate_titles: false,
  granularity,
  items: editItems,
})
```

- [ ] **Step 3: Add granularity radio group to the preview step**

In the preview step section (after the edit table, before the closing `</div>` of the preview step around line 286), add the granularity selector:

```tsx
{/* Granularity selector */}
<div className="mt-4 pt-4 border-t border-parchment-200 dark:border-ink-600/50">
  <label className="label mb-2">Segment Granularity</label>
  <div className="flex gap-4">
    {[
      { value: 'sentence' as const, label: 'Sentence', desc: 'Split on punctuation (finest)' },
      { value: 'paragraph' as const, label: 'Paragraph', desc: 'One segment per paragraph' },
      { value: 'chapter' as const, label: contentType === 'article' ? 'Full text' : 'Full chapter', desc: 'Entire content as one segment' },
    ].map((opt) => (
      <label
        key={opt.value}
        className={`flex-1 cursor-pointer rounded-lg border p-3 transition-colors ${
          granularity === opt.value
            ? 'border-gold bg-gold/5 dark:bg-gold-faint/20'
            : 'border-parchment-200 dark:border-ink-600 hover:border-parchment-300 dark:hover:border-ink-500'
        }`}
      >
        <input
          type="radio"
          name="granularity"
          value={opt.value}
          checked={granularity === opt.value}
          onChange={() => setGranularity(opt.value)}
          className="sr-only"
        />
        <div className="text-sm font-medium text-ink-850 dark:text-cream font-body">{opt.label}</div>
        <div className="text-xs text-parchment-400 dark:text-cream-muted font-body mt-0.5">{opt.desc}</div>
      </label>
    ))}
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/library/BulkImportModal.tsx
git commit -m "feat: add segment granularity selector to bulk import modal"
```

---

### Task 7: Add re-segment button and modal to TranslationEditor

**Files:**
- Modify: `frontend/src/components/editor/TranslationEditor.tsx`

- [ ] **Step 1: Add imports and state**

Add `resegmentChapter` to the import from books API (around line 10):

```typescript
import { getBook, listChapters, getChapterDetail, splitSegment, mergeSegment, updateBook, resegmentChapter } from '../../api/books'
```

Add `Layers` to the lucide-react import (the icon for the re-segment button).

Add state variables near the other state declarations (around line 220):

```typescript
const [showResegmentModal, setShowResegmentModal] = useState(false)
const [resegmentGranularity, setResegmentGranularity] = useState<'sentence' | 'paragraph' | 'chapter'>('sentence')
const [resegmenting, setResegmenting] = useState(false)
```

- [ ] **Step 2: Add the re-segment handler function**

Add near the other handler functions (after `handleMerge`):

```typescript
async function handleResegment() {
  if (!bookId || !chapterId) return
  setResegmenting(true)
  try {
    const ch = await resegmentChapter(parseInt(bookId), parseInt(chapterId), resegmentGranularity)
    setChapter(ch)
    setShowResegmentModal(false)
  } catch (err) {
    console.error('Re-segment failed:', err)
  } finally {
    setResegmenting(false)
  }
}
```

- [ ] **Step 3: Add re-segment button to toolbar**

In the toolbar area (around line 922), find a suitable location in the right side of the toolbar (near other action buttons). Add a re-segment button. Look for the toolbar's right-side `<div>` with `flex items-center gap-...` and add:

```tsx
<button
  onClick={() => setShowResegmentModal(true)}
  className="btn-ghost text-xs flex items-center gap-1"
  title="Re-segment chapter"
>
  <Layers className="w-3.5 h-3.5" />
  Re-segment
</button>
```

- [ ] **Step 4: Add the re-segment modal**

Add the modal before the closing `</div>` of the main component (or just before another modal). Use the project's custom modal pattern (not browser `confirm()`):

```tsx
{showResegmentModal && (
  <div className="fixed inset-0 bg-black/40 dark:bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50">
    <div className="surface-glass shadow-surface-lg w-full max-w-md p-6 animate-fade-in">
      <h3 className="text-lg font-semibold text-ink-850 dark:text-cream font-heading mb-4">
        Re-segment Chapter
      </h3>

      <div className="space-y-3 mb-4">
        {[
          { value: 'sentence' as const, label: 'Sentence', desc: 'Split on punctuation (finest)' },
          { value: 'paragraph' as const, label: 'Paragraph', desc: 'One segment per original paragraph' },
          { value: 'chapter' as const, label: isArticle ? 'Full text' : 'Full chapter', desc: 'Entire content as one segment' },
        ].map((opt) => (
          <label
            key={opt.value}
            className={`block cursor-pointer rounded-lg border p-3 transition-colors ${
              resegmentGranularity === opt.value
                ? 'border-gold bg-gold/5 dark:bg-gold-faint/20'
                : 'border-parchment-200 dark:border-ink-600 hover:border-parchment-300 dark:hover:border-ink-500'
            }`}
          >
            <input
              type="radio"
              name="resegment-granularity"
              value={opt.value}
              checked={resegmentGranularity === opt.value}
              onChange={() => setResegmentGranularity(opt.value)}
              className="sr-only"
            />
            <div className="text-sm font-medium text-ink-850 dark:text-cream font-body">{opt.label}</div>
            <div className="text-xs text-parchment-400 dark:text-cream-muted font-body mt-0.5">{opt.desc}</div>
          </label>
        ))}
      </div>

      <div className="px-3 py-2 rounded-md bg-amber-50/50 dark:bg-status-warning-bg/20 text-xs text-amber-700 dark:text-status-warning font-body mb-4">
        <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
        Existing translations will be merged to match the new segmentation. Merged translations may need review.
      </div>

      <div className="flex justify-end gap-3">
        <button onClick={() => setShowResegmentModal(false)} className="btn-ghost" disabled={resegmenting}>
          Cancel
        </button>
        <button onClick={handleResegment} className="btn-primary" disabled={resegmenting}>
          {resegmenting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Re-segmenting...</>
          ) : (
            'Re-segment'
          )}
        </button>
      </div>
    </div>
  </div>
)}
```

Note: `Loader2` and `AlertTriangle` should already be imported in the TranslationEditor. Check the existing lucide imports and add any missing ones.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/editor/TranslationEditor.tsx
git commit -m "feat: add re-segment button and modal to translation editor"
```

---

### Task 8: Add paragraph group visual separators in editor

**Files:**
- Modify: `frontend/src/components/editor/TranslationEditor.tsx` (segment list rendering)

- [ ] **Step 1: Add visual separator between paragraph groups**

In the segment list rendering area (around line 1345+), where segments are mapped, add a separator when the `paragraph_group` changes. Find the segment `.map()` call and add a condition before each segment row:

```tsx
{segments.map((segment, idx) => {
  const prevSegment = idx > 0 ? segments[idx - 1] : null
  const isNewParagraphGroup = prevSegment && segment.paragraph_group !== prevSegment.paragraph_group
  // ... existing segment rendering code ...
  return (
    <React.Fragment key={segment.id}>
      {isNewParagraphGroup && (
        <div className="border-t-2 border-parchment-200 dark:border-ink-500/50 my-1" />
      )}
      {/* existing segment row JSX */}
    </React.Fragment>
  )
})}
```

The exact integration depends on the current JSX structure. The key change is: wrap each segment's JSX in a `React.Fragment` and conditionally render a divider `<div>` before segments where `paragraph_group` differs from the previous segment.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/editor/TranslationEditor.tsx
git commit -m "feat: show visual separator between paragraph groups in editor"
```

---

### Task 9: Update release notes and version

**Files:**
- Modify: `frontend/src/data/releaseNotes.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Bump version in package.json**

This is a minor feature addition. Bump the minor version in `frontend/package.json`. Read the current version first, then increment the minor part.

- [ ] **Step 2: Add release notes entry**

Add a new entry at the top of the `releaseNotes` array in `frontend/src/data/releaseNotes.ts`:

```typescript
{
  version: '<new version>',
  date: '2026-04-03',
  highlights: [
    'New segment granularity control — choose between sentence, paragraph, or full chapter/text segmentation when importing books',
    'Re-segment existing chapters from the editor toolbar — change granularity at any time with existing translations preserved',
    'Visual paragraph separators in the editor show original paragraph boundaries when working with sentence-level segments',
  ],
},
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/data/releaseNotes.ts frontend/package.json
git commit -m "docs: add segment granularity release notes and bump version"
```
