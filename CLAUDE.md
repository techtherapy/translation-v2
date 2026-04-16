# BITS — Buddha Intelligence Translation System

AI-powered translation tool for the works of **Living Buddha Lian Sheng** (True Buddha School). Translates 300+ Buddhist books from Chinese into multiple target languages (English primary, with Indonesian, French, Spanish, Japanese, etc.).

**Internal team tool** — 2-5 translators, reviewers, and editors. No public SaaS.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | **Python 3.12, FastAPI** (async) |
| ORM | **SQLAlchemy 2.0** (async with asyncpg) |
| Database | **PostgreSQL 16** |
| Cache | **Redis 7** |
| LLM Gateway | **LiteLLM** (Claude, GPT-4, DeepSeek, Gemini, local models) |
| TM Alignment | **bertalign** (multilingual paragraph alignment) |
| Fuzzy Matching | **rapidfuzz** |
| Frontend | **React 18 + TypeScript** |
| Editor | **TipTap** (ProseMirror-based) + **@manuscripts/track-changes-plugin** |
| Styling | **Tailwind CSS 3** (dark mode via `class` strategy) |
| Build | **Vite 6** |
| Icons | **lucide-react** |
| Deployment | Backend on **Railway**, Frontend on **Vercel** |
| Local Dev | **Docker Compose** (PostgreSQL, Redis, backend, frontend) |

## Directory Structure

```
translation/
├── backend/
│   ├── app/
│   │   ├── api/              # FastAPI route handlers
│   │   │   ├── __init__.py   # Registers all routers under /api prefix
│   │   │   ├── auth.py       # Login, register, JWT
│   │   │   ├── books.py      # Book/chapter/segment CRUD, import
│   │   │   ├── book_translations.py  # Translation project CRUD
│   │   │   ├── comments.py   # Segment comment threads (CRUD, resolve/unresolve)
│   │   │   ├── glossary.py   # Glossary terms CRUD, CSV import, AI completion
│   │   │   ├── glossary_admin.py  # Category and project management
│   │   │   ├── translate.py  # LLM translation endpoints, track changes resolve
│   │   │   ├── tm.py         # Translation Memory seeding, alignment, search
│   │   │   ├── languages.py  # Target language configuration
│   │   │   └── settings.py   # App settings (API keys stored in DB)
│   │   ├── models/           # SQLAlchemy ORM models
│   │   ├── schemas/          # Pydantic request/response schemas
│   │   ├── services/         # Business logic
│   │   │   ├── translation/  # LLM integration (llm.py), prompt building (prompts.py)
│   │   │   ├── glossary/     # AI completion (ai_complete.py)
│   │   │   ├── tm/           # TM alignment (alignment.py), fuzzy matching (fuzzy.py)
│   │   │   ├── qa/           # (stub — not yet implemented)
│   │   │   ├── import_export/# (stub — not yet implemented)
│   │   │   ├── ai_assistants/# (stub — not yet implemented)
│   │   │   └── pipeline/     # (stub — not yet implemented)
│   │   └── core/
│   │       ├── config.py     # Pydantic Settings (env vars)
│   │       ├── database.py   # Engine, session, init_db, migrations
│   │       └── security.py   # JWT + password hashing
│   ├── Dockerfile
│   ├── railway.toml
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/              # Axios API clients (one per backend module)
│   │   │   └── client.ts     # Shared Axios instance with auth interceptor
│   │   ├── components/
│   │   │   ├── editor/       # TipTap translation editor, segment editor, comments, diff review
│   │   │   ├── library/      # Book library, translation detail, NewTranslationModal
│   │   │   ├── glossary/     # Glossary page, table, filters, modals
│   │   │   ├── tm/           # TM seeding page
│   │   │   ├── settings/     # Settings page
│   │   │   └── common/       # Layout, LoginPage, ConfirmModal, ErrorBoundary
│   │   ├── hooks/            # useConfirm, useTheme, useEditorShortcuts, useGlossaryTerms, useBatchAI, etc.
│   │   ├── stores/           # AuthContext (React Context + JWT)
│   │   └── types/index.ts    # All TypeScript interfaces
│   ├── vercel.json           # API proxy rewrites to Railway
│   ├── vite.config.ts        # Dev proxy /api → localhost:8000
│   └── tailwind.config.js
├── docker-compose.yml
├── uploads/                  # File uploads (gitignored except .gitkeep)
└── .env.example
```

