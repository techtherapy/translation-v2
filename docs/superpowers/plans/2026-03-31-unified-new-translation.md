# Unified "New Translation" Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-step source-book-then-translation flow with a single "New Translation" modal that creates source + translation + auto-translates in one action.

**Architecture:** New `NewTranslationModal.tsx` component replaces the existing inline modal in `BookLibrary.tsx`. The modal handles three source input methods (paste, upload, existing), language selection, and orchestrates the multi-step creation. BookLibrary.tsx is simplified — it opens the modal and receives a callback on completion.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, existing API clients (no backend changes)

**Spec:** `docs/superpowers/specs/2026-03-31-unified-new-translation-design.md`

---

## File Map

### New files
| File | Responsibility |
|------|----------------|
| `frontend/src/components/library/NewTranslationModal.tsx` | Unified modal: source input (paste/upload/existing), language pickers, creation + auto-translate orchestration |

### Modified files
| File | Changes |
|------|---------|
| `frontend/src/components/library/BookLibrary.tsx` | Remove inline New Translation modal, replace with `<NewTranslationModal>` component. Keep translations tab, sources tab, and create-source modal unchanged. |
| `frontend/src/data/releaseNotes.ts` | Add release notes entry |
| `frontend/package.json` | Version bump |

---

## Task 1: Create NewTranslationModal component — shell + source tabs

**Files:**
- Create: `frontend/src/components/library/NewTranslationModal.tsx`

- [ ] **Step 1: Create the modal component with source input tabs**

Create `frontend/src/components/library/NewTranslationModal.tsx`:

