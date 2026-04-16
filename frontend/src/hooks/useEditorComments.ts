import { useState, useCallback } from 'react'
import { getChapterComments } from '../api/comments'
import type { ChapterCommentsData, SegmentComment } from '../types'
import type { EditorSelectionInfo } from '../components/editor/SegmentEditor'

export interface UseEditorCommentsOptions {
  chapterId: string | undefined
  languageId: number
}

export interface UseEditorCommentsReturn {
  // State
  chapterComments: ChapterCommentsData | null
  commentFilter: boolean
  pendingQuotedText: { segmentId: number; text: string } | null
  showCommentsMargin: boolean
  showChangesMargin: boolean
  editorSelection: { segmentId: number; info: EditorSelectionInfo } | null

  // Setters exposed for TranslationEditor integration
  setCommentFilter: (value: boolean) => void
  setEditorSelection: (value: { segmentId: number; info: EditorSelectionInfo } | null) => void
  setPendingQuotedText: (value: { segmentId: number; text: string } | null) => void

  // Stable callbacks
  loadComments: (delay?: number) => void
  handleCommentCreated: (newComment: SegmentComment) => void
  handleCommentMutate: (updater: (comments: SegmentComment[]) => SegmentComment[]) => void
  consumePendingQuotedText: () => void
  ensureCommentsVisible: () => void
  ensureChangesVisible: () => void
  toggleCommentsMargin: () => void
  toggleChangesMargin: () => void
  getSegmentComments: (segmentId: number) => SegmentComment[]
}

export function useEditorComments({
  chapterId,
  languageId,
}: UseEditorCommentsOptions): UseEditorCommentsReturn {
  const [chapterComments, setChapterComments] = useState<ChapterCommentsData | null>(null)
  const [commentFilter, setCommentFilter] = useState(false)
  const [pendingQuotedText, setPendingQuotedText] = useState<{ segmentId: number; text: string } | null>(null)
  const [showCommentsMargin, setShowCommentsMargin] = useState(
    () => localStorage.getItem('show_comments_margin') !== 'false'
  )
  const [showChangesMargin, setShowChangesMargin] = useState(
    () => localStorage.getItem('show_changes_margin') !== 'false'
  )
  const [editorSelection, setEditorSelection] = useState<{ segmentId: number; info: EditorSelectionInfo } | null>(null)

  const loadComments = useCallback(
    async (delay = 0) => {
      if (!chapterId || !languageId) return
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
      try {
        const data = await getChapterComments(parseInt(chapterId), languageId)
        setChapterComments(data)
      } catch (err) {
        console.warn('Failed to load comments:', err)
      }
    },
    [chapterId, languageId]
  )

  const handleCommentCreated = useCallback((newComment: SegmentComment) => {
    setChapterComments((prev) => {
      if (!prev) {
        return {
          comments: [newComment],
          segment_comment_counts: { [String(newComment.segment_id)]: 1 },
          unresolved_count: 1,
        }
      }
      return {
        ...prev,
        comments: [...prev.comments, newComment],
        segment_comment_counts: {
          ...prev.segment_comment_counts,
          [String(newComment.segment_id)]: (prev.segment_comment_counts[String(newComment.segment_id)] || 0) + 1,
        },
        unresolved_count: prev.unresolved_count + 1,
      }
    })
  }, [])

  const handleCommentMutate = useCallback(
    (updater: (comments: SegmentComment[]) => SegmentComment[]) => {
      setChapterComments((prev) => {
        if (!prev) return prev
        const updated = updater(prev.comments)
        const counts: Record<string, number> = {}
        for (const c of updated) {
          if (!c.is_resolved) {
            counts[String(c.segment_id)] = (counts[String(c.segment_id)] || 0) + 1
          }
        }
        return {
          ...prev,
          comments: updated,
          segment_comment_counts: counts,
          unresolved_count: Object.values(counts).reduce((a, b) => a + b, 0),
        }
      })
    },
    []
  )

  const consumePendingQuotedText = useCallback(() => {
    setPendingQuotedText(null)
  }, [])

  const ensureCommentsVisible = useCallback(() => {
    setShowCommentsMargin(true)
    localStorage.setItem('show_comments_margin', 'true')
  }, [])

  const ensureChangesVisible = useCallback(() => {
    setShowChangesMargin(true)
    localStorage.setItem('show_changes_margin', 'true')
  }, [])

  const toggleCommentsMargin = useCallback(() => {
    setShowCommentsMargin((prev) => {
      const next = !prev
      localStorage.setItem('show_comments_margin', String(next))
      return next
    })
  }, [])

  const toggleChangesMargin = useCallback(() => {
    setShowChangesMargin((prev) => {
      const next = !prev
      localStorage.setItem('show_changes_margin', String(next))
      return next
    })
  }, [])

  const getSegmentComments = useCallback(
    (segmentId: number): SegmentComment[] => {
      if (!chapterComments) return []
      return chapterComments.comments.filter((c) => c.segment_id === segmentId)
    },
    [chapterComments]
  )

  return {
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
  }
}
