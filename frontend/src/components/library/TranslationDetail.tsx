import React, { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Pencil, Check, X } from 'lucide-react'
import { getBookTranslation, listBTChapters, updateBookTranslation } from '../../api/bookTranslations'
import { getDefaultChapter, updateBook } from '../../api/books'
import type { BookTranslation, Chapter } from '../../types'

function ChapterProgressBar({ chapter }: { chapter: Chapter }) {
  const counts = chapter.status_counts || {}
  const total = chapter.segment_count
  if (total === 0) return null
  const pct = (n: number) => `${(n / total) * 100}%`
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-parchment-200 dark:bg-ink-700">
        <div className="bg-green-500" style={{ width: pct(counts.approved || 0) }} />
        <div className="bg-blue-500" style={{ width: pct(counts.under_review || 0) }} />
        <div className="bg-amber-500" style={{ width: pct(counts.draft || 0) }} />
        <div className="bg-purple-500" style={{ width: pct(counts.machine_translated || 0) }} />
        <div className="bg-red-500" style={{ width: pct(counts.needs_revision || 0) }} />
      </div>
      <span className="text-[10px] text-parchment-400 dark:text-cream-muted font-body tabular-nums shrink-0">
        {chapter.translated_count}/{total}
      </span>
    </div>
  )
}

export default function TranslationDetail() {
  const { btId } = useParams<{ btId: string }>()
  const navigate = useNavigate()
  const [bt, setBt] = useState<BookTranslation | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  const [editingSourceTitle, setEditingSourceTitle] = useState<string | null>(null)

  useEffect(() => {
    if (btId) loadData()
  }, [btId])

  async function loadData() {
    setLoading(true)
    try {
      const [btData, chs] = await Promise.all([
        getBookTranslation(parseInt(btId!)),
        listBTChapters(parseInt(btId!)),
      ])
      setBt(btData)
      setChapters(chs)

      // For articles with segments, redirect straight to editor
      if (btData.content_type === 'article' && chs.length > 0 && chs[0].segment_count > 0) {
        navigate(`/translations/${btId}/chapters/${chs[0].id}`, { replace: true })
      }
    } catch (err) {
      console.error('Failed to load translation:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveSourceTitle(newTitle: string) {
    if (!bt || !newTitle.trim()) return
    try {
      await updateBook(bt.book_id, { title_source: newTitle.trim() })
      setBt({ ...bt, book_title_source: newTitle.trim() })
    } catch (err) {
      console.error('Failed to update title:', err)
    }
    setEditingSourceTitle(null)
  }

  if (loading) return <div className="text-center py-12 text-parchment-400 dark:text-cream-muted">Loading...</div>
  if (!bt) return <div className="text-center py-12 text-parchment-500 dark:text-cream-muted">Not found</div>

  const sourceLang = bt.source_language_name || 'Unknown'
  const sourceCode = bt.source_language_code?.toUpperCase() || '?'
  const targetCode = bt.target_language_code.toUpperCase()

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
            <div className="flex items-center gap-3 mb-1">
              {bt.book_number != null && (
                <span className="text-sm px-2 py-0.5 rounded font-bold font-body bg-gold/10 text-gold-dim dark:bg-gold-faint dark:text-gold-light tabular-nums">
                  #{String(bt.book_number).padStart(3, '0')}
                </span>
              )}
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-parchment-200 dark:bg-ink-700 text-parchment-600 dark:text-cream-muted font-body">
                {sourceCode}→{targetCode}
              </span>
              {editingSourceTitle !== null ? (
                <input
                  type="text"
                  value={editingSourceTitle}
                  onChange={(e) => setEditingSourceTitle(e.target.value)}
                  className="input-field py-1 text-lg font-semibold min-w-[200px]"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveSourceTitle(editingSourceTitle)
                    else if (e.key === 'Escape') setEditingSourceTitle(null)
                  }}
                  onBlur={() => handleSaveSourceTitle(editingSourceTitle)}
                />
              ) : (
                <h1 className="page-heading flex items-center gap-2">
                  {bt.book_title_source}
                  <button
                    onClick={() => setEditingSourceTitle(bt.book_title_source)}
                    className="text-parchment-300 dark:text-ink-400 hover:text-gold transition-colors"
                    title="Edit title"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </h1>
              )}
            </div>
            {/* Translated title — editable inline */}
            <div className="flex items-center gap-2 mb-2">
              {editingTitle !== null ? (
                <>
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    className="input-field py-1 text-sm flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        updateBookTranslation(bt.id, { translated_title: editingTitle }).then(setBt)
                        setEditingTitle(null)
                      } else if (e.key === 'Escape') {
                        setEditingTitle(null)
                      }
                    }}
                  />
                  <button
                    onClick={() => { updateBookTranslation(bt.id, { translated_title: editingTitle }).then(setBt); setEditingTitle(null) }}
                    className="p-1 text-jade hover:text-jade-light"
                  ><Check className="w-4 h-4" /></button>
                  <button onClick={() => setEditingTitle(null)} className="p-1 text-parchment-400 hover:text-status-error">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-parchment-500 dark:text-cream-muted">
                    {bt.translated_title || <span className="italic text-parchment-300 dark:text-ink-400">No translated title</span>}
                  </p>
                  <button
                    onClick={() => setEditingTitle(bt.translated_title || '')}
                    className="p-1 text-parchment-300 dark:text-ink-400 hover:text-gold"
                    title="Edit translated title"
                  ><Pencil className="w-3.5 h-3.5" /></button>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-parchment-400 dark:text-cream-muted/60">
              <span>{sourceLang} → {bt.target_language_name}</span>
              <span>{bt.total_segments} segments</span>
              <span>{bt.percent_complete}% translated</span>
            </div>
          </div>
        </div>
      </div>

      {/* Overall Progress */}
      <div className="surface p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-ink-850 dark:text-cream font-body">Overall Progress</span>
          <span className="text-sm text-parchment-500 dark:text-cream-muted font-body tabular-nums">
            {bt.translated_segments}/{bt.total_segments} ({bt.percent_complete}%)
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden bg-parchment-200 dark:bg-ink-700">
          <div
            className="h-full bg-gold transition-all duration-300"
            style={{ width: `${bt.percent_complete}%` }}
          />
        </div>
      </div>

      {/* Chapters */}
      <h2 className="text-sm font-semibold text-ink-850 dark:text-cream font-heading mb-3">
        Chapters ({chapters.length})
      </h2>
      <div className="grid gap-2 stagger-children">
        {chapters.map((ch) => (
          <Link
            key={ch.id}
            to={`/translations/${btId}/chapters/${ch.id}`}
            className="surface-interactive p-4 flex items-center"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs text-parchment-400 dark:text-cream-muted/60 font-body tabular-nums shrink-0">
                  Ch {ch.order}
                </span>
                <span className="text-sm font-medium text-ink-850 dark:text-cream truncate">
                  {ch.title || `Chapter ${ch.order}`}
                </span>
                <span className="text-xs text-parchment-400 dark:text-cream-muted/60 font-body shrink-0">
                  {ch.segment_count} seg
                </span>
              </div>
              <ChapterProgressBar chapter={ch} />
            </div>
            <ChevronRight className="w-4 h-4 text-parchment-300 dark:text-ink-400 ml-2 shrink-0" />
          </Link>
        ))}
        {chapters.length === 0 && (
          <div className="text-center py-8 text-parchment-400 dark:text-cream-muted text-sm">
            No chapters found. Import content from the source book first.
          </div>
        )}
      </div>

    </div>
  )
}