```tsx
import React, { useState, useEffect, useRef } from 'react'
import { Upload, ClipboardPaste, BookOpen, Search, X, Loader2 } from 'lucide-react'
import { createBook, importFile, importText, listBooks, listChapters } from '../../api/books'
import { createBookTranslation, listBTChapters } from '../../api/bookTranslations'
import { batchTranslate } from '../../api/translate'
import { listLanguages } from '../../api/languages'
import type { Book, Language } from '../../types'

type SourceMode = 'paste' | 'upload' | 'existing'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (btId: number, chapterId: number | null) => void
  languages: Language[]
  preselectedBookId?: number
}

export default function NewTranslationModal({ open, onClose, onCreated, languages, preselectedBookId }: Props) {
  // Source input
  const [sourceMode, setSourceMode] = useState<SourceMode>(preselectedBookId ? 'existing' : 'paste')
  const [pasteText, setPasteText] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [selectedBookId, setSelectedBookId] = useState<number | null>(preselectedBookId ?? null)
  const [allBooks, setAllBooks] = useState<Book[]>([])
  const [bookSearch, setBookSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Language selection
  const [targetLangId, setTargetLangId] = useState(() => {
    const stored = localStorage.getItem('last_target_language_id')
    return stored ? parseInt(stored) : ''
  })
  const [sourceLangId, setSourceLangId] = useState<string>('')  // '' = Chinese

  // State
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'input' | 'creating'>('input')

  // Load book list for "existing" tab
  useEffect(() => {
    if (open) {
      listBooks({ limit: 200 }).then(data => setAllBooks(data.books)).catch(() => {})
    }
  }, [open])

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSourceMode(preselectedBookId ? 'existing' : 'paste')
      setPasteText('')
      setUploadFile(null)
      setTitle('')
      setSelectedBookId(preselectedBookId ?? null)
      setBookSearch('')
      setError('')
      setStep('input')
      setCreating(false)
      setSourceLangId('')
      // Keep targetLangId from localStorage
    }
  }, [open, preselectedBookId])

  const enabledLangs = languages.filter(l => l.is_enabled && l.code !== 'zh')

  const canSubmit = (() => {
    if (!targetLangId) return false
    if (sourceMode === 'paste' && !pasteText.trim()) return false
    if (sourceMode === 'upload' && !uploadFile) return false
    if (sourceMode === 'existing' && !selectedBookId) return false
    return true
  })()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || creating) return
    setCreating(true)
    setError('')
    setStep('creating')

    try {
      let bookId: number

      if (sourceMode === 'paste') {
        // Create article + import text
        const derivedTitle = title.trim() || pasteText.trim().split('\n')[0].slice(0, 80) || 'Untitled'
        const book = await createBook({ content_type: 'article', title_source: derivedTitle })
        await importText(book.id, pasteText)
        bookId = book.id
      } else if (sourceMode === 'upload') {
        // Create book + import file
        const derivedTitle = title.trim() || uploadFile!.name.replace(/\.(txt|docx)$/i, '') || 'Untitled'
        const book = await createBook({ content_type: 'book', title_source: derivedTitle })
        await importFile(book.id, uploadFile!)
        bookId = book.id
      } else {
        bookId = selectedBookId!
      }

      // Create translation project
      const targetId = typeof targetLangId === 'string' ? parseInt(targetLangId) : targetLangId
      const bt = await createBookTranslation({
        book_id: bookId,
        source_language_id: sourceLangId ? parseInt(sourceLangId) : null,
        target_language_id: targetId,
      })

      // Save last-used language
      localStorage.setItem('last_target_language_id', String(targetId))

      // Check chapter count to decide auto-translate
      const chapters = await listBTChapters(bt.id)
      if (chapters.length === 1) {
        // Single chapter — auto-translate and go to editor
        batchTranslate({
          chapter_id: chapters[0].id,
          book_translation_id: bt.id,
        }).catch(err => console.warn('Auto-translate failed:', err))
        onCreated(bt.id, chapters[0].id)
      } else {
        // Multi-chapter — go to translation detail
        onCreated(bt.id, null)
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to create translation')
      setStep('input')
    } finally {
      setCreating(false)
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && /\.(txt|docx)$/i.test(file.name)) {
      setUploadFile(file)
    }
  }

  if (!open) return null

  const filteredBooks = allBooks.filter(b =>
    !bookSearch ||
    b.title_source.toLowerCase().includes(bookSearch.toLowerCase()) ||
    (b.book_number != null && String(b.book_number).includes(bookSearch))
  )

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <form
        onSubmit={handleSubmit}
        className="surface-glass shadow-surface-lg w-full max-w-lg max-h-[90vh] flex flex-col animate-fade-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-ink-850 dark:text-cream font-heading">New Translation</h2>
          <button type="button" onClick={onClose} className="text-parchment-400 hover:text-ink-700 dark:text-cream-muted dark:hover:text-cream">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 space-y-4">
          {/* Source mode tabs */}
          <div>
            <label className="label mb-1.5">What do you want to translate?</label>
            <div className="flex gap-1.5">
              {([
                { mode: 'paste' as const, icon: ClipboardPaste, label: 'Paste Text' },
                { mode: 'upload' as const, icon: Upload, label: 'Upload File' },
                { mode: 'existing' as const, icon: BookOpen, label: 'Existing Source' },
              ]).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSourceMode(mode)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-body font-medium rounded-md border transition-colors ${
                    sourceMode === mode
                      ? 'border-gold bg-gold/10 text-gold-dim dark:bg-gold-faint dark:text-gold-light'
                      : 'border-parchment-300 text-parchment-500 hover:bg-parchment-100 dark:border-ink-600 dark:text-cream-muted dark:hover:bg-ink-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Source: Paste */}
          {sourceMode === 'paste' && (
            <div className="space-y-3">
              <div>
                <label className="label">Title (optional)</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="input-field"
                  placeholder="Derived from first line if blank"
                />
              </div>
              <div>
                <label className="label">Source Text *</label>
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  className="input-field font-chinese text-sm"
                  rows={8}
                  placeholder="Paste the text you want to translate..."
                  required
                />
                {pasteText.trim() && (
                  <p className="text-xs text-parchment-400 dark:text-cream-muted/60 mt-1">
                    {pasteText.trim().length} characters
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Source: Upload */}
          {sourceMode === 'upload' && (
            <div className="space-y-3">
              <div>
                <label className="label">Title (optional)</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="input-field"
                  placeholder="Derived from filename if blank"
                />
              </div>
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  uploadFile
                    ? 'border-gold bg-gold/5'
                    : 'border-parchment-300 dark:border-ink-600 hover:border-gold/50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.docx"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) setUploadFile(file)
                  }}
                />
                {uploadFile ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gold-dim dark:text-gold-light font-body">
                    <Upload className="w-4 h-4" />
                    {uploadFile.name}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setUploadFile(null) }}
                      className="text-parchment-400 hover:text-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="text-sm text-parchment-400 dark:text-cream-muted font-body">
                    <Upload className="w-5 h-5 mx-auto mb-1.5" />
                    Drop a .txt or .docx file here, or click to browse
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Source: Existing */}
          {sourceMode === 'existing' && (
            <div>
              <label className="label mb-1.5">Select a source text *</label>
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-parchment-400 dark:text-ink-400" />
                <input
                  type="text"
                  placeholder="Filter by title or number..."
                  value={bookSearch}
                  onChange={e => setBookSearch(e.target.value)}
                  className="input-field pl-8 py-1.5 text-sm"
                />
              </div>
              <div className="max-h-48 overflow-y-auto border border-parchment-200 dark:border-ink-600 rounded-md">
                {filteredBooks.length === 0 && (
                  <p className="text-sm text-parchment-400 dark:text-cream-muted p-3">No source texts found.</p>
                )}
                {filteredBooks.map(b => (
                  <label
                    key={b.id}
                    className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-parchment-100 dark:hover:bg-ink-700/50 transition-colors ${
                      selectedBookId === b.id ? 'bg-gold/5 dark:bg-gold-faint/10' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="existingBook"
                      checked={selectedBookId === b.id}
                      onChange={() => setSelectedBookId(b.id)}
                      className="rounded-full border-parchment-300 dark:border-ink-500 text-gold focus:ring-gold shrink-0"
                    />
                    <span className="text-sm text-ink-850 dark:text-cream font-body truncate">
                      {b.book_number != null && (
                        <span className="text-xs text-parchment-400 dark:text-cream-muted/60 tabular-nums mr-1.5">
                          #{String(b.book_number).padStart(3, '0')}
                        </span>
                      )}
                      {b.title_source}
                    </span>
                    {b.content_type === 'article' && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-status-purple-bg dark:text-status-purple shrink-0">
                        Art
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Language row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Source</label>
              <select
                value={sourceLangId}
                onChange={e => setSourceLangId(e.target.value)}
                className="select-field"
              >
                <option value="">Chinese</option>
                {enabledLangs.filter(l => String(l.id) !== String(targetLangId)).map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Translate to *</label>
              <select
                value={targetLangId}
                onChange={e => setTargetLangId(e.target.value)}
                className="select-field"
                required
              >
                <option value="">Select language...</option>
                {enabledLangs.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-status-error">{error}</p>
          )}
        </div>

        {/* Sticky footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-parchment-200 dark:border-ink-600/30 mt-2">
          <button type="button" onClick={onClose} className="btn-ghost" disabled={creating}>
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit || creating} className="btn-primary">
            {creating ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
            ) : (
              'Translate'
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/library/NewTranslationModal.tsx
git commit -m "feat: add NewTranslationModal component with paste/upload/existing source tabs"
```

