# Glossary Feature Improvements Plan

## Context

The glossary page in BITS manages Buddhist terminology for AI-assisted translation. This plan covers improvements implemented in Phases 1-4 and planned for Phases 5-7.

---

## Completed: Phases 1-4

### Phase 1: Component Architecture + Hybrid Editing

**Goal**: Split monolithic `GlossaryPage.tsx` into sub-components with both inline editing and an edit modal.

#### Component Structure

| Component | Purpose |
|---|---|
| `GlossaryToolbar.tsx` | Header with title, term count, Import CSV + Add Term buttons |
| `GlossaryFilters.tsx` | Search input, category/project/tradition dropdowns, translation status toggles |
| `GlossaryTable.tsx` | Table wrapper with bold, sortable column headers |
| `GlossaryRow.tsx` | Row with all fields inline-editable (double-click) + edit/delete action buttons |
| `TermFormModal.tsx` | Unified create/edit modal for all fields. Accepts optional `term` prop |
| `GlossaryPage.tsx` | Orchestrator composing above components, manages state |

#### Inline Editing (all fields)

- **Double-click** any cell to edit in place (Chinese, English, Sanskrit, Category, Project, Tradition)
- Category field uses a dropdown select; all others use text input
- Pencil icon appears on cell hover as a visual cue
- Enter to save, Escape to cancel, check/X buttons also available
- Saves are **optimistic** - local state updates immediately without full list reload

#### Edit Modal

- Click the pencil action button on a row to open full edit form
- All fields available: Chinese, English, Sanskrit, Category, Project, Tradition, Source Reference, TBS Notes, Context Notes, Do Not Translate, Transliterate
- Same modal reused for creating new terms (without `term` prop)

#### Backend: Translation CRUD

New endpoints (registered before `/{term_id}` to avoid path conflicts):
- `PATCH /glossary/translations/{translation_id}` - Update translation text, preferred status, notes
- `DELETE /glossary/translations/{translation_id}` - Delete a specific translation

New schema: `GlossaryTranslationUpdate` in `backend/app/schemas/glossary.py`

#### Files

**New:**
- `frontend/src/components/glossary/GlossaryToolbar.tsx`
- `frontend/src/components/glossary/GlossaryFilters.tsx`
- `frontend/src/components/glossary/GlossaryTable.tsx`
- `frontend/src/components/glossary/GlossaryRow.tsx`
- `frontend/src/components/glossary/TermFormModal.tsx`

**Modified:**
- `frontend/src/components/glossary/GlossaryPage.tsx` - Refactored to orchestrator
- `frontend/src/api/glossary.ts` - Added `updateTranslation`, `deleteTranslation`, `addTranslation`; added `translation_status`, `sort_by`, `sort_order` params to `listTerms`
- `backend/app/api/glossary.py` - Translation CRUD, sorting, filters
- `backend/app/schemas/glossary.py` - `GlossaryTranslationUpdate`

---

### Phase 2: Translation Status Markers + Filters

**Goal**: Visually flag unaccepted translations and terms with missing translations. Allow filtering and review.

#### Visual Indicators

- **"?" in translation**: Amber background highlight + warning triangle icon
- **Missing translation** (no translation row, or empty text): Red "Missing" badge
- **Normal translation**: Plain text display

#### Filter Toggles

Pill-style buttons below the search bar:
- **All** (default) - Show everything
- **Needs Review (?)** - Only terms with "?" in English translation
- **Missing Translation** - Only terms with no/empty English translation

#### Backend Filter

`translation_status` query parameter on `GET /glossary`:
- `needs_review`: EXISTS subquery where `translated_term LIKE '%?%'`
- `missing`: NOT EXISTS subquery where `translated_term != ''` (catches both no-row and empty-string cases)

#### Accept/Review Workflow

In the edit modal, when a translation contains "?":
- "Accept" button appears next to the English field label
- Clicking it strips all "?" characters and keeps the rest
- The field is highlighted with an amber border for visibility

---

### Phase 3: Column Sorting

**Goal**: Click any column header to sort ascending/descending.

#### Backend

