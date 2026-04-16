import React, { useMemo, useState } from 'react'
import type { DetectedTerm } from '../../api/glossary'

interface Props {
  text: string
  detectedTerms: DetectedTerm[]
  onTermClick?: (term: DetectedTerm) => void
  fontClass?: string
}

interface HighlightRange {
  start: number
  end: number
  term: DetectedTerm
}

/**
 * Renders source text with glossary terms highlighted.
 * Longest matches take priority when terms overlap.
 */
export default function HighlightedSourceText({ text, detectedTerms, onTermClick, fontClass = 'font-chinese' }: Props) {
  const [hoveredTerm, setHoveredTerm] = useState<DetectedTerm | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  // Build non-overlapping highlight ranges (longest match wins)
  const ranges = useMemo(() => {
    const all: HighlightRange[] = []
    for (const term of detectedTerms) {
      for (const pos of term.positions) {
        all.push({ start: pos.start, end: pos.end, term })
      }
    }
    // Sort by start, then longest first
    all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))

    // Remove overlaps (keep earliest / longest)
    const merged: HighlightRange[] = []
    let lastEnd = 0
    for (const r of all) {
      if (r.start >= lastEnd) {
        merged.push(r)
        lastEnd = r.end
      }
    }
    return merged
  }, [detectedTerms, text])

  // Build JSX fragments
  const parts: React.ReactNode[] = []
  let cursor = 0

  for (const range of ranges) {
    // Plain text before this highlight
    if (range.start > cursor) {
      parts.push(
        <span key={`t-${cursor}`}>{text.slice(cursor, range.start)}</span>,
      )
    }

    // Highlighted glossary term
    const matchedText = text.slice(range.start, range.end)
    parts.push(
      <span
        key={`h-${range.start}`}
        className="bg-gold/25 dark:bg-gold/20 border-b-2 border-gold dark:border-gold/70 cursor-help rounded-sm px-0.5 transition-colors hover:bg-gold/40 dark:hover:bg-gold/35"
        onMouseEnter={(e) => {
          setHoveredTerm(range.term)
          const rect = (e.target as HTMLElement).getBoundingClientRect()
          setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top })
        }}
        onMouseLeave={() => {
          setHoveredTerm(null)
          setTooltipPos(null)
        }}
        onClick={(e) => {
          e.stopPropagation()
          onTermClick?.(range.term)
        }}
      >
        {matchedText}
      </span>,
    )

    cursor = range.end
  }

  // Remaining text
  if (cursor < text.length) {
    parts.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>)
  }

  return (
    <div className="relative">
      <p className={`text-sm text-ink-850 dark:text-cream leading-relaxed whitespace-pre-wrap ${fontClass}`}>
        {parts}
      </p>

      {/* Tooltip */}
      {hoveredTerm && tooltipPos && (() => {
        const tooltipWidth = 280 // approximate max-w-xs
        const padding = 12
        const centeredX = tooltipPos.x
        const minX = padding + tooltipWidth / 2
        const maxX = window.innerWidth - padding - tooltipWidth / 2
        const clampedX = Math.max(minX, Math.min(maxX, centeredX))
        return (
        <div
          className="fixed z-50 transform -translate-x-1/2 -translate-y-full pointer-events-none"
          style={{ left: clampedX, top: tooltipPos.y - 6 }}
        >
          <div className="bg-ink-850 dark:bg-ink-700 text-cream text-xs rounded-md px-3 py-2 shadow-lg max-w-xs">
            <div className="flex items-center gap-2 mb-1">
              <span className={`${fontClass} font-medium`}>{hoveredTerm.source}</span>
              {hoveredTerm.translation && (
                <>
                  <span className="text-cream/40">→</span>
                  <span className="text-gold font-body font-medium">{hoveredTerm.translation}</span>
                </>
              )}
            </div>
            {hoveredTerm.sanskrit && (
              <div className="text-cream/60 font-body">
                Sanskrit: {hoveredTerm.sanskrit}
              </div>
            )}
            {hoveredTerm.category && (
              <div className="text-cream/50 font-body capitalize">
                {hoveredTerm.category.replace(/_/g, ' ')}
              </div>
            )}
            {hoveredTerm.do_not_translate && (
              <div className="text-amber-400 font-body mt-0.5">Do not translate</div>
            )}
            {hoveredTerm.transliterate && (
              <div className="text-amber-400 font-body mt-0.5">Transliterate only</div>
            )}
            {/* Arrow */}
            <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-ink-850 dark:border-t-ink-700" />
          </div>
        </div>
        )
      })()}
    </div>
  )
}
