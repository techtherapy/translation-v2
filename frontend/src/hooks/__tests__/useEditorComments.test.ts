// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useEditorComments } from '../useEditorComments'

// Mock the comments API
vi.mock('../../api/comments', () => ({
  getChapterComments: vi.fn(),
}))

// Stub localStorage with a real in-memory implementation
const localStorageStore: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value },
  removeItem: (key: string) => { delete localStorageStore[key] },
  clear: () => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]) },
  get length() { return Object.keys(localStorageStore).length },
  key: (index: number) => Object.keys(localStorageStore)[index] ?? null,
}
vi.stubGlobal('localStorage', localStorageMock)

import { getChapterComments } from '../../api/comments'

// --- Helpers ---

function makeOptions(overrides: Partial<{ chapterId: string; languageId: number }> = {}) {
  return {
    chapterId: '5',
    languageId: 1,
    ...overrides,
  }
}

function makeChapterCommentsData() {
  return {
    comments: [
      {
        id: 1,
        segment_id: 10,
        language_id: 1,
        user_id: 1,
        username: 'alice',
        text: 'First comment',
        quoted_text: null,
        parent_id: null,
        is_resolved: false,
        resolved_by: null,
        resolved_by_username: null,
        resolved_at: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        replies: [],
        reactions: [],
      },
    ],
    segment_comment_counts: { '10': 1 },
    unresolved_count: 1,
  }
}

function makeComment(overrides: Partial<{ id: number; segment_id: number; is_resolved: boolean }> = {}) {
  return {
    id: overrides.id ?? 2,
    segment_id: overrides.segment_id ?? 10,
    language_id: 1,
    user_id: 1,
    username: 'bob',
    text: 'New comment',
    quoted_text: null,
    parent_id: null,
    is_resolved: overrides.is_resolved ?? false,
    resolved_by: null,
    resolved_by_username: null,
    resolved_at: null,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    replies: [],
    reactions: [],
  }
}

