import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Zap, Loader2, AlertCircle, X,
  ChevronLeft, ChevronRight as ChevronRightIcon,
  AlertTriangle, GitCompareArrows,
  Keyboard, Search, CheckSquare, Square, MinusSquare,
  ArrowRightLeft, FileDiff, Minimize2, Maximize2, Pencil, Layers, PanelRight,
} from 'lucide-react'
import { getBook, listChapters, getChapterDetail, splitSegment, mergeSegment, updateBook, resegmentChapter } from '../../api/books'
import { extractCleanText } from '../../utils/translationContent'
import { translateSegment, batchTranslate, updateTranslation, createTranslation, batchUpdateStatus, getVersionHistory, resolveTrackChanges } from '../../api/translate'
import { listLanguages } from '../../api/languages'
import { getBookTranslation, listBTChapters, updateBookTranslation } from '../../api/bookTranslations'
import { getAvailableModels, getModelCatalog, type ProviderModels } from '../../api/settings'
import {
  detectGlossaryTerms, listCategories, createTerm, autocompleteTerms,
  getTerm, updateTerm, updateTranslation as updateGlossaryTranslation, addTranslation,
  type DetectedTerm,
} from '../../api/glossary'
import { checkGlossaryConsistency, type QAIssue } from '../../api/qa'
// getChapterComments is used inside useEditorComments hook
import { useAuth } from '../../stores/AuthContext'
import { useEditorShortcuts } from '../../hooks/useEditorShortcuts'
import { useSegmentFilter, type StatusFilter } from '../../hooks/useSegmentFilter'
import { useConfirm } from '../../hooks/useConfirm'
import ComparisonModal from './ComparisonModal'
import ChapterComparisonView from './ChapterComparisonView'
import { type SegmentEditorHandle, type EditorSelectionInfo } from './SegmentEditor'
import EditorBottomPanel from './EditorBottomPanel'
import FindReplaceBar from './FindReplaceBar'
import VersionHistoryPanel from './VersionHistoryPanel'
import ChangesPanel from './ChangesPanel'
import SegmentReviewPanel from './SegmentReviewPanel'
import ShortcutHelpOverlay from './ShortcutHelpOverlay'
import { EditorProvider } from './EditorContext'
import { useTrackChanges } from '../../hooks/useTrackChanges'
import { useEditorComments } from '../../hooks/useEditorComments'
import SegmentRow, { CJK_LANGUAGE_CODES, countChineseChars, countEnglishWords } from './SegmentRow'
import TermFormModal, { type TermFormData } from '../glossary/TermFormModal'
import type { Book, BookTranslation, Chapter, ChapterDetail, Segment, Language, GlossaryCategory, GlossaryTerm, ChapterCommentsData, SegmentComment } from '../../types'
import { extractErrorMessage } from '../../utils/extractErrorMessage'
import { TRANSLATION_STATUS_BADGES } from '../../utils/statusBadges'

// --- Progress Bar ---
function ProgressBar({ progress }: { progress: { total: number; empty: number; machine_translated: number; draft: number; under_review: number; approved: number; needs_revision: number } }) {
  if (progress.total === 0) return null
  const pct = (n: number) => `${(n / progress.total) * 100}%`
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-parchment-200 dark:bg-ink-700">
        <div className="bg-green-500 dark:bg-green-400" style={{ width: pct(progress.approved) }} title={`${progress.approved} approved`} />
        <div className="bg-blue-500 dark:bg-blue-400" style={{ width: pct(progress.under_review) }} title={`${progress.under_review} review`} />
        <div className="bg-amber-500 dark:bg-amber-400" style={{ width: pct(progress.draft) }} title={`${progress.draft} draft`} />
        <div className="bg-purple-500 dark:bg-purple-400" style={{ width: pct(progress.machine_translated) }} title={`${progress.machine_translated} MT`} />
        <div className="bg-red-500 dark:bg-red-400" style={{ width: pct(progress.needs_revision) }} title={`${progress.needs_revision} revision`} />
      </div>
      <span className="text-[10px] text-parchment-400 dark:text-cream-muted font-body tabular-nums shrink-0">
        {progress.approved}/{progress.total}
      </span>
    </div>
  )
}

