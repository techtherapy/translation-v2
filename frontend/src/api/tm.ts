import api from './client'
import type { TMMatch, AlignmentPair, TMEntry } from '../types'

export async function searchTM(params: {
  source_text: string
  language_id: number
  threshold?: number
  limit?: number
}): Promise<TMMatch[]> {
  const { data } = await api.post('/tm/search', params)
  return data
}

export async function seedAlign(
  sourceFile: File,
  translationFile: File,
): Promise<AlignmentPair[]> {
  const formData = new FormData()
  formData.append('source_file', sourceFile)
  formData.append('translation_file', translationFile)
  const { data } = await api.post('/tm/seed/align', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function seedCommit(params: {
  book_id: number
  language_id: number
  pairs: Array<{
    source_text: string
    translated_text: string
    approved: boolean
    confidence?: number
  }>
}): Promise<{ committed: number; total_pairs: number }> {
  const { data } = await api.post('/tm/seed/commit', params.pairs, {
    params: { book_id: params.book_id, language_id: params.language_id },
  })
  return data
}

export async function listTMEntries(params?: {
  language_id?: number
  book_id?: number
  offset?: number
  limit?: number
}): Promise<TMEntry[]> {
  const { data } = await api.get('/tm/entries', { params })
  return data
}
