import { useState, useEffect } from 'react'
import { Send, Plus } from 'lucide-react'
import { createComment } from '../../api/comments'
import type { SegmentComment } from '../../types'

interface Props {
  segmentId: number
  languageId: number
  pendingQuotedText?: string
  onPendingQuotedTextConsumed?: () => void
  onCommentCreated?: (comment: SegmentComment) => void
  onUpdate: () => void
  /** If true, show a compact "+" button that expands to the full input on click */
  compact?: boolean
  /** If true, include quoted text when submitting but don't show the preview */
  hideQuotedPreview?: boolean
  /** Override the placeholder text */
  placeholder?: string
  /** If set, creates a reply to this comment instead of a top-level comment */
  parentId?: number
}

export default function CommentInput({
  segmentId,
  languageId,
  pendingQuotedText,
  onPendingQuotedTextConsumed,
  onCommentCreated,
  onUpdate,
  compact = false,
  hideQuotedPreview = false,
  placeholder: placeholderOverride,
  parentId,
}: Props) {
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Auto-expand when pendingQuotedText is provided
  useEffect(() => {
    if (pendingQuotedText) {
      setExpanded(true)
    }
  }, [pendingQuotedText])

  const handleSubmit = async () => {
    if (!commentText.trim() || submitting) return
    setSubmitting(true)
    try {
      const newComment = await createComment({
        segment_id: segmentId,
        language_id: languageId,
        text: commentText.trim(),
        quoted_text: pendingQuotedText || undefined,
        parent_id: parentId || undefined,
      })
      setCommentText('')
      onPendingQuotedTextConsumed?.()
      if (onCommentCreated) {
        onCommentCreated(newComment)
        // Skip refetch — optimistic update is sufficient and refetch can race
      } else {
        onUpdate()
      }
      if (compact) setExpanded(false)
    } catch (err) {
      console.error('Failed to create comment:', err)
    } finally {
      setSubmitting(false)
    }
  }

  // Compact mode: show just a "+" button when collapsed
  if (compact && !expanded && !pendingQuotedText) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="p-1 text-gold hover:text-gold-dark dark:hover:text-gold-light transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    )
  }

  return (
    <div className="mt-1.5 pt-1.5 border-t border-parchment-100 dark:border-ink-600/20" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      {pendingQuotedText && !hideQuotedPreview && (
        <div className="flex items-start gap-1.5 mb-1.5">
          <div className="flex-1 px-2 py-1 bg-amber-50 dark:bg-amber-900/10 border-l-2 border-amber-400 dark:border-amber-600 rounded-r text-[11px] text-ink-700 dark:text-cream-dim italic truncate">
            &ldquo;{pendingQuotedText}&rdquo;
          </div>
          <button onClick={() => onPendingQuotedTextConsumed?.()} className="text-[10px] text-parchment-400 hover:text-ink-700 dark:hover:text-cream shrink-0">✕</button>
        </div>
      )}
      <div className="flex gap-1">
        <input
          value={commentText}
          onChange={e => setCommentText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
          placeholder={placeholderOverride || (pendingQuotedText ? 'Comment on selected text...' : 'Add a comment...')}
          className="flex-1 text-[11px] px-2 py-1 border border-parchment-200 dark:border-ink-600 rounded bg-white dark:bg-ink-800 text-ink-700 dark:text-cream-dim font-body focus:outline-none focus:border-gold"
          autoFocus={!!pendingQuotedText}
        />
        <button
          onClick={handleSubmit}
          disabled={submitting || !commentText.trim()}
          className="p-1 text-gold hover:text-gold-dark dark:hover:text-gold-light disabled:opacity-40 transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
