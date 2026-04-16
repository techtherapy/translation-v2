# AI Translation Tool — Specification & Plan

## Context

Build an internal web-based AI translation tool for translating the works of **Living Buddha Lian Sheng (盧勝彥)** of **True Buddha School** from Chinese into **multiple target languages**. Primary target is English, with support for additional languages (e.g., Indonesian, French, Spanish, Japanese, etc.) built into the architecture from day one. The corpus spans **300+ books written over 40+ years**, primarily on Buddhist subjects. The author's style has evolved significantly over this period.

- Some books have existing human translations (useful as reference material)
- A formal Buddhist terminology glossary exists (import on day one) — the glossary is the primary tool for translation consistency across the corpus
- Source texts are available as digital TXT/DOCX files
- This is an **internal team tool** — no public SaaS, no billing, no multi-tenancy
- Small team: 2-5 translators, reviewers, and editors

### Why build a custom tool
- **Buddhist terminology precision** — True Buddha School has specific term translations that differ from other Buddhist traditions. Generic tools won't enforce these.
- **Author-aware context** — 300+ books form an interconnected body of work with cross-references, recurring teachings, and evolving terminology.
- **Editorial workflow** — professional publishing requires review, approval, and versioning that consumer tools (like ainoveltranslation.com) don't support.
- **LLM flexibility** — tune prompts for Buddhist content, inject domain context, switch between models.

---

## Recommended Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | **React + TypeScript** | Rich editor experience, large ecosystem |
| Editor | **TipTap** (ProseMirror-based) | Annotations, comments, track changes, extensible |
| Styling | **Tailwind CSS** | Rapid UI development, consistent design |
| Backend | **Python (FastAPI)** | Best LLM ecosystem, async, fast |
| LLM Gateway | **LiteLLM** | Unified API for Claude, GPT-4, DeepSeek, Gemini, local models |
| Database | **PostgreSQL** | JSONB for metadata, full-text search, robust |
| Reference Alignment | **bertalign** | Multilingual paragraph alignment for importing existing translations as reference material |
| Cache | **Redis** | Reference translation caching, rate limiting |
| Auth | **Simple JWT + role-based** | Internal team, lightweight |
| File Storage | **Local filesystem or S3** | Document uploads, exports |
| Deployment | **Docker Compose** | Simple internal deployment |

---

## Core Features

### 1. Library & Document Management

The corpus is large (300+ books), so organization and navigation are critical.

**Book library:**
- Browse/search all books by title, year, topic/category, translation status
- **Book metadata:** title (Chinese + English), year published, category/topic, era tag (early/middle/recent), series grouping
- **Translation status per book:** Not Started, In Progress, Under Review, Published
- **Progress dashboard:** per-book and overall corpus stats (% translated, % reviewed, % published)

**Document structure:**
- Each book is a project containing chapters/sections
- **Import:** TXT, DOCX
- **Auto-segmentation** at paragraph level (Buddhist literary texts need context, not sentence-level)
- Manual merge/split segments
- **Structure AI** — auto-detect chapter breaks and section headings from imported text
- Chapter/section navigation sidebar

### 2. AI Translation Engine

**Multi-LLM support via LiteLLM:**
- Configure multiple providers: Claude, GPT-4, DeepSeek, Gemini, Ollama (local), etc.
- Per-book or per-chapter default model selection
- Per-segment model override
- **A/B translation comparison** — generate from 2+ models side by side, pick the best

**AI Assistants:**
- **Structure AI** — auto-detect chapter breaks and sections when importing raw text
- **Glossary AI** — scan source text, suggest new terms not yet in glossary (Buddhist concepts, proper names) for human approval
- **Summary AI** — generate per-chapter summaries (key teachings, terminology used). Summaries feed into translation prompts for consistency across chapters
- **Editor AI** — optional post-translation polish pass for naturalness and readability
- **Batch translation** — one-click translate entire book or selected chapters with progress tracking and pause/resume

**Context-aware prompting (critical for Buddhist literary translation):**
Each translation request automatically includes:
- **Buddhist context:** this is a Buddhist text by Living Buddha Lian Sheng; the AI understands dharma terminology and the author's teaching style
- **Era-aware style notes:** early works vs. recent works may need different translation approaches
- **Glossary terms** found in the source segment (with approved TBS translations)
- **Entity references** — Buddhist figures, deities, masters, temples mentioned in the segment
- **Surrounding paragraphs** for context (configurable, default 3 before + 1 after)
- **Previously approved translations** of recent segments (voice consistency)
- **Custom prompt templates** — editors can tune the system prompt per book or per era
- **Refinement prompt** — "make this more formal", "clarify the dharma reference", "simplify for Western readers", etc.