## Data Model

```
Books → Chapters → Segments → Translations (per target language, with versions, content_format: 'plain'|'prosemirror')
BookTranslations (one per book per target language, tracks progress + settings)
SegmentComments (threaded comments per segment per language, with resolve/unresolve)
GlossaryTerms → GlossaryTranslations (per language, with preferred flag)
GlossaryCategories (key, label, color, sort_order)
GlossaryProjects (name, description, is_active)
TMEntries (source_text, translated_text, language_id, alignment_confidence)
Users (admin, translator, reviewer roles)
Languages (configurable target languages)
Settings (key-value store for API keys, loaded into env at startup)
```

## Development Setup

```bash
# Start all services (PostgreSQL, Redis, backend, frontend)
docker compose up

# Or run locally:
# Backend
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm install && npm run dev
```

- Copy `.env.example` to `.env` and set API keys
- Default admin credentials: `admin` / `admin` (seeded on first startup)
- Frontend dev server: `http://localhost:5173` (proxies /api to backend)
- Backend API: `http://localhost:8000` (health check at `/health`)
- API docs: `http://localhost:8000/docs` (Swagger UI)

```bash
# Frontend production build
cd frontend && tsc -b && vite build
```

## Testing & Linting

```bash
# Frontend tests (vitest)
cd frontend && npx vitest run              # all tests
cd frontend && npx vitest run src/utils/   # specific directory
cd frontend && npx vitest --reporter=verbose  # verbose output

# Frontend type check
cd frontend && npx tsc --noEmit

# Frontend linting
cd frontend && npm run lint        # ESLint
cd frontend && npm run format:check # Prettier check
```

- **Frontend tests**: Vitest + jsdom + @testing-library/react. ~180 tests across 13 files.
- **Backend tests**: None yet (no pytest configured)
- **CI/CD**: None — deploys are triggered by git push (Railway auto-deploy, Vercel auto-deploy)
- **Pre-commit hook**: Runs `tsc --noEmit` before each commit

## Architecture Patterns

### Backend

- **Async everywhere** — all DB operations use `async_session`, all endpoints are `async def`
- **Manual migrations** in `core/database.py` `_run_migrations()` — runs on startup, uses raw SQL to add columns/alter types on existing tables (since `create_all` only creates new tables)
- **Pydantic schemas** — separate request/response models in `schemas/` directory
- **Settings in DB** — API keys stored in `settings` table, loaded into `os.environ` at startup via `load_settings_into_env()`
- **LiteLLM** for LLM calls — model strings use provider prefix format (e.g., `anthropic/claude-sonnet-4-20250514`)

### Frontend

- **Relative imports** — all components use relative paths (`../../api/glossary`). An `@/` alias is configured in vite.config.ts/tsconfig.json but not used in the codebase — do not introduce it
- **API clients** — one file per backend module in `src/api/`, all use shared Axios instance from `client.ts`
- **TypeScript interfaces** — all shared types in `src/types/index.ts`
- **Auth** — JWT stored in localStorage, injected via Axios interceptor in `client.ts`
- **Optimistic updates** — glossary inline edits update local state immediately via `patchLocalTerm()` instead of reloading the full list
- **Protected routes** — `ProtectedRoute` component wraps all authenticated pages with `Layout`
- **Dark mode** — Tailwind `class` strategy, toggled via `useTheme` hook

### Frontend Routes

| Path | Component |
|------|-----------|
| `/login` | LoginPage |
| `/books` | BookLibrary (tabs: Translations, Source Texts) |
| `/books/:bookId` | BookDetail |
| `/translations/:btId` | TranslationDetail (chapter list for a translation project) |
| `/translations/:btId/chapters/:chapterId` | TranslationEditor |
| `/glossary` | GlossaryPage |
| `/tm` | TMSeedingPage |
| `/settings` | SettingsPage |

