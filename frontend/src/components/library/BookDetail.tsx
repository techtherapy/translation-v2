import React, { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Upload, BookOpen, FileText, ChevronRight, ArrowRight } from 'lucide-react'
import { getBook, listChapters, importFile } from '../../api/books'
import { listBookTranslations } from '../../api/bookTranslations'
import { useAuth } from '../../stores/AuthContext'
import type { Book, BookTranslation, Chapter } from '../../types'

export default function BookDetail() {
  const { bookId } = useParams<{ bookId: string }>()
  const { hasPermission } = useAuth()
  const [book, setBook] = useState<Book | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [instances, setInstances] = useState<BookTranslation[]>([])
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (bookId) loadData()
  }, [bookId])

  async function loadData() {
    setLoading(true)
    try {
      const [b, chs, inst] = await Promise.all([
        getBook(parseInt(bookId!)),
        listChapters(parseInt(bookId!)),
        listBookTranslations({ book_id: parseInt(bookId!) }).then(r => r.items).catch(() => []),
      ])
      setBook(b)
      setChapters(chs)
      setInstances(inst)
    } catch (err) {
      console.error('Failed to load book:', err)
    } finally {
      setLoading(false)
    }
  }


  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !bookId) return
    try {
      await importFile(parseInt(bookId), file)
      loadData()
    } catch (err) {
      console.error('Failed to import:', err)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (loading) return <div className="text-center py-12 text-parchment-400 dark:text-cream-muted">Loading...</div>
  if (!book) return <div className="text-center py-12 text-parchment-500 dark:text-cream-muted">Not found</div>

  const isArticle = book.content_type === 'article'

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link to="/books" className="flex items-center gap-1 text-sm text-parchment-500 dark:text-cream-muted hover:text-gold transition-colors duration-200 mb-4">
          <ArrowLeft className="w-4 h-4" />
          Back to Library
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              {book.book_number != null && (
                <span className="text-sm px-2 py-0.5 rounded font-bold font-body bg-gold/10 text-gold-dim dark:bg-gold-faint dark:text-gold-light tabular-nums">
                  #{String(book.book_number).padStart(3, '0')}
                </span>
              )}
              <h1 className="page-heading">{book.title_source}</h1>
            </div>
            {book.title_translated && (
              <p className="text-lg text-parchment-500 dark:text-cream-muted mt-1">{book.title_translated}</p>
            )}
            <div className="flex items-center gap-4 text-sm text-parchment-400 dark:text-cream-muted/60 mt-2">
              {book.year_published && <span>{book.year_published}</span>}
              {book.category && <span>{book.category}</span>}
              {!isArticle && book.era_tag && <span className="capitalize">{book.era_tag} era</span>}
            </div>
          </div>
          {hasPermission('books.import') && (
            <div>
              <input ref={fileInputRef} type="file" accept=".txt,.docx" className="hidden" onChange={handleImport} />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-primary"
              >
                <Upload className="w-4 h-4" />
                Import File
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className={`grid ${isArticle ? 'grid-cols-2' : 'grid-cols-3'} gap-4 mb-8`}>
        {!isArticle && (
          <div className="surface p-4 text-center">
            <div className="text-2xl font-bold text-ink-850 dark:text-cream font-heading">{book.chapter_count}</div>
            <div className="text-sm text-parchment-500 dark:text-cream-muted">Chapters</div>
          </div>
        )}
        <div className="surface p-4 text-center">
          <div className="text-2xl font-bold text-ink-850 dark:text-cream font-heading">{book.segment_count}</div>
          <div className="text-sm text-parchment-500 dark:text-cream-muted">Segments</div>
        </div>
        <div className="surface p-4 text-center">
          <div className="text-2xl font-bold text-gold capitalize">{book.status.replace('_', ' ')}</div>
          <div className="text-sm text-parchment-500 dark:text-cream-muted">Status</div>
        </div>
      </div>

      {/* Translation instances */}
      {instances.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-ink-850 dark:text-cream font-heading mb-3">Translations</h2>
          <div className="grid gap-2">
            {instances.map((inst) => {
              const sourceCode = inst.source_language_code?.toUpperCase() || '?'
              const targetCode = inst.target_language_code.toUpperCase()
              return (
                <Link
                  key={inst.id}
                  to={`/translations/${inst.id}`}
                  className="surface-interactive p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-parchment-200 dark:bg-ink-700 text-parchment-600 dark:text-cream-muted font-body">
                      {sourceCode}<ArrowRight className="w-3 h-3 inline mx-0.5" />{targetCode}
                    </span>
                    <span className="text-sm text-ink-850 dark:text-cream">{inst.target_language_name}</span>
                    <span className="text-xs text-parchment-400 dark:text-cream-muted/60 tabular-nums">{inst.percent_complete}%</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-parchment-300 dark:text-ink-400" />
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Chapters (books only) */}
      {!isArticle && (
        <>
          <h2 className="text-lg font-semibold text-ink-850 dark:text-cream font-heading mb-4">Chapters</h2>
          {chapters.length === 0 ? (
            <div className="text-center py-12 surface">
              <BookOpen className="w-12 h-12 mx-auto text-parchment-300 dark:text-ink-400 mb-3" />
              <p className="text-parchment-500 dark:text-cream-muted">No chapters yet. Import a file to get started.</p>
            </div>
          ) : (
            <div className="space-y-2 stagger-children">
              {chapters.map((ch) => (
                  <div
                    key={ch.id}
                    className="surface flex items-center justify-between p-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm text-segment-num text-parchment-400 dark:text-cream-muted/40 w-8 shrink-0">{ch.order}</span>
                      <span className="text-sm font-medium text-ink-850 dark:text-cream truncate">{ch.title}</span>
                    </div>
                    <span className="text-xs text-parchment-400 dark:text-cream-muted/60 tabular-nums shrink-0 ml-4">
                      {ch.segment_count} segments
                    </span>
                  </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Article empty state */}
      {isArticle && chapters.length === 0 && (
        <div className="text-center py-12 surface">
          <FileText className="w-12 h-12 mx-auto text-parchment-300 dark:text-ink-400 mb-3" />
          <p className="text-parchment-500 dark:text-cream-muted">Import your article file to begin translating.</p>
        </div>
      )}
    </div>
  )
}