**Cost & usage tracking:**
- Token counts per request, cost estimates per model, usage dashboard per book

### 3. Editor Interface

**Layout: Side-by-side source and translation**

```
┌────────────────────────────┬────────────────────────────┐
│   Chinese Source (原文)      │   English Translation       │
│                            │                            │
│  [Paragraph 1]             │  [Paragraph 1]             │
│  [Paragraph 2]  ◄────────► │  [Paragraph 2]  ← active   │
│  [Paragraph 3]             │  [Paragraph 3]             │
│                            │                            │
├────────────────────────────┴────────────────────────────┤
│  Glossary | Comments | History | Reference Translations | Context │
└─────────────────────────────────────────────────────────┘
```

**Editor capabilities:**
- Synchronized scrolling between source and translation
- Click a source segment to jump to its translation (and vice versa)
- Rich text editing (formatting preservation)
- **Track changes mode** — insertions/deletions with diff highlighting
- **Inline comments** — select text, add a comment (like Google Docs)
- **Segment status indicators** — visual badges (Machine Translated, Draft, Under Review, Approved, Needs Revision)
- Keyboard shortcuts for common actions (approve, reject, next segment, retranslate)
- **Focus mode** — minimal UI, just source + translation
- Word/character count (source and translation)
- **Find & replace** across chapter or book
- Undo/redo per segment

**Bottom panel (tabbed):**
- **Glossary:** auto-detected Buddhist terms from source, with approved TBS translations
- **Comments:** threaded discussion per segment
- **History:** all versions of this segment's translation
- **Reference Translations:** how similar passages were translated in other books (for inspiration, not copy-paste)
- **Context:** surrounding paragraphs, chapter summary, book-level notes

### 4. Buddhist Terms / Glossary Database

**The primary tool for translation consistency across 300+ books.** The corpus varies widely in style across eras and subjects, but Buddhist and True Buddha School terminology recurs throughout. The glossary — not paragraph-level translation memory — is where consistency is enforced, because the repetition in this corpus is at the term level rather than the sentence or paragraph level.

**Term structure:**
- Source term (Chinese)
- **Per-language translations** — each term can have approved translations for multiple target languages (English, Indonesian, French, etc.), each with a preferred translation marked
- Sanskrit/Pali equivalent (where applicable, e.g., 般若 → Prajñā → Wisdom/Prajna)
- Category: dharma concept, deity/buddha, mantra, mudra, practice/ritual, person, place/temple, honorific, general
- True Buddha School specific notes (how this term is used in TBS context vs. other traditions)
- Context notes / usage guidance
- Cross-references to related terms
- "Do not translate" flag (for mantras, Sanskrit terms that should stay romanized — applies across all languages)
- "Transliterate" flag (for terms that should be romanized rather than translated)

**Glossary features (in priority order):**
- **Import existing glossary** — CSV import of the formal TBS terminology glossary on day one
- **Auto-highlight in editor** — scan source text, highlight known glossary terms, show approved translations inline. This is the highest-value feature for translator productivity.
- **Context-aware AI prompting** — inject relevant glossary terms found in the source segment into LLM prompts so AI translations use correct terminology from the start
- **Consistency checker** — QA flag when a glossary term appears in source but the approved translation isn't used. This catches inconsistency at review time.
- **Glossary AI / Term extraction** — scan a book's source text, identify candidate terms not yet in glossary, suggest for human review before translation begins
- **Quick-add from editor:** select Chinese text → "Add to glossary" → fill in translation and metadata
- **Search and filter** by category, language, date added
- **Import/export:** CSV

### 5. Reference Translations (formerly Translation Memory)

A lightweight reference system for showing translators how similar passages were handled in other books. **This is a reference tool, not a copy-paste reuse system.** The corpus varies too widely in style across 40+ years of writing for traditional TM (paragraph-level fuzzy matching) to be high-value. Term-level consistency is handled by the glossary (Section 4); this system provides paragraph-level inspiration.

