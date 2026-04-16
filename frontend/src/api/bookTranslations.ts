import api from './client'
import type { BookTranslation, Chapter } from '../types'

export async function listBookTranslations(params?: {
  book_id?: number
  target_language_id?: number
  source_language_id?: number
  status?: string
  search?: string
}): Promise<{ items: BookTranslation[]; total: number }> {
  const { data } = await api.get('/book-translations', { params })
  return data
}

export async function createBookTranslation(payload: {
  book_id: number
  source_language_id: number | null
  target_language_id: number
  translated_title?: string
}): Promise<BookTranslation> {
  const { data } = await api.post('/book-translations', payload)
  return data
}

export async function getBookTranslation(id: number): Promise<BookTranslation> {
  const { data } = await api.get(`/book-translations/${id}`)
  return data
}

export async function updateBookTranslation(
  id: number,
  updates: Partial<Pick<BookTranslation, 'status' | 'llm_model' | 'prompt_template' | 'translated_title' | 'track_changes' | 'notes' | 'source_language_id'>>,
): Promise<BookTranslation> {
  const { data } = await api.patch(`/book-translations/${id}`, updates)
  return data
}

export async function deleteBookTranslation(id: number): Promise<void> {
  await api.delete(`/book-translations/${id}`)
}

export async function listBTChapters(btId: number): Promise<Chapter[]> {
  const { data } = await api.get(`/book-translations/${btId}/chapters`)
  return data
}
