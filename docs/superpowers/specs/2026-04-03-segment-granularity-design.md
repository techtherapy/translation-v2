# Segment Granularity Control

## Problem

The current segmentation algorithm (`_segment_text()`) aggressively splits source text into sentence-level segments. This makes segments small and numerous, which doesn't suit all translation workflows. Translators want the option to work with paragraph-level segments that match the original text structure, both for readability and for future export formatting.

## Solution

Extend the segmentation system with three granularity levels, available both at import time and as a post-import re-segmentation action. Add a `paragraph_group` field to track original paragraph boundaries regardless of segment granularity.

## Granularity Levels

| Level | Behavior |
|-------|----------|
| **Sentence** | Current behavior: split on `。！？`, quotes `「」`, semicolons for long sentences, merge orphans < 15 chars |
| **Paragraph** | Split only on blank lines. Each original paragraph becomes one segment |
| **Chapter / Full text** | Entire chapter content as a single segment. Label shows "Full chapter" for books, "Full text" for articles |

## Data Model

### Segment model change

Add `paragraph_group` integer field (default=1, not nullable).

During import, all segments derived from the same source paragraph share the same `paragraph_group` value, 1-indexed and sequential within the chapter.

- **Sentence granularity:** Multiple segments per paragraph group
- **Paragraph granularity:** One segment per paragraph group (1:1)
- **Chapter granularity:** All segments share `paragraph_group=1`

### Migration

Add column via `_run_migrations()`:

```sql
ALTER TABLE segments ADD COLUMN paragraph_group INTEGER DEFAULT 1;
```

Existing segments get `paragraph_group=1` — original paragraph boundaries are unknown for previously imported books.

No other model changes. Granularity is a transient request parameter, not stored on the book or chapter.

## Import-Time Granularity

### Backend changes

`_segment_text(text, granularity="sentence")` gains a `granularity` parameter:

- `"sentence"`: Current behavior, unchanged
- `"paragraph"`: Split on `\n\s*\n` only, return one segment per paragraph
- `"chapter"`: Return entire text as a single-element list

All import endpoints (`/books/bulk-import/confirm`, `/{book_id}/import`, `/{book_id}/import-text`) accept an optional `granularity` field in the request body. Defaults to `"sentence"`.

The `paragraph_group` value is assigned during segment creation:
1. Split text into paragraphs (blank-line split) — these define the groups
2. For sentence granularity, further split each paragraph into sentences, all sharing the same `paragraph_group`
3. For paragraph/chapter granularity, the group assignment is straightforward

### Frontend changes

BulkImportModal preview step gains a 3-option radio group or dropdown:
- "Sentence (default)"
- "Paragraph"
- "Full chapter" / "Full text" (label adapts to content type)

Selected value is sent with the confirm request.

## Post-Import Re-segmentation

### New endpoint

`POST /books/{book_id}/chapters/{chapter_id}/re-segment`

Request body:
```json
{ "granularity": "sentence" | "paragraph" | "chapter" }
```

### Logic

1. Load all segments for the chapter, ordered by `order`
2. For each target language that has translations on these segments, collect translations in segment order
3. Determine new segment boundaries:
   - **To paragraph:** Merge segments sharing the same `paragraph_group`. Concatenate their source texts (no separator for Chinese, newline otherwise). Concatenate translations with a space (or no space for CJK targets).
   - **To sentence:** Reconstruct full source text by joining all segments with `\n\n` between paragraph groups. Run `_segment_text(text, "sentence")`. Assign `paragraph_group` by tracking which original paragraph each new sentence segment came from (using character offsets from the joined text).
   - **To chapter:** Join all source text and all translations.
4. Delete old segments (cascade deletes old translations and versions)
5. Create new segments with correct `order` and `paragraph_group` values
6. Create translations from concatenated text:
   - Segments with no source translations get no translation record
   - Separator: single space for most languages; no space for CJK
   - Skip empty translations in concatenation (no placeholder)
   - Status set to `draft` regardless of original statuses (concatenated text needs review)
7. Return updated chapter detail

### Frontend changes

TranslationEditor toolbar gains a "Re-segment" button/menu item:
1. Opens a modal with the three granularity options (book/article-aware labels)
2. Shows warning: "Existing translations will be merged to match the new segmentation. Merged translations may need review."
3. Uses `useConfirm()` pattern (no browser `confirm()`)
4. On confirm, calls the re-segment endpoint and reloads the chapter

## Editor Visual Separation

When segments are at sentence level, the editor shows subtle visual separators (larger gap or thin divider line) between segments with different `paragraph_group` values. This helps translators see original paragraph structure while working with fine-grained segments.

Always shown when paragraph groups differ — no toggle needed.

## Translation Concatenation Rules

- Join in segment `order` sequence
- Separator: single space for most languages; no space for CJK (Chinese/Japanese)
- Skip segments with no translation (status `empty`)
- All merged translations get status `draft`
- Version history not preserved — old `TranslationVersion` records cascade-delete with old segments

## Scope & Non-goals

- Re-segmentation operates on a whole chapter, not individual segments
- One-way operation — no snapshot or undo
- Existing split/merge per-segment operations remain unchanged
- No changes to TM, glossary, or comment systems (comments on deleted segments are cascade-deleted)
