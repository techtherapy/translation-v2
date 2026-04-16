import React from 'react'
import {
  Zap, Loader2, CheckCircle, AlertCircle,
  Scissors, Merge, AlertTriangle, GitCompareArrows,
  History, FileDiff, MessageSquare, CheckSquare, Square, Undo2, Redo2,
} from 'lucide-react'
import SegmentEditor, { type SegmentEditorHandle, type EditorSelectionInfo } from './SegmentEditor'
import HighlightedSourceText from './HighlightedSourceText'
import SourceTextSelection from './SourceTextSelection'
import SegmentAnnotationMargin from './SegmentAnnotationMargin'
import TranslationDisplay from './TranslationDisplay'
import { useEditorContext } from './EditorContext'
import { TRANSLATION_STATUS_BADGES } from '../../utils/statusBadges'
import type { Segment, Language, SegmentComment, ChapterCommentsData } from '../../types'
import type { DetectedTerm, AutocompleteSuggestion } from '../../api/glossary'
import { extractCleanText } from '../../utils/translationContent'
import type { QAIssue } from '../../api/qa'

// --- Status row background colors ---
export const STATUS_ROW_COLORS: Record<string, string> = {
  empty: '',
  machine_translated: 'border-l-2 border-l-purple-400/40',
  draft: 'border-l-2 border-l-amber-400/40',
  under_review: 'border-l-2 border-l-blue-400/40',
  approved: 'border-l-2 border-l-green-400/40',
  needs_revision: 'border-l-2 border-l-red-400/40',
}

export const CJK_LANGUAGE_CODES = new Set(['zh', 'ja', 'ko'])

// --- Helper: count Chinese characters / English words ---
export function countChineseChars(text: string): number {
  return (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
}

export function countEnglishWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

// --- Highlight substrings ---
function HighlightSubstrings({ text, terms }: { text: string; terms: string[] }) {
  const ranges: { start: number; end: number }[] = []
  for (const term of terms) {
    let idx = 0
    while ((idx = text.indexOf(term, idx)) !== -1) {
      ranges.push({ start: idx, end: idx + term.length })
      idx += term.length
    }
  }
  if (ranges.length === 0) return <>{text}</>
  ranges.sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const r of ranges) {
    if (merged.length === 0 || r.start >= merged[merged.length - 1].end) {
      merged.push(r)
    }
  }
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const r of merged) {
    if (r.start > cursor) parts.push(<span key={`t-${cursor}`}>{text.slice(cursor, r.start)}</span>)
    parts.push(
      <span key={`h-${r.start}`} className="bg-gold/40 dark:bg-gold/30 border-b-2 border-gold rounded-sm px-0.5 text-ink-950 dark:text-cream font-medium animate-highlight-pulse">
        {text.slice(r.start, r.end)}
      </span>,
    )
    cursor = r.end
  }
  if (cursor < text.length) parts.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>)
  return <>{parts}</>
}

// --- Split view ---
function SplitView({ text, segmentId, onSplit, fontClass = 'font-chinese' }: { text: string; segmentId: number; onSplit: (segmentId: number, position: number) => void; fontClass?: string }) {
  const boundaries: number[] = []
  for (let i = 0; i < text.length; i++) {
    if ('。！？；'.includes(text[i]) && i < text.length - 1) boundaries.push(i + 1)
    if (text[i] === '「' && i > 0 && !boundaries.includes(i)) boundaries.push(i)
    if (text[i] === '」' && i < text.length - 1) boundaries.push(i + 1)
  }
  if (boundaries.length === 0) {
    return (
      <p className={`text-sm text-ink-850 dark:text-cream leading-relaxed whitespace-pre-wrap ${fontClass}`}>
        <span className="text-parchment-400 dark:text-ink-400 italic text-xs font-body">No split points found</span>
        <br />{text}
      </p>
    )
  }
  const parts: React.ReactNode[] = []
  let prev = 0
  for (const pos of boundaries) {
    parts.push(<span key={`t-${pos}`}>{text.slice(prev, pos)}</span>)
    parts.push(
      <button key={`m-${pos}`} onClick={(e) => { e.stopPropagation(); onSplit(segmentId, pos) }}
        className="inline-flex items-center mx-0.5 px-1 py-0 text-gold hover:text-ink-950 hover:bg-gold rounded text-xs font-bold transition-colors cursor-pointer align-baseline"
        title={`Split here (position ${pos})`}>✂</button>,
    )
    prev = pos
  }
  if (prev < text.length) parts.push(<span key="tail">{text.slice(prev)}</span>)
  return (
    <div className={`text-sm text-ink-850 dark:text-cream leading-relaxed ${fontClass}`}>
      <div className="text-[10px] text-gold mb-1 font-body">Click ✂ to split at that point</div>
      {parts}
    </div>
  )
}

