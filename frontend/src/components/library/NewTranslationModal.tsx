import React, { useState, useEffect, useRef } from 'react'
import { Upload, ClipboardPaste, BookOpen, FileText, Search, X, Loader2, ChevronDown } from 'lucide-react'
import { createBook, importFile, importText, listBooks, listChapters, getBookProgress } from '../../api/books'
import { createBookTranslation, listBTChapters } from '../../api/bookTranslations'
import type { Book, Language, LanguageProgress } from '../../types'
import BulkImportModal from './BulkImportModal'

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
  const [uploadContentType, setUploadContentType] = useState<'book' | 'article'>('book')
  const [granularity, setGranularity] = useState<'sentence' | 'paragraph' | 'chapter'>('paragraph')
  const [title, setTitle] = useState('')
  const [bookNumber, setBookNumber] = useState('')
  const [yearPublished, setYearPublished] = useState('')
  const [category, setCategory] = useState('')
  const [eraTag, setEraTag] = useState('')
  const [showDetails, setShowDetails] = useState(false)
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
  const [pivotLanguages, setPivotLanguages] = useState<LanguageProgress[]>([])

  // Bulk import sub-modal
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [bulkFiles, setBulkFiles] = useState<File[]>([])

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

  // Load pivot languages when a book is selected
  useEffect(() => {
    if (selectedBookId && sourceMode === 'existing') {
      getBookProgress(selectedBookId).then(progress => {
        setPivotLanguages(progress.languages.filter(l => l.total_translated > 0))
      }).catch(() => setPivotLanguages([]))
    } else {
      setPivotLanguages([])
    }
  }, [selectedBookId, sourceMode])

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSourceMode(preselectedBookId ? 'existing' : 'paste')
      setPasteText('')
      setUploadFile(null)
      setUploadContentType('book')
      setGranularity('paragraph')
      setTitle('')
      setBookNumber('')
      setYearPublished('')
      setCategory('')
      setEraTag('')
      setShowDetails(false)
      setSelectedBookId(preselectedBookId ?? null)
      setBookSearch('')
      setError('')
      setStep('input')
      setCreating(false)
      setSourceLangId('')
      // Keep targetLangId from localStorage
    }
  }, [open, preselectedBookId])

  const enabledLangs = languages.filter(l => l.is_enabled)

  const canSubmit = (() => {
    if (!targetLangId) return false
    if (sourceMode === 'paste' && !pasteText.trim()) return false
    if (sourceMode === 'paste' && !sourceLangId) return false
    if (sourceMode === 'upload' && !uploadFile) return false
    if (sourceMode === 'upload' && !sourceLangId) return false
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

      const metadata = {
        ...(bookNumber ? { book_number: parseInt(bookNumber) } : {}),
        ...(yearPublished ? { year_published: parseInt(yearPublished) } : {}),
        ...(category ? { category } : {}),
        ...(eraTag ? { era_tag: eraTag } : {}),
      }

      const bookSourceLangId = sourceLangId && sourceMode !== 'existing' ? parseInt(sourceLangId) : null

      if (sourceMode === 'paste') {
        // Create article + import text
        const derivedTitle = title.trim() || pasteText.trim().split('\n')[0].slice(0, 80) || 'Untitled'
        const book = await createBook({ content_type: 'article', title_source: derivedTitle, source_language_id: bookSourceLangId, ...metadata })
        await importText(book.id, pasteText, granularity)
        bookId = book.id
      } else if (sourceMode === 'upload') {
        // Create book/article + import file
        const derivedTitle = title.trim() || uploadFile!.name.replace(/\.(txt|docx)$/i, '') || 'Untitled'
        const book = await createBook({ content_type: uploadContentType, title_source: derivedTitle, source_language_id: bookSourceLangId, ...metadata })
        await importFile(book.id, uploadFile!, granularity)
        bookId = book.id
      } else {
        bookId = selectedBookId!
      }

      // Create translation project
      // For paste/upload: source language is on the Book itself, BT source_language_id is only for pivot
      const targetId = typeof targetLangId === 'string' ? parseInt(targetLangId) : targetLangId
      const btSourceLangId = sourceMode === 'existing' && sourceLangId ? parseInt(sourceLangId) : null
      const bt = await createBookTranslation({
        book_id: bookId,
        source_language_id: btSourceLangId,
        target_language_id: targetId,
      })

      // Save last-used language
      localStorage.setItem('last_target_language_id', String(targetId))

      // For articles / single-chapter content, go straight to editor
      // For multi-chapter books, go to translation detail
      const isArticle = sourceMode === 'paste' || (sourceMode === 'upload' && uploadContentType === 'article')
      if (isArticle) {
        // Articles always have one chapter — fetch it and go to editor
        try {
          const chapters = await listChapters(bookId)
          onCreated(bt.id, chapters.length > 0 ? chapters[0].id : null)
        } catch {
          onCreated(bt.id, null)
        }
      } else if (sourceMode === 'existing') {
        // Check chapter count for existing books
        try {
          const chapters = await listBTChapters(bt.id)
          onCreated(bt.id, chapters.length === 1 ? chapters[0].id : null)
        } catch {
          onCreated(bt.id, null)
        }
      } else {
        // Uploaded book — go to translation detail to pick chapters
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
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(txt|docx|zip)$/i.test(f.name))
    if (files.length > 1) {
      setBulkFiles(files)
      setShowBulkImport(true)
    } else if (files.length === 1) {
      setUploadFile(files[0])
      if (!title) setTitle(files[0].name.replace(/\.(txt|docx)$/i, ''))
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
                { mode: 'upload' as const, icon: Upload, label: 'Upload File(s)' },
                { mode: 'existing' as const, icon: BookOpen, label: 'Existing Source' },
              ]).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { setSourceMode(mode); setSourceLangId('') }}
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
                  className="input-field text-sm"
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
              {/* File dropzone — always shown first */}
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => !uploadFile && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  uploadFile
                    ? 'border-gold bg-gold/5'
                    : 'border-parchment-300 dark:border-ink-600 hover:border-gold/50 cursor-pointer'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.docx,.zip"
                  multiple
                  className="hidden"
                  onChange={e => {
                    const files = Array.from(e.target.files || [])
                    if (files.length > 1) {
                      setBulkFiles(files)
                      setShowBulkImport(true)
                    } else if (files.length === 1) {
                      setUploadFile(files[0])
                      // Pre-fill title from filename
                      if (!title) setTitle(files[0].name.replace(/\.(txt|docx)$/i, ''))
                    }
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                />
                {uploadFile ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gold-dim dark:text-gold-light font-body">
                    <Upload className="w-4 h-4" />
                    {uploadFile.name}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setUploadFile(null); setTitle('') }}
                      className="text-parchment-400 hover:text-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="text-sm text-parchment-400 dark:text-cream-muted font-body">
                    <Upload className="w-5 h-5 mx-auto mb-1.5" />
                    Drop file(s) here, or click to browse
                    <p className="text-xs text-parchment-400 dark:text-cream-muted/50 mt-1">.txt, .docx, or .zip — multiple files opens bulk import</p>
                  </div>
                )}
              </div>

              {/* After file selected: editable title + options */}
              {uploadFile && (
                <>
                  <div>
                    <label className="label">Title</label>
                    <input
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      className="input-field"
                    />
                  </div>
                  {/* Book vs Article toggle */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setUploadContentType('book')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md border transition-colors ${
                        uploadContentType === 'book'
                          ? 'border-gold bg-gold/10 text-gold-dim dark:bg-gold-faint dark:text-gold-light'
                          : 'border-parchment-300 text-parchment-500 hover:bg-parchment-100 dark:border-ink-600 dark:text-cream-muted dark:hover:bg-ink-700'
                      }`}
                    >
                      <BookOpen className="w-4 h-4" />
                      Book
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadContentType('article')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md border transition-colors ${
                        uploadContentType === 'article'
                          ? 'border-gold bg-gold/10 text-gold-dim dark:bg-gold-faint dark:text-gold-light'
                          : 'border-parchment-300 text-parchment-500 hover:bg-parchment-100 dark:border-ink-600 dark:text-cream-muted dark:hover:bg-ink-700'
                      }`}
                    >
                      <FileText className="w-4 h-4" />
                      Article
                    </button>
                  </div>
                  {/* Collapsible metadata — only for books */}
                  {uploadContentType === 'book' && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowDetails(!showDetails)}
                        className="flex items-center gap-1 text-xs text-parchment-500 dark:text-cream-muted hover:text-gold dark:hover:text-gold-light font-body transition-colors"
                      >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDetails ? '' : '-rotate-90'}`} />
                        Details (optional)
                      </button>
                      {showDetails && (
                        <div className="mt-2 space-y-2 pl-1 border-l-2 border-parchment-200 dark:border-ink-600/30 ml-1">
                          <div className="grid grid-cols-2 gap-2 pl-3">
                            <div>
                              <label className="label text-[11px]">Book Number</label>
                              <input type="number" value={bookNumber} onChange={e => setBookNumber(e.target.value)} className="input-field py-1 text-sm" placeholder="e.g. 1" />
                            </div>
                            <div>
                              <label className="label text-[11px]">Year Published</label>
                              <input type="number" value={yearPublished} onChange={e => setYearPublished(e.target.value)} className="input-field py-1 text-sm" />
                            </div>
                          </div>
                          <div className="pl-3">
                            <label className="label text-[11px]">Category</label>
                            <input type="text" value={category} onChange={e => setCategory(e.target.value)} className="input-field py-1 text-sm" placeholder="e.g. Dharma talks, Poetry" />
                          </div>
                          <div className="pl-3">
                            <label className="label text-[11px]">Era</label>
                            <select value={eraTag} onChange={e => setEraTag(e.target.value)} className="select-field py-1 text-sm">
                              <option value="">—</option>
                              <option value="early">Early</option>
                              <option value="middle">Middle</option>
                              <option value="recent">Recent</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
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
          <div className="grid gap-3 grid-cols-2">
            {sourceMode === 'existing' ? (
            <div>
              <label className="label">Source</label>
              <select
                value={sourceLangId}
                onChange={e => setSourceLangId(e.target.value)}
                className="select-field"
              >
                <option value="">Original language</option>
                {pivotLanguages.length > 0
                  ? pivotLanguages.map(l => (
                        <option key={l.language_id} value={l.language_id}>
                          {l.language_name} (pivot — {l.percent_complete}% translated)
                        </option>
                      ))
                  : enabledLangs.map(l => (
                      <option key={l.id} value={l.id}>{l.name} (pivot)</option>
                    ))
                }
              </select>
              {sourceLangId && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-body">
                  Pivot — will translate from the existing {
                    pivotLanguages.find(l => String(l.language_id) === sourceLangId)?.language_name ||
                    enabledLangs.find(l => String(l.id) === sourceLangId)?.name
                  } translation
                </p>
              )}
            </div>
            ) : (
            <div>
              <label className="label">Source language *</label>
              <select
                value={sourceLangId}
                onChange={e => setSourceLangId(e.target.value)}
                className="select-field"
                required
              >
                <option value="">Select language...</option>
                {enabledLangs.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            )}
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

          {/* Granularity */}
          {sourceMode !== 'existing' && (
            <div>
              <label className="label mb-1.5">Segment Granularity</label>
              <div className="flex gap-2">
                {[
                  { value: 'sentence' as const, label: 'Sentence', desc: 'Split on punctuation' },
                  { value: 'paragraph' as const, label: 'Paragraph', desc: 'One segment per paragraph' },
                  { value: 'chapter' as const, label: sourceMode === 'paste' || uploadContentType === 'article' ? 'Full text' : 'Full chapter', desc: 'All in one segment' },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex-1 cursor-pointer rounded-lg border p-2 transition-colors ${
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
                    <div className="text-xs font-medium text-ink-850 dark:text-cream font-body">{opt.label}</div>
                    <div className="text-[10px] text-parchment-400 dark:text-cream-muted font-body mt-0.5">{opt.desc}</div>
                  </label>
                ))}
              </div>
            </div>
          )}

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
              'Create'
            )}
          </button>
        </div>
      </form>

      {/* Bulk Import sub-modal */}
      {showBulkImport && (
        <BulkImportModal
          initialFiles={bulkFiles}
          onClose={() => setShowBulkImport(false)}
          onDone={() => {
            setShowBulkImport(false)
            // Reload book list so newly imported books appear in "Existing Source" tab
            listBooks({ limit: 200 }).then(data => setAllBooks(data.books)).catch(() => {})
            // Switch to existing source tab so user can select the imported books
            setSourceMode('existing')
          }}
        />
      )}
    </div>
  )
}
