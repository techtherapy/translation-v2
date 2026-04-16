import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, X, ChevronUp, ChevronDown, ArrowRightLeft } from 'lucide-react'
import { Segment } from '../../types'
import { extractCleanText } from '../../utils/translationContent'

interface FindReplaceBarProps {
  segments: Segment[]
  onHighlightSegment: (segmentId: number) => void
  onReplace: (translationId: number, oldText: string, newText: string) => void
  onClose: () => void
  showReplace?: boolean
}

interface Match {
  segmentId: number
  field: 'source' | 'translation'
  index: number
  translationId?: number
}

type SearchIn = 'source' | 'translation' | 'both'

export default function FindReplaceBar({
  segments,
  onHighlightSegment,
  onReplace,
  onClose,
  showReplace = false,
}: FindReplaceBarProps) {
  const [query, setQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)
  const [searchIn, setSearchIn] = useState<SearchIn>('both')
  const [caseSensitive, setCaseSensitive] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus on mount
  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const matches = useMemo<Match[]>(() => {
    if (!query) return []

    const results: Match[] = []
    const q = caseSensitive ? query : query.toLowerCase()

    for (const segment of segments) {
      if (searchIn === 'source' || searchIn === 'both') {
        const text = caseSensitive ? segment.source_text : segment.source_text.toLowerCase()
        let pos = 0
        let idx = text.indexOf(q, pos)
        while (idx !== -1) {
          results.push({ segmentId: segment.id, field: 'source', index: idx })
          pos = idx + 1
          idx = text.indexOf(q, pos)
        }
      }

      if (searchIn === 'translation' || searchIn === 'both') {
        for (const translation of segment.translations) {
          const cleanTranslation = extractCleanText(translation)
          const text = caseSensitive
            ? cleanTranslation
            : cleanTranslation.toLowerCase()
          let pos = 0
          let idx = text.indexOf(q, pos)
          while (idx !== -1) {
            results.push({
              segmentId: segment.id,
              field: 'translation',
              index: idx,
              translationId: translation.id,
            })
            pos = idx + 1
            idx = text.indexOf(q, pos)
          }
        }
      }
    }

    return results
  }, [query, segments, searchIn, caseSensitive])

  // Reset current match when matches change
  useEffect(() => {
    setCurrentMatch(0)
  }, [matches])

  // Navigate to current match
  useEffect(() => {
    if (matches.length > 0 && matches[currentMatch]) {
      onHighlightSegment(matches[currentMatch].segmentId)
    }
  }, [currentMatch, matches, onHighlightSegment])

  const goToNext = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatch((prev) => (prev + 1) % matches.length)
  }, [matches.length])

  const goToPrev = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatch((prev) => (prev - 1 + matches.length) % matches.length)
  }, [matches.length])

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        goToPrev()
      } else {
        goToNext()
      }
      e.preventDefault()
    }
  }

  const handleReplace = () => {
    if (matches.length === 0 || !matches[currentMatch]) return
    const match = matches[currentMatch]
    if (match.field !== 'translation' || !match.translationId) return

    // Find the actual text occurrence at the match index
    const segment = segments.find((s) => s.id === match.segmentId)
    if (!segment) return
    const translation = segment.translations.find((t) => t.id === match.translationId)
    if (!translation) return

    const originalText = translation.translated_text
    const matchStart = match.index
    const matchEnd = matchStart + query.length
    const actualMatch = originalText.slice(matchStart, matchEnd)

    const newText =
      originalText.slice(0, matchStart) + replaceText + originalText.slice(matchEnd)
    onReplace(match.translationId, originalText, newText)

    // After replacing, navigate to next (or stay if no more)
    if (matches.length > 1) {
      goToNext()
    }
  }

  const handleReplaceAll = () => {
    if (matches.length === 0) return

    // Group translation matches by translationId to batch replacements
    const translationMatches = matches.filter(
      (m) => m.field === 'translation' && m.translationId
    )

    // Process each unique translation, replacing all occurrences
    const processed = new Set<number>()
    for (const match of translationMatches) {
      if (!match.translationId || processed.has(match.translationId)) continue
      processed.add(match.translationId)

      const segment = segments.find((s) => s.id === match.segmentId)
      if (!segment) continue
      const translation = segment.translations.find((t) => t.id === match.translationId)
      if (!translation) continue

      // Replace all occurrences in this translation
      let newText = translation.translated_text
      if (caseSensitive) {
        newText = newText.split(query).join(replaceText)
      } else {
        const regex = new RegExp(escapeRegex(query), 'gi')
        newText = newText.replace(regex, replaceText)
      }

      if (newText !== translation.translated_text) {
        onReplace(match.translationId, translation.translated_text, newText)
      }
    }
  }

  const searchInOptions: { value: SearchIn; label: string }[] = [
    { value: 'source', label: 'Source' },
    { value: 'translation', label: 'Translation' },
    { value: 'both', label: 'Both' },
  ]

  const currentMatchDisplay = matches.length > 0 ? currentMatch + 1 : 0

  return (
    <div className="flex flex-col gap-2 px-4 py-2.5 border-b border-parchment-300 dark:border-ink-600/50 bg-parchment-50 dark:bg-ink-900 font-body">
      {/* Find row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Search className="w-4 h-4 text-parchment-400 dark:text-cream-muted flex-shrink-0" />

        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Find..."
          className="flex-1 min-w-[180px] max-w-xs px-2.5 py-1.5 text-sm rounded border border-parchment-300 dark:border-ink-600/50 bg-white dark:bg-ink-800 text-ink-850 dark:text-cream placeholder:text-parchment-400 dark:placeholder:text-cream-muted focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold"
        />

        {/* Match count */}
        <span className="text-xs text-parchment-400 dark:text-cream-muted whitespace-nowrap min-w-[80px]">
          {query
            ? `${currentMatchDisplay} of ${matches.length} match${matches.length !== 1 ? 'es' : ''}`
            : 'No query'}
        </span>

        {/* Navigate matches */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={goToPrev}
            disabled={matches.length === 0}
            className="p-1 rounded hover:bg-parchment-200 dark:hover:bg-ink-700 text-ink-850 dark:text-cream disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={goToNext}
            disabled={matches.length === 0}
            className="p-1 rounded hover:bg-parchment-200 dark:hover:bg-ink-700 text-ink-850 dark:text-cream disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next match (Enter)"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-parchment-300 dark:bg-ink-600/50" />

        {/* Search in toggle */}
        <div className="flex items-center gap-0.5 rounded border border-parchment-300 dark:border-ink-600/50 overflow-hidden">
          {searchInOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSearchIn(opt.value)}
              className={`px-2 py-1 text-xs transition-colors ${
                searchIn === opt.value
                  ? 'bg-gold text-ink-850 font-semibold'
                  : 'bg-white dark:bg-ink-800 text-ink-850 dark:text-cream hover:bg-parchment-100 dark:hover:bg-ink-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Case sensitive toggle */}
        <button
          onClick={() => setCaseSensitive(!caseSensitive)}
          className={`px-2 py-1 text-xs rounded border transition-colors ${
            caseSensitive
              ? 'border-gold bg-gold/20 text-gold font-semibold'
              : 'border-parchment-300 dark:border-ink-600/50 text-parchment-400 dark:text-cream-muted hover:bg-parchment-100 dark:hover:bg-ink-700'
          }`}
          title="Case sensitive"
        >
          Aa
        </button>

        {/* Close button */}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-parchment-200 dark:hover:bg-ink-700 text-parchment-400 dark:text-cream-muted ml-auto"
          title="Close (Escape)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="flex items-center gap-2 pl-6">
          <ArrowRightLeft className="w-4 h-4 text-parchment-400 dark:text-cream-muted flex-shrink-0" />

          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="Replace with..."
            className="flex-1 min-w-[180px] max-w-xs px-2.5 py-1.5 text-sm rounded border border-parchment-300 dark:border-ink-600/50 bg-white dark:bg-ink-800 text-ink-850 dark:text-cream placeholder:text-parchment-400 dark:placeholder:text-cream-muted focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold"
          />

          <button
            onClick={handleReplace}
            disabled={
              matches.length === 0 ||
              !matches[currentMatch] ||
              matches[currentMatch].field !== 'translation'
            }
            className="px-3 py-1.5 text-xs font-semibold rounded border border-gold bg-gold/10 text-gold hover:bg-gold/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Replace current match (translation only)"
          >
            Replace
          </button>

          <button
            onClick={handleReplaceAll}
            disabled={
              matches.length === 0 ||
              !matches.some((m) => m.field === 'translation')
            }
            className="px-3 py-1.5 text-xs font-semibold rounded border border-gold bg-gold/10 text-gold hover:bg-gold/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Replace all matches in translations"
          >
            Replace All
          </button>

          <span className="text-xs text-parchment-400 dark:text-cream-muted italic">
            Replaces translation text only
          </span>
        </div>
      )}
    </div>
  )
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
