import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getBookProgress, getPivotReadiness } from '../../api/books'
import { listLanguages } from '../../api/languages'
import type { BookProgress as BookProgressType, LanguageProgress, PivotReadiness, Language, Chapter } from '../../types'

const STATUS_COLORS: Record<string, string> = {
  approved: 'bg-green-500',
  under_review: 'bg-blue-500',
  draft: 'bg-amber-500',
  machine_translated: 'bg-purple-500',
  needs_revision: 'bg-red-500',
  empty: 'bg-parchment-200 dark:bg-ink-600',
}

const STATUS_LABELS: Record<string, string> = {
  approved: 'Approved',
  under_review: 'Review',
  draft: 'Draft',
  machine_translated: 'MT',
  needs_revision: 'Revision',
  empty: 'Empty',
}

interface Props {
  bookId: number
  chapters: Chapter[]
}

export default function BookProgress({ bookId, chapters }: Props) {
  const navigate = useNavigate()
  const [progress, setProgress] = useState<BookProgressType | null>(null)
  const [languages, setLanguages] = useState<Language[]>([])
  const [pivotReadiness, setPivotReadiness] = useState<Map<number, PivotReadiness>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadProgress()
  }, [bookId])

  async function loadProgress() {
    setLoading(true)
    try {
      const [prog, langs] = await Promise.all([
        getBookProgress(bookId),
        listLanguages(),
      ])
      setProgress(prog)
      setLanguages(langs)

      // Load pivot readiness for languages with reference_language_id
      const readinessMap = new Map<number, PivotReadiness>()
      const langsWithRef = langs.filter((l) => l.reference_language_id)
      await Promise.all(
        langsWithRef.map(async (l) => {
          try {
            const readiness = await getPivotReadiness(bookId, l.reference_language_id!)
            readinessMap.set(l.id, readiness)
          } catch {
            // ignore
          }
        }),
      )
      setPivotReadiness(readinessMap)
    } catch (err) {
      console.error('Failed to load progress:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading || !progress) return null
  if (progress.languages.length === 0) return null

  const statusOrder = ['approved', 'under_review', 'draft', 'machine_translated', 'needs_revision']

  function handleLanguageClick(langId: number) {
    // Navigate to first chapter's editor with this language pre-selected
    if (chapters.length > 0) {
      navigate(`/books/${bookId}/chapters/${chapters[0].id}`)
    }
  }

  return (
    <div className="surface p-4 mb-6">
      <h3 className="text-sm font-semibold text-ink-850 dark:text-cream font-heading mb-3">
        Translation Progress
      </h3>
      <div className="space-y-3">
        {progress.languages.map((lang) => {
          const langInfo = languages.find((l) => l.id === lang.language_id)
          const readiness = pivotReadiness.get(lang.language_id)
          const refLang = langInfo?.reference_language_id
            ? languages.find((l) => l.id === langInfo.reference_language_id)
            : null

          return (
            <div
              key={lang.language_id}
              className="group cursor-pointer"
              onClick={() => handleLanguageClick(lang.language_id)}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink-850 dark:text-cream font-body group-hover:text-gold transition-colors">
                    {lang.language_name}
                  </span>
                  <span className="text-[10px] text-parchment-400 dark:text-cream-muted/60 font-body uppercase">
                    {lang.language_code}
                  </span>
                  {readiness && refLang && (
                    <span className={`text-[10px] font-body font-medium px-1.5 py-0.5 rounded ${
                      readiness.percent_ready >= 100
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>
                      {refLang.name}: {readiness.approved_in_source}/{readiness.total_segments} approved
                    </span>
                  )}
                </div>
                <span className="text-xs text-parchment-400 dark:text-cream-muted/60 font-body tabular-nums">
                  {lang.percent_complete}%
                </span>
              </div>

              {/* Stacked progress bar */}
              <div className="flex h-2 rounded-full overflow-hidden bg-parchment-200 dark:bg-ink-700">
                {statusOrder.map((status) => {
                  const count = lang.counts[status] || 0
                  if (count === 0) return null
                  const pct = (count / progress.total_segments) * 100
                  return (
                    <div
                      key={status}
                      className={`${STATUS_COLORS[status]} transition-all duration-300`}
                      style={{ width: `${pct}%` }}
                      title={`${STATUS_LABELS[status]}: ${count}`}
                    />
                  )
                })}
              </div>

              {/* Status breakdown */}
              <div className="flex items-center gap-3 mt-1">
                {statusOrder.map((status) => {
                  const count = lang.counts[status] || 0
                  if (count === 0) return null
                  return (
                    <span key={status} className="flex items-center gap-1 text-[10px] text-parchment-400 dark:text-cream-muted/60 font-body">
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[status]}`} />
                      {STATUS_LABELS[status]} {count}
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