**Why not traditional TM:** Traditional Translation Memory is designed for repetitive structured content (legal contracts, product manuals, UI strings) where the same sentence structures recur frequently. Buddhist literary texts spanning decades vary significantly in style, tone, and subject matter. Fuzzy matches at paragraph level will be rare and often stylistically inappropriate for the current book's context. The glossary handles the actual repetition pattern (terms, not paragraphs).

**What this system provides:**
- **Reference import** — import existing human translations alongside source texts, aligned at paragraph level, as reference material for translators
- Approved segment translations are stored as reference entries
- When translating a passage, the editor shows how similar passages were translated in other books — for **inspiration and context**, not direct reuse
- **Language-pair aware** — reference entries are tagged with target language; lookups return results for the active target language only

**Reference Import Workflow:**
1. **Import pair** — user uploads Chinese source file and corresponding translation file for the same book
2. **Auto-segment both** — split each file into paragraphs independently
3. **Structural alignment** — if both files have similar paragraph counts, do 1:1 mapping. For mismatched counts, use `bertalign` embedding-based alignment as fallback
4. **Human review screen** — show proposed pairs side by side; user can confirm, adjust, or discard pairs
5. **Commit** — confirmed pairs are stored as reference entries tagged with the source book
6. **Batch import** — support importing multiple book pairs in sequence

**Editor integration:**
- Reference matches shown in editor bottom panel with similarity indicator
- Fuzzy matching for similar segments (configurable threshold, e.g., 75%)
- Matches are presented as "how this was translated in [Book Name]" — contextual reference, not suggested inserts
- **Corpus-wide** — references can come from any book

### 6. Review Workflow

**Segment statuses:**
```
Machine Translated → Editor Draft → Under Review → Approved
                                         ↓
                                   Needs Revision → Editor Draft (cycle)
```

**Review features:**
- **Per-segment review:** reviewer can Approve, Request Revision, or Comment
- **Bulk actions:** approve all segments in a chapter, approve filtered selection
- **Side-by-side diff** between current and previous version
- **Review assignment:** admin assigns chapters to specific reviewers
- **Review dashboard:** overview of all segments by status, filterable
- **Lock on approval:** approved segments require explicit unlock to re-edit
- **Chapter sign-off:** chapter-level approval when all segments approved
- **Book sign-off:** book-level final approval for publishing

### 7. Entity & Context Database

**Buddhist entities database:**
- **Buddhas, Bodhisattvas, Deities** — Chinese name, English name, Sanskrit name, description, iconography notes
- **Masters and historical figures** — names, roles, lineage relationships
- **Places and temples** — Chinese name, English name, description
- **Practices and rituals** — name, description, associated mantras/mudras
- These are injected into AI prompts when detected in a segment

**Book-level context:**
- Era/period tag (affects style guide selection)
- Topic/category
- Summary and key themes
- Related books in the corpus
- Per-chapter notes and summaries (can be AI-generated via Summary AI)

**Style guide (era-aware):**
- Base style rules applying to all translations
- Era-specific overrides (early works may be more colloquial, later works more formal)
- Formality level, pronoun conventions
- Handling of honorifics (e.g., 上師 → Guru, Root Guru, Grand Master)
- Buddhist-specific rules: when to transliterate vs. translate, how to format mantras, how to handle Chinese literary allusions
- Punctuation and formatting preferences

### 8. Versioning

- **Document versions:** first draft, second draft, editor review, final
- Each version preserves full segment state (translation text + status + comments)
- Compare any two versions side by side with diff highlighting
- Branch a version to try alternative translation approaches without losing work
- Roll back to any previous version
- Version notes (why this version was created)

### 9. Pre-translation Pipeline

Automated pipeline when a new book is imported:
1. **Import & structure** — parse TXT/DOCX, auto-detect chapters (Structure AI)
2. **Term detection** — scan source for known glossary terms, flag unknown candidates (Glossary AI). New terms should be reviewed and added to the glossary before AI translation begins.
3. **AI translate** — translate segments with Buddhist-aware prompts. Prompts include: relevant glossary terms with approved translations, entity references, surrounding context, era-aware style notes.
4. **Reference lookup** — flag segments where similar passages exist in previously translated books (shown as reference, not auto-inserted)
5. **Editor AI polish** — optional second pass for naturalness
6. **QA scan** — run automated quality checks (glossary consistency is the primary check)
7. **Present to translator** — all segments pre-populated, status indicators showing source (AI translated, AI polished, reference available)

