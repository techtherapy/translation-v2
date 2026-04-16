import api from './client'
import type { Book, Chapter, ChapterDetail, BookProgress, PivotReadiness } from '../types'

export async function splitSegment(
  bookId: number,
  chapterId: number,
  segmentId: number,
  position: number,
): Promise<ChapterDetail> {
  const { data } = await api.post(
    `/books/${bookId}/chapters/${chapterId}/segments/${segmentId}/split`,
    { position },
  )
  return data
}

export async function mergeSegment(
  bookId: number,
  chapterId: number,
  segmentId: number,
): Promise<ChapterDetail> {
  const { data } = await api.post(
    `/books/${bookId}/chapters/${chapterId}/segments/${segmentId}/merge`,
  )
  return data
}

export async function listBooks(params?: {
  search?: string
  status?: string
  category?: string
  content_type?: string
  sort?: string
  offset?: number
  limit?: number
}): Promise<{ books: Book[]; total: number }> {
  const { data } = await api.get('/books', { params })
  return data
}

export async function getBook(id: number): Promise<Book> {
  const { data } = await api.get(`/books/${id}`)
  return data
}

export interface CreateBookPayload {
  content_type: Book['content_type']
  book_number?: number | null
  title_source: string
  title_translated?: string
  year_published?: number
  category?: string
  era_tag?: string
  source_language_id?: number | null
}

export async function createBook(book: CreateBookPayload): Promise<Book> {
  const { data } = await api.post('/books', book)
  return data
}

export async function updateBook(id: number, updates: Partial<Book>): Promise<Book> {
  const { data } = await api.patch(`/books/${id}`, updates)
  return data
}

export async function deleteBook(id: number): Promise<void> {
  await api.delete(`/books/${id}`)
}

export async function importFile(bookId: number, file: File, granularity?: string): Promise<Book> {
  const formData = new FormData()
  formData.append('file', file)
  if (granularity) formData.append('granularity', granularity)
  const { data } = await api.post(`/books/${bookId}/import`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function importText(bookId: number, text: string, granularity?: string): Promise<Book> {
  const { data } = await api.post(`/books/${bookId}/import-text`, { text, ...(granularity ? { granularity } : {}) })
  return data
}

export async function getDefaultChapter(bookId: number): Promise<Chapter> {
  const { data } = await api.get(`/books/${bookId}/default-chapter`)
  return data
}

export async function listChapters(bookId: number, languageId?: number): Promise<Chapter[]> {
  const { data } = await api.get(`/books/${bookId}/chapters`, {
    params: languageId ? { language_id: languageId } : undefined,
  })
  return data
}

export async function getBookProgress(bookId: number): Promise<BookProgress> {
  const { data } = await api.get(`/books/${bookId}/progress`)
  return data
}

export async function getPivotReadiness(
  bookId: number,
  sourceLanguageId: number,
): Promise<PivotReadiness> {
  const { data } = await api.get(`/books/${bookId}/pivot-readiness`, {
    params: { source_language_id: sourceLanguageId },
  })
  return data
}

export async function getChapterDetail(
  bookId: number,
  chapterId: number,
  languageId?: number,
): Promise<ChapterDetail> {
  const { data } = await api.get(`/books/${bookId}/chapters/${chapterId}`, {
    params: languageId ? { language_id: languageId } : undefined,
  })
  return data
}

// --- Bulk Import ---

export interface BulkImportFilePreview {
  filename: string
  book_number: number | null
  title_source: string
  title_translated: string
  content_type: string
  parse_success: boolean
  error: string | null
  warnings: string[]
}

export interface BulkImportPreviewResponse {
  previews: BulkImportFilePreview[]
}

export interface BulkImportFileItem {
  filename: string
  book_number: number | null
  title_source: string
  title_translated: string
  content_type: string
}

export interface BulkImportMetadata {
  translate_titles: boolean
  granularity?: 'sentence' | 'paragraph' | 'chapter'
  items: BulkImportFileItem[]
}

export interface BulkImportResult {
  filename: string
  book_id: number | null
  book_number: number | null
  title_source: string
  title_translated: string
  chapter_count: number
  segment_count: number
  status: 'success' | 'error'
  error: string | null
}

export interface BulkImportResponse {
  results: BulkImportResult[]
  total: number
  succeeded: number
  failed: number
}

export async function bulkImportPreview(files: File[]): Promise<BulkImportPreviewResponse> {
  const formData = new FormData()
  files.forEach((f) => formData.append('files', f))
  const { data } = await api.post('/books/bulk-import/preview', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function resegmentChapter(
  bookId: number,
  chapterId: number,
  granularity: 'sentence' | 'paragraph' | 'chapter',
): Promise<ChapterDetail> {
  const { data } = await api.post(
    `/books/${bookId}/chapters/${chapterId}/re-segment`,
    { granularity },
  )
  return data
}

export async function bulkImportConfirm(
  files: File[],
  metadata: BulkImportMetadata,
): Promise<BulkImportResponse> {
  const formData = new FormData()
  files.forEach((f) => formData.append('files', f))
  formData.append('metadata', JSON.stringify(metadata))
  const { data } = await api.post('/books/bulk-import/confirm', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000, // 5 min for large imports with title translation
  })
  return data
}
