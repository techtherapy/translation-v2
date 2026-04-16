import React, { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Upload, BookOpen, FileText, Trash2, Pencil, Check, X, Languages, ArrowRight } from 'lucide-react'
import { listBooks, updateBook, deleteBook, importFile, getDefaultChapter, getBookProgress } from '../../api/books'
import { listBookTranslations, deleteBookTranslation } from '../../api/bookTranslations'
import { listLanguages } from '../../api/languages'
import { useAuth } from '../../stores/AuthContext'
import { useConfirm } from '../../hooks/useConfirm'
import type { Book, BookTranslation, Language } from '../../types'
import { BOOK_STATUS_BADGES } from '../../utils/statusBadges'
import NewTranslationModal from './NewTranslationModal'

type Tab = 'translations' | 'sources'
type ContentFilter = 'all' | 'book' | 'article'

export default function BookLibrary() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>('translations')

  // --- Translation instances state ---
  const [instances, setInstances] = useState<BookTranslation[]>([])
  const [instTotal, setInstTotal] = useState(0)
  const [instSearch, setInstSearch] = useState('')
  const [instLangFilter, setInstLangFilter] = useState<number | ''>('')
  const [instSort, setInstSort] = useState<'newest' | 'oldest'>('newest')
  const [instLoading, setInstLoading] = useState(true)
  const [languages, setLanguages] = useState<Language[]>([])

  // --- Source books state ---
  const [books, setBooks] = useState<Book[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all')
  const [loading, setLoading] = useState(true)
  const [sortOrder, setSortOrder] = useState('created_desc')
  const [editingBookId, setEditingBookId] = useState<number | null>(null)
  const [editData, setEditData] = useState({ book_number: '', title_source: '', title_translated: '', status: '' })
  const [importBookId, setImportBookId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- Create modals ---
  const [showNewTranslation, setShowNewTranslation] = useState(false)
  const [preselectedBookId, setPreselectedBookId] = useState<number | undefined>()

  // Load languages and book list once on mount
  useEffect(() => {
    listLanguages().then(setLanguages).catch(console.error)
  }, [])

  // Load translation instances
  useEffect(() => {
    if (tab === 'translations') loadInstances()
  }, [tab, instSearch, instLangFilter, instSort])

  // Load source books
  useEffect(() => {
    if (tab === 'sources') loadBooks()
  }, [tab, search, contentFilter, sortOrder])

  async function loadInstances() {
    setInstLoading(true)
    try {
      const data = await listBookTranslations({
        search: instSearch || undefined,
        target_language_id: instLangFilter || undefined,
      })
      const sorted = [...data.items].sort((a, b) => {
        const da = new Date(a.created_at).getTime()
        const db = new Date(b.created_at).getTime()
        return instSort === 'newest' ? db - da : da - db
      })
      setInstances(sorted)
      setInstTotal(data.total)
    } catch (err) {
      console.error('Failed to load translation instances:', err)
    } finally {
      setInstLoading(false)
    }
  }

  async function loadBooks() {
    setLoading(true)
    try {
      const data = await listBooks({
        search,
        limit: 100,
        content_type: contentFilter === 'all' ? undefined : contentFilter,
        sort: sortOrder,
      })
      setBooks(data.books)
      setTotal(data.total)
    } catch (err) {
      console.error('Failed to load books:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteBook(book: Book) {
    const label = book.content_type === 'article' ? 'article' : 'book'
    // Check for existing translations
    let warning = `Delete this ${label} and all its segments? This cannot be undone.`
    try {
      const { items } = await listBookTranslations({ book_id: book.id })
      if (items.length > 0) {
        const langs = items.map(t => t.target_language_name).join(', ')
        warning = `This ${label} has ${items.length} translation${items.length > 1 ? 's' : ''} (${langs}) that will also be deleted. This cannot be undone.`
      }
    } catch {}
    if (!await confirm({ title: `Delete ${label}`, message: warning, confirmLabel: 'Delete', variant: 'danger' })) return
    try {
      await deleteBook(book.id)
      loadBooks()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  async function handleDeleteInstance(inst: BookTranslation) {
    if (!await confirm({ title: 'Remove translation', message: 'Remove this translation instance? The underlying source text will not be deleted.', confirmLabel: 'Remove', variant: 'warning' })) return
    try {
      await deleteBookTranslation(inst.id)
      loadInstances()
    } catch (err) {
      console.error('Failed to delete instance:', err)
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !importBookId) return
    try {
      await importFile(importBookId, file)
      setImportBookId(null)
      loadBooks()
    } catch (err) {
      console.error('Failed to import file:', err)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function openNewTranslationModal(bookId?: number) {
    setPreselectedBookId(bookId)
    setShowNewTranslation(true)
  }

  function startEditing(book: Book) {
    setEditingBookId(book.id)
    setEditData({
      book_number: book.book_number != null ? String(book.book_number) : '',
      title_source: book.title_source,
      title_translated: book.title_translated,
      status: book.status,
    })
  }

  async function handleSaveEdit(bookId: number) {
    try {
      await updateBook(bookId, {
        book_number: editData.book_number ? parseInt(editData.book_number) : null,
        title_source: editData.title_source,
        title_translated: editData.title_translated,
        status: editData.status,
      } as Partial<Book>)
      setEditingBookId(null)
      loadBooks()
    } catch (err) {
      console.error('Failed to update book:', err)
    }
  }

  // --- Render ---
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-heading">Library</h1>
          <p className="page-subheading">
            {tab === 'translations'
              ? `${instTotal} translation projects`
              : `${total} source ${contentFilter === 'article' ? 'articles' : contentFilter === 'book' ? 'books' : 'items'}`
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'translations' && (
            <button onClick={() => openNewTranslationModal()} className="btn-primary">
              <Plus className="w-4 h-4" />
              New Translation
            </button>
          )}
          {/* Sources tab has no creation buttons — use "New Translation" or bulk import via Upload File(s) tab */}
        </div>
      </div>

      {/* Tab toggle */}
      <div className="flex items-center gap-1 mb-5 border-b border-parchment-200 dark:border-ink-600/50">
        {([['translations', 'Translations'], ['sources', 'Source Texts']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium font-body transition-colors relative ${
              tab === key
                ? 'text-gold-dim dark:text-gold-light'
                : 'text-parchment-500 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream'
            }`}
          >
            {label}
            {tab === key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gold rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* === TRANSLATIONS TAB === */}
      {tab === 'translations' && (
        <>
          {/* Search + Language filter */}
          <div className="flex items-center gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-parchment-400 dark:text-ink-400" />
              <input
                type="text"
                placeholder="Search by title..."
                value={instSearch}
                onChange={(e) => setInstSearch(e.target.value)}
                className="input-field pl-10"
              />
            </div>
            <select
              value={instLangFilter}
              onChange={(e) => setInstLangFilter(e.target.value ? parseInt(e.target.value) : '')}
              className="select-field w-auto"
            >
              <option value="">All languages</option>
              {languages.filter(l => l.is_enabled).map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <select
              value={instSort}
              onChange={(e) => setInstSort(e.target.value as 'newest' | 'oldest')}
              className="select-field w-auto"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>

          {instLoading ? (
            <div className="text-center py-12 text-parchment-400 dark:text-cream-muted">Loading...</div>
          ) : instances.length === 0 ? (
            <div className="text-center py-12">
              <Languages className="w-12 h-12 mx-auto text-parchment-300 dark:text-ink-400 mb-3" />
              <p className="text-parchment-500 dark:text-cream-muted">
                No translation projects yet. Create one to get started.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 stagger-children">
              {instances.map((inst) => {
                const sourceCode = inst.source_language_code?.toUpperCase() || '?'
                const targetCode = inst.target_language_code.toUpperCase()
                return (
                  <div key={inst.id} className="surface-interactive p-4">
                    <div className="flex items-center justify-between">
                      <Link to={`/translations/${inst.id}`} className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          {inst.book_number != null && (
                            <span className="text-xs px-1.5 py-0.5 rounded font-bold font-body bg-gold/10 text-gold-dim dark:bg-gold-faint dark:text-gold-light tabular-nums shrink-0">
                              #{String(inst.book_number).padStart(3, '0')}
                            </span>
                          )}
                          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-parchment-200 dark:bg-ink-700 text-parchment-600 dark:text-cream-muted font-body shrink-0">
                            {sourceCode}<ArrowRight className="w-3 h-3 inline mx-0.5" />{targetCode}
                          </span>
                          <h3 className="text-sm font-semibold text-ink-850 dark:text-cream truncate">
                            {inst.book_title_source}
                          </h3>
                          {inst.content_type === 'article' ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-50 text-purple-700 dark:bg-status-purple-bg dark:text-status-purple shrink-0">
                              Article
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 shrink-0">
                              Book
                            </span>
                          )}
                        </div>
                        {inst.translated_title && inst.translated_title !== inst.book_title_source && (
                          <p className="text-xs text-parchment-500 dark:text-cream-muted mb-1.5 truncate">{inst.translated_title}</p>
                        )}
                        {/* Progress bar */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-parchment-200 dark:bg-ink-700">
                            <div
                              className="h-full bg-gold transition-all duration-300"
                              style={{ width: `${inst.percent_complete}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-parchment-400 dark:text-cream-muted font-body tabular-nums shrink-0">
                            {inst.percent_complete}%
                          </span>
                        </div>
                      </Link>
                      <div className="flex items-center gap-1 ml-3 shrink-0">
                        <button
                          onClick={() => handleDeleteInstance(inst)}
                          className="p-2 text-parchment-400 dark:text-ink-400 hover:text-status-error transition-colors duration-200"
                          title="Remove translation instance"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* === SOURCE BOOKS TAB === */}
      {tab === 'sources' && (
        <>
          {/* Filter tabs */}
          <div className="flex items-center gap-2 mb-4">
            {([['all', 'All'], ['book', 'Books'], ['article', 'Articles']] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setContentFilter(value as ContentFilter)}
                className={`px-3 py-1.5 text-sm rounded-md font-medium font-body transition-colors ${
                  contentFilter === value
                    ? 'bg-gold/10 text-gold-dim dark:bg-gold-faint dark:text-gold-light'
                    : 'text-parchment-500 dark:text-cream-muted hover:bg-parchment-200 dark:hover:bg-ink-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search + Sort */}
          <div className="flex items-center gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-parchment-400 dark:text-ink-400" />
              <input
                type="text"
                placeholder="Search by title..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-field pl-10"
              />
            </div>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="select-field w-auto"
            >
              <option value="created_desc">Newest first</option>
              <option value="book_number_asc">By book number</option>
              <option value="title_asc">By title A-Z</option>
            </select>
          </div>

          {/* Hidden file input for import */}
          <input ref={fileInputRef} type="file" accept=".txt,.docx" className="hidden" onChange={handleImport} />

          {loading ? (
            <div className="text-center py-12 text-parchment-400 dark:text-cream-muted">Loading...</div>
          ) : books.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="w-12 h-12 mx-auto text-parchment-300 dark:text-ink-400 mb-3" />
              <p className="text-parchment-500 dark:text-cream-muted">
                {contentFilter === 'article' ? 'No articles yet.' : contentFilter === 'book' ? 'No books yet.' : 'No items yet. Add a book or article to get started.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 stagger-children">
              {books.map((book) => {
                const isArticle = book.content_type === 'article'
                const isEditing = editingBookId === book.id

                if (isEditing) {
                  return (
                    <div key={book.id} className="surface p-5 ring-2 ring-gold/40">
                      <div className="space-y-3">
                        <div className="grid grid-cols-[80px_1fr_1fr] gap-3">
                          <div>
                            <label className="label">Book #</label>
                            <input
                              type="number"
                              value={editData.book_number}
                              onChange={(e) => setEditData({ ...editData, book_number: e.target.value })}
                              className="input-field tabular-nums"
                              placeholder="—"
                            />
                          </div>
                          <div>
                            <label className="label">Source Title</label>
                            <input
                              type="text"
                              value={editData.title_source}
                              onChange={(e) => setEditData({ ...editData, title_source: e.target.value })}
                              className="input-field"
                            />
                          </div>
                          <div>
                            <label className="label">Translated Title</label>
                            <input
                              type="text"
                              value={editData.title_translated}
                              onChange={(e) => setEditData({ ...editData, title_translated: e.target.value })}
                              className="input-field"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="w-48">
                            <label className="label">Status</label>
                            <select
                              value={editData.status}
                              onChange={(e) => setEditData({ ...editData, status: e.target.value })}
                              className="select-field"
                            >
                              <option value="not_started">Not Started</option>
                              <option value="in_progress">In Progress</option>
                              <option value="under_review">Under Review</option>
                              <option value="published">Published</option>
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setEditingBookId(null)} className="btn-ghost">
                              <X className="w-4 h-4" />
                              Cancel
                            </button>
                            <button onClick={() => handleSaveEdit(book.id)} className="btn-primary">
                              <Check className="w-4 h-4" />
                              Save
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }

                return (
                  <div key={book.id} className="surface-interactive p-5">
                    <div className="flex items-start justify-between">
                      <Link to={`/books/${book.id}`} className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          {book.book_number != null && (
                            <span className="text-xs px-1.5 py-0.5 rounded font-bold font-body bg-gold/10 text-gold-dim dark:bg-gold-faint dark:text-gold-light tabular-nums shrink-0">
                              #{String(book.book_number).padStart(3, '0')}
                            </span>
                          )}
                          <h3 className="text-base font-semibold text-ink-850 dark:text-cream truncate">{book.title_source}</h3>
                          {isArticle && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-50 text-purple-700 dark:bg-status-purple-bg dark:text-status-purple">
                              Article
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${BOOK_STATUS_BADGES[book.status]?.color}`}>
                            {BOOK_STATUS_BADGES[book.status]?.label}
                          </span>
                        </div>
                        {book.title_translated && (
                          <p className="text-sm text-parchment-500 dark:text-cream-muted mb-2">{book.title_translated}</p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-parchment-400 dark:text-cream-muted/60">
                          {book.year_published && <span>{book.year_published}</span>}
                          {book.category && <span>{book.category}</span>}
                          {!isArticle && book.era_tag && <span className="capitalize">{book.era_tag} era</span>}
                          {!isArticle && <span>{book.chapter_count} chapters</span>}
                          <span>{book.segment_count} segments</span>
                        </div>
                      </Link>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => openNewTranslationModal(book.id)}
                          className="p-2 text-parchment-400 dark:text-ink-400 hover:text-gold transition-colors duration-200"
                          title="New translation"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        {hasPermission('books.edit') && (
                          <button onClick={() => startEditing(book)} className="p-2 text-parchment-400 dark:text-ink-400 hover:text-gold transition-colors duration-200" title="Edit">
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission('books.import') && (
                          <button
                            onClick={() => { setImportBookId(book.id); fileInputRef.current?.click() }}
                            className="p-2 text-parchment-400 dark:text-ink-400 hover:text-gold transition-colors duration-200"
                            title="Import file"
                          >
                            <Upload className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission('books.delete') && (
                          <button
                            onClick={() => handleDeleteBook(book)}
                            className="p-2 text-parchment-400 dark:text-ink-400 hover:text-status-error transition-colors duration-200"
                            title={`Delete ${isArticle ? 'article' : 'book'}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* === Create Book Modal (same as before) === */}
      <NewTranslationModal
        open={showNewTranslation}
        onClose={() => setShowNewTranslation(false)}
        languages={languages}
        preselectedBookId={preselectedBookId}
        onCreated={(btId, chapterId) => {
          setShowNewTranslation(false)
          if (chapterId) {
            navigate(`/translations/${btId}/chapters/${chapterId}`)
          } else {
            navigate(`/translations/${btId}`)
          }
        }}
      />

    </div>
  )
}