The translator refines and approves rather than translating from scratch. The glossary ensures terminology is correct from the AI translation step, reducing the amount of manual term correction needed.

### 10. Quality Assurance

Automated QA checks (run on demand or before export):

- **Glossary consistency** — flag segments where TBS glossary terms aren't used correctly
- **Term consistency** — detect if the same Buddhist term is translated differently across segments/chapters
- **Untranslated segments** — flag empty or machine-only segments not yet reviewed
- **Mantra/Sanskrit check** — ensure mantras and Sanskrit terms are preserved (not machine-translated)
- **Length anomalies** — flag unusual source-to-translation length ratios
- **Formatting check** — mismatched formatting, punctuation issues
- **Number/date preservation** — ensure numbers and dates are correct
- **Cross-reference check** — when a book references another book by the same author, flag for verification

### 11. Export

- **Clean export:** final translation only (DOCX, PDF, TXT)
- **Bilingual export:** source and translation side by side (DOCX, PDF)
- **Review export:** translation with comments and revision notes
- **Print-ready export:** formatted for publishing (configurable templates)

### 12. Multi-language Support

The same Chinese source text can be translated into multiple target languages independently.

**Architecture:**
- **Target languages are configurable** — admin adds languages (English, Indonesian, French, etc.) with language code and display name
- **Each segment has independent translation tracks per language** — English translation and Indonesian translation of the same paragraph are separate, each with their own version history, status, comments, and review workflow
- **Language switcher in editor** — translator selects target language; editor shows Chinese source alongside the selected language's translation. Can also show a reference language (e.g., view approved English while translating to Indonesian)
- **Per-language progress tracking** — book library shows translation status per language (e.g., Book 42: English 100%, Indonesian 35%, French 0%)
- **Shared source segments** — the Chinese source and its segmentation are shared across all languages; segment splits/merges apply to all language tracks

**Glossary and references per language:**
- Glossary terms have translations per target language (one Chinese term → different approved translations in English, Indonesian, etc.)
- Reference translation entries are tagged by language pair; lookups only return results for the active target language
- Glossary AI and QA checks run per target language

**Prompting:**
- Custom prompt templates can be overridden per target language (e.g., different formality norms for Japanese vs. English)
- Existing approved translations in other languages can be provided as reference context to the LLM ("here is the approved English translation for reference")

### 13. Collaboration

- **Roles:** Admin, Translator, Reviewer
- **Segment-level comments** with threading
- **@mentions** in comments
- **Activity feed** — who changed what, when
- **In-app notifications** for assignments, review requests, mentions
- **Segment locking** — when someone edits a segment, others see it as locked

---

## Additional Features Worth Considering

### Back-translation Verification
AI translates English back to Chinese, compares with original. Flags significant semantic differences as potential mistranslations. Useful QA sanity check for Buddhist concepts that are easy to mistranslate.

### API & Integrations
- REST API for all operations (enables future integrations)
- Webhook support for workflow events (segment approved, chapter complete)
- Potential integration with publishing tools (InDesign, Scrivener export formats)

---

## Data Model (Key Entities)

```
Corpus
  └── Books
        ├── Chapters/Sections
        │     ├── Segments (paragraphs)
        │     │     ├── Translations (per target language, with versions)
        │     │     ├── Comments (per language track)
        │     │     └── Reviews (per language track)
        │     └── Chapter metadata (summary, notes)
        └── Book metadata (year, era, category, status)

Languages (configured target languages)
  └── Language config (code, name, enabled, prompt template overrides)

Glossary (corpus-wide)
  └── Terms
        ├── Source: Chinese
        ├── Sanskrit/Pali equivalent
        └── Translations (per target language, each with preferred marked)

Entity Database (corpus-wide)
  ├── Buddhist figures (buddhas, bodhisattvas, deities, masters)
  ├── Places & temples
  └── Practices & rituals

Reference Translations (corpus-wide, per language pair)
  └── Segment pairs (source → translation, target language, book reference) — for reference, not reuse

Style Guide
  ├── Base rules
  ├── Era-specific overrides
  └── Language-specific overrides (e.g., formality norms differ by target language)

Users & Roles
```

## Proposed Directory Structure