// --- Filter Chips ---
function FilterChips({ statusFilter, setStatusFilter, progress }: {
  statusFilter: StatusFilter
  setStatusFilter: (f: StatusFilter) => void
  progress: { total: number; empty: number; machine_translated: number; draft: number; under_review: number; approved: number; needs_revision: number }
}) {
  const chips: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: progress.total },
    { key: 'empty', label: 'Empty', count: progress.empty },
    { key: 'machine_translated', label: 'AI', count: progress.machine_translated },
    { key: 'draft', label: 'Draft', count: progress.draft },
    { key: 'under_review', label: 'Review', count: progress.under_review },
    { key: 'approved', label: 'Approved', count: progress.approved },
    { key: 'needs_revision', label: 'Revision', count: progress.needs_revision },
  ]
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {chips.map((c) => {
        const badge = TRANSLATION_STATUS_BADGES[c.key]
        const badgeColor = badge?.color || 'bg-parchment-200 text-parchment-600 dark:bg-ink-700 dark:text-cream-muted'
        return (
          <button
            key={c.key}
            onClick={() => setStatusFilter(c.key)}
            className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full font-body font-medium transition-colors ${
              statusFilter === c.key
                ? `${badgeColor} ring-1 ring-gold/50`
                : `${badgeColor} opacity-60 hover:opacity-100`
            }`}
          >
            {c.label}
            {c.count > 0 && <span className="opacity-70">{c.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default function TranslationEditor() {
  const { bookId: routeBookId, chapterId, btId } = useParams<{ bookId?: string; chapterId: string; btId?: string }>()
  const { hasPermission, user } = useAuth()
  const confirm = useConfirm()
  const [bt, setBt] = useState<BookTranslation | null>(null)
  const [book, setBook] = useState<Book | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [chapter, setChapter] = useState<ChapterDetail | null>(null)
  const [languages, setLanguages] = useState<Language[]>([])
  const [selectedLanguageId, setSelectedLanguageId] = useState<number>(0)
  const [sourceLanguageId, setSourceLanguageId] = useState<number | null>(null) // null = book's source language
  // Resolved bookId: from btId context or route param
  const bookId = bt ? String(bt.book_id) : routeBookId
  // Use CJK font only when source language is CJK
  const sourceCode = bt?.source_language_code || book?.source_language_code || ''
  const sourceFont = CJK_LANGUAGE_CODES.has(sourceCode) ? 'font-chinese' : 'font-body'
  const [pivotTranslations, setPivotTranslations] = useState<Map<number, { text: string; status: string }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [translating, setTranslating] = useState<number | null>(null)
  const [batchRunning, setBatchRunning] = useState(false)
  const [activeSegment, setActiveSegment] = useState<number | null>(null)
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null)
  const [editingSegment, setEditingSegment] = useState<number | null>(null)
  const [splitMode, setSplitMode] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout>>()

  // Glossary integration state
  const [detectedTerms, setDetectedTerms] = useState<DetectedTerm[]>([])
  const [qaIssues, setQaIssues] = useState<QAIssue[]>([])
  const [quickAddTerm, setQuickAddTerm] = useState<{ source_term: string; translated_term?: string } | null>(null)
  const [categories, setCategories] = useState<GlossaryCategory[]>([])
  const [crossHighlight, setCrossHighlight] = useState<{ segmentId: number; sourceTerms: string[] } | null>(null)
  const [editingTerm, setEditingTerm] = useState<GlossaryTerm | null>(null)

  // A/B comparison state
  const [comparingSegment, setComparingSegment] = useState<Segment | null>(null)
  const [chapterCompareMode, setChapterCompareMode] = useState(false)

  // UI overlays
  const [showFindBar, setShowFindBar] = useState(false)
  const [showFindReplace, setShowFindReplace] = useState(false)
  const [showShortcutHelp, setShowShortcutHelp] = useState(false)
  const [versionHistoryTranslation, setVersionHistoryTranslation] = useState<{ id: number; text: string } | null>(null)
  const [reviewBaseText, setReviewBaseText] = useState('')
  const [reviewerName, setReviewerName] = useState('')
  // Track changes state managed by useTrackChanges hook
  const {
    trackingEnabled,
    displayMode,
    syncEnabled: syncTrackingEnabled,
    toggleTracking,
    cycleDisplayMode,
    switchToMarkupIfOriginal,
  } = useTrackChanges({ btId, loadChapter })
  const [editorSaveStatus, setEditorSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // Display
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem('editor_compact') === 'true')
  const [editingBookTitle, setEditingBookTitle] = useState<string | null>(null)

  // Model selector
  const [availableModels, setAvailableModels] = useState<ProviderModels[]>([])
  const [defaultModelName, setDefaultModelName] = useState('Default')

  // Comments & annotation margin — managed by useEditorComments hook
  const {
    chapterComments,
    commentFilter,
    pendingQuotedText,
    showCommentsMargin,
    showChangesMargin,
    editorSelection,
    setCommentFilter,
    setEditorSelection,
    setPendingQuotedText,
    loadComments,
    handleCommentCreated,
    handleCommentMutate,
    consumePendingQuotedText,
    ensureCommentsVisible,
    ensureChangesVisible,
    toggleCommentsMargin,
    toggleChangesMargin,
    getSegmentComments,
  } = useEditorComments({ chapterId, languageId: selectedLanguageId })
  const [highlightedCommentId, setHighlightedCommentId] = useState<number | null>(null)

  // Auto-clear highlight after 2 seconds
  useEffect(() => {
    if (highlightedCommentId === null) return
    const timer = setTimeout(() => setHighlightedCommentId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightedCommentId])

  // Clear editor selection popup when switching segments
  useEffect(() => { setEditorSelection(null) }, [editingSegment])


  // Re-segment
  const [showResegmentModal, setShowResegmentModal] = useState(false)
  const [resegmentGranularity, setResegmentGranularity] = useState<'sentence' | 'paragraph' | 'chapter'>('sentence')
  const [resegmenting, setResegmenting] = useState(false)
  const [resegmentConfirmed, setResegmentConfirmed] = useState(false)

  // Batch selection
  const [selectedSegments, setSelectedSegments] = useState<Set<number>>(new Set())

  // Editor ref for imperative save
  const segmentEditorRef = useRef<SegmentEditorHandle>(null)

  // Segment filter
  const { statusFilter, setStatusFilter, filteredSegments: statusFilteredSegments, progress } = useSegmentFilter(chapter?.segments || [])

  // Apply comment filter on top of status filter
  const filteredSegments = useMemo(() => {
    if (!commentFilter || !chapterComments) return statusFilteredSegments
    return statusFilteredSegments.filter(s => chapterComments.segment_comment_counts[String(s.id)])
  }, [statusFilteredSegments, commentFilter, chapterComments])

  // beforeunload warning
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (segmentEditorRef.current?.hasUnsavedChanges()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Load available models for model selector
  useEffect(() => {
    getAvailableModels().then(setAvailableModels).catch(console.error)
    getModelCatalog().then(catalog => {
      const dm = catalog.models.find(m => m.id === catalog.default_model)
      if (dm) setDefaultModelName(`Default (${dm.name})`)
    }).catch(console.error)
  }, [])

  function showError(err: unknown) {
    const msg = extractErrorMessage(err)
    setError(msg)
    clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(null), 8000)
  }

  useEffect(() => {
    loadInitial()
    setSplitMode(null)
    setEditingSegment(null)
  }, [btId, routeBookId, chapterId])

  useEffect(() => {
    if (selectedLanguageId && chapterId && bookId) {
      loadChapter()
    }
  }, [selectedLanguageId])

  useEffect(() => { loadComments() }, [selectedLanguageId, chapterId])

  // Load pivot translations when source language changes
  useEffect(() => {
    if (sourceLanguageId && chapterId && bookId) {
      getChapterDetail(parseInt(bookId!), parseInt(chapterId!), sourceLanguageId)
        .then((pivotChapter) => {
          const map = new Map<number, { text: string; status: string }>()
          for (const seg of pivotChapter.segments) {
            const t = seg.translations[0]
            if (t) map.set(seg.id, { text: t.translated_text, status: t.status })
          }
          setPivotTranslations(map)
        })
        .catch(() => setPivotTranslations(new Map()))
    } else {
      setPivotTranslations(new Map())
    }
  }, [sourceLanguageId, bookId, chapterId])

  // Detect glossary terms when active segment or language changes
  useEffect(() => {
    if (activeSegment && selectedLanguageId && chapter) {
      const segment = chapter.segments.find((s) => s.id === activeSegment)
      if (segment) {
        detectGlossaryTerms(segment.source_text, selectedLanguageId)
          .then((r) => setDetectedTerms(r.terms))
          .catch(() => setDetectedTerms([]))

        const translation = segment.translations[0]
        if (translation?.translated_text) {
          checkGlossaryConsistency({
            source_text: segment.source_text,
            translated_text: translation.translated_text,
            language_id: selectedLanguageId,
          })
            .then((result) => setQaIssues(result.issues))
            .catch(() => setQaIssues([]))
        } else {
          setQaIssues([])
        }
      }
    } else {
      setDetectedTerms([])
      setQaIssues([])
    }
  }, [activeSegment, selectedLanguageId, chapter])

  async function loadInitial() {
    setLoading(true)
    try {
      let resolvedBookId: number
      let langId: number
      let srcLangId: number | null = null
      let resolvedChapters: Chapter[]

      if (btId) {
        // BookTranslation mode: language pair is fixed
        const btData = await getBookTranslation(parseInt(btId))
        setBt(btData)
        // Initialize tracking toggle from DB field
        syncTrackingEnabled(!!btData.track_changes)
        resolvedBookId = btData.book_id
        langId = btData.target_language_id
        srcLangId = btData.source_language_id

        const [b, chs, langs, cats] = await Promise.all([
          getBook(resolvedBookId),
          listBTChapters(parseInt(btId)),
          listLanguages(),
          listCategories(),
        ])
        setBook(b)
        resolvedChapters = chs
        setChapters(chs)
        setLanguages(langs)
        setCategories(cats)
      } else {
        // Legacy mode: language selected via dropdown
        resolvedBookId = parseInt(routeBookId!)
        const [b, chs, langs, cats] = await Promise.all([
          getBook(resolvedBookId),
          listChapters(resolvedBookId),
          listLanguages(),
          listCategories(),
        ])
        setBook(b)
        resolvedChapters = chs
        setChapters(chs)
        setLanguages(langs)
        setCategories(cats)

        const en = langs.find((l) => l.code === 'en')
        langId = en?.id || langs[0]?.id || 0
      }

      setSelectedLanguageId(langId)
      setSourceLanguageId(srcLangId)

      const ch = await getChapterDetail(resolvedBookId, parseInt(chapterId!), langId)
      setChapter(ch)
    } catch (err) {
      console.error('Failed to load editor data:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadChapter() {
    try {
      const ch = await getChapterDetail(parseInt(bookId!), parseInt(chapterId!), selectedLanguageId)
      setChapter(ch)
      loadComments()
    } catch (err) {
      console.error('Failed to load chapter:', err)
    }
  }

  // --- Optimistic local segment update (avoids full reload flicker) ---
  function updateSegmentLocally(segmentId: number, updater: (seg: Segment) => Segment) {
    setChapter((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        segments: prev.segments.map((s) => (s.id === segmentId ? updater(s) : s)),
      }
    })
  }

  const handleTranslateSegment = useCallback(async (segmentId: number) => {
    if (!selectedLanguageId) return

    // Warn if overwriting manually edited content
    const seg = chapter?.segments.find(s => s.id === segmentId)
    const existing = seg?.translations[0]
    if (existing?.translated_text && existing.status === 'draft') {
      const ok = await confirm({
        message: 'This segment has been manually edited. AI translate will replace your changes. Previous versions are saved in history.',
        confirmLabel: 'Replace',
        variant: 'warning',
      })
      if (!ok) return
    }

    // Clear unsaved editor changes so unmount save doesn't restore old content
    segmentEditorRef.current?.clearUnsavedChanges()
    setTranslating(segmentId)
    setError(null)
    try {
      const result = await translateSegment({
        segment_id: segmentId,
        language_id: btId ? undefined : selectedLanguageId,
        source_language_id: btId ? undefined : sourceLanguageId,
        book_translation_id: btId ? parseInt(btId) : undefined,
      })
      // Optimistic update
      updateSegmentLocally(segmentId, (seg) => ({
        ...seg,
        translations: seg.translations.length > 0
          ? seg.translations.map((t, i) => i === 0 ? {
              ...t,
              translated_text: result.translated_text,
              content_format: 'plain' as const,
              previous_text: null,
              status: result.status as any,
              llm_model_used: result.model_used,
            } : t)
          : [{ id: 0, segment_id: segmentId, language_id: selectedLanguageId, translated_text: result.translated_text, content_format: 'plain' as const, status: result.status as any, llm_model_used: result.model_used, token_count: result.token_count, updated_at: new Date().toISOString() }],
      }))
    } catch (err) {
      showError(err)
    } finally {
      setTranslating(null)
    }
  }, [selectedLanguageId, btId, sourceLanguageId, chapter, confirm])

  async function handleBatchTranslate() {
    if (!chapterId || !selectedLanguageId) return
    setBatchRunning(true)
    setError(null)

    const pollInterval = setInterval(() => { loadChapter() }, 5000)

    try {
      await batchTranslate({
        chapter_id: parseInt(chapterId),
        language_id: btId ? undefined : selectedLanguageId,
        source_language_id: btId ? undefined : sourceLanguageId,
        book_translation_id: btId ? parseInt(btId) : undefined,
      })
      await loadChapter()
    } catch (err) {
      showError(err)
      await loadChapter()
    } finally {
      clearInterval(pollInterval)
      setBatchRunning(false)
    }
  }

  const handleSaveTranslation = useCallback(async (translationId: number, text: string, format?: 'plain' | 'prosemirror') => {
    try {
      const result = await updateTranslation(translationId, {
        translated_text: text,
        status: 'draft',
        content_format: format || 'plain',
      })
      // Optimistic update — update text and capture previous_text on format transition
      setChapter((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          segments: prev.segments.map((seg) => ({
            ...seg,
            translations: seg.translations.map((t) => {
              if (t.id !== translationId) return t
              // Capture previous_text exactly once: when format transitions to prosemirror
              const shouldCapturePrevText = format === 'prosemirror' && !t.previous_text && t.content_format !== 'prosemirror'
              return {
                ...t,
                translated_text: result.translated_text,
                status: result.status as any,
                content_format: format || t.content_format,
                previous_text: shouldCapturePrevText ? t.translated_text : t.previous_text,
              }
            }),
          })),
        }
      })

      // Run glossary QA check — read chapter from state setter to avoid stale closure
      setChapter((prev) => {
        if (prev) {
          const segment = prev.segments.find((s) => s.translations.some((t) => t.id === translationId))
          if (segment && text) {
            checkGlossaryConsistency({ source_text: segment.source_text, translated_text: text, language_id: selectedLanguageId })
              .then((r) => setQaIssues(r.issues))
              .catch(() => setQaIssues([]))
          }
        }
        return prev
      })
    } catch (err) {
      showError(err)
      throw err // re-throw so SegmentEditor knows save failed
    }
  }, [selectedLanguageId])

  // Legacy accept/reject for inline buttons (diff-based, not plugin-based)
  // Both clear unsaved editor changes before exiting editing to prevent the
  // unmount save from overwriting the accept/reject with stale JSON content.
  const handleAcceptChange = useCallback(async (segmentId: number, translationId: number) => {
    try {
      let translatedText: string | undefined
      let contentFormat: string | undefined
      setChapter((prev) => {
        if (prev) {
          const seg = prev.segments.find((s) => s.id === segmentId)
          const t = seg?.translations[0]
          if (t) {
            translatedText = t.translated_text
            contentFormat = t.content_format
          }
        }
        return prev
      })
      if (!translatedText) return
      const cleanText = contentFormat === 'prosemirror'
        ? extractCleanText({ content_format: contentFormat, translated_text: translatedText })
        : translatedText
      await updateTranslation(translationId, { translated_text: cleanText, status: 'draft', content_format: 'plain' })
      segmentEditorRef.current?.clearUnsavedChanges()
      setEditingSegment((prev) => (prev === segmentId ? null : prev))
      setChapter((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          segments: prev.segments.map((s) =>
            s.id === segmentId
              ? { ...s, translations: s.translations.map((tr) => tr.id === translationId ? { ...tr, translated_text: cleanText, previous_text: cleanText, content_format: 'plain' as const } : tr) }
              : s
          ),
        }
      })
    } catch (err) {
      console.error('Accept change failed:', err)
    }
  }, [])

  const handleRejectChange = useCallback(async (segmentId: number, translationId: number, previousText: string) => {
    try {
      await updateTranslation(translationId, { translated_text: previousText, status: 'draft', content_format: 'plain' })
      segmentEditorRef.current?.clearUnsavedChanges()
      setEditingSegment((prev) => (prev === segmentId ? null : prev))
      setChapter((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          segments: prev.segments.map((s) =>
            s.id === segmentId
              ? { ...s, translations: s.translations.map((tr) => tr.id === translationId ? { ...tr, translated_text: previousText, previous_text: previousText, content_format: 'plain' as const } : tr) }
              : s
          ),
        }
      })
    } catch (err) {
      console.error('Reject change failed:', err)
    }
  }, [])

  const handleOpenReview = useCallback(async (segmentId: number, translation: { id: number; translated_text: string }) => {
    try {
      const versions = await getVersionHistory(translation.id)
      // Find the current user's last version (the translator's baseline)
      const myLastVersion = versions.find(v => v.created_by === user?.id)
      if (!myLastVersion) {
        // No prior version by this user — use the oldest version as baseline
        const oldest = versions[versions.length - 1]
        if (!oldest) return
        setReviewBaseText(oldest.translated_text)
      } else {
        setReviewBaseText(myLastVersion.translated_text)
      }
      // Find the reviewer who made the latest edit
      const latestByOther = versions.find(v => v.created_by !== user?.id)
      setReviewerName(latestByOther?.created_by_username || 'Reviewer')
      ensureChangesVisible()
      setActiveSegment(segmentId)
    } catch (err) {
      console.error('Failed to load review data:', err)
    }
  }, [user?.id])

  async function handleResolveReview(segmentId: number, translationId: number, resolvedText: string) {
    try {
      await handleSaveTranslation(translationId, resolvedText, 'plain')
    } catch (err) {
      // Error already shown by handleSaveTranslation
    }
  }

  const handleCreateTranslation = useCallback(async (segmentId: number, text: string, format?: 'plain' | 'prosemirror') => {
    if (!text.trim()) return // don't create empty translation rows
    try {
      const result = await createTranslation({
        segment_id: segmentId,
        language_id: selectedLanguageId,
        translated_text: text,
        status: 'draft',
        content_format: format || 'plain',
      })
      // Update local state with the real translation ID from the response
      setChapter((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          segments: prev.segments.map((seg) =>
            seg.id === segmentId
              ? {
                  ...seg,
                  translations: [{
                    id: result.translation_id || 0,
                    segment_id: segmentId,
                    language_id: selectedLanguageId,
                    translated_text: result.translated_text,
                    content_format: format || 'plain' as const,
                    status: result.status as any,
                    llm_model_used: null,
                    token_count: 0,
                    updated_at: new Date().toISOString(),
                  }],
                }
              : seg
          ),
        }
      })
    } catch (err) {
      showError(err)
      throw err
    }
  }, [selectedLanguageId])

  const handleStatusChange = useCallback(async (translationId: number, newStatus: string) => {
    try {
      // Read translation text from state to avoid stale closure
      let translatedText: string | undefined
      let contentFormat: string | undefined
      setChapter(prev => {
        if (prev) {
          for (const seg of prev.segments) {
            const t = seg.translations.find(t => t.id === translationId)
            if (t) { translatedText = t.translated_text; contentFormat = t.content_format; break }
          }
        }
        return prev
      })
      if (translatedText === undefined) return
      await updateTranslation(translationId, { translated_text: translatedText, status: newStatus, content_format: contentFormat })
      // Optimistic update
      setChapter((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          segments: prev.segments.map((seg) => ({
            ...seg,
            translations: seg.translations.map((t) =>
              t.id === translationId ? { ...t, status: newStatus as any } : t
            ),
          })),
        }
      })
    } catch (err) {
      showError(err)
    }
  }, [])

  async function handleBatchStatusUpdate(status: string) {
    const translationIds: number[] = []
    for (const segId of selectedSegments) {
      const seg = chapter?.segments.find((s) => s.id === segId)
      if (seg?.translations[0]) translationIds.push(seg.translations[0].id)
    }
    if (translationIds.length === 0) return

    try {
      await batchUpdateStatus({ translation_ids: translationIds, status })
      // Optimistic update
      setChapter((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          segments: prev.segments.map((seg) => ({
            ...seg,
            translations: seg.translations.map((t) =>
              translationIds.includes(t.id) ? { ...t, status: status as any } : t
            ),
          })),
        }
      })
      setSelectedSegments(new Set())
    } catch (err) {
      showError(err)
    }
  }

  const handleSplit = useCallback(async (segmentId: number, position: number) => {
    if (position === -1) {
      // Toggle split mode (called from split button in SegmentRow)
      setSplitMode(prev => prev === segmentId ? null : segmentId)
      return
    }
    setSplitMode(null)
    setError(null)
    try {
      const ch = await splitSegment(parseInt(bookId!), parseInt(chapterId!), segmentId, position)
      setChapter(ch)
    } catch (err) {
      showError(err)
    }
  }, [bookId, chapterId])

  const handleMerge = useCallback(async (segmentId: number) => {
    setError(null)
    try {
      const ch = await mergeSegment(parseInt(bookId!), parseInt(chapterId!), segmentId)
      setChapter(ch)
    } catch (err) {
      showError(err)
    }
  }, [bookId, chapterId])

  async function handleModelChange(model: string) {
    if (!bt) return
    const newModel = model || null
    setBt(prev => prev ? { ...prev, llm_model: newModel } : prev)
    try {
      const updated = await updateBookTranslation(bt.id, { llm_model: newModel })
      setBt(updated)
    } catch (err) {
      console.error('Failed to update model:', err)
      setBt(prev => prev ? { ...prev, llm_model: bt.llm_model } : prev)
    }
  }

  async function handleResegment() {
    if (!bookId || !chapterId) return
    setResegmenting(true)
    try {
      const ch = await resegmentChapter(parseInt(bookId), parseInt(chapterId), resegmentGranularity)
      setChapter(ch)
      setShowResegmentModal(false)
    } catch (err) {
      showError(err)
    } finally {
      setResegmenting(false)
    }
  }

  async function handleQuickAddSave(data: TermFormData) {
    await createTerm({
      source_term: data.source_term,
      sanskrit_pali: data.sanskrit_pali,
      category: data.category,
      tbs_notes: data.tbs_notes,
      context_notes: data.context_notes,
      do_not_translate: data.do_not_translate,
      transliterate: data.transliterate,
      project_tags: data.project_tags,
      source_reference: data.source_reference,
      tradition_group: data.tradition_group,
      translations: data.translated_term
        ? [{ language_id: selectedLanguageId, translated_term: data.translated_term, is_preferred: true, notes: '' }]
        : [],
    })
    setQuickAddTerm(null)
    redetectTerms()
  }

  async function handleEditTerm(termId: number) {
    try {
      const term = await getTerm(termId)
      setEditingTerm(term)
    } catch (err) {
      showError(err)
    }
  }

  async function handleEditSave(data: TermFormData) {
    if (!editingTerm) return
    await updateTerm(editingTerm.id, {
      source_term: data.source_term,
      sanskrit_pali: data.sanskrit_pali,
      category: data.category,
      tbs_notes: data.tbs_notes,
      context_notes: data.context_notes,
      do_not_translate: data.do_not_translate,
      transliterate: data.transliterate,
      project_tags: data.project_tags,
      source_reference: data.source_reference,
      tradition_group: data.tradition_group,
    })
    const langTranslation = editingTerm.translations.find((t) => t.language_id === selectedLanguageId)
    if (data.translated_term) {
      if (langTranslation) {
        await updateGlossaryTranslation(langTranslation.id, { translated_term: data.translated_term })
      } else {
        await addTranslation(editingTerm.id, { language_id: selectedLanguageId, translated_term: data.translated_term, is_preferred: true })
      }
    }
    setEditingTerm(null)
    redetectTerms()
  }

  function redetectTerms() {
    if (activeSegment && chapter) {
      const segment = chapter.segments.find((s) => s.id === activeSegment)
      if (segment) {
        detectGlossaryTerms(segment.source_text, selectedLanguageId)
          .then((r) => setDetectedTerms(r.terms))
          .catch(() => {})
      }
    }
  }

  const lookupGlossary = useCallback(async (text: string) => {
    const result = await autocompleteTerms(text, 5, 0, selectedLanguageId || undefined)
    return result.suggestions
  }, [selectedLanguageId])

  // --- Stable callbacks for SegmentRow ---
  const handleSegmentClick = useCallback((segmentId: number) => {
    setActiveSegment(segmentId)
    // Don't enter edit mode if user is selecting text (drag-select)
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      setEditingSegment(segmentId)
    }
    setCrossHighlight(null)
    setSplitMode(prev => prev === segmentId ? prev : null)
    // Auto-switch from Original to All Markup when entering edit mode
    switchToMarkupIfOriginal()
  }, [trackingEnabled, switchToMarkupIfOriginal])

  const handleSegmentMouseEnter = useCallback((segmentId: number) => {
    setHoveredSegment(segmentId)
  }, [])

  const handleSegmentMouseLeave = useCallback((segmentId: number) => {
    setHoveredSegment(prev => prev === segmentId ? null : prev)
  }, [])

  const handleToggleSelection = useCallback((segmentId: number) => {
    setSelectedSegments(prev => {
      const next = new Set(prev)
      if (next.has(segmentId)) next.delete(segmentId)
      else next.add(segmentId)
      return next
    })
  }, [])

  const handleCompare = useCallback((segment: Segment) => {
    setComparingSegment(segment)
  }, [])

  const handleVersionHistory = useCallback((translation: { id: number; text: string }) => {
    setVersionHistoryTranslation(translation)
  }, [])

  const handleSetEditorSaveStatus = useCallback((status: 'idle' | 'saving' | 'saved' | 'error') => {
    setEditorSaveStatus(status)
  }, [])

  const handleEditorSelectionChange = useCallback((selection: { segmentId: number; info: EditorSelectionInfo } | null) => {
    setEditorSelection(selection)
  }, [setEditorSelection])

  const handleSetPendingQuotedText = useCallback((value: { segmentId: number; text: string } | null) => {
    setPendingQuotedText(value)
  }, [setPendingQuotedText])

  const handleSetShowCommentsMargin = useCallback((show: boolean) => {
    if (show) {
      ensureCommentsVisible()
    } else {
      toggleCommentsMargin()
    }
  }, [ensureCommentsVisible, toggleCommentsMargin])

  const handleSetHighlightedCommentId = useCallback((id: number | null) => {
    setHighlightedCommentId(id)
  }, [])

  const handleSetCrossHighlight = useCallback((value: { segmentId: number; sourceTerms: string[] } | null) => {
    setCrossHighlight(value)
  }, [])

  const handleSetQuickAddTerm = useCallback((value: { source_term: string; translated_term?: string } | null) => {
    setQuickAddTerm(value)
  }, [])

  const handleEditTermCb = useCallback((termId: number) => {
    handleEditTerm(termId)
  }, [])

  const handleNavigateToComment = useCallback((commentId: number) => {
    setHighlightedCommentId(commentId)
    const highlight = document.querySelector(`[data-comment-id="${commentId}"]`)
    if (highlight) highlight.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const handleAnnotationAcceptChange = useCallback((segId: number, transId: number, resolvedText: string) => {
    segmentEditorRef.current?.clearUnsavedChanges()
    handleSaveTranslation(transId, resolvedText, 'plain')
  }, [handleSaveTranslation])

  const handleAnnotationRejectChange = useCallback(async (segId: number, transId: number, previousText: string) => {
    try {
      await updateTranslation(transId, { translated_text: previousText, status: 'draft', content_format: 'plain' })
      segmentEditorRef.current?.clearUnsavedChanges()
      setEditingSegment(prev => prev === segId ? null : prev)
      setChapter(prev => {
        if (!prev) return prev
        return {
          ...prev,
          segments: prev.segments.map(s => s.id === segId
            ? { ...s, translations: s.translations.map(tr => tr.id === transId ? { ...tr, translated_text: previousText, previous_text: previousText, content_format: 'plain' as const } : tr) }
            : s
          ),
        }
      })
    } catch (err) {
      console.error('Reject change failed:', err)
    }
  }, [])

  const handleHunkResolve = useCallback(async (segId: number, transId: number, newTranslatedText: string, newPreviousText: string | null) => {
    try {
      segmentEditorRef.current?.clearUnsavedChanges()
      setEditingSegment(prev => prev === segId ? null : prev)
      await updateTranslation(transId, { translated_text: newTranslatedText, status: 'draft', previous_text: newPreviousText, content_format: 'plain' })
      setChapter(prev => {
        if (!prev) return prev
        return { ...prev, segments: prev.segments.map(s => s.id === segId ? { ...s, translations: s.translations.map(tr => tr.id === transId ? { ...tr, translated_text: newTranslatedText, previous_text: newPreviousText, content_format: 'plain' as const } : tr) } : s) }
      })
    } catch (err) { console.error('Hunk resolve failed:', err) }
  }, [])

  // --- Segment navigation ---
  const segmentIds = useMemo(() => filteredSegments.map((s) => s.id), [filteredSegments])
  const activeIndex = activeSegment ? segmentIds.indexOf(activeSegment) : -1

  function navigateSegment(direction: 'next' | 'prev') {
    if (segmentIds.length === 0) return
    // Save current before navigating
    segmentEditorRef.current?.save()
    setEditingSegment(null)
    if (activeIndex === -1) {
      setActiveSegment(direction === 'next' ? segmentIds[0] : segmentIds[segmentIds.length - 1])
    } else {
      const newIdx = direction === 'next'
        ? Math.min(activeIndex + 1, segmentIds.length - 1)
        : Math.max(activeIndex - 1, 0)
      setActiveSegment(segmentIds[newIdx])
    }
    setCrossHighlight(null)
    setSplitMode(null)
  }

  // Handle find/replace replace action
  function handleFindReplace(translationId: number, _oldText: string, newText: string) {
    handleSaveTranslation(translationId, newText)
  }

  // Handle version restore
  function handleVersionRestore(text: string, status: string) {
    setVersionHistoryTranslation(null)
    setEditingSegment(null)
    loadChapter()
  }

  // --- Keyboard shortcuts ---
  const shortcutsEnabled = !quickAddTerm && !editingTerm && !comparingSegment && !chapterCompareMode && !versionHistoryTranslation && !showShortcutHelp

  useEditorShortcuts({
    enabled: shortcutsEnabled,
    onSave: () => segmentEditorRef.current?.save(),
    onTranslate: () => { if (activeSegment) handleTranslateSegment(activeSegment) },
    onNextSegment: () => navigateSegment('next'),
    onPrevSegment: () => navigateSegment('prev'),
    onSaveAndAdvance: () => {
      segmentEditorRef.current?.save()
      setTimeout(() => navigateSegment('next'), 50)
    },
    onActivateSegment: () => {
      if (activeSegment) {
        // Segment is highlighted — enter edit mode
        setEditingSegment(activeSegment)
      } else if (segmentIds.length > 0) {
        // No segment highlighted — highlight the first one
        setActiveSegment(segmentIds[0])
      }
    },
    onDeselect: () => {
      if (showFindBar || showFindReplace) { setShowFindBar(false); setShowFindReplace(false) }
      else if (editingSegment) {
        // Exit edit mode but stay highlighted
        segmentEditorRef.current?.save()
        setEditingSegment(null)
      } else {
        // Deselect entirely
        setActiveSegment(null); setEditingSegment(null); setSplitMode(null); setQuickAddTerm(null); setEditingTerm(null)
      }
    },
    onToggleHelp: () => setShowShortcutHelp((v) => !v),
    onSetStatus: (status) => {
      const targetId = hoveredSegment || activeSegment
      if (!targetId || !chapter) return
      const seg = chapter.segments.find((s) => s.id === targetId)
      const t = seg?.translations[0]
      if (t) handleStatusChange(t.id, status)
    },
    onFind: () => { setShowFindBar(true); setShowFindReplace(false) },
    onFindReplace: () => { setShowFindBar(true); setShowFindReplace(true) },
  })

  function toggleSelectAll() {
    if (selectedSegments.size === filteredSegments.length) {
      setSelectedSegments(new Set())
    } else {
      setSelectedSegments(new Set(filteredSegments.map((s) => s.id)))
    }
  }

  // Chapter navigation
  const currentChapterIndex = chapters.findIndex((c) => c.id === parseInt(chapterId!))
  const prevChapter = currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] : null
  const nextChapter = currentChapterIndex < chapters.length - 1 ? chapters[currentChapterIndex + 1] : null

  const activeQaMissing = qaIssues.filter((i) => !i.found)

  const batchProgress = chapter ? {
    total: chapter.segments.length,
    done: chapter.segments.filter((s) => s.translations[0]?.translated_text).length,
  } : null

  // Word/char counts
  const chapterCounts = useMemo(() => {
    if (!chapter) return { chars: 0, words: 0 }
    let chars = 0, words = 0
    for (const seg of chapter.segments) {
      chars += countChineseChars(seg.source_text)
      const t = seg.translations[0]
      if (t?.translated_text) words += countEnglishWords(t.translated_text)
    }
    return { chars, words }
  }, [chapter])

  // Build user ID → display name map for track changes author resolution
  const userMap = useMemo(() => {
    const map: Record<string, string> = {}
    if (user) map[String(user.id)] = user.username || `User ${user.id}`
    if (chapter) {
      for (const seg of chapter.segments) {
        for (const t of seg.translations) {
          if (t.updated_by && t.updated_by_username) {
            map[String(t.updated_by)] = t.updated_by_username
          }
        }
      }
    }
    return map
  }, [user, chapter])

  if (loading) return <div className="text-center py-12 text-parchment-400 dark:text-cream-muted">Loading editor...</div>
  if (!book || !chapter) return <div className="text-center py-12 text-parchment-500 dark:text-cream-muted">Not found</div>

  const isArticle = book.content_type === 'article'

  return (
    <EditorProvider
      selectedLanguageId={selectedLanguageId}
      currentUserId={user?.id || 0}
      trackingEnabled={trackingEnabled}
      displayMode={displayMode}
      sourceFont={sourceFont}
      hasPermission={hasPermission}
      highlightedCommentId={highlightedCommentId}
      setHighlightedCommentId={setHighlightedCommentId}
      userMap={userMap}
    >
    <div className="h-[calc(100vh-57px)] flex flex-col">
      {/* Toolbar */}
      <div className="bg-parchment-50 dark:bg-ink-900 border-b border-parchment-300 dark:border-ink-600/50 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link to={btId ? (isArticle ? '/books' : `/translations/${btId}`) : (isArticle ? '/books' : `/books/${bookId}`)} className="text-parchment-400 dark:text-cream-muted hover:text-gold transition-colors duration-200 shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="text-sm font-body truncate flex items-center gap-1.5">
            {editingBookTitle !== null ? (
              <input
                type="text"
                value={editingBookTitle}
                onChange={e => setEditingBookTitle(e.target.value)}
                className="input-field py-0.5 px-2 text-sm font-medium min-w-[200px]"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur()
                  } else if (e.key === 'Escape') {
                    setEditingBookTitle(null)
                  }
                }}
                onBlur={e => {
                  const newTitle = e.currentTarget.value.trim()
                  if (newTitle) {
                    setBook(prev => prev ? { ...prev, title_source: newTitle } : prev)
                    updateBook(book.id, { title_source: newTitle }).catch(console.error)
                  }
                  setEditingBookTitle(null)
                }}
              />
            ) : isArticle ? (
              <>
                <span className="font-medium text-ink-850 dark:text-cream">{book.title_source}</span>
                <button onClick={() => setEditingBookTitle(book.title_source)} className="text-parchment-300 dark:text-ink-400 hover:text-gold transition-colors shrink-0" title="Edit title">
                  <Pencil className="w-3 h-3" />
                </button>
              </>
            ) : (
              <>
                <span className="text-parchment-400 dark:text-cream-muted/60">
                  <button onClick={() => setEditingBookTitle(book.title_source)} className="hover:text-gold transition-colors" title="Edit title">
                    {book.title_source}
                  </button>
                  {' /'}
                </span>
                <span className="font-medium text-ink-850 dark:text-cream">{chapter.title}</span>
              </>
            )}
          </div>
          {/* Language pair badge */}
          {btId ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-parchment-200 dark:bg-ink-700 text-parchment-500 dark:text-cream-muted/70 font-body shrink-0">
              {(bt?.source_language_name || 'Source').split(' ')[0]}
              <ArrowRightLeft className="w-2.5 h-2.5 inline mx-0.5 opacity-50" />
              {bt?.target_language_name?.split(' ')[0]}
            </span>
          ) : (
            <div className="flex items-center gap-1.5 shrink-0">
              <select
                value={sourceLanguageId ?? ''}
                onChange={(e) => setSourceLanguageId(e.target.value ? parseInt(e.target.value) : null)}
                className="select-field w-auto py-1 text-xs"
              >
                <option value="">Source</option>
                {languages.filter((l) => l.id !== selectedLanguageId).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <ArrowRightLeft className="w-3 h-3 text-parchment-400 dark:text-cream-muted/60 shrink-0" />
              <select
                value={selectedLanguageId}
                onChange={(e) => setSelectedLanguageId(parseInt(e.target.value))}
                className="select-field w-auto py-1 text-xs"
              >
                {languages.filter((l) => l.id !== (sourceLanguageId ?? -1)).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          )}
          {/* Counts */}
          <div className="hidden sm:flex items-center gap-1 text-[10px] font-body shrink-0">
            <span className="px-1.5 py-0.5 rounded bg-parchment-100 dark:bg-ink-700 text-parchment-500 dark:text-cream-muted/60">{chapterCounts.chars.toLocaleString()}字</span>
            <span className="px-1.5 py-0.5 rounded bg-parchment-100 dark:bg-ink-700 text-parchment-500 dark:text-cream-muted/60">{chapterCounts.words.toLocaleString()}w</span>
            {chapter && (() => {
              const approved = chapter.segments.filter((s) => s.translations[0]?.status === 'approved').length
              const total = chapter.segments.length
              return <span className="px-1.5 py-0.5 rounded bg-parchment-100 dark:bg-ink-700 text-parchment-500 dark:text-cream-muted/60">{approved}/{total} approved</span>
            })()}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">

          {/* ── Group 1: Translation (Model + AI) ── */}
          {bt && (
            <select
              value={bt.llm_model || ''}
              onChange={(e) => handleModelChange(e.target.value)}
              className="select-field py-1 text-xs w-auto"
            >
              <option value="">{defaultModelName}</option>
              {availableModels.filter(p => p.api_key_set).flatMap(provider =>
                provider.models.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))
              )}
            </select>
          )}
          {hasPermission('translations.ai_translate') && (
            <div className="relative group/actions">
              <button
                disabled={batchRunning}
                className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-body font-medium text-jade hover:bg-jade/10 disabled:opacity-50 transition-colors"
                title="AI actions"
              >
                {batchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                AI
              </button>
              <div className="absolute right-0 top-full pt-1 w-40 z-50 hidden group-hover/actions:block">
                <div className="bg-white dark:bg-ink-850 border border-parchment-200 dark:border-ink-600 rounded-lg shadow-lg p-1.5">
                  <button
                    onClick={handleBatchTranslate}
                    disabled={batchRunning}
                    className="w-full text-left px-2.5 py-1.5 text-xs font-body rounded text-ink-700 dark:text-cream-dim hover:bg-parchment-100 dark:hover:bg-ink-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <Zap className="w-3.5 h-3.5 text-jade" /> Translate All
                  </button>
                  <button
                    onClick={() => setChapterCompareMode(true)}
                    disabled={batchRunning}
                    className="w-full text-left px-2.5 py-1.5 text-xs font-body rounded text-ink-700 dark:text-cream-dim hover:bg-parchment-100 dark:hover:bg-ink-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <GitCompareArrows className="w-3.5 h-3.5 text-gold" /> Compare All
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Divider ── */}
          <div className="w-px h-5 bg-parchment-300 dark:bg-ink-600/50 mx-1" />

          {/* ── Group 2: Track Changes Toggle + Display Mode ── */}
          {btId && bt && (() => {
            const changedSegments = chapter?.segments.filter(s => {
              const t = s.translations[0]
              return t?.previous_text && t.previous_text !== t.translated_text
            }) || []
            const changeCount = changedSegments.length

            return (
              <>
                {/* Track toggle */}
                <button
                  onClick={toggleTracking}
                  className={`relative p-1.5 rounded-md transition-colors ${
                    trackingEnabled ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10' : 'text-parchment-400 dark:text-cream-muted/60 hover:bg-parchment-100 dark:hover:bg-ink-700'
                  }`}
                  title={trackingEnabled ? 'Tracking ON — click to disable' : 'Track changes — click to enable'}
                >
                  <FileDiff className="w-4 h-4" />
                </button>

                {/* Display mode cycle (only when tracking is on) */}
                {trackingEnabled && (
                  <>
                    <button
                      onClick={() => {
                        // Preserve scroll position of active segment during display mode toggle
                        const segEl = activeSegment ? document.getElementById(`segment-${activeSegment}`) : null
                        const scrollContainer = segEl?.closest('[data-scroll-container]') as HTMLElement | null
                        const offsetBefore = segEl ? segEl.getBoundingClientRect().top : null
                        cycleDisplayMode()
                        if (segEl && scrollContainer && offsetBefore !== null) {
                          requestAnimationFrame(() => {
                            const offsetAfter = segEl.getBoundingClientRect().top
                            scrollContainer.scrollTop += offsetAfter - offsetBefore
                          })
                        }
                      }}
                      className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-body font-medium transition-colors ${
                        displayMode === 'all-markup'
                          ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
                          : displayMode === 'original'
                          ? 'text-blue-600 dark:text-blue-400 bg-blue-500/10'
                          : 'text-parchment-500 dark:text-cream-muted/60 hover:bg-parchment-100 dark:hover:bg-ink-700'
                      }`}
                      title={`Display: ${displayMode === 'all-markup' ? 'All Markup' : displayMode === 'no-markup' ? 'No Markup' : 'Original'} — click to cycle`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      {displayMode === 'all-markup' ? 'Markup' : displayMode === 'no-markup' ? 'Clean' : 'Original'}
                    </button>
                    <button
                      onClick={toggleChangesMargin}
                      className={`p-1.5 rounded-md transition-colors ${
                        showChangesMargin
                          ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
                          : 'text-parchment-400 dark:text-cream-muted/60 hover:bg-parchment-100 dark:hover:bg-ink-700'
                      }`}
                      title={showChangesMargin ? 'Hide changes margin' : 'Show changes margin'}
                    >
                      <PanelRight className="w-4 h-4" />
                    </button>
                  </>
                )}
              </>
            )
          })()}

          {/* Re-segment (icon only) */}
          <button
            onClick={() => { setResegmentConfirmed(false); setShowResegmentModal(true) }}
            className="p-1.5 text-parchment-400 dark:text-cream-muted/60 hover:text-gold transition-colors"
            title={`Re-segment ${isArticle ? 'article' : 'chapter'}`}
          >
            <Layers className="w-4 h-4" />
          </button>

          {/* ── Divider ── */}
          <div className="w-px h-5 bg-parchment-300 dark:bg-ink-600/50 mx-1" />

          {/* ── Group 3: Utility (compact, shortcuts, search) ── */}
          <button
            onClick={() => {
              const next = !compactMode
              setCompactMode(next)
              localStorage.setItem('editor_compact', String(next))
            }}
            className={`p-1.5 transition-colors ${compactMode ? 'text-gold' : 'text-parchment-400 dark:text-cream-muted hover:text-gold'}`}
            title={compactMode ? 'Standard view (show headers)' : 'Compact view (hide headers)'}
          >
            {compactMode ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
          </button>
          <button onClick={() => setShowShortcutHelp(true)} className="p-1.5 text-parchment-400 dark:text-cream-muted hover:text-gold transition-colors" title="Keyboard shortcuts (?)">
            <Keyboard className="w-4 h-4" />
          </button>
          <button onClick={() => { setShowFindBar(true); setShowFindReplace(false) }} className="p-1.5 text-parchment-400 dark:text-cream-muted hover:text-gold transition-colors" title="Find (Ctrl+F)">
            <Search className="w-4 h-4" />
          </button>

          {/* ── Chapter navigation (books only) ── */}
          {!isArticle && (
            <div className="flex items-center gap-0.5 border-l border-parchment-300 dark:border-ink-600/50 pl-2 ml-1">
              {prevChapter ? (
                <Link to={btId ? `/translations/${btId}/chapters/${prevChapter.id}` : `/books/${bookId}/chapters/${prevChapter.id}`} className="p-1 text-parchment-400 dark:text-cream-muted hover:text-gold transition-colors duration-200" title={prevChapter.title}>
                  <ChevronLeft className="w-4 h-4" />
                </Link>
              ) : (
                <span className="p-1 text-parchment-200 dark:text-ink-500"><ChevronLeft className="w-4 h-4" /></span>
              )}
              <span className="text-xs text-parchment-400 dark:text-cream-muted/60 text-segment-num tabular-nums">
                {currentChapterIndex + 1}/{chapters.length}
              </span>
              {nextChapter ? (
                <Link to={btId ? `/translations/${btId}/chapters/${nextChapter.id}` : `/books/${bookId}/chapters/${nextChapter.id}`} className="p-1 text-parchment-400 dark:text-cream-muted hover:text-gold transition-colors duration-200" title={nextChapter.title}>
                  <ChevronRightIcon className="w-4 h-4" />
                </Link>
              ) : (
                <span className="p-1 text-parchment-200 dark:text-ink-500"><ChevronRightIcon className="w-4 h-4" /></span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar + filter chips (hidden during batch translate to avoid duplicate bars) */}
      {!batchRunning && (
        <div className="bg-parchment-50 dark:bg-ink-900 border-b border-parchment-200 dark:border-ink-700/50 px-4 py-1.5 space-y-1">
          <ProgressBar progress={progress} />
          <div className="flex items-center gap-1 flex-wrap">
            <FilterChips statusFilter={statusFilter} setStatusFilter={setStatusFilter} progress={progress} />
          </div>
        </div>
      )}

      {/* Batch translate progress bar */}
      {batchRunning && batchProgress && (
        <div className="bg-parchment-50 dark:bg-ink-900 border-b border-parchment-200 dark:border-ink-700/50 px-4 py-1.5">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-parchment-200 dark:bg-ink-700 rounded-full h-1.5 overflow-hidden">
              <div className="bg-jade h-1.5 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0}%` }} />
            </div>
            <span className="text-xs text-parchment-400 dark:text-cream-muted font-body tabular-nums shrink-0">
              {batchProgress.done}/{batchProgress.total}
            </span>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 dark:bg-status-error-bg border-b border-red-200 dark:border-status-error/20 px-4 py-2.5 flex items-center gap-2 text-sm text-red-700 dark:text-status-error">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 dark:text-status-error/60 hover:text-red-600 dark:hover:text-status-error">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Chapter comparison mode */}
      {chapterCompareMode ? (
        <ChapterComparisonView
          bookId={parseInt(bookId!)}
          chapterId={parseInt(chapterId!)}
          languageId={selectedLanguageId}
          onDone={() => { setChapterCompareMode(false); loadChapter() }}
          sourceFontClass={sourceFont}
        />
      ) : (
      /* Editor area + bottom panel */
      <div className="flex-1 flex flex-col min-h-0">
        {/* Find/Replace bar */}
        {showFindBar && (
          <FindReplaceBar
            segments={chapter.segments}
            onHighlightSegment={(segId) => {
              setActiveSegment(segId)
              // Scroll to segment
              const el = document.getElementById(`segment-${segId}`)
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}
            onReplace={handleFindReplace}
            onClose={() => { setShowFindBar(false); setShowFindReplace(false) }}
            showReplace={showFindReplace}
          />
        )}

        {/* Batch selection action bar */}
        {selectedSegments.size > 0 && (
          <div className="bg-gold/10 dark:bg-gold-faint/20 border-b border-gold/30 px-4 py-2 flex items-center gap-3 font-body">
            <span className="text-sm font-semibold text-gold">
              {selectedSegments.size} segment{selectedSegments.size > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-1">
              {(['draft', 'under_review', 'approved', 'needs_revision'] as const).map((status) => (
                <button key={status} onClick={() => handleBatchStatusUpdate(status)}
                  className="px-2 py-1 text-xs rounded border border-gold/30 text-gold hover:bg-gold/20 transition-colors">
                  {TRANSLATION_STATUS_BADGES[status]?.label}
                </button>
              ))}
            </div>
            {hasPermission('translations.ai_translate') && (
              <button onClick={() => {
                // Re-translate selected segments
                for (const segId of selectedSegments) handleTranslateSegment(segId)
                setSelectedSegments(new Set())
              }}
                className="px-2 py-1 text-xs rounded border border-jade/30 text-jade hover:bg-jade/20 transition-colors">
                Re-translate
              </button>
            )}
            <button onClick={() => setSelectedSegments(new Set())} className="ml-auto text-xs text-parchment-400 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream">
              Clear
            </button>
          </div>
        )}

        {/* Scrollable segment grid + inline annotation margin */}
        <div data-scroll-container className={`flex-1 overflow-y-auto ${compactMode ? 'compact-segments' : ''}`}>
          {/* Column headers */}
          <div className={`sticky top-0 bg-parchment-100 dark:bg-ink-900/80 border-b border-parchment-300 dark:border-ink-600/50 flex z-10 ${compactMode ? 'hidden' : ''}`}>
          <div className="flex-1 grid grid-cols-[auto_1fr_1fr]">
            <div className="px-2 py-2 flex items-center">
              <button onClick={toggleSelectAll} className="text-parchment-400 dark:text-cream-muted hover:text-gold transition-colors" title="Select all">
                {selectedSegments.size === filteredSegments.length && filteredSegments.length > 0 ? (
                  <CheckSquare className="w-3.5 h-3.5" />
                ) : selectedSegments.size > 0 ? (
                  <MinusSquare className="w-3.5 h-3.5" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <div className="px-4 py-2 text-xs font-semibold text-parchment-500 dark:text-cream-muted uppercase tracking-wider font-body">
              {sourceLanguageId ? `Source (Pivot + ${bt?.source_language_name || 'Original'})` : `${bt?.source_language_name || 'Source'}`}
            </div>
            <div className="px-4 py-2 text-xs font-semibold text-parchment-500 dark:text-cream-muted uppercase tracking-wider font-body border-l border-parchment-300 dark:border-ink-600/50">
              {trackingEnabled && displayMode === 'original' ? 'Original (Baseline)' : 'Translation'}
            </div>
          </div>
          {(showCommentsMargin || showChangesMargin) && (
            <div className="w-72 shrink-0 border-l border-parchment-300 dark:border-ink-600/50 px-2 py-2 text-xs font-semibold text-parchment-500 dark:text-cream-muted uppercase tracking-wider font-body">
              Annotations
            </div>
          )}
          </div>

          {/* Segments */}
          {filteredSegments.map((segment, segIdx) => {
            const prevSegment = segIdx > 0 ? filteredSegments[segIdx - 1] : null
            return (
              <SegmentRow
                key={segment.id}
                segment={segment}
                segIdx={segIdx}
                totalFilteredSegments={filteredSegments.length}
                prevSegmentParagraphGroup={prevSegment?.paragraph_group}
                isActive={activeSegment === segment.id}
                isEditing={editingSegment === segment.id}
                isSplitting={splitMode === segment.id}
                isSelected={selectedSegments.has(segment.id)}
                translating={translating}
                compactMode={compactMode}
                showCommentsMargin={showCommentsMargin}
                showChangesMargin={showChangesMargin}
                sourceLanguageId={sourceLanguageId}
                pivotTranslations={pivotTranslations}
                languages={languages}
                btSourceLanguageName={bt?.source_language_name ?? undefined}
                detectedTerms={activeSegment === segment.id ? detectedTerms : []}
                activeQaMissing={activeSegment === segment.id ? activeQaMissing : []}
                crossHighlight={crossHighlight}
                chapterComments={chapterComments}
                pendingQuotedText={pendingQuotedText}
                editorSaveStatus={editingSegment === segment.id ? editorSaveStatus : 'idle'}
                editorSelection={editorSelection}
                segmentEditorRef={editingSegment === segment.id ? segmentEditorRef : { current: null }}
                onSegmentClick={handleSegmentClick}
                onMouseEnter={handleSegmentMouseEnter}
                onMouseLeave={handleSegmentMouseLeave}
                onToggleSelection={handleToggleSelection}
                onSaveTranslation={handleSaveTranslation}
                onCreateTranslation={handleCreateTranslation}
                onStatusChange={handleStatusChange}
                onTranslateSegment={handleTranslateSegment}
                onSplit={handleSplit}
                onMerge={handleMerge}
                onAcceptChange={handleAcceptChange}
                onRejectChange={handleRejectChange}
                onOpenReview={handleOpenReview}
                onCompare={handleCompare}
                onVersionHistory={handleVersionHistory}
                onToggleCommentsMargin={toggleCommentsMargin}
                onSetEditorSaveStatus={handleSetEditorSaveStatus}
                onEditorSelectionChange={handleEditorSelectionChange}
                onSetPendingQuotedText={handleSetPendingQuotedText}
                onSetShowCommentsMargin={handleSetShowCommentsMargin}
                onSetHighlightedCommentId={handleSetHighlightedCommentId}
                onSetCrossHighlight={handleSetCrossHighlight}
                onSetQuickAddTerm={handleSetQuickAddTerm}
                onEditTerm={handleEditTermCb}
                lookupGlossary={lookupGlossary}
                onLoadComments={loadComments}
                onCommentCreated={handleCommentCreated}
                onMutateComments={handleCommentMutate}
                onEnsureCommentsVisible={ensureCommentsVisible}
                onNavigateToComment={handleNavigateToComment}
                onAnnotationAcceptChange={handleAnnotationAcceptChange}
                onAnnotationRejectChange={handleAnnotationRejectChange}
                onHunkResolve={handleHunkResolve}
                onPendingQuotedTextConsumed={consumePendingQuotedText}
              />
            )
          })}
        </div>


        {/* Bottom panel */}
        <EditorBottomPanel
          detectedTerms={detectedTerms}
          qaIssues={qaIssues}
          onAddTerm={(sourceTerm) => setQuickAddTerm({ source_term: sourceTerm })}
          sourceFontClass={sourceFont}
        />
      </div>
      )}

      {/* Single-segment comparison modal */}
      {comparingSegment && (
        <ComparisonModal
          segment={comparingSegment}
          languageId={selectedLanguageId}
          onPick={() => { setComparingSegment(null); loadChapter() }}
          onClose={() => setComparingSegment(null)}
          sourceFontClass={sourceFont}
        />
      )}

      {/* Quick-add glossary term modal */}
      {quickAddTerm && !editingTerm && (
        <TermFormModal
          initialSourceTerm={quickAddTerm.source_term}
          initialTranslatedTerm={quickAddTerm.translated_term}
          languages={languages}
          categories={categories}
          projectOptions={[]}
          selectedLanguageId={selectedLanguageId}
          onSave={handleQuickAddSave}
          onClose={() => setQuickAddTerm(null)}
        />
      )}

      {/* Edit existing glossary term modal */}
      {editingTerm && (
        <TermFormModal
          term={editingTerm}
          languages={languages}
          categories={categories}
          projectOptions={[]}
          selectedLanguageId={selectedLanguageId}
          onSave={handleEditSave}
          onClose={() => setEditingTerm(null)}
        />
      )}

      {/* Version history panel */}
      {versionHistoryTranslation && (
        <VersionHistoryPanel
          translationId={versionHistoryTranslation.id}
          currentText={versionHistoryTranslation.text}
          onRestore={handleVersionRestore}
          onClose={() => setVersionHistoryTranslation(null)}
        />
      )}

      {/* Shortcut help overlay */}
      {showShortcutHelp && (
        <ShortcutHelpOverlay onClose={() => setShowShortcutHelp(false)} />
      )}

      {/* Re-segment modal */}
      {showResegmentModal && (() => {
        // Detect current granularity from chapter segments
        const segs = chapter.segments
        const distinctGroups = new Set(segs.map(s => s.paragraph_group)).size
        const currentGranularity: 'sentence' | 'paragraph' | 'chapter' =
          segs.length === 1 ? 'chapter' :
          segs.length === distinctGroups ? 'paragraph' :
          'sentence'

        return (
        <div className="fixed inset-0 bg-black/40 dark:bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="surface-glass shadow-surface-lg w-full max-w-md p-6 animate-fade-in">
            <h3 className="text-lg font-semibold text-ink-850 dark:text-cream font-heading mb-4">
              Re-segment {isArticle ? 'Article' : 'Chapter'}
            </h3>

            <div className="space-y-3 mb-4">
              {[
                { value: 'sentence' as const, label: 'Sentence', desc: 'Split on punctuation (finest)' },
                { value: 'paragraph' as const, label: 'Paragraph', desc: 'One segment per original paragraph' },
                { value: 'chapter' as const, label: isArticle ? 'Full text' : 'Full chapter', desc: 'Entire content as one segment' },
              ].map((opt) => {
                const isCurrent = opt.value === currentGranularity
                return (
                <label
                  key={opt.value}
                  className={`block rounded-lg border p-3 transition-colors ${
                    isCurrent
                      ? 'border-2 border-gold bg-gold/10 dark:bg-gold-faint/30 cursor-default'
                      : resegmentGranularity === opt.value
                        ? 'border-2 border-jade bg-jade/5 dark:bg-jade/10 cursor-pointer'
                        : 'border border-parchment-200 dark:border-ink-600 hover:border-parchment-300 dark:hover:border-ink-500 cursor-pointer'
                  }`}
                >
                  <input
                    type="radio"
                    name="resegment-granularity"
                    value={opt.value}
                    checked={resegmentGranularity === opt.value}
                    onChange={() => { if (!isCurrent) { setResegmentGranularity(opt.value); setResegmentConfirmed(false) } }}
                    disabled={isCurrent}
                    className="sr-only"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink-850 dark:text-cream font-body">{opt.label}</span>
                    {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gold/20 dark:bg-gold-faint text-gold-dim dark:text-gold-light font-bold font-body">Current</span>}
                  </div>
                  <div className="text-xs text-parchment-400 dark:text-cream-muted font-body mt-0.5">{opt.desc}</div>
                </label>
                )
              })}
            </div>

            {(() => {
              const willLoseTranslations =
                (currentGranularity === 'chapter' && resegmentGranularity !== 'chapter') ||
                (currentGranularity === 'paragraph' && resegmentGranularity === 'sentence')
              return willLoseTranslations ? (
                <div className="px-3 py-2 rounded-md bg-red-50/50 dark:bg-status-error-bg/20 text-xs text-red-700 dark:text-status-error font-body mb-4">
                  <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                  Existing translations will be <strong>lost</strong> — they cannot be split into smaller segments. You will need to re-translate.
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={resegmentConfirmed}
                      onChange={(e) => setResegmentConfirmed(e.target.checked)}
                      className="rounded border-red-300 dark:border-red-600 text-red-600 focus:ring-red-500"
                    />
                    <span>I understand that translations will be lost</span>
                  </label>
                </div>
              ) : (
                <div className="px-3 py-2 rounded-md bg-amber-50/50 dark:bg-status-warning-bg/20 text-xs text-amber-700 dark:text-status-warning font-body mb-4">
                  <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                  Existing translations will be merged to match the new segmentation. Merged translations may need review.
                </div>
              )
            })()}

            <div className="flex justify-end gap-3">
              <button onClick={() => setShowResegmentModal(false)} className="btn-ghost" disabled={resegmenting}>
                Cancel
              </button>
              <button onClick={handleResegment} className="btn-primary" disabled={
                resegmenting || resegmentGranularity === currentGranularity ||
                (((currentGranularity === 'chapter' && resegmentGranularity !== 'chapter') ||
                  (currentGranularity === 'paragraph' && resegmentGranularity === 'sentence')) && !resegmentConfirmed)
              }>
                {resegmenting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Re-segmenting...</>
                ) : (
                  'Re-segment'
                )}
              </button>
            </div>
          </div>
        </div>
        )
      })()}
    </div>
    </EditorProvider>
  )
}
