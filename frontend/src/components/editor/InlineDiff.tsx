import React, { useMemo } from 'react'
import { computeDiffs, computeHunkIndices } from './diffUtils'
import type { SegmentComment } from '../../types'

const AUTHOR_COLORS = [
  { insert: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400', label: 'blue' },
  { insert: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400', label: 'purple' },
  { insert: 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400', label: 'teal' },
  { insert: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400', label: 'orange' },
  { insert: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400', label: 'green' },
]

export function getAuthorColor(authorId: number | null | undefined): typeof AUTHOR_COLORS[0] {
  if (!authorId) return AUTHOR_COLORS[0]
  return AUTHOR_COLORS[authorId % AUTHOR_COLORS.length]
}

export { AUTHOR_COLORS }

interface Props {
  oldText: string
  newText: string
  authorId?: number | null
  comments?: SegmentComment[]
  onClickComment?: (commentId: number) => void
}

export default function InlineDiff({ oldText, newText, authorId, comments, onClickComment }: Props) {
  const parts = useMemo(() => {
    if (oldText === newText) return null
    return computeDiffs(oldText, newText)
  }, [oldText, newText])

  const insertClass = getAuthorColor(authorId).insert

  // Build comment highlight ranges within the newText
  const commentRanges = useMemo(() => {
    if (!comments || comments.length === 0) return []
    const ranges: { start: number; end: number; commentId: number }[] = []
    for (const c of comments) {
      if (!c.quoted_text || c.is_resolved) continue
      const idx = newText.indexOf(c.quoted_text)
      if (idx === -1) continue
      ranges.push({ start: idx, end: idx + c.quoted_text.length, commentId: c.id })
    }
    return ranges.sort((a, b) => a.start - b.start)
  }, [comments, newText])

  // Helper: apply comment highlights within a text fragment at a given offset in newText
  function highlightComments(text: string, offsetInNewText: number, baseClass: string, baseKey: string): React.ReactNode {
    if (commentRanges.length === 0) return <span key={baseKey} className={baseClass}>{text}</span>
    const end = offsetInNewText + text.length
    const applicable = commentRanges.filter(r => r.start < end && r.end > offsetInNewText)
    if (applicable.length === 0) return <span key={baseKey} className={baseClass}>{text}</span>

    const parts: React.ReactNode[] = []
    let cursor = 0
    for (const range of applicable) {
      const relStart = Math.max(0, range.start - offsetInNewText)
      const relEnd = Math.min(text.length, range.end - offsetInNewText)
      if (cursor < relStart) {
        parts.push(<span key={`${baseKey}-t${cursor}`} className={baseClass}>{text.slice(cursor, relStart)}</span>)
      }
      parts.push(
        <span
          key={`${baseKey}-h${relStart}`}
          data-comment-id={range.commentId}
          className={`${baseClass} bg-amber-100/60 dark:bg-amber-900/20 border-b-2 border-amber-400 dark:border-amber-600/60 cursor-pointer hover:bg-amber-200/60 dark:hover:bg-amber-900/30 rounded-sm px-px`}
          onClick={(e) => { e.stopPropagation(); onClickComment?.(range.commentId) }}
          title="Click to view comment"
        >
          {text.slice(relStart, relEnd)}
        </span>
      )
      cursor = relEnd
    }
    if (cursor < text.length) {
      parts.push(<span key={`${baseKey}-t${cursor}`} className={baseClass}>{text.slice(cursor)}</span>)
    }
    return <>{parts}</>
  }

  if (!parts) {
    return <p className="text-sm text-ink-700 dark:text-cream-dim leading-relaxed whitespace-pre-wrap font-body">{highlightComments(newText, 0, 'text-ink-700 dark:text-cream-dim', 'full')}</p>
  }

  // Assign hunk indices matching ChangesPanel's computation
  const hunkIndices = computeHunkIndices(parts)

  // Track position in newText for comment highlight mapping
  let newTextCursor = 0
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap font-body">
      {parts.map(([op, text], i) => {
        const idx = hunkIndices[i]
        if (op === 0) {
          const pos = newTextCursor
          newTextCursor += text.length
          return highlightComments(text, pos, 'text-ink-700 dark:text-cream-dim', `s${i}`)
        }
        if (op === -1) {
          if (text.trim().length === 0) return null
          return <span key={i} data-diff-hunk={idx} className="tc-diff-del bg-red-100 dark:bg-red-900/30 text-red-700/60 dark:text-red-400/60 line-through decoration-1 decoration-red-500/70 dark:decoration-red-400/70">{text}</span>
        }
        // op === 1 (insertion)
        const pos = newTextCursor
        newTextCursor += text.length
        return highlightComments(text, pos, `tc-diff-ins ${insertClass}`, `s${i}`)
      })}
    </p>
  )
}