`sort_by` and `sort_order` query parameters on `GET /glossary`:
- Whitelisted columns: `source_term`, `sanskrit_pali`, `category`, `project_tags`, `tradition_group`, `created_at`, `updated_at`
- Replaces hardcoded `ORDER BY source_term`

#### Frontend

- Bold column headers with click-to-sort
- Click cycles: asc -> desc -> reset to default
- Arrow icons: `ArrowUp` (asc), `ArrowDown` (desc), `ArrowUpDown` (neutral, shown on hover)
- Sort state managed in `GlossaryPage.tsx`, passed as props

---

### Phase 4: AI Translation + Field Completion

**Goal**: Use AI (LiteLLM) to suggest English translations, Sanskrit equivalents, and categories for glossary terms.

#### Backend: AI Completion Service

New service: `backend/app/services/glossary/ai_complete.py`
- Specialized Buddhist terminology system prompt with knowledge of TBS, Vajrayana, Mahayana, Theravada traditions
- `ai_complete_term()` - Complete fields for a single term, returns JSON with english, sanskrit, category, confidence
- `ai_complete_batch()` - Complete fields for multiple terms in a single LLM call
- Auto-detects empty fields when no specific fields requested
- Strips markdown code fences from LLM responses for reliable JSON parsing

#### Backend: New Endpoints

Registered before `/{term_id}` to avoid path conflicts:
- `POST /glossary/{term_id}/ai-complete` - AI-complete a single term's empty fields
  - Request body: `AICompleteRequest` with optional `fields` list and `model` override
  - Response: `AICompleteResponse` with suggested values and confidence score
- `POST /glossary/ai-batch` - AI-complete multiple terms at once
  - Request body: `AIBatchRequest` with `term_ids` list (max 50) and optional `model`
  - Response: `AIBatchResponse` with results array containing suggestions per term
- Both endpoints handle LLM auth errors with user-friendly messages

#### Frontend: Edit Modal AI Buttons

- **Sparkle icon buttons** (purple `Sparkles` from lucide-react) next to English, Sanskrit, and Category field labels
- Clicking a sparkle button AI-completes just that one field
- **"Complete All with AI" button** in the modal header fills all empty fields at once
- Loading state: sparkle icon replaced with spinning `Loader2` during AI call
- AI-filled fields get a purple ring highlight for 3 seconds
- Confidence percentage displayed in a purple status banner
- Error messages shown in red banner with auto-dismiss
- AI buttons only available in edit mode (not create mode, since term must exist)

#### Frontend: Batch AI Completion

- **"AI Batch" button** in the GlossaryToolbar with purple styling
- Identifies terms with missing English translations from the current view
- Confirmation dialog shows count of terms to be completed
- Progress indicated by spinning loader on the button
- Result banner shows completion count and model used
- Triggers full table reload after batch completion

#### New Schemas

In `backend/app/schemas/glossary.py`:
- `AICompleteRequest` - fields, model
- `AICompleteResponse` - english, sanskrit, category, confidence, model, token_count
- `AIBatchRequest` - term_ids, model
- `AIBatchItem` - term_id, english, sanskrit, category, confidence
- `AIBatchResponse` - results, model

#### Files

**New:**
- `backend/app/services/glossary/ai_complete.py` - AI completion service with prompts

**Modified:**
- `backend/app/api/glossary.py` - Added `ai-batch` and `{term_id}/ai-complete` endpoints
- `backend/app/schemas/glossary.py` - AI completion request/response schemas
- `frontend/src/api/glossary.ts` - Added `aiCompleteTerm()`, `aiBatchComplete()`, response types
- `frontend/src/components/glossary/TermFormModal.tsx` - Sparkle buttons, Complete All with AI, AI state management
- `frontend/src/components/glossary/GlossaryToolbar.tsx` - AI Batch button with loading/result states
- `frontend/src/components/glossary/GlossaryPage.tsx` - Batch AI handler wired to toolbar

---

### Phase 5: Search with Suggestions and Autocompletion

**Goal**: Add autocomplete suggestions to the search input and expand search to cover translations and Sanskrit.

