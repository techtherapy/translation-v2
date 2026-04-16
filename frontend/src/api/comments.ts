import api from './client'
import type { SegmentComment, ChapterCommentsData, ReactionSummary } from '../types'

export async function getChapterComments(
  chapterId: number,
  languageId: number,
): Promise<ChapterCommentsData> {
  const { data } = await api.get(`/comments/chapter/${chapterId}`, {
    params: { language_id: languageId },
  })
  return data
}

export async function createComment(params: {
  segment_id: number
  language_id: number
  text: string
  parent_id?: number | null
  quoted_text?: string | null
}): Promise<SegmentComment> {
  const { data } = await api.post('/comments', params)
  return data
}

export async function updateComment(
  commentId: number,
  text: string,
): Promise<SegmentComment> {
  const { data } = await api.patch(`/comments/${commentId}`, { text })
  return data
}

export async function deleteComment(commentId: number): Promise<void> {
  await api.delete(`/comments/${commentId}`)
}

export async function resolveComment(commentId: number): Promise<SegmentComment> {
  const { data } = await api.post(`/comments/${commentId}/resolve`)
  return data
}

export async function unresolveComment(commentId: number): Promise<SegmentComment> {
  const { data } = await api.post(`/comments/${commentId}/unresolve`)
  return data
}

export async function addReaction(
  commentId: number,
  emoji: string,
): Promise<ReactionSummary[]> {
  const { data } = await api.post(`/comments/${commentId}/reactions`, { emoji })
  return data
}

export async function removeReaction(
  commentId: number,
  emoji: string,
): Promise<ReactionSummary[]> {
  const { data } = await api.delete(`/comments/${commentId}/reactions/${encodeURIComponent(emoji)}`)
  return data
}
