import { useState, useRef, useEffect } from 'react'
import { SmilePlus } from 'lucide-react'
import { addReaction, removeReaction } from '../../api/comments'
import type { ReactionSummary } from '../../types'

const ALLOWED_EMOJI = ['👍', '👎', '✅', '❓', '🙏']

interface Props {
  commentId: number
  reactions: ReactionSummary[]
  onUpdate: () => void
  onReactionsUpdated?: (commentId: number, reactions: ReactionSummary[]) => void
  /** Hide the add-emoji picker button (when it's in the hover toolbar instead) */
  hidePicker?: boolean
}

export default function CommentReactions({ commentId, reactions, onUpdate, onReactionsUpdated, hidePicker }: Props) {
  const [showPicker, setShowPicker] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    if (showPicker) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showPicker])

  async function handleToggle(emoji: string, alreadyReacted: boolean) {
    if (submitting) return
    setSubmitting(true)
    try {
      let updated: ReactionSummary[]
      if (alreadyReacted) {
        updated = await removeReaction(commentId, emoji)
      } else {
        updated = await addReaction(commentId, emoji)
      }
      onReactionsUpdated?.(commentId, updated)
      onUpdate()
    } catch (err) {
      console.error('Failed to toggle reaction:', err)
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePickerSelect(emoji: string) {
    setShowPicker(false)
    const existing = reactions.find(r => r.emoji === emoji)
    if (existing?.reacted_by_me) return
    await handleToggle(emoji, false)
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {reactions.map(r => (
        <button
          key={r.emoji}
          onClick={() => handleToggle(r.emoji, r.reacted_by_me)}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
            r.reacted_by_me
              ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700'
              : 'bg-transparent border-parchment-200 dark:border-ink-600/30 hover:bg-parchment-100 dark:hover:bg-ink-700/30'
          }`}
          title={r.users.map(u => u.username).join(', ')}
        >
          <span>{r.emoji}</span>
          <span className="text-parchment-500 dark:text-cream-muted">{r.count}</span>
        </button>
      ))}
      {!hidePicker && <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="p-0.5 text-parchment-400 dark:text-ink-400 hover:text-gold dark:hover:text-gold-light transition-colors"
          title="Add reaction"
        >
          <SmilePlus className="w-3.5 h-3.5" />
        </button>
        {showPicker && (
          <div className="absolute bottom-full left-0 mb-1 flex gap-1 p-1.5 bg-white dark:bg-ink-800 rounded-lg shadow-lg border border-parchment-200 dark:border-ink-600 z-50">
            {ALLOWED_EMOJI.map(emoji => (
              <button
                key={emoji}
                onClick={() => handlePickerSelect(emoji)}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-parchment-100 dark:hover:bg-ink-700 transition-colors text-base"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>}
    </div>
  )
}

export { ALLOWED_EMOJI }
