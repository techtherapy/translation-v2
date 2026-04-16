# Unified "New Translation" Flow

**Date:** 2026-03-31
**Status:** Design approved

## Goal

Replace the current two-step flow (create source book → create translation from it) with a single "New Translation" action that takes the user from source text to translated segments in one step.

## Current Pain Points

1. Users must understand the "source book" vs "translation project" distinction — an implementation detail they shouldn't need to think about
2. Creating a translation requires navigating between two tabs and two modals
3. The modal can clip on smaller screens, cutting off action buttons
4. No auto-translation — user must manually trigger AI translation after setup

## Design

### Entry Point

A single prominent **"New Translation"** button on the Translations tab (the default landing view). This is the primary action in the library.

### The Modal

A single modal titled **"New Translation"**. Three sections:

#### Section 1: Source Content

Three mutually exclusive input methods, presented as tabs or toggle options:

- **Upload File** — drag-and-drop or file picker for .txt, .docx files. Single file only (bulk import remains a separate power-user flow).
- **Paste Text** — a textarea for pasting Chinese source text directly.
- **Existing Source** — a searchable, scrollable list of previously imported source books. Collapsed by default, expands on click. Each row shows book number, title, and chapter/segment counts.

For Upload and Paste, an optional **Title** field is shown. If left blank:
- For uploads: derived from the filename (strip extension)
- For paste: use the first line or first N characters of the pasted text

Content type is inferred automatically:
- **Paste**: always creates an article (single chapter)
- **Upload .txt/.docx**: creates a book — the existing import logic splits into chapters based on the file's structure

#### Section 2: Target Language

A language dropdown, pre-filled from the user's last-used target language (stored in `localStorage` under key `last_target_language_id`). If no previous selection exists, defaults to English.

#### Section 3: Source Language

A language dropdown defaulting to Chinese. The user can change it if the source text is in another language (e.g. English). No auto-detection — the user knows what language their text is in.

Shown inline as a small row: `Source: Chinese ▾` — not hidden, not prominent. Just there if needed.

### Action Button

Single button: **"Translate"** (or "Create & Translate" — whatever fits).

Disabled until both source content and target language are provided. Shows a loading spinner during creation.

### What Happens on Submit

1. **If source is Upload or Paste**: Create source book via API (`POST /books` + `POST /books/{id}/import-text` or `POST /books/{id}/import`), then create translation project (`POST /book-translations`).
2. **If source is Existing**: Skip book creation, just create translation project.
3. **After translation project is created**:
   - **Single chapter** (articles, short texts): Auto-trigger batch AI translation and navigate directly to the editor. The user sees segments being translated in real-time.
   - **Multiple chapters** (books): Navigate to the TranslationDetail page showing the chapter list. No auto-translate — user translates chapter-by-chapter to control cost.

### Modal Layout for Small Screens

- Modal uses `max-h-[90vh]` with `overflow-y-auto` on the content area
- Action buttons in a sticky footer that is always visible at the bottom of the modal
- On very small screens, the modal becomes nearly full-screen but buttons never clip

### Last-Used Language Memory

- On successful translation creation, save the selected `target_language_id` to `localStorage` under `last_target_language_id`
- On modal open, read this value and pre-select it in the dropdown
- If the stored language no longer exists or is disabled, fall back to English (or the first enabled language)

### What Stays the Same

- **Source Texts tab** remains in the library for browsing and managing source books. It becomes a secondary admin/management view, not part of the primary translation creation flow.
- **Bulk Import** stays as a separate button on the Source Texts tab — it's a power-user feature for importing many files at once.
- **Existing "Add New Source" modal** is removed or folded into the Source Texts tab (since the unified flow handles source creation).
- **TranslationDetail page** is unchanged — it's where multi-chapter books land after creation.
- **Editor** is unchanged — it's where single-chapter content lands after creation.

### What Changes

| Before | After |
|--------|-------|
| "Add New" on Source Texts tab → fill metadata → then "New Translation" → pick source → pick language | "New Translation" → provide source + language → done |
| User must know about source books vs translations | User just says "I want to translate this" |
| No auto-translate | Single-chapter content auto-translates |
| Language picked fresh each time | Last-used language remembered |
| Modal can clip on small screens | Scrollable modal with sticky footer |

## Architecture

### New/Modified Components

| Component | Change |
|-----------|--------|
| `BookLibrary.tsx` | Replace "New Translation" modal with unified wizard modal. Keep existing source-texts tab. |
| New: `NewTranslationModal.tsx` | Extract the unified modal into its own component (BookLibrary.tsx is already large). Handles all three source input methods, language selection, and creation logic. |

### API Calls (all existing, no new endpoints needed)

1. `POST /books` — create source book (for upload/paste paths)
2. `POST /books/{id}/import` — import uploaded file
3. `POST /books/{id}/import-text` — import pasted text
4. `POST /book-translations` — create translation project
5. `POST /translate/batch` — auto-translate (for single-chapter content)

### State Flow

```
User clicks "New Translation"
  → Modal opens
  → User provides source (file/paste/existing)
  → Source language defaults to Chinese (user can change)
  → Target language pre-filled from last used
  → Click "Translate"
  → [Loading state]
  → IF upload/paste:
      → createBook({ title, content_type: 'article' | 'book' })
      → importText() or importFile()
  → createBookTranslation({ book_id, target_language_id, source_language_id })
      (source_language_id = null for Chinese, or the selected language ID)
  → Fetch chapter list for the new translation
  → IF single chapter:
      → Navigate to /translations/{btId}/chapters/{chapterId}
      → Fire batchTranslate() (non-blocking — segments appear as they complete)
  → IF multiple chapters:
      → Navigate to /translations/{btId}
      → User picks chapters to translate individually
```

## Out of Scope

- Bulk import changes (stays as-is)
- Changes to the editor
- Changes to TranslationDetail page
- User preferences/settings page changes (we use localStorage, not DB settings)
- PDF/EPUB/HTML import support
- Multi-file upload in the unified modal (use bulk import for that)