describe('useEditorComments', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorageMock.clear()
  })

  // --- Initial state ---

  describe('initial state', () => {
    it('starts with chapterComments = null', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))
      expect(result.current.chapterComments).toBeNull()
    })

    it('starts with commentFilter = false', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))
      expect(result.current.commentFilter).toBe(false)
    })

    it('starts with pendingQuotedText = null', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))
      expect(result.current.pendingQuotedText).toBeNull()
    })

    it('starts with editorSelection = null', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))
      expect(result.current.editorSelection).toBeNull()
    })

    it('showCommentsMargin defaults to true when localStorage has no value', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))
      expect(result.current.showCommentsMargin).toBe(true)
    })

    it('showCommentsMargin is false when localStorage has "false"', () => {
      localStorage.setItem('show_comments_margin', 'false')
      const { result } = renderHook(() => useEditorComments(makeOptions()))
      expect(result.current.showCommentsMargin).toBe(false)
    })

    it('showCommentsMargin is true when localStorage has "true"', () => {
      localStorage.setItem('show_comments_margin', 'true')
      const { result } = renderHook(() => useEditorComments(makeOptions()))
      expect(result.current.showCommentsMargin).toBe(true)
    })

    it('showChangesMargin defaults to true when localStorage has no value', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))
      expect(result.current.showChangesMargin).toBe(true)
    })

    it('showChangesMargin is false when localStorage has "false"', () => {
      localStorage.setItem('show_changes_margin', 'false')
      const { result } = renderHook(() => useEditorComments(makeOptions()))
      expect(result.current.showChangesMargin).toBe(false)
    })
  })

  // --- loadComments ---

  describe('loadComments', () => {
    it('fetches comments and sets chapterComments', async () => {
      const data = makeChapterCommentsData()
      vi.mocked(getChapterComments).mockResolvedValue(data)

      const { result } = renderHook(() => useEditorComments(makeOptions()))

      await act(async () => {
        await result.current.loadComments()
      })

      expect(getChapterComments).toHaveBeenCalledWith(5, 1)
      expect(result.current.chapterComments).toEqual(data)
    })

    it('does nothing when chapterId is undefined', async () => {
      const { result } = renderHook(() => useEditorComments(makeOptions({ chapterId: undefined })))

      await act(async () => {
        await result.current.loadComments()
      })

      expect(getChapterComments).not.toHaveBeenCalled()
    })

    it('does nothing when languageId is 0', async () => {
      const { result } = renderHook(() => useEditorComments(makeOptions({ languageId: 0 })))

      await act(async () => {
        await result.current.loadComments()
      })

      expect(getChapterComments).not.toHaveBeenCalled()
    })

    it('silently warns when API call fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(getChapterComments).mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useEditorComments(makeOptions()))

      await act(async () => {
        await result.current.loadComments()
      })

      expect(warnSpy).toHaveBeenCalledWith('Failed to load comments:', expect.any(Error))
      expect(result.current.chapterComments).toBeNull()
      warnSpy.mockRestore()
    })
  })

  // --- handleCommentCreated ---

  describe('handleCommentCreated', () => {
    it('creates initial ChapterCommentsData when chapterComments is null', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))
      const newComment = makeComment({ id: 1, segment_id: 10 })

      act(() => {
        result.current.handleCommentCreated(newComment)
      })

      expect(result.current.chapterComments).toEqual({
        comments: [newComment],
        segment_comment_counts: { '10': 1 },
        unresolved_count: 1,
      })
    })

    it('appends comment and increments counts when chapterComments exists', async () => {
      const data = makeChapterCommentsData() // has 1 comment on segment 10
      vi.mocked(getChapterComments).mockResolvedValue(data)

      const { result } = renderHook(() => useEditorComments(makeOptions()))

      await act(async () => { await result.current.loadComments() })

      const newComment = makeComment({ id: 2, segment_id: 10 })
      act(() => {
        result.current.handleCommentCreated(newComment)
      })

      expect(result.current.chapterComments?.comments).toHaveLength(2)
      expect(result.current.chapterComments?.segment_comment_counts['10']).toBe(2)
      expect(result.current.chapterComments?.unresolved_count).toBe(2)
    })

    it('handles comment on a new segment (no prior count for that segment)', async () => {
      const data = makeChapterCommentsData() // segment 10 count = 1
      vi.mocked(getChapterComments).mockResolvedValue(data)

      const { result } = renderHook(() => useEditorComments(makeOptions()))
      await act(async () => { await result.current.loadComments() })

      const newComment = makeComment({ id: 3, segment_id: 20 })
      act(() => { result.current.handleCommentCreated(newComment) })

      expect(result.current.chapterComments?.segment_comment_counts['20']).toBe(1)
      expect(result.current.chapterComments?.unresolved_count).toBe(2)
    })
  })

  // --- handleCommentMutate ---

  describe('handleCommentMutate', () => {
    it('does nothing when chapterComments is null', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))

      act(() => {
        result.current.handleCommentMutate((comments) => comments)
      })

      expect(result.current.chapterComments).toBeNull()
    })

    it('recomputes counts from the updated comments array', async () => {
      const data = makeChapterCommentsData() // 1 unresolved on seg 10
      vi.mocked(getChapterComments).mockResolvedValue(data)

      const { result } = renderHook(() => useEditorComments(makeOptions()))
      await act(async () => { await result.current.loadComments() })

      // Mark the comment as resolved
      act(() => {
        result.current.handleCommentMutate((comments) =>
          comments.map((c) => ({ ...c, is_resolved: true }))
        )
      })

      expect(result.current.chapterComments?.unresolved_count).toBe(0)
      expect(result.current.chapterComments?.segment_comment_counts).toEqual({})
    })

    it('filters out resolved comments from segment_comment_counts', async () => {
      // Two comments: one resolved, one not
      const initialData = {
        ...makeChapterCommentsData(),
        comments: [
          makeComment({ id: 1, segment_id: 10, is_resolved: false }),
          makeComment({ id: 2, segment_id: 10, is_resolved: true }),
        ],
        segment_comment_counts: { '10': 1 },
        unresolved_count: 1,
      }
      vi.mocked(getChapterComments).mockResolvedValue(initialData)

      const { result } = renderHook(() => useEditorComments(makeOptions()))
      await act(async () => { await result.current.loadComments() })

      // Resolve the remaining unresolved comment
      act(() => {
        result.current.handleCommentMutate((comments) =>
          comments.map((c) => ({ ...c, is_resolved: true }))
        )
      })

      expect(result.current.chapterComments?.unresolved_count).toBe(0)
      expect(result.current.chapterComments?.segment_comment_counts['10']).toBeUndefined()
    })
  })

  // --- consumePendingQuotedText ---

  describe('consumePendingQuotedText', () => {
    it('clears pendingQuotedText', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))

      // Manually set a pending value via setEditorSelection (pendingQuotedText has no direct setter)
      // Instead we test via the returned function directly — since the state starts null,
      // we verify that calling consume does not throw and leaves state null.
      act(() => {
        result.current.consumePendingQuotedText()
      })

      expect(result.current.pendingQuotedText).toBeNull()
    })
  })

  // --- ensureCommentsVisible ---

  describe('ensureCommentsVisible', () => {
    it('sets showCommentsMargin to true and persists to localStorage', () => {
      localStorage.setItem('show_comments_margin', 'false')
      const { result } = renderHook(() => useEditorComments(makeOptions()))

      // The initial value should be false (from localStorage)
      expect(result.current.showCommentsMargin).toBe(false)

      act(() => {
        result.current.ensureCommentsVisible()
      })

      expect(result.current.showCommentsMargin).toBe(true)
      expect(localStorage.getItem('show_comments_margin')).toBe('true')
    })

    it('is a no-op when margin is already visible', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))

      expect(result.current.showCommentsMargin).toBe(true) // default

      act(() => {
        result.current.ensureCommentsVisible()
      })

      expect(result.current.showCommentsMargin).toBe(true)
      expect(localStorage.getItem('show_comments_margin')).toBe('true')
    })
  })

  // --- toggleCommentsMargin ---

  describe('toggleCommentsMargin', () => {
    it('toggles from true to false and persists', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))

      expect(result.current.showCommentsMargin).toBe(true) // default

      act(() => { result.current.toggleCommentsMargin() })

      expect(result.current.showCommentsMargin).toBe(false)
      expect(localStorage.getItem('show_comments_margin')).toBe('false')
    })

    it('toggles from false to true and persists', () => {
      localStorage.setItem('show_comments_margin', 'false')
      const { result } = renderHook(() => useEditorComments(makeOptions()))

      act(() => { result.current.toggleCommentsMargin() })

      expect(result.current.showCommentsMargin).toBe(true)
      expect(localStorage.getItem('show_comments_margin')).toBe('true')
    })
  })

  // --- toggleChangesMargin ---

  describe('toggleChangesMargin', () => {
    it('toggles from true to false and persists', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))

      expect(result.current.showChangesMargin).toBe(true) // default

      act(() => { result.current.toggleChangesMargin() })

      expect(result.current.showChangesMargin).toBe(false)
      expect(localStorage.getItem('show_changes_margin')).toBe('false')
    })

    it('toggles from false to true and persists', () => {
      localStorage.setItem('show_changes_margin', 'false')
      const { result } = renderHook(() => useEditorComments(makeOptions()))

      act(() => { result.current.toggleChangesMargin() })

      expect(result.current.showChangesMargin).toBe(true)
      expect(localStorage.getItem('show_changes_margin')).toBe('true')
    })
  })

  // --- getSegmentComments ---

  describe('getSegmentComments', () => {
    it('returns empty array when chapterComments is null', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))
      expect(result.current.getSegmentComments(10)).toEqual([])
    })

    it('returns comments for the specified segment', async () => {
      const data = makeChapterCommentsData() // comment on seg 10
      vi.mocked(getChapterComments).mockResolvedValue(data)

      const { result } = renderHook(() => useEditorComments(makeOptions()))
      await act(async () => { await result.current.loadComments() })

      const comments = result.current.getSegmentComments(10)
      expect(comments).toHaveLength(1)
      expect(comments[0].segment_id).toBe(10)
    })

    it('returns empty array when no comments match the segment', async () => {
      const data = makeChapterCommentsData() // comment on seg 10
      vi.mocked(getChapterComments).mockResolvedValue(data)

      const { result } = renderHook(() => useEditorComments(makeOptions()))
      await act(async () => { await result.current.loadComments() })

      expect(result.current.getSegmentComments(99)).toEqual([])
    })
  })

  // --- setCommentFilter ---

  describe('setCommentFilter', () => {
    it('updates commentFilter', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))

      act(() => { result.current.setCommentFilter(true) })
      expect(result.current.commentFilter).toBe(true)

      act(() => { result.current.setCommentFilter(false) })
      expect(result.current.commentFilter).toBe(false)
    })
  })

  // --- setEditorSelection ---

  describe('setEditorSelection', () => {
    it('updates editorSelection', () => {
      const { result } = renderHook(() => useEditorComments(makeOptions()))

      const selection = {
        segmentId: 7,
        info: {
          text: 'hello',
          from: 0,
          to: 5,
          rect: { left: 0, top: 0, width: 50, height: 20 },
        },
      }

      act(() => { result.current.setEditorSelection(selection) })
      expect(result.current.editorSelection).toEqual(selection)

      act(() => { result.current.setEditorSelection(null) })
      expect(result.current.editorSelection).toBeNull()
    })
  })

  // --- Stable callback identity ---

  describe('callback stability', () => {
    it('loadComments reference is stable across re-renders with same options', () => {
      const { result, rerender } = renderHook(() => useEditorComments(makeOptions()))
      const initial = result.current.loadComments
      rerender()
      expect(result.current.loadComments).toBe(initial)
    })

    it('handleCommentCreated reference is stable across re-renders', () => {
      const { result, rerender } = renderHook(() => useEditorComments(makeOptions()))
      const initial = result.current.handleCommentCreated
      rerender()
      expect(result.current.handleCommentCreated).toBe(initial)
    })

    it('handleCommentMutate reference is stable across re-renders', () => {
      const { result, rerender } = renderHook(() => useEditorComments(makeOptions()))
      const initial = result.current.handleCommentMutate
      rerender()
      expect(result.current.handleCommentMutate).toBe(initial)
    })

    it('consumePendingQuotedText reference is stable across re-renders', () => {
      const { result, rerender } = renderHook(() => useEditorComments(makeOptions()))
      const initial = result.current.consumePendingQuotedText
      rerender()
      expect(result.current.consumePendingQuotedText).toBe(initial)
    })

    it('ensureCommentsVisible reference is stable across re-renders', () => {
      const { result, rerender } = renderHook(() => useEditorComments(makeOptions()))
      const initial = result.current.ensureCommentsVisible
      rerender()
      expect(result.current.ensureCommentsVisible).toBe(initial)
    })

    it('toggleCommentsMargin reference is stable across re-renders', () => {
      const { result, rerender } = renderHook(() => useEditorComments(makeOptions()))
      const initial = result.current.toggleCommentsMargin
      rerender()
      expect(result.current.toggleCommentsMargin).toBe(initial)
    })

    it('toggleChangesMargin reference is stable across re-renders', () => {
      const { result, rerender } = renderHook(() => useEditorComments(makeOptions()))
      const initial = result.current.toggleChangesMargin
      rerender()
      expect(result.current.toggleChangesMargin).toBe(initial)
    })
  })
})
