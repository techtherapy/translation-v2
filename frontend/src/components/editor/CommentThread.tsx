import { useState } from 'react'
import { Check, Undo2, Trash2, Send, MessageSquare, SmilePlus } from 'lucide-react'
import CommentReactions, { ALLOWED_EMOJI } from './CommentReactions'
import { addReaction } from '../../api/comments'
import type { SegmentComment } from '../../types'

export const AVATAR_COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#14b8a6', '#ef4444', '#ec4899', '#06b6d4']

export function avatarColor(userId: number): string {
  return AVATAR_COLORS[userId % AVATAR_COLORS.length]
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function fullTimestamp(dateStr: string): string {
  const d = new Date(dateStr)
  const month = d.toLocaleString('en-US', { month: 'long' })
  const day = String(d.getDate()).padStart(2, '0')
  const year = d.getFullYear()
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
  return `Created ${month} ${day}, ${year} at ${time}`
}

interface Props {
  comment: SegmentComment
  currentUserId: number
  translationText: string
  onResolve: (commentId: number) => void
  onUnresolve: (commentId: number) => void
  onDelete: (commentId: number) => void
  onReply: (parentId: number, text: string) => void
  onUpdate: () => void
  onMutate?: (updater: (comments: SegmentComment[]) => SegmentComment[]) => void
  onNavigateToComment?: (commentId: number) => void
  hideQuotedText?: boolean
  /** If true, all comments (including top-level) use individual hover for toolbar */
  individualHover?: boolean
  /** If true, card is active — show all replies. If false, collapse to last reply only */
  isActive?: boolean
  onShowAllReplies?: () => void
  /** If true, render without avatar indentation — flat layout for inline replies */
  compact?: boolean
}

export default function CommentThread({
  comment,
  currentUserId,
  translationText,
  onResolve,
  onUnresolve,
  onDelete,
  onReply,
  onUpdate,
  onMutate,
  onNavigateToComment,
  hideQuotedText,
  individualHover,
  isActive = true,
  onShowAllReplies,
  compact,
}: Props) {
  const [replyingTo, setReplyingTo] = useState<number | null>(null)
  const [replyText, setReplyText] = useState('')
  const [emojiPickerFor, setEmojiPickerFor] = useState<number | null>(null)

  function handleReply(parentId: number) {
    if (!replyText.trim()) return
    onReply(parentId, replyText.trim())
    setReplyText('')
    setReplyingTo(null)
  }

  function renderQuotedText(c: SegmentComment) {
    if (!c.quoted_text) return null
    const isStale = translationText.indexOf(c.quoted_text) === -1
    const canNavigate = !isStale && onNavigateToComment
    return (
      <blockquote
        className={`border-l-2 border-amber-400 dark:border-amber-600 pl-2 my-1 ${isStale ? 'opacity-50' : ''} ${canNavigate ? 'cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/10 rounded-r transition-colors' : ''}`}
        onClick={canNavigate ? () => onNavigateToComment!(c.id) : undefined}
        title={canNavigate ? 'Click to scroll to text' : undefined}
      >
        <p className="text-[10px] italic text-parchment-500 dark:text-cream-muted font-body leading-snug">
          {c.quoted_text}
        </p>
        {isStale && (
          <span className="inline-block mt-0.5 text-[9px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-body">
            text changed
          </span>
        )}
      </blockquote>
    )
  }

  function renderComment(c: SegmentComment, isReply = false): JSX.Element {
    const isOwn = c.user_id === currentUserId
    const color = avatarColor(c.user_id)
    const useCompact = compact && isReply

    return (
      <div key={c.id} data-panel-comment-id={c.id} className={useCompact ? 'mb-1.5' : 'mb-2.5'}>
        <div className={`${useCompact ? '' : 'flex gap-2'} group/comment`}>
          {/* Avatar — hidden in compact mode */}
          {!useCompact && (
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white flex-shrink-0 mt-0.5"
              style={{ backgroundColor: color }}
            >
              {c.username.charAt(0).toUpperCase()}
            </div>
          )}
          {/* Content column — name, text, emoji all aligned */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-semibold text-ink-850 dark:text-cream font-body">{c.username}</span>
              <span className="text-[11px] text-parchment-500 dark:text-cream-muted font-body cursor-default" title={fullTimestamp(c.created_at)}>{timeAgo(c.created_at)}</span>
              <div className={`ml-auto flex items-center gap-0.5 opacity-0 ${isReply || individualHover ? 'group-hover/comment:opacity-100' : 'group-hover/card:opacity-100'} transition-opacity bg-parchment-50 dark:bg-ink-700 rounded-md border border-parchment-200 dark:border-ink-600 shadow-sm px-1 py-0.5 relative`}>
                <button onClick={() => setEmojiPickerFor(emojiPickerFor === c.id ? null : c.id)} className="p-0.5 text-parchment-500 dark:text-cream-muted hover:text-gold dark:hover:text-gold-light transition-colors" title="React"><SmilePlus className="w-3.5 h-3.5" /></button>
                {!isReply && !c.is_resolved && (
                  <button onClick={() => onResolve(c.id)} className="p-0.5 text-parchment-500 dark:text-cream-muted hover:text-green-600 dark:hover:text-green-400 transition-colors" title="Resolve"><Check className="w-3.5 h-3.5" /></button>
                )}
                {!isReply && c.is_resolved && (
                  <button onClick={() => onUnresolve(c.id)} className="p-0.5 text-parchment-500 dark:text-cream-muted hover:text-gold dark:hover:text-gold-light transition-colors" title="Unresolve"><Undo2 className="w-3.5 h-3.5" /></button>
                )}
                {isOwn && (
                  <button onClick={() => onDelete(c.id)} className="p-0.5 text-parchment-500 dark:text-cream-muted hover:text-red-500 dark:hover:text-red-400 transition-colors" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
                {emojiPickerFor === c.id && (
                  <div className="absolute top-full right-0 mt-1 flex gap-1 p-1.5 bg-white dark:bg-ink-800 rounded-lg shadow-lg border border-parchment-200 dark:border-ink-600 z-50">
                    {ALLOWED_EMOJI.map(emoji => (
                      <button
                        key={emoji}
                        onClick={async () => {
                          setEmojiPickerFor(null)
                          try {
                            const updated = await addReaction(c.id, emoji)
                            onMutate?.(comments => {
                              const updateR = (cm: SegmentComment): SegmentComment =>
                                cm.id === c.id ? { ...cm, reactions: updated } :
                                cm.replies ? { ...cm, replies: cm.replies.map(updateR) } : cm
                              return comments.map(updateR)
                            })
                            onUpdate()
                          } catch {}
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-parchment-100 dark:hover:bg-ink-700 transition-colors text-base"
                      >{emoji}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="text-[12px] text-ink-700 dark:text-cream-dim leading-snug mt-1 font-body">{c.text}</p>
            <div className="mt-1">
            <CommentReactions
              commentId={c.id}
              reactions={c.reactions ?? []}
              onUpdate={onUpdate}
              hidePicker
              onReactionsUpdated={(cId, updatedReactions) => {
                onMutate?.(comments => {
                  const updateReactions = (cm: SegmentComment): SegmentComment =>
                    cm.id === cId ? { ...cm, reactions: updatedReactions } :
                    cm.replies ? { ...cm, replies: cm.replies.map(updateReactions) } : cm
                  return comments.map(updateReactions)
                })
              }}
            />
            </div>
          </div>
        </div>

        {/* Replies — collapsed when inactive */}
        {c.replies && c.replies.length > 0 && (() => {
          const replies = c.replies
          if (isActive || replies.length <= 1) {
            return replies.map(r => renderComment(r, true))
          }
          // Inactive with multiple replies: show "Show N replies" + last reply
          const hidden = replies.length - 1
          return (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onShowAllReplies?.() }}
                className="text-[10px] text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 font-body transition-colors mb-1.5"
              >
                Show {hidden} {hidden === 1 ? 'reply' : 'replies'}
              </button>
              {renderComment(replies[replies.length - 1], true)}
            </>
          )
        })()}

        {/* Reply input */}
        {replyingTo === c.id && (
          <div className="mt-1 flex gap-1">
            <input
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleReply(c.id)}
              placeholder="Reply..."
              className="flex-1 text-[11px] px-2 py-1 border border-parchment-200 dark:border-ink-600 rounded bg-white dark:bg-ink-800 text-ink-700 dark:text-cream-dim font-body focus:outline-none focus:border-gold"
              autoFocus
            />
            <button
              onClick={() => handleReply(c.id)}
              disabled={!replyText.trim()}
              className="p-1 text-gold hover:text-gold-dark dark:hover:text-gold-light disabled:opacity-40 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    )
  }

  return renderComment(comment)
}