```
translation-tool/
├── frontend/                 # React + TypeScript
│   ├── src/
│   │   ├── components/
│   │   │   ├── editor/       # TipTap editor, segment panels
│   │   │   ├── library/      # Book library, progress dashboard
│   │   │   ├── review/       # Review interface
│   │   │   ├── glossary/     # Terms management
│   │   │   ├── entities/     # Buddhist entities database
│   │   │   └── common/       # Shared UI components
│   │   ├── hooks/
│   │   ├── stores/
│   │   ├── api/
│   │   └── types/
│   └── package.json
├── backend/                  # Python FastAPI
│   ├── app/
│   │   ├── api/              # Route handlers
│   │   ├── models/           # SQLAlchemy models
│   │   ├── services/
│   │   │   ├── translation/  # LLM integration, prompt building
│   │   │   ├── pipeline/     # Pre-translation pipeline
│   │   │   ├── tm/           # Reference translations + fuzzy matching
│   │   │   ├── glossary/     # Term management + auto-detection
│   │   │   ├── qa/           # Quality assurance checks
│   │   │   ├── import_export/# Document import and export
│   │   │   └── ai_assistants/# Structure AI, Summary AI, etc.
│   │   ├── core/             # Config, auth, dependencies
│   │   └── schemas/          # Pydantic schemas
│   └── requirements.txt
├── docker-compose.yml        # PostgreSQL, Redis, backend, frontend
└── README.md
```

---

## Implementation Phases

### Phase 1 — Foundation
- **Multi-language-aware data model** — segments, translations, and glossary all support target language from day one (even if UI initially focuses on English)
- Book/chapter/segment data model and API
- Book library with import (TXT, DOCX) and auto-segmentation
- Basic side-by-side editor (Chinese → English)
- Single LLM integration (Claude via LiteLLM)
- Paragraph-level AI translation with basic Buddhist context prompt
- User auth and roles (Admin, Translator, Reviewer)
- **Import existing TBS glossary** (CSV import, with English translations)
- **Glossary auto-highlight in editor** — scan source text, highlight known glossary terms, show approved translations inline

### Phase 2 — Core Workflow
- **Language switcher in editor** — select target language, view reference language alongside
- **Per-language progress tracking** in book library
- **Context-aware AI prompting** — inject glossary terms found in source segment into LLM translation prompts
- **Glossary consistency QA** — flag when a translator uses a different translation for a known glossary term
- Glossary quick-add from editor (per target language)
- Review workflow (approve/reject/comment per segment, per language)
- Track changes and segment version history
- Export (DOCX, TXT)
- Multi-LLM support and A/B model comparison
- Segment locking for concurrent users
- **Reference translation import** — import source + translation file pairs, alignment, human review screen (lower priority than glossary features)

### Phase 3 — Buddhist Intelligence
- **Glossary AI / Term extraction** — scan source text, identify candidate terms not yet in glossary before translation begins
- Buddhist entity database (figures, places, practices)
- Context-aware prompting (entities, style guide, summaries injected into prompts alongside glossary)
- Pre-translation pipeline (full automated flow, glossary-driven)
- Summary AI (per-chapter summaries)
- QA checks (glossary consistency, term consistency, mantra preservation)
- Reference translation fuzzy matching in editor (lower priority)

### Phase 4 — Polish
- Document versioning and branching
- Structure AI (auto chapter detection)
- Editor AI (post-translation polish)
- Era-aware style guide with overrides
- Advanced QA rules (cross-reference checks, back-translation)
- Print-ready export templates
- Notifications and activity feed
- Performance optimization for full corpus

---

## Verification / Testing Strategy

- **Unit tests:** backend services (translation, glossary matching, glossary consistency QA, fuzzy matching)
- **Integration tests:** API endpoints with test database
- **Frontend tests:** editor interactions, review workflow (Playwright)
- **Glossary import test:** verify existing TBS glossary imports correctly and terms are detected in source text
- **Glossary highlight test:** verify glossary terms are auto-highlighted in the editor and approved translations are shown
- **Glossary-aware AI test:** verify LLM prompts include relevant glossary terms and AI translations use correct terminology
- **Reference import test:** import a human-translated book pair, verify aligned pairs are stored and shown as references
- **End-to-end:** import a sample chapter → run pre-translation pipeline → edit in UI → review → approve → export
- **LLM quality test:** translate a sample chapter with different models, compare Buddhist terminology accuracy against glossary
