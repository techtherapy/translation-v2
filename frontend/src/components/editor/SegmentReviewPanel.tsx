import { useState, useEffect, useRef } from 'react'
import { useConfirm } from '../../hooks/useConfirm'
import { Check, Undo2, Trash2, MessageSquare, GitCompareArrows, Send } from 'lucide-react'
import { createComment, deleteComment, resolveComment, unresolveComment } from '../../api/comments'
import CommentReactions from './CommentReactions'
import DiffReviewView from './DiffReviewView'
import type { SegmentComment } from '../../types'

const AVATAR_COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#14b8a6', '#ef4444', '#ec4899', '#06b6d4']

function avatarColor(userId: number): string {
  return AVATAR_COLORS[userId % AVATAR_COLORS.length]
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

interface Props {
  comments: SegmentComment[]
  segmentId: number
  languageId: number
  currentUserId: number
  translationText: string
  onUpdate: () => void
  /** Called with the newly created comment for optimistic UI update */
  onCommentCreated?: (comment: SegmentComment) => void
  /** Called with a state updater for optimistic local mutations (resolve, reply, delete) */
  onMutate?: (updater: (comments: SegmentComment[]) => SegmentComment[]) => void
  hasTrackChanges: boolean
  oldText?: string
  newText?: string
  reviewerName?: string
  onResolveReview?: (text: string) => void
  onCancelReview?: () => void
  defaultTab?: 'changes' | 'comments'
  /** Pre-filled quoted text from text selection — triggers comment input to auto-open */
  pendingQuotedText?: string
  onPendingQuotedTextConsumed?: () => void
  /** Called when user clicks to navigate to this segment in the editor */
  onNavigateToSegment?: (segmentId: number) => void
  /** ID of a comment to scroll to and highlight in the panel */
  focusedCommentId?: number | null
  onFocusedCommentConsumed?: () => void
  /** Called when user clicks quoted text to navigate to the highlight in the editor */
  onNavigateToComment?: (commentId: number) => void
  /** Hide the inner tab bar (when embedded in a parent that already has tabs) */
  hideTabBar?: boolean
}

export default function SegmentReviewPanel({
  comments,
  segmentId,
  languageId,
  currentUserId,
  translationText,
  onUpdate,
  hasTrackChanges,
  oldText,
  newText,
  reviewerName,
  onResolveReview,
  onCancelReview,
  defaultTab = 'comments',
  onCommentCreated,
  onMutate,
  pendingQuotedText,
  onPendingQuotedTextConsumed,
  onNavigateToSegment,
  focusedCommentId,
  onFocusedCommentConsumed,
  onNavigateToComment,
  hideTabBar,
}: Props) {
  const [activeTab, setActiveTab] = useState<'changes' | 'comments'>(
    hasTrackChanges && defaultTab === 'changes' ? 'changes' : 'comments'
  )
  const [newCommentText, setNewCommentText] = useState('')
  const [replyingTo, setReplyingTo] = useState<number | null>(null)
  const [replyText, setReplyText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const confirm = useConfirm()

  const panelRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to focused comment
  useEffect(() => {
    if (!focusedCommentId) return
    requestAnimationFrame(() => {
      const el = panelRef.current?.querySelector(`[data-panel-comment-id="${focusedCommentId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        el.classList.add('ring-2', 'ring-amber-400', 'rounded')
        setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400', 'rounded'), 2000)
      }
      onFocusedCommentConsumed?.()
    })
  }, [focusedCommentId])

  const unresolved = comments.filter(c => !c.is_resolved)
  const resolved = comments.filter(c => c.is_resolved)
  const unresolvedCount = unresolved.length

  async function handleCreateComment() {
    if (!newCommentText.trim()) return
    setSubmitting(true)
    try {
      const newComment = await createComment({
        segment_id: segmentId,
        language_id: languageId,
        text: newCommentText.trim(),
        quoted_text: pendingQuotedText || undefined,
      })
      setNewCommentText('')
      onPendingQuotedTextConsumed?.()
      onCommentCreated?.(newComment)
      onUpdate()
    } catch (err) {
      console.error('Failed to create comment:', err)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReply(parentId: number) {
    if (!replyText.trim()) return
    setSubmitting(true)
    try {
      const reply = await createComment({
        segment_id: segmentId,
        language_id: languageId,
        text: replyText.trim(),
        parent_id: parentId,
      })
      setReplyText('')
      setReplyingTo(null)
      // Optimistic: add reply to parent comment
      onMutate?.(comments => comments.map(c =>
        c.id === parentId ? { ...c, replies: [...(c.replies || []), reply] } : c
      ))
      onUpdate()
    } catch (err) {
      console.error('Failed to create reply:', err)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResolve(commentId: number) {
    try {
      await resolveComment(commentId)
      // Optimistic: mark as resolved
      onMutate?.(comments => comments.map(c =>
        c.id === commentId ? { ...c, is_resolved: true, resolved_by: currentUserId } : c
      ))
      onUpdate()
    } catch (err) {
      console.error('Failed to resolve comment:', err)
    }
  }

  async function handleUnresolve(commentId: number) {
    try {
      await unresolveComment(commentId)
      // Optimistic: mark as unresolved
      onMutate?.(comments => comments.map(c =>
        c.id === commentId ? { ...c, is_resolved: false, resolved_by: null, resolved_at: null } : c
      ))
      onUpdate()
    } catch (err) {
      console.error('Failed to unresolve comment:', err)
    }
  }

  async function handleDelete(commentId: number) {
    if (!await confirm({ title: 'Delete comment', message: 'Delete this comment?', confirmLabel: 'Delete', variant: 'danger' })) return
    try {
      await deleteComment(commentId)
      // Optimistic: remove from list
      onMutate?.(comments => comments.filter(c => c.id !== commentId))
      onUpdate()
    } catch (err) {
      console.error('Failed to delete comment:', err)
    }
  }

  function renderQuotedText(comment: SegmentComment) {
    if (!comment.quoted_text) return null
    const isStale = translationText.indexOf(comment.quoted_text) === -1
    const canNavigate = !isStale && onNavigateToComment
    return (
      <blockquote
        className={`border-l-2 border-amber-400 dark:border-amber-600 pl-2 my-1 ${isStale ? 'opacity-50' : ''} ${canNavigate ? 'cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/10 rounded-r transition-colors' : ''}`}
        onClick={canNavigate ? () => onNavigateToComment!(comment.id) : undefined}
        title={canNavigate ? 'Click to scroll to text' : undefined}
      >
        <p className="text-[10px] italic text-parchment-500 dark:text-cream-muted font-body leading-snug">
          {comment.quoted_text}
        </p>
        {isStale && (
          <span className="inline-block mt-0.5 text-[9px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-body">
            text changed
          </span>
        )}
      </blockquote>
    )
  }

  function renderComment(comment: SegmentComment, isReply = false): JSX.Element {
    const isOwn = comment.user_id === currentUserId
    const color = avatarColor(comment.user_id)

    return (
      <div key={comment.id} data-panel-comment-id={comment.id} className={`${isReply ? 'ml-6' : ''} mb-2`}>
        <div className="flex items-start gap-2">
          {/* Avatar */}
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white flex-shrink-0 mt-0.5"
            style={{ backgroundColor: color }}
          >
            {comment.username.charAt(0).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            {/* Header row */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-ink-850 dark:text-cream font-body">
                {comment.username}
              </span>
              <span className="text-[10px] text-parchment-500 dark:text-cream-muted font-body">
                {timeAgo(comment.created_at)}
              </span>
              {isOwn && (
                <button
                  onClick={() => handleDelete(comment.id)}
                  className="ml-auto text-parchment-400 hover:text-red-500 dark:text-cream-muted dark:hover:text-red-400 transition-colors"
                  title="Delete comment"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Quoted text (not for replies) */}
            {!isReply && renderQuotedText(comment)}

            {/* Comment body */}
            <p className="text-xs text-ink-700 dark:text-cream-dim leading-relaxed mt-0.5 font-body">
              {comment.text}
            </p>

            {/* Reactions */}
            <div className="mt-1">
              <CommentReactions
                commentId={comment.id}
                reactions={comment.reactions ?? []}
                onUpdate={onUpdate}
                onReactionsUpdated={(cId, updatedReactions) => {
                  onMutate?.(comments => {
                    const updateReactions = (c: SegmentComment): SegmentComment =>
                      c.id === cId ? { ...c, reactions: updatedReactions } :
                      c.replies ? { ...c, replies: c.replies.map(updateReactions) } : c
                    return comments.map(updateReactions)
                  })
                }}
              />
            </div>

            {/* Action buttons for top-level comments */}
            {!isReply && (
              <div className="flex items-center gap-2 mt-1">
                {!comment.is_resolved && (
                  <>
                    <button
                      onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                      className="text-[10px] text-parchment-500 hover:text-gold dark:text-cream-muted dark:hover:text-gold-light font-body transition-colors"
                    >
                      Reply
                    </button>
                    <button
                      onClick={() => handleResolve(comment.id)}
                      className="flex items-center gap-0.5 text-[10px] text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 font-body transition-colors"
                    >
                      <Check className="w-3 h-3" /> Resolve
                    </button>
                  </>
                )}
                {comment.is_resolved && (
                  <button
                    onClick={() => handleUnresolve(comment.id)}
                    className="flex items-center gap-0.5 text-[10px] text-parchment-500 hover:text-gold dark:text-cream-muted dark:hover:text-gold-light font-body transition-colors"
                  >
                    <Undo2 className="w-3 h-3" /> Unresolve
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Replies */}
        {comment.replies && comment.replies.map(r => renderComment(r, true))}

        {/* Reply input */}
        {replyingTo === comment.id && (
          <div className="ml-6 mt-1 flex gap-1">
            <input
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleReply(comment.id)}
              placeholder="Reply..."
              className="flex-1 text-[11px] px-2 py-1 border border-parchment-200 dark:border-ink-600 rounded bg-white dark:bg-ink-800 text-ink-700 dark:text-cream-dim font-body focus:outline-none focus:border-gold"
              autoFocus
            />
            <button
              onClick={() => handleReply(comment.id)}
              disabled={submitting || !replyText.trim()}
              className="p-1 text-gold hover:text-gold-dark dark:hover:text-gold-light disabled:opacity-40 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={panelRef} className={`${hideTabBar ? '' : 'border border-parchment-200 dark:border-ink-600/40 rounded-lg'} overflow-hidden ${hideTabBar ? '' : 'mt-1'}`}>
      {/* Tab bar — hidden when embedded in parent with its own tabs */}
      {!hideTabBar && (
      <div className="flex border-b border-parchment-200 dark:border-ink-600/40 bg-parchment-50 dark:bg-ink-850">
        {hasTrackChanges && (
          <button
            onClick={() => setActiveTab('changes')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-body transition-colors border-b-2 -mb-px ${
              activeTab === 'changes'
                ? 'border-gold text-ink-850 dark:text-cream'
                : 'border-transparent text-parchment-500 dark:text-cream-muted hover:text-ink-700 dark:hover:text-cream-dim'
            }`}
          >
            <GitCompareArrows className="w-3.5 h-3.5" />
            Changes
          </button>
        )}
        <button
          onClick={() => setActiveTab('comments')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-body transition-colors border-b-2 -mb-px ${
            activeTab === 'comments'
              ? 'border-gold text-ink-850 dark:text-cream'
              : 'border-transparent text-parchment-500 dark:text-cream-muted hover:text-ink-700 dark:hover:text-cream-dim'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Comments
          {unresolvedCount > 0 && (
            <span className="ml-0.5 px-1 py-0.5 rounded-full text-[9px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 leading-none">
              {unresolvedCount}
            </span>
          )}
        </button>
      </div>
      )}

      {/* Tab content */}
      <div className="p-2.5">
        {/* Changes tab */}
        {activeTab === 'changes' && hasTrackChanges && oldText && newText && reviewerName && onResolveReview && onCancelReview && (
          <DiffReviewView
            oldText={oldText}
            newText={newText}
            reviewerName={reviewerName}
            onResolve={onResolveReview}
            onCancel={onCancelReview}
          />
        )}

        {/* Comments tab */}
        {activeTab === 'comments' && (
          <div>
            {/* Unresolved comments */}
            {unresolved.map(c => renderComment(c))}

            {/* No comments message */}
            {comments.length === 0 && (
              <p className="text-[11px] text-parchment-400 dark:text-cream-muted font-body italic mb-2">
                No comments yet.
              </p>
            )}

            {/* Resolved comments (collapsible) */}
            {resolved.length > 0 && (
              <details className="mt-1">
                <summary className="text-[10px] text-parchment-400 dark:text-cream-muted cursor-pointer font-body select-none">
                  {resolved.length} resolved {resolved.length === 1 ? 'thread' : 'threads'}
                </summary>
                <div className="mt-1 opacity-60">
                  {resolved.map(c => renderComment(c))}
                </div>
              </details>
            )}

            {/* New comment input */}
            <div className="mt-2 pt-2 border-t border-parchment-100 dark:border-ink-600/20">
              {pendingQuotedText && (
                <div className="flex items-start gap-1.5 mb-1.5">
                  <div className="flex-1 px-2 py-1 bg-amber-50 dark:bg-amber-900/10 border-l-2 border-amber-400 dark:border-amber-600 rounded-r text-[11px] text-ink-700 dark:text-cream-dim italic truncate">
                    &ldquo;{pendingQuotedText}&rdquo;
                  </div>
                  <button onClick={() => onPendingQuotedTextConsumed?.()} className="text-[10px] text-parchment-400 hover:text-ink-700 dark:hover:text-cream shrink-0">✕</button>
                </div>
              )}
              <div className="flex gap-1">
                <input
                  value={newCommentText}
                  onChange={e => setNewCommentText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleCreateComment())}
                  placeholder={pendingQuotedText ? 'Comment on selected text...' : 'Add a comment...'}
                  className="flex-1 text-[11px] px-2 py-1 border border-parchment-200 dark:border-ink-600 rounded bg-white dark:bg-ink-800 text-ink-700 dark:text-cream-dim font-body focus:outline-none focus:border-gold"
                  autoFocus={!!pendingQuotedText}
                />
                <button
                  onClick={handleCreateComment}
                  disabled={submitting || !newCommentText.trim()}
                  className="p-1 text-gold hover:text-gold-dark dark:hover:text-gold-light disabled:opacity-40 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
