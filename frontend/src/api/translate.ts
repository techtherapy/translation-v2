import api from './client'

export interface TranslateResult {
  translation_id?: number | null
  segment_id: number
  language_id: number
  source_language_id?: number | null
  translated_text: string
  model_used: string
  token_count: number
  status: string
}

export async function translateSegment(params: {
  segment_id: number
  language_id?: number | null
  source_language_id?: number | null
  book_translation_id?: number | null
  model?: string
  extra_instructions?: string
}): Promise<TranslateResult> {
  const { data } = await api.post('/translate/segment', params)
  return data
}

export async function batchTranslate(params: {
  chapter_id: number
  language_id?: number | null
  source_language_id?: number | null
  book_translation_id?: number | null
  model?: string
  overwrite_existing?: boolean
}): Promise<{
  chapter_id: number
  total_segments: number
  translated: number
  skipped: number
  errors: number
  status: string
}> {
  const { data } = await api.post('/translate/batch', params, {
    timeout: 600_000, // 10 minutes – batch translates a full chapter sequentially
  })
  return data
}

export async function createTranslation(params: {
  segment_id: number
  language_id: number
  translated_text: string
  status?: string
  content_format?: string
}): Promise<TranslateResult> {
  const { data } = await api.post('/translate/segment/create', params)
  return data
}

export async function updateTranslation(
  translationId: number,
  params: { translated_text: string; status?: string; previous_text?: string | null; content_format?: string },
): Promise<TranslateResult> {
  const { data } = await api.put(`/translate/segment/${translationId}`, params)
  return data
}

export interface CompareVariant {
  model: string
  translated_text: string
  token_count: number
  error: string | null
}

export interface CompareResponse {
  segment_id: number
  language_id: number
  variants: CompareVariant[]
}

export interface BatchCompareSegmentResult {
  segment_id: number
  order: number
  source_text: string
  variants: CompareVariant[]
}

export interface BatchCompareResponse {
  chapter_id: number
  segments: BatchCompareSegmentResult[]
}

export async function compareModels(params: {
  segment_id: number
  language_id: number
  source_language_id?: number | null
  models: string[]
  extra_instructions?: string
}): Promise<CompareResponse> {
  const { data } = await api.post('/translate/compare', params)
  return data
}

export async function pickComparisonWinner(params: {
  segment_id: number
  language_id: number
  winning_model: string
  winning_text: string
  losing_variants: CompareVariant[]
}): Promise<TranslateResult> {
  const { data } = await api.post('/translate/compare/pick', params)
  return data
}

export async function batchCompare(
  params: {
    chapter_id: number
    language_id: number
    models: string[]
    overwrite_existing?: boolean
  },
  onProgress?: (completed: number, total: number, segment?: BatchCompareSegmentResult) => void,
): Promise<BatchCompareResponse> {
  const response = await fetch('/api/translate/compare/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
    },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Batch comparison failed' }))
    throw new Error(error.detail || 'Batch comparison failed')
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const segments: BatchCompareSegmentResult[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line)
      if (event.type === 'progress') {
        onProgress?.(0, event.total)
      } else if (event.type === 'segment') {
        segments.push(event.result)
        onProgress?.(event.completed, event.total, event.result)
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    const event = JSON.parse(buffer)
    if (event.type === 'segment') {
      segments.push(event.result)
      onProgress?.(event.completed, event.total, event.result)
    }
  }

  return { chapter_id: params.chapter_id, segments }
}

// Version history
export interface TranslationVersionInfo {
  id: number
  version_number: number
  translated_text: string
  status: string
  llm_model_used: string | null
  content_format: string
  created_by: number | null
  created_by_username: string | null
  created_at: string
}

export async function getVersionHistory(translationId: number): Promise<TranslationVersionInfo[]> {
  const { data } = await api.get(`/translate/segment/${translationId}/versions`)
  return data
}

export async function restoreVersion(
  translationId: number,
  versionId: number,
): Promise<TranslateResult> {
  const { data } = await api.post(`/translate/segment/${translationId}/restore/${versionId}`)
  return data
}

// Batch status update
export async function resolveTrackChanges(params: {
  chapter_id: number
  language_id: number
  action: 'accept_all' | 'reject_all'
}): Promise<{ resolved: number; action: string }> {
  const { data } = await api.post('/translate/track-changes/resolve', params)
  return data
}

export async function batchUpdateStatus(params: {
  translation_ids: number[]
  status: string
}): Promise<{ updated: number }> {
  const { data } = await api.put('/translate/batch-status', params)
  return data
}

export async function batchPickWinners(params: {
  chapter_id: number
  language_id: number
  picks: {
    segment_id: number
    winning_model: string
    winning_text: string
    losing_variants: CompareVariant[]
  }[]
}): Promise<{ chapter_id: number; total: number; saved: number; errors: number }> {
  const { data } = await api.post('/translate/compare/batch/pick', params)
  return data
}