## Code Conventions

### Python
- Pydantic models for all request/response schemas
- SQLAlchemy models with `Base` from `core/database.py`
- `async with async_session() as db:` for DB access in services
- FastAPI dependency injection via `Depends(get_db)` in route handlers

### TypeScript
- Interfaces (not types) for data shapes, all in `types/index.ts`
- API functions return typed responses
- React functional components with hooks
- Tailwind for all styling (no CSS modules)
- lucide-react for icons

## Engineering Principles

- **Fix root causes, not symptoms.** Don't add defensive wrappers, content sniffing, or backwards-compatibility shims. If data can be wrong, fix the code path that produces it. If a field can be stale, fix the writer — don't add fallback readers.
- **Single source of truth.** `content_format` is authoritative for how to interpret `translated_text`. Don't guess or sniff. If it's wrong, fix the backend endpoint that set it.
- **No unnecessary `loadChapter()` calls.** Full chapter reloads from stale `useCallback` closures cause race conditions and navigation bugs. Prefer optimistic local state updates. Only reload when the user explicitly navigates.
- **TipTap editors are imperative.** Don't rely on prop changes to update editor content. Use `useEffect` with plugin commands (e.g., `trackCommands.setTrackingStatus()`) to change behavior on a live editor. Memoize extensions to prevent editor recreation.

## Release Notes

**Every commit must update the release notes.** This is mandatory.

- **Data file**: `frontend/src/data/releaseNotes.ts` — array of `{ version, date, highlights }` objects, newest first
- **Version**: in `frontend/package.json` — bump for each release (semver: patch for fixes, minor for features, major for breaking changes)
- **Displayed via**: Sparkles icon in the toolbar header → modal showing all release notes
- **Audience**: Non-technical users. Write highlights in plain language describing what changed from the user's perspective. No code references, file names, or technical jargon.
- **Format**: Each version entry has a `highlights` array of short bullet point strings

