import type { SegmentComment } from '../../types'

interface HighlightRange {
  start: number
  end: number
  commentId: number
}

interface Props {
  text: string
  comments: SegmentComment[]
  onClickHighlight: (commentId: number) => void
  className?: string
}

function buildHighlightRanges(text: string, comments: SegmentComment[]): HighlightRange[] {
  const ranges: HighlightRange[] = []
  for (const c of comments) {
    if (!c.quoted_text || c.is_resolved) continue
    const idx = text.indexOf(c.quoted_text)
    if (idx === -1) continue
    ranges.push({ start: idx, end: idx + c.quoted_text.length, commentId: c.id })
  }
  ranges.sort((a, b) => a.start - b.start)
  const merged: HighlightRange[] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end)
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

export default function TextHighlighter({ text, comments, onClickHighlight, className }: Props) {
  const ranges = buildHighlightRanges(text, comments)

  if (ranges.length === 0) {
    return <p className={className}>{text}</p>
  }

  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const range of ranges) {
    if (cursor < range.start) {
      parts.push(<span key={`t-${cursor}`}>{text.slice(cursor, range.start)}</span>)
    }
    parts.push(
      <span
        key={`h-${range.start}`}
        data-comment-id={range.commentId}
        onClick={(e) => { e.stopPropagation(); onClickHighlight(range.commentId) }}
        className="bg-amber-100/60 dark:bg-amber-900/20 border-b-2 border-amber-400 dark:border-amber-600/60 cursor-pointer hover:bg-amber-200/60 dark:hover:bg-amber-900/30 transition-colors rounded-sm px-px"
        title="Click to view comment"
      >
        {text.slice(range.start, range.end)}
      </span>
    )
    cursor = range.end
  }
  if (cursor < text.length) {
    parts.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>)
  }

  return <p className={className}>{parts}</p>
}
