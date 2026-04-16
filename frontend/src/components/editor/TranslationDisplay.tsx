import React from 'react'
import { CheckCircle, AlertCircle } from 'lucide-react'
import SourceTextSelection from './SourceTextSelection'
import InlineDiff from './InlineDiff'
import TextHighlighter from './TextHighlighter'
import { useEditorContext } from './EditorContext'
import type { Translation, SegmentComment } from '../../types'
import type { AutocompleteSuggestion } from '../../api/glossary'
import { extractCleanText } from '../../utils/translationContent'

interface Props {
  translation: Translation | undefined
  segmentId: number
  isEditing: boolean
  comments: SegmentComment[]
  onAcceptChange: (segmentId: number, translationId: number) => void
  onRejectChange: (segmentId: number, translationId: number, previousText: string) => void
  onSetPendingQuotedText: (value: { segmentId: number; text: string } | null) => void
  onSetShowCommentsMargin: (show: boolean) => void
  onSetHighlightedCommentId: (id: number | null) => void
  onSetCrossHighlight: (value: { segmentId: number; sourceTerms: string[] } | null) => void
  onLookupResults?: (results: AutocompleteSuggestion[] | null) => void
  children?: React.ReactNode
}

/**
 * Encapsulates the 3-way display mode branching for the translation column.
 *
 * When isEditing: renders children (SegmentEditor + floating popup).
 * When not editing + track changes visible + has changes: renders InlineDiff.
 * When not editing + original mode + has previous_text: renders previous_text.
 * Default: renders TextHighlighter with comment highlights.
 * Also renders Accept/Reject buttons when appropriate.
 */
export default function TranslationDisplay({
  translation,
  segmentId,
  isEditing,
  comments,
  onAcceptChange,
  onRejectChange,
  onSetPendingQuotedText,
  onSetShowCommentsMargin,
  onSetHighlightedCommentId,
  onSetCrossHighlight,
  onLookupResults,
  children,
}: Props) {
  const { trackingEnabled, displayMode } = useEditorContext()

  const cleanText = translation ? extractCleanText(translation) : ''
  const hasChanges =
    !!translation?.previous_text &&
    translation.previous_text !== cleanText

  const showAcceptReject =
    trackingEnabled &&
    displayMode === 'all-markup' &&
    hasChanges &&
    !isEditing

  if (isEditing) {
    return <>{children}</>
  }

  if (!translation?.translated_text) {
    return (
      <p className="text-sm text-ink-700 dark:text-cream-dim leading-relaxed whitespace-pre-wrap font-body">
        <span className="text-parchment-300 dark:text-ink-400 italic">No translation yet</span>
      </p>
    )
  }

  const onComment = (selectedText: string) => {
    onSetPendingQuotedText({ segmentId, text: selectedText })
    onSetShowCommentsMargin(true)
  }

  let displayContent: React.ReactNode

  if (trackingEnabled && displayMode === 'all-markup' && hasChanges) {
    displayContent = (
      <SourceTextSelection onComment={onComment}>
        <InlineDiff
          oldText={translation.previous_text!}
          newText={cleanText}
          authorId={translation.updated_by}
          comments={comments}
          onClickComment={(commentId) => {
            onSetShowCommentsMargin(true)
            onSetHighlightedCommentId(commentId)
          }}
        />
      </SourceTextSelection>
    )
  } else if (trackingEnabled && displayMode === 'original' && translation.previous_text) {
    displayContent = (
      <SourceTextSelection onComment={onComment}>
        <p className="text-sm text-ink-700 dark:text-cream-dim leading-relaxed whitespace-pre-wrap font-body">
          {translation.previous_text}
        </p>
      </SourceTextSelection>
    )
  } else {
    displayContent = (
      <SourceTextSelection
        onComment={onComment}
        onLookupResults={(results) => {
          if (onLookupResults) {
            onLookupResults(results)
          } else if (results && results.length > 0) {
            onSetCrossHighlight({
              segmentId,
              sourceTerms: [...new Set(results.map((r) => r.source_term))],
            })
          } else {
            onSetCrossHighlight(null)
          }
        }}
      >
        <TextHighlighter
          text={cleanText}
          comments={comments}
          onClickHighlight={(commentId) => {
            onSetShowCommentsMargin(true)
            onSetHighlightedCommentId(commentId)
          }}
          className="text-sm text-ink-700 dark:text-cream-dim leading-relaxed whitespace-pre-wrap font-body"
        />
      </SourceTextSelection>
    )
  }

  return (
    <>
      {displayContent}
      {showAcceptReject && (
        <div className="flex items-center gap-1 mt-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAcceptChange(segmentId, translation.id)
            }}
            className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-body font-medium rounded bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
          >
            <CheckCircle className="w-2.5 h-2.5" /> Accept
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRejectChange(segmentId, translation.id, translation.previous_text!)
            }}
            className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-body font-medium rounded bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            <AlertCircle className="w-2.5 h-2.5" /> Reject
          </button>
        </div>
      )}
    </>
  )
}
