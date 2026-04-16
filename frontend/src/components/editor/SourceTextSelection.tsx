import React, { useState, useRef, useCallback, useEffect } from 'react'
import { BookPlus, BookOpen, Loader2, Pencil, MessageSquare } from 'lucide-react'
import type { AutocompleteSuggestion } from '../../api/glossary'

interface Props {
  children: React.ReactNode
  /** When provided, shows "Add to Glossary" option in popup. */
  onAddToGlossary?: (selectedText: string) => void
  /** When provided, selected text is looked up in the glossary first.
   *  "Add to Glossary" only appears if no match is found. */
  lookupGlossary?: (text: string) => Promise<AutocompleteSuggestion[]>
  /** Fires with results when lookup completes, or null when popup is dismissed. */
  onLookupResults?: (results: AutocompleteSuggestion[] | null) => void
  /** Called when user clicks a matched glossary term to edit it. */
  onEditTerm?: (termId: number) => void
  /** Called when user clicks "Comment" on selected text. Receives the selected string. */
  onComment?: (selectedText: string) => void
  sourceFontClass?: string
}

/**
 * Wraps text content and detects text selection.
 * If lookupGlossary is provided, shows glossary matches first;
 * otherwise (or when no match) shows "Add to Glossary".
 */
export default function SourceTextSelection({ children, onAddToGlossary, lookupGlossary, onLookupResults, onEditTerm, onComment, sourceFontClass = 'font-chinese' }: Props) {
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupResults, setLookupResults] = useState<AutocompleteSuggestion[] | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const requestId = useRef(0)

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !containerRef.current?.contains(sel.anchorNode)) {
      return
    }
    const text = sel.toString().trim()
    if (!text) {
      setSelection(null)
      setLookupResults(null)
      return
    }

    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    setSelection({
      text,
      x: rect.left + rect.width / 2,
      y: rect.top,
    })

    // Look up glossary if available
    if (lookupGlossary) {
      const thisRequest = ++requestId.current
      setLookupLoading(true)
      setLookupResults(null)
      lookupGlossary(text)
        .then((results) => {
          if (thisRequest === requestId.current) {
            setLookupResults(results)
            onLookupResults?.(results)
          }
        })
        .catch(() => {
          if (thisRequest === requestId.current) {
            setLookupResults([])
            onLookupResults?.([])
          }
        })
        .finally(() => {
          if (thisRequest === requestId.current) {
            setLookupLoading(false)
          }
        })
    }
  }, [lookupGlossary])

  function dismiss() {
    setSelection(null)
    setLookupResults(null)
    onLookupResults?.(null)
  }

  // Dismiss on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        dismiss()
      }
    }
    if (selection) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [selection])

  const showAddButton = onAddToGlossary && (!lookupGlossary || (lookupResults !== null && lookupResults.length === 0))

  return (
    <div ref={containerRef} onMouseUp={handleMouseUp}>
      {children}
      {selection && (
        <div
          className="fixed z-50 transform -translate-x-1/2 -translate-y-full"
          style={{ left: selection.x, top: selection.y - 8 }}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <div className="bg-ink-850 dark:bg-ink-700 text-cream text-xs rounded-md shadow-lg max-w-sm overflow-hidden">
            {lookupGlossary && lookupLoading ? (
              /* Loading spinner */
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 font-body">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Looking up...
              </div>
            ) : lookupResults && lookupResults.length > 0 ? (
              /* Glossary matches — clickable to edit */
              <>
                {lookupResults.slice(0, 3).map((match) => (
                  <button
                    key={match.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditTerm?.(match.id)
                      dismiss()
                      window.getSelection()?.removeAllRanges()
                    }}
                    className="w-full px-3 py-2 border-b border-cream/10 last:border-b-0 hover:bg-cream/10 transition-colors text-left flex items-center gap-2"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-gold shrink-0" />
                    <span className={`${sourceFontClass} font-medium`}>{match.source_term}</span>
                    <span className="text-cream/40">→</span>
                    <span className="text-gold font-body font-medium flex-1">{match.translated_term}</span>
                    <Pencil className="w-3 h-3 text-cream/40 shrink-0" />
                  </button>
                ))}
              </>
            ) : showAddButton ? (
              /* No match — offer to add */
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onAddToGlossary?.(selection.text)
                  dismiss()
                  window.getSelection()?.removeAllRanges()
                }}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 font-body font-medium
                           hover:bg-cream/10 transition-colors"
              >
                <BookPlus className="w-3.5 h-3.5" />
                Add to Glossary
              </button>
            ) : null}
            {/* Comment button */}
            {onComment && !lookupLoading && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onComment(selection.text)
                  dismiss()
                  window.getSelection()?.removeAllRanges()
                }}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 font-body font-medium
                           text-amber-400 hover:bg-cream/10 transition-colors
                           border-t border-cream/10"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Comment
              </button>
            )}
          </div>
          {/* Arrow */}
          <div className="flex justify-center">
            <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-ink-850 dark:border-t-ink-700" />
          </div>
        </div>
      )}
    </div>
  )
}