When committing changes, add a new entry at the top of the `releaseNotes` array (or update the latest entry if the version hasn't changed). Bump the version in `package.json` to match.

## Feature Status

| Feature | Status | Key files |
|---------|--------|-----------|
| Glossary | Most mature (Phases 1-5) | `components/glossary/`, `api/glossary.py`, `services/glossary/ai_complete.py` |
| Book library | Unified new-translation flow, CRUD + import | `components/library/`, `NewTranslationModal.tsx`, `api/books.py` |
| Translation editor | Side-by-side editor with comments, track changes, formatting toolbar, compact mode | `components/editor/`, `api/translate.py`, `api/comments.py` |
| TM seeding | Alignment + fuzzy match | `components/tm/`, `services/tm/` |
| Settings | API key + language + model management | `components/settings/`, `api/settings.py` |
| QA, Pipeline, AI assistants | Not started (stubs only) | `services/qa/`, `services/pipeline/`, `services/ai_assistants/` |

See `GLOSSARY_IMPROVEMENTS_PLAN.md` for detailed glossary phase documentation.

## Gotchas

- **No Alembic** — `alembic` is in `requirements.txt` but not configured (no `alembic.ini` or `alembic/` directory). All schema migrations are manual raw SQL in `core/database.py` `_run_migrations()`. New columns must be added there.
- **Route registration order** — FastAPI matches routes top-to-bottom. In `api/glossary.py`, static paths (`/autocomplete`, `/ai-batch`, `/import/csv`) must come before `/{term_id}` or they'll be swallowed by the path parameter.
- **Empty service stubs** — `services/qa/`, `services/pipeline/`, `services/import_export/`, `services/ai_assistants/` are empty placeholder packages. Don't try to import from them.
- **DB URL auto-fix** — `core/database.py` auto-converts `postgresql://` and `postgres://` to `postgresql+asyncpg://` for Railway compatibility.
- **Settings loaded at startup** — API keys from the DB `settings` table are injected into `os.environ` during app startup (`_load_settings` in `main.py`). Changes require app restart.
- **Custom confirm dialogs** — Never use browser `confirm()`. Use `useConfirm()` hook from `hooks/useConfirm.tsx` which shows a styled `ConfirmModal`. For hooks that can't call `useConfirm()` directly, accept a `confirm` function as a parameter and have the calling component pass it in.
- **Track changes uses `@manuscripts/track-changes-plugin`** — The plugin intercepts ProseMirror transactions and stores change metadata in `tracked_insert`/`tracked_delete` marks. Tracked content is saved as ProseMirror JSON with `content_format: 'prosemirror'`. The `translations.previous_text` column stores the immutable plain-text baseline, captured once on first prosemirror save. `previous_text` must always be plain text — the backend guard (`content_format != 'prosemirror'`) prevents JSON from being captured. The tracking plugin is always loaded but toggled via `trackCommands.setTrackingStatus()` — never by recreating the editor.
- **Dual-format content** — `translated_text` stores either plain text (`content_format: 'plain'`) or ProseMirror JSON (`content_format: 'prosemirror'`). Every backend endpoint that writes plain text must reset `content_format` to `'plain'`. Every frontend consumer must use `extractCleanText()` from `utils/translationContent.ts` instead of reading `translated_text` directly. The `content_format` field is the single source of truth — don't sniff content shape or add defensive fallbacks.
- **SegmentEditor ref-based save pattern** — `SegmentEditor.tsx` uses refs (`onSaveRef`, `hasChangesRef`) instead of closure-captured state for all timer callbacks and unmount cleanup. This is **mandatory** because TipTap's `onUpdate` → `setTimeout(doSave, 2000)` freezes the closure at timer-set time. If `onSave` changes between setting and firing (e.g., `trackingEnabled` flips), a closure-captured `onSave` would be stale. Always use `onSaveRef.current` in any callback that runs asynchronously (timers, unmount, etc.). The `doSave` function has `[]` deps and reads everything through refs.
- **Canonical diff computation** — All diff operations (hunk computation, hunk indices, resolved text) must go through `components/editor/diffUtils.ts`. Do NOT create `new DiffMatchPatch()` instances in consumer components.
- **EditorContext for shared editor state** — `EditorContext` provides `selectedLanguageId`, `currentUserId`, `trackingEnabled`, `displayMode`, `sourceFont`, `hasPermission`, `highlightedCommentId`, and `userMap` (string user ID → display name) to all editor sub-components. Consume via `useEditorContext()` instead of prop-drilling these values.
- **SegmentRow is React.memo** — `SegmentRow` is wrapped in `React.memo`. All callbacks passed to it from `TranslationEditor` must be wrapped in `useCallback` with correct dependency arrays. Inline arrow functions in props defeat memoization.
- **Async SQLAlchemy lazy-load** — Relationships on async models can't be lazy-loaded. Always use `selectinload()` when querying models with relationships you need to access (e.g., `SegmentComment.replies`).

## Deployment

- **Backend**: Railway (Docker, auto-deploy from git push)
- **Frontend**: Vercel (auto-deploy, API calls proxied via `vercel.json` rewrites to Railway URL)
- **Database**: Railway-managed PostgreSQL
- Production backend URL: `https://translation-production-c3ad.up.railway.app`

## Security

- JWT authentication (24h expiry, HS256)
- Three roles: `admin`, `translator`, `reviewer`
- CORS configured for localhost dev + Vercel preview domains
- API keys stored in DB settings table (not in environment on deployment platform)

## Frontend Design Guidelines

Avoid generic "AI slop" aesthetics. Make creative, distinctive frontends that surprise and delight.

- **Typography**: Choose beautiful, unique fonts. Avoid generic families (Inter, Roboto, Arial, system fonts). Pick distinctive choices that elevate the design.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (`animation-delay`) creates more delight than scattered micro-interactions.
- **Backgrounds**: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.

**Avoid these cliches:**
- Overused font families (Inter, Roboto, Arial, Space Grotesk, system fonts)
- Purple gradients on white backgrounds
- Predictable layouts and cookie-cutter component patterns
- Designs that lack context-specific character

Interpret creatively. Vary between light and dark themes, different fonts, different aesthetics. Think outside the box — don't converge on common choices across generations.