---

## Task 2: Integrate NewTranslationModal into BookLibrary

**Files:**
- Modify: `frontend/src/components/library/BookLibrary.tsx`

- [ ] **Step 1: Import the new modal**

Add import at the top of `BookLibrary.tsx`, after the existing imports:

```typescript
import NewTranslationModal from './NewTranslationModal'
```

- [ ] **Step 2: Replace the old New Translation modal with the new component**

Find the old New Translation modal (the `{showNewTranslation && (` block, lines ~706-801) and replace the entire block with:

```tsx
      <NewTranslationModal
        open={showNewTranslation}
        onClose={() => setShowNewTranslation(false)}
        languages={languages}
        preselectedBookId={selectedBookIds.size === 1 ? [...selectedBookIds][0] : undefined}
        onCreated={(btId, chapterId) => {
          setShowNewTranslation(false)
          if (chapterId) {
            navigate(`/translations/${btId}/chapters/${chapterId}`)
          } else {
            navigate(`/translations/${btId}`)
          }
        }}
      />
```

- [ ] **Step 3: Remove unused state variables**

Remove these state variables that were only used by the old inline modal (they are now managed inside `NewTranslationModal`):

- `selectedBookIds` and `setSelectedBookIds`
- `newTranslationSourceLang` and `setNewTranslationSourceLang`
- `newTranslationTargetLang` and `setNewTranslationTargetLang`
- `newTranslationError` and `setNewTranslationError`
- `newTranslationCreating` and `setNewTranslationCreating`
- `modalBookSearch` and `setModalBookSearch`

Also remove the functions that are now inside the modal:
- `toggleBookSelection`
- `handleCreateTranslation`

Keep `openNewTranslationModal` but simplify it — it no longer needs to load books:

```typescript
  function openNewTranslationModal(preselectedBookId?: number) {
    setSelectedBookIds(preselectedBookId ? new Set([preselectedBookId]) : new Set())
    setShowNewTranslation(true)
  }
```

Actually, since `selectedBookIds` is removed, simplify further. The preselected book ID can be passed via a new state:

```typescript
  const [preselectedBookId, setPreselectedBookId] = useState<number | undefined>()

  function openNewTranslationModal(bookId?: number) {
    setPreselectedBookId(bookId)
    setShowNewTranslation(true)
  }
```

Update the `<NewTranslationModal>` to use `preselectedBookId={preselectedBookId}`.

- [ ] **Step 4: Update the "+" button on source book cards**

Find where source book cards have a "+" button that calls `openNewTranslationModal(b.id)` — this should still work with the simplified function. Verify the call site passes the book ID correctly.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/library/BookLibrary.tsx
git commit -m "feat: replace inline new-translation modal with NewTranslationModal component"
```

---

## Task 3: Build verification + release notes

**Files:**
- Modify: `frontend/src/data/releaseNotes.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Run full build**

Run: `cd frontend && npm run build`

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Add release notes**

In `frontend/src/data/releaseNotes.ts`, add a new entry at the top of the array. Check the current version first and bump it.

The entry should describe:
- Unified "New Translation" — paste text, upload a file, or pick an existing source in one step
- Auto-translate for articles — single-chapter content is translated automatically
- Remembers your last-used language

- [ ] **Step 3: Bump version in package.json**

Bump the patch or minor version as appropriate.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/data/releaseNotes.ts frontend/package.json
git commit -m "chore: bump version, add release notes for unified new translation flow"
```