// --- Status Dropdown ---
function StatusDropdown({ currentStatus, onChange }: { currentStatus: string; onChange: (status: string) => void }) {
  const statuses = ['draft', 'machine_translated', 'under_review', 'approved', 'needs_revision']
  const badge = TRANSLATION_STATUS_BADGES[currentStatus]
  return (
    <select
      value={currentStatus}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className={`text-[10px] px-2 py-0.5 rounded-full font-medium font-body border border-transparent cursor-pointer appearance-none pr-5 ${badge?.color || 'bg-parchment-200 text-parchment-500 dark:bg-ink-700 dark:text-cream-muted'}`}
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
    >
      {statuses.map((s) => (
        <option key={s} value={s}>{TRANSLATION_STATUS_BADGES[s]?.label || s}</option>
      ))}
    </select>
  )
}

// --- SegmentRow Props ---
export interface SegmentRowProps {
  segment: Segment
  segIdx: number
  totalFilteredSegments: number
  prevSegmentParagraphGroup: number | undefined

  // Per-segment UI state
  isActive: boolean
  isEditing: boolean
  isSplitting: boolean
  isSelected: boolean
  translating: number | null
  compactMode: boolean

  // Annotation margin visibility
  showCommentsMargin: boolean
  showChangesMargin: boolean

  // Pivot translations
  sourceLanguageId: number | null
  pivotTranslations: Map<number, { text: string; status: string }>
  languages: Language[]
  btSourceLanguageName: string | undefined

  // Glossary
  detectedTerms: DetectedTerm[]
  activeQaMissing: QAIssue[]
  crossHighlight: { segmentId: number; sourceTerms: string[] } | null

  // Comments
  chapterComments: ChapterCommentsData | null
  pendingQuotedText: { segmentId: number; text: string } | null

  // Editor
  editorSaveStatus: 'idle' | 'saving' | 'saved' | 'error'
  editorSelection: { segmentId: number; info: EditorSelectionInfo } | null
  segmentEditorRef: React.RefObject<SegmentEditorHandle | null>

  // Callbacks
  onSegmentClick: (segmentId: number) => void
  onMouseEnter: (segmentId: number) => void
  onMouseLeave: (segmentId: number) => void
  onToggleSelection: (segmentId: number) => void
  onSaveTranslation: (translationId: number, text: string, format?: 'plain' | 'prosemirror') => Promise<void>
  onCreateTranslation: (segmentId: number, text: string, format?: 'plain' | 'prosemirror') => Promise<void>
  onStatusChange: (translationId: number, status: string) => void
  onTranslateSegment: (segmentId: number) => void
  onSplit: (segmentId: number, position: number) => void
  onMerge: (segmentId: number) => void
  onAcceptChange: (segmentId: number, translationId: number) => void
  onRejectChange: (segmentId: number, translationId: number, previousText: string) => void
  onOpenReview: (segmentId: number, translation: { id: number; translated_text: string }) => void
  onCompare: (segment: Segment) => void
  onVersionHistory: (translation: { id: number; text: string }) => void
  onToggleCommentsMargin: () => void
  onSetEditorSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  onEditorSelectionChange: (selection: { segmentId: number; info: EditorSelectionInfo } | null) => void
  onSetPendingQuotedText: (value: { segmentId: number; text: string } | null) => void
  onSetShowCommentsMargin: (show: boolean) => void
  onSetHighlightedCommentId: (id: number | null) => void
  onSetCrossHighlight: (value: { segmentId: number; sourceTerms: string[] } | null) => void
  onSetQuickAddTerm: (value: { source_term: string; translated_term?: string } | null) => void
  onEditTerm: (termId: number) => void
  lookupGlossary: (text: string) => Promise<AutocompleteSuggestion[]>