#### Backend: Autocomplete Endpoint

New endpoint: `GET /glossary/autocomplete`
- Query parameter `q` (min 1 char), `limit` (1-30, default 10), optional `language_id`
- Searches across `source_term`, `translated_term` (via outer join), and `sanskrit_pali`
- Returns lightweight `AutocompleteResponse` with `suggestions` list containing `id`, `source_term`, `translated_term`, `match_field`
- Deduplicates by term ID; determines which field matched for UI highlighting
- Registered before `/{term_id}` routes to avoid path conflicts

#### Backend: Expanded Main Search

- `_apply_filters()` search now uses `or_()` across `source_term`, `sanskrit_pali`, and an `exists()` subquery on `GlossaryTranslation.translated_term`
- Uses `exists()` (not JOIN) to avoid row multiplication that would break pagination/count

#### Frontend: SearchAutocomplete Component

New component: `frontend/src/components/glossary/SearchAutocomplete.tsx`
- Debounced input (300ms) via new `useDebounce` hook
- Dropdown with suggestions showing source term (bold) and translation (muted)
- Matching text highlighted with `<mark>` tags
- Full keyboard navigation: ArrowUp/Down to navigate, Enter to select, Escape to close
- Click-outside closes dropdown
- ARIA attributes for accessibility (`role="combobox"`, `role="listbox"`, `aria-activedescendant`)
- Loading spinner while fetching; dark mode support
- Sanskrit matches tagged with purple "Sanskrit" label

#### Frontend: Debounced Main Search

- `GlossaryPage.tsx` uses `useDebounce(search, 300)` for the main list API call
- Both autocomplete and table update debounce at 300ms independently

#### New Schemas

In `backend/app/schemas/glossary.py`:
- `AutocompleteSuggestion` - id, source_term, translated_term, match_field
- `AutocompleteResponse` - suggestions list

#### Files

**New:**
- `frontend/src/hooks/useDebounce.ts` - Generic debounce hook
- `frontend/src/components/glossary/SearchAutocomplete.tsx` - Autocomplete input component

**Modified:**
- `backend/app/schemas/glossary.py` - Added autocomplete schemas
- `backend/app/api/glossary.py` - Added `/autocomplete` endpoint; expanded `_apply_filters()` search
- `frontend/src/api/glossary.ts` - Added `autocompleteTerms()` function and `AutocompleteSuggestion` type
- `frontend/src/components/glossary/GlossaryFilters.tsx` - Replaced plain input with `SearchAutocomplete`
- `frontend/src/components/glossary/GlossaryPage.tsx` - Added debounced search for main list queries

---

## Planned: Future Phases

### Phase 6: Category and Project Management

- Migrate `category` column from PostgreSQL ENUM to VARCHAR(50)
- New `glossary_categories` table (key, label, color, sort_order, is_builtin)
- New `glossary_projects` table (name, description, is_active)
- Admin CRUD endpoints for categories and projects
- Frontend `CategoryManager.tsx` and `ProjectManager.tsx` components
- Dynamic category labels/colors fetched from API instead of hardcoded

### Phase 7: Additional Improvements

- **CSV Export**: `GET /glossary/export/csv` with same format as import
- **Pagination**: `GlossaryPagination.tsx` with page navigation and configurable page size
- **Bulk Operations**: Row selection checkboxes, bulk delete/update/AI-complete
- **Keyboard Shortcuts**: `/` to focus search, `n` for new term, `Escape` to close modal

---

## Architecture Notes

### Optimistic Updates

Inline edits and modal saves update local state immediately via `patchLocalTerm()` instead of reloading the full list. Only create and import operations trigger a full `loadTerms()`. This prevents the visual jarring of a full table re-render on every edit.

### Route Registration Order

In `backend/app/api/glossary.py`, static path routes (`/translations/{id}`, `/import/csv`) are registered before dynamic `/{term_id}` routes to prevent FastAPI from interpreting path segments as term IDs.

### Shared Filter Logic

`_apply_filters()` helper applies search, category, project, tradition, and translation_status filters to both the data query and count query, avoiding duplication.
