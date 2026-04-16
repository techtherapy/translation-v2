import { useState, useEffect, useRef, useCallback } from 'react'
import { MessageSquare, X } from 'lucide-react'
import { createComment } from '../../api/comments'

interface Props {
  segmentId: number
  languageId: number
  containerRef: React.RefObject<HTMLElement | null>
  onCommentCreated: () => void
  disabled?: boolean
}

export default function FloatingCommentButton({
  segmentId,
  languageId,
  containerRef,
  onCommentCreated,
  disabled,
}: Props) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [selectedText, setSelectedText] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleMouseUp = useCallback(() => {
    if (disabled) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !containerRef.current?.contains(sel.anchorNode)) {
      if (!showInput) {
        setPosition(null)
        setSelectedText('')
      }
      return
    }
    const text = sel.toString().trim()
    if (!text) {
      if (!showInput) {
        setPosition(null)
        setSelectedText('')
      }
      return
    }

    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    setPosition({
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.bottom - containerRect.top + 4,
    })
    setSelectedText(text)
  }, [containerRef, disabled, showInput])

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseUp])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        dismiss()
      }
    }
    if (position) {
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside)
      }, 100)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [position, showInput])

  function dismiss() {
    setPosition(null)
    setSelectedText('')
    setShowInput(false)
    setCommentText('')
  }

  function handleClickButton() {
    setShowInput(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function handleSubmit() {
    if (!commentText.trim() || submitting) return
    setSubmitting(true)
    try {
      await createComment({
        segment_id: segmentId,
        language_id: languageId,
        text: commentText.trim(),
        quoted_text: selectedText,
      })
      onCommentCreated()
      dismiss()
    } catch (err) {
      console.error('Failed to create comment:', err)
    } finally {
      setSubmitting(false)
    }
  }

  if (!position || !selectedText) return null

  return (
    <div
      ref={buttonRef}
      className="absolute z-50"
      style={{ left: position.x, top: position.y, transform: 'translateX(-50%)' }}
    >
      {!showInput ? (
        <button
          onClick={handleClickButton}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 dark:bg-amber-600 text-white text-[11px] font-semibold rounded-md shadow-lg hover:bg-amber-600 dark:hover:bg-amber-700 transition-colors"
        >
          <MessageSquare className="w-3 h-3" />
          Comment
        </button>
      ) : (
        <div className="w-72 p-3 bg-white dark:bg-ink-800 rounded-lg shadow-xl border border-parchment-200 dark:border-ink-600">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-parchment-500 dark:text-cream-muted">Commenting on:</span>
            <button onClick={dismiss} className="text-parchment-400 hover:text-ink-700 dark:hover:text-cream">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="px-2 py-1.5 mb-2 bg-amber-50 dark:bg-amber-900/10 border-l-[3px] border-amber-400 dark:border-amber-600 rounded-r text-xs text-ink-700 dark:text-cream-dim italic truncate">
            &ldquo;{selectedText}&rdquo;
          </div>
          <textarea
            ref={inputRef}
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="Add your comment..."
            className="w-full h-16 px-2 py-1.5 text-xs bg-parchment-50 dark:bg-ink-700 border border-parchment-200 dark:border-ink-600 rounded resize-none focus:outline-none focus:ring-1 focus:ring-gold dark:focus:ring-gold-light text-ink-800 dark:text-cream"
          />
          <div className="flex justify-end gap-1.5 mt-2">
            <button
              onClick={dismiss}
              className="px-2.5 py-1 text-[10px] text-parchment-500 dark:text-cream-muted hover:text-ink-700 dark:hover:text-cream"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!commentText.trim() || submitting}
              className="px-2.5 py-1 text-[10px] font-semibold bg-amber-500 dark:bg-amber-600 text-white rounded hover:bg-amber-600 dark:hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Saving...' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