  // Annotation margin callbacks
  onLoadComments: (delay?: number) => void
  onCommentCreated: (newComment: SegmentComment) => void
  onMutateComments: (updater: (comments: SegmentComment[]) => SegmentComment[]) => void
  onEnsureCommentsVisible: () => void
  onNavigateToComment: (commentId: number) => void
  onAnnotationAcceptChange: (segId: number, transId: number, resolvedText: string) => void
  onAnnotationRejectChange: (segId: number, transId: number, previousText: string) => void
  onHunkResolve: (segId: number, transId: number, newTranslatedText: string, newPreviousText: string | null) => Promise<void>
  onPendingQuotedTextConsumed: () => void
}

const SegmentRow = React.memo(function SegmentRow({
  segment,
  segIdx,
  totalFilteredSegments,
  prevSegmentParagraphGroup,
  isActive,
  isEditing,
  isSplitting,
  isSelected,
  translating,
  compactMode,
  showCommentsMargin,
  showChangesMargin,
  sourceLanguageId,
  pivotTranslations,
  languages,
  btSourceLanguageName,
  detectedTerms,
  activeQaMissing,
  crossHighlight,
  chapterComments,
  pendingQuotedText,
  editorSaveStatus,
  editorSelection,
  segmentEditorRef,
  onSegmentClick,
  onMouseEnter,
  onMouseLeave,
  onToggleSelection,
  onSaveTranslation,
  onCreateTranslation,
  onStatusChange,
  onTranslateSegment,
  onSplit,
  onMerge,
  onAcceptChange,
  onRejectChange,
  onOpenReview,
  onCompare,
  onVersionHistory,
  onToggleCommentsMargin,
  onSetEditorSaveStatus,
  onEditorSelectionChange,
  onSetPendingQuotedText,
  onSetShowCommentsMargin,
  onSetHighlightedCommentId,
  onSetCrossHighlight,
  onSetQuickAddTerm,
  onEditTerm,
  lookupGlossary,
  onLoadComments,
  onCommentCreated,
  onMutateComments,
  onEnsureCommentsVisible,
  onNavigateToComment,
  onAnnotationAcceptChange,
  onAnnotationRejectChange,
  onHunkResolve,
  onPendingQuotedTextConsumed,
}: SegmentRowProps) {
  const { selectedLanguageId, currentUserId, trackingEnabled, displayMode, sourceFont, hasPermission } = useEditorContext()

  const translation = segment.translations[0]
  const status = translation?.status || 'empty'
  const badge = TRANSLATION_STATUS_BADGES[status]
  const isLastSegment = segIdx === totalFilteredSegments - 1
  const sourceChars = countChineseChars(segment.source_text)
  const translatedClean = translation ? extractCleanText(translation) : ''
  const transWords = translatedClean ? countEnglishWords(translatedClean) : 0
  const isNewParagraphGroup = prevSegmentParagraphGroup !== undefined && segment.paragraph_group !== prevSegmentParagraphGroup

  return (
    <React.Fragment>
      {isNewParagraphGroup && (
        <div className="border-t-2 border-parchment-200 dark:border-ink-500/50 my-1" />
      )}
      <div className="flex relative">
        <div
          id={`segment-${segment.id}`}
          className={`flex-1 group/seg grid grid-cols-[auto_1fr_1fr] border-b border-parchment-200 dark:border-ink-700/50 transition-colors ${STATUS_ROW_COLORS[status] || ''} ${
            isActive ? 'bg-gold/5 dark:bg-gold-faint/30' : 'hover:bg-parchment-100/50 dark:hover:bg-ink-800/50'
          } ${isSelected ? 'bg-gold/10 dark:bg-gold-faint/20' : ''} ${(showCommentsMargin || showChangesMargin) ? 'mr-72' : ''}`}
          onClick={() => onSegmentClick(segment.id)}
          onMouseEnter={() => onMouseEnter(segment.id)}
          onMouseLeave={() => onMouseLeave(segment.id)}
        >
          {/* Checkbox */}
          <div className={`px-2 flex items-start ${compactMode ? 'py-1 pt-1.5' : 'py-3 pt-3.5'}`}>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelection(segment.id) }}
              className="text-parchment-300 dark:text-ink-400 hover:text-gold transition-colors"
            >
              {isSelected ? <CheckSquare className="w-3.5 h-3.5 text-gold" /> : <Square className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Source */}
          <div className={`px-4 ${compactMode ? 'py-1' : 'py-3'}`}>
            {/* Source header row */}
            <div className={`flex items-center gap-1.5 ${compactMode && !isActive ? 'mb-0' : 'mb-1'}`}>
              <span className="text-xs text-parchment-300 dark:text-cream-muted/40 text-segment-num">
                {segment.order}
              </span>
              {(!compactMode || isActive) && (
                <span className="text-[9px] text-parchment-300 dark:text-cream-muted/30 font-body tabular-nums">{sourceChars}</span>
              )}
              {isActive && !compactMode && hasPermission('segments.split_merge') && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); onSplit(segment.id, -1) }}
                    className={`p-0.5 rounded transition-colors ${isSplitting ? 'text-gold bg-gold-faint' : 'text-parchment-300 dark:text-ink-400 hover:text-gold'}`}
                    title="Split this segment into two">
                    <Scissors className="w-3 h-3" />
                  </button>
                  {!isLastSegment && (
                    <button onClick={(e) => { e.stopPropagation(); onMerge(segment.id) }}
                      className="p-0.5 rounded text-parchment-300 dark:text-ink-400 hover:text-jade transition-colors"
                      title="Merge with the segment below">
                      <Merge className="w-3 h-3" />
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="min-w-0">
              {/* Source text: pivot mode shows pivot as primary, original as secondary reference */}
              {sourceLanguageId ? (() => {
                const pivot = pivotTranslations.get(segment.id)
                const pivotLang = languages.find((l) => l.id === sourceLanguageId)
                return (
                  <>
                    {/* Status badge row */}
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium font-body ${
                        pivot?.status === 'approved'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {pivot?.status === 'approved' ? `${pivotLang?.name} approved` : `${pivotLang?.name}: ${pivot?.status || 'missing'}`}
                      </span>
                    </div>
                    {pivot?.text ? (
                      <p className="text-sm text-ink-850 dark:text-cream leading-relaxed whitespace-pre-wrap font-body">
                        {pivot.text}
                      </p>
                    ) : (
                      <p className="text-sm text-parchment-300 dark:text-ink-400 italic font-body">
                        No {pivotLang?.name || 'pivot'} translation
                      </p>
                    )}
                    {/* Original text reference */}
                    <details className="mt-2">
                      <summary className="text-[10px] text-parchment-400 dark:text-cream-muted/50 cursor-pointer font-body hover:text-parchment-500 dark:hover:text-cream-muted/70">
                        {btSourceLanguageName || 'Original'} text
                      </summary>
                      <p className={`text-xs text-parchment-400 dark:text-cream-muted/60 leading-relaxed whitespace-pre-wrap ${sourceFont} mt-1`}>
                        {segment.source_text}
                      </p>
                    </details>
                  </>
                )
              })() : (
                <>
                  {/* Direct source text */}
                  {isSplitting ? (
                    <SplitView text={segment.source_text} segmentId={segment.id} onSplit={onSplit} fontClass={sourceFont} />
                  ) : isActive && detectedTerms.length > 0 ? (
                    <SourceTextSelection onAddToGlossary={(text) => onSetQuickAddTerm({ source_term: text })} lookupGlossary={lookupGlossary} onEditTerm={onEditTerm} sourceFontClass={sourceFont}>
                      <HighlightedSourceText text={segment.source_text} detectedTerms={detectedTerms} fontClass={sourceFont} />
                    </SourceTextSelection>
                  ) : (
                    <SourceTextSelection onAddToGlossary={(text) => onSetQuickAddTerm({ source_term: text })} lookupGlossary={lookupGlossary} onEditTerm={onEditTerm} sourceFontClass={sourceFont}>
                      <p className={`text-sm text-ink-850 dark:text-cream leading-relaxed whitespace-pre-wrap ${sourceFont}`}>
                        {crossHighlight?.segmentId === segment.id ? (
                          <HighlightSubstrings text={segment.source_text} terms={crossHighlight.sourceTerms} />
                        ) : segment.source_text}
                      </p>
                    </SourceTextSelection>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Translation */}
          <div className={`px-4 border-l border-parchment-200 dark:border-ink-600/30 ${compactMode ? 'py-1' : 'py-3'}`}>
            <div className={`flex items-center justify-between gap-2 min-h-[24px] ${compactMode && !isActive ? 'mb-0' : 'mb-1'}`}>
              <div className="flex items-center gap-1.5">
                {translation ? (
                  <StatusDropdown currentStatus={status} onChange={(s) => onStatusChange(translation.id, s)} />
                ) : compactMode ? null : (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium font-body ${badge.color}`}>
                    {badge.label}
                  </span>
                )}
                {isActive && activeQaMissing.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium font-body bg-amber-50 text-amber-700 dark:bg-status-warning-bg dark:text-status-warning flex items-center gap-0.5">
                    <AlertTriangle className="w-3 h-3" />
                    {activeQaMissing.length}
                  </span>
                )}
                {/* Word count for active segment */}
                {isActive && transWords > 0 && (
                  <span className="text-[9px] text-parchment-300 dark:text-cream-muted/30 font-body tabular-nums">{transWords}w</span>
                )}
                {/* Editing toolbar */}
                {isEditing && (() => {
                  const getEd = () => segmentEditorRef.current?.getEditor()
                  const saveStatus = editorSaveStatus
                  const btn = "w-5 h-5 flex items-center justify-center rounded text-parchment-500 dark:text-cream-muted/70 hover:bg-parchment-100 dark:hover:bg-ink-600 hover:text-ink-850 dark:hover:text-cream transition-colors"
                  return (
                    <>
                      <div className="w-px h-3.5 bg-parchment-300 dark:bg-ink-500 mx-1" />
                      <button onClick={() => getEd()?.chain().focus().toggleBold().run()} className={`${btn} text-[11px] font-bold`} title="Bold (Ctrl+B)">B</button>
                      <button onClick={() => getEd()?.chain().focus().toggleItalic().run()} className={`${btn} text-[11px] italic`} title="Italic (Ctrl+I)">I</button>
                      <button onClick={() => getEd()?.chain().focus().undo().run()} className={btn} title="Undo (Ctrl+Z)"><Undo2 className="w-3 h-3" /></button>
                      <button onClick={() => getEd()?.chain().focus().redo().run()} className={btn} title="Redo (Ctrl+Shift+Z)"><Redo2 className="w-3 h-3" /></button>
                      <div className="w-px h-3.5 bg-parchment-300 dark:bg-ink-500 mx-1" />
                      {saveStatus === 'saved' ? (
                        <span className="flex items-center gap-1 text-[10px] text-jade dark:text-jade-light font-body">
                          <CheckCircle className="w-3 h-3" /> Saved
                        </span>
                      ) : saveStatus === 'error' ? (
                        <span className="flex items-center gap-1 text-[10px] text-red-500 font-body">
                          <AlertCircle className="w-3 h-3" /> Failed
                        </span>
                      ) : (
                        <span className="text-[10px] text-parchment-300 dark:text-cream-muted/30 font-body">Editing</span>
                      )}
                    </>
                  )
                })()}
              </div>
              {hasPermission('translations.ai_translate') && (
                <div className={`flex items-center gap-1 ${!isActive && !compactMode ? 'opacity-0 group-hover/seg:opacity-100 transition-opacity' : ''}`}>
                  {/* Review changes */}
                  {translation && translation.translated_text && (
                    trackingEnabled || (
                      translation.updated_by && translation.updated_by !== currentUserId &&
                      (status === 'under_review' || status === 'needs_revision')
                    )
                  ) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenReview(segment.id, translation) }}
                      className="text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors duration-200"
                      title="Review changes (interactive diff)"
                    >
                      <FileDiff className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {/* Version history */}
                  {translation && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onVersionHistory({ id: translation.id, text: extractCleanText(translation) }) }}
                      className="text-parchment-300 dark:text-ink-400 hover:text-gold transition-colors duration-200"
                      title="Version history (view previous edits)"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); onTranslateSegment(segment.id) }}
                    disabled={translating === segment.id}
                    className="text-parchment-300 dark:text-ink-400 hover:text-jade transition-colors duration-200"
                    title="AI Translate (Ctrl+Enter)">
                    {translating === segment.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onCompare(segment) }}
                    className="text-parchment-300 dark:text-ink-400 hover:text-gold transition-colors duration-200"
                    title="Compare AI models side-by-side">
                    <GitCompareArrows className="w-3.5 h-3.5" />
                  </button>
                  {(() => {
                    const count = chapterComments?.segment_comment_counts[String(segment.id)] || 0
                    return (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleCommentsMargin()
                        }}
                        className="relative p-0.5 text-parchment-400 hover:text-gold dark:text-cream-muted dark:hover:text-gold-light"
                        title={count > 0 ? `Comments (${count} unresolved)` : 'Add comment'}
                      >
                        <MessageSquare className="w-4 h-4" />
                        {count > 0 && (
                          <span className="absolute -top-1 -right-1.5 bg-red-500 text-white text-[8px] w-3.5 h-3.5 rounded-full flex items-center justify-center font-semibold">
                            {count}
                          </span>
                        )}
                      </button>
                    )
                  })()}
                </div>
              )}
            </div>

            <TranslationDisplay
              translation={translation}
              segmentId={segment.id}
              isEditing={isEditing && hasPermission('translations.edit')}
              comments={(chapterComments?.comments || []).filter(c => c.segment_id === segment.id)}
              onAcceptChange={onAcceptChange}
              onRejectChange={onRejectChange}
              onSetPendingQuotedText={onSetPendingQuotedText}
              onSetShowCommentsMargin={onSetShowCommentsMargin}
              onSetHighlightedCommentId={onSetHighlightedCommentId}
              onSetCrossHighlight={onSetCrossHighlight}
            >
              <SegmentEditor
                ref={segmentEditorRef as React.Ref<SegmentEditorHandle>}
                translation={translation || { id: 0, segment_id: segment.id, language_id: selectedLanguageId, translated_text: '', status: 'empty' as any, llm_model_used: null, token_count: 0, updated_at: '' }}
                onSave={(text, format) => translation && translation.id > 0 ? onSaveTranslation(translation.id, text, format) : onCreateTranslation(segment.id, text, format)}
                trackingEnabled={trackingEnabled}
                currentUserId={currentUserId}
                onSaveStatusChange={onSetEditorSaveStatus}
                onSelectionChange={(info) => onEditorSelectionChange(info ? { segmentId: segment.id, info } : null)}
                comments={(chapterComments?.comments || []).filter(c => c.segment_id === segment.id)}
              />
              {/* Floating comment popup for editor text selection */}
              {editorSelection?.segmentId === segment.id && editorSelection.info.text && (
                <div
                  className="fixed z-50 transform -translate-x-1/2 -translate-y-full"
                  style={{
                    left: editorSelection.info.rect.left + editorSelection.info.rect.width / 2,
                    top: editorSelection.info.rect.top - 8,
                  }}
                >
                  <div className="bg-ink-850 dark:bg-ink-700 text-cream text-xs rounded-md shadow-lg overflow-hidden">
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onSetPendingQuotedText({ segmentId: segment.id, text: editorSelection.info.text })
                        onSetShowCommentsMargin(true)
                        onEditorSelectionChange(null)
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 font-body font-medium text-amber-400 hover:bg-cream/10 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Comment
                    </button>
                  </div>
                  <div className="flex justify-center">
                    <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-ink-850 dark:border-t-ink-700" />
                  </div>
                </div>
              )}
            </TranslationDisplay>
          </div>
        </div>
        {/* Inline annotation margin */}
        {(showCommentsMargin || showChangesMargin) && (() => {
          const segComments = (chapterComments?.comments || []).filter(c => c.segment_id === segment.id)
          const segHasChanges = trackingEnabled && displayMode === 'all-markup' && !!translation?.previous_text && translation.previous_text !== (translation ? extractCleanText(translation) : '')
          const hasPending = pendingQuotedText?.segmentId === segment.id
          const hasContent = (showCommentsMargin && (segComments.length > 0 || hasPending)) || (showChangesMargin && segHasChanges)
          return (
            <div className="absolute right-0 top-0 w-72 border-l border-parchment-200 dark:border-ink-600/50 bg-parchment-50 dark:bg-ink-900/50 z-10"
              onClick={(e) => e.stopPropagation()}
            >
              {hasContent ? (
                <SegmentAnnotationMargin
                  segment={segment}
                  comments={segComments}
                  showComments={showCommentsMargin}
                  showChanges={showChangesMargin}
                  isActive={isActive}
                  languageId={selectedLanguageId}
                  currentUserId={currentUserId}
                  onUpdate={() => onLoadComments(300)}
                  onCommentCreated={onCommentCreated}
                  onMutate={onMutateComments}
                  pendingQuotedText={hasPending ? pendingQuotedText!.text : undefined}
                  onPendingQuotedTextConsumed={onPendingQuotedTextConsumed}
                  onEnsureCommentsVisible={onEnsureCommentsVisible}
                  onNavigateToComment={onNavigateToComment}
                  onAcceptChange={onAnnotationAcceptChange}
                  onRejectChange={onAnnotationRejectChange}
                  onHunkResolve={onHunkResolve}
                />
              ) : null}
            </div>
          )
        })()}
      </div>
    </React.Fragment>
  )
})

export default SegmentRow
