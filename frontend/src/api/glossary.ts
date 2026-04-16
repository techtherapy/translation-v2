import api from './client'
import type { GlossaryTerm, GlossaryTranslation, GlossaryCategory, GlossaryProject } from '../types'

export async function listTerms(
  params?: {
    search?: string
    category?: string
    project?: string
    tradition?: string
    language_id?: number
    reference_language_id?: number
    translation_status?: string
    sort_by?: string
    sort_order?: string
    offset?: number
    limit?: number
  },
  signal?: AbortSignal,
): Promise<{ terms: GlossaryTerm[]; total: number }> {
  const { data } = await api.get('/glossary', { params, signal })
  return data
}

export async function getTerm(id: number): Promise<GlossaryTerm> {
  const { data } = await api.get(`/glossary/${id}`)
  return data
}

export interface CreateTermPayload extends Omit<Partial<GlossaryTerm>, 'translations'> {
  translations?: { language_id: number; translated_term: string; is_preferred: boolean; notes: string }[]
}

export async function createTerm(term: CreateTermPayload): Promise<GlossaryTerm> {
  const { data } = await api.post('/glossary', term)
  return data
}

export async function updateTerm(id: number, updates: Partial<GlossaryTerm>): Promise<GlossaryTerm> {
  const { data } = await api.patch(`/glossary/${id}`, updates)
  return data
}

export async function deleteTerm(id: number): Promise<void> {
  await api.delete(`/glossary/${id}`)
}

export async function updateTranslation(
  id: number,
  updates: Partial<GlossaryTranslation>
): Promise<GlossaryTranslation> {
  const { data } = await api.patch(`/glossary/translations/${id}`, updates)
  return data
}

export async function deleteTranslation(id: number): Promise<void> {
  await api.delete(`/glossary/translations/${id}`)
}

export async function addTranslation(
  termId: number,
  translation: { language_id: number; translated_term: string; is_preferred?: boolean; notes?: string }
): Promise<GlossaryTranslation> {
  const { data } = await api.post(`/glossary/${termId}/translations`, translation)
  return data
}

export async function importCSV(
  file: File,
  languageCode: string = 'en',
): Promise<{ imported: number; skipped: number; errors: string[]; categories_created: number; projects_created: number }> {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post('/glossary/import/csv', formData, {
    params: { language_code: languageCode },
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000,
  })
  return data
}

// Autocomplete

export interface AutocompleteSuggestion {
  id: number
  source_term: string
  translated_term: string
  match_field: string
}

export interface AutocompleteResult {
  suggestions: AutocompleteSuggestion[]
  total: number
}

export async function autocompleteTerms(
  q: string,
  limit: number = 20,
  offset: number = 0,
  language_id?: number,
): Promise<AutocompleteResult> {
  const { data } = await api.get('/glossary/autocomplete', { params: { q, limit, offset, language_id } })
  return data
}

// Term detection (used by editor for highlighting)

export interface TermPosition {
  start: number
  end: number
}

export interface DetectedTerm {
  term_id: number
  source: string
  translation: string | null
  sanskrit: string | null
  do_not_translate: boolean
  transliterate: boolean
  tbs_notes: string | null
  context_notes: string | null
  category: string | null
  positions: TermPosition[]
}

export async function detectGlossaryTerms(
  text: string,
  languageId: number,
): Promise<{ terms: DetectedTerm[] }> {
  const { data } = await api.post('/glossary/detect', { text, language_id: languageId })
  return data
}

// AI completion

export interface AICompleteResponse {
  english?: string | null
  sanskrit?: string | null
  category?: string | null
  confidence: number
  model?: string | null
  token_count: number
}

export interface AIBatchItem {
  term_id: number
  english?: string | null
  sanskrit?: string | null
  category?: string | null
  confidence: number
}

export interface AIBatchResponse {
  results: AIBatchItem[]
  model?: string | null
}

export async function aiCompleteTerm(
  termId: number,
  fields?: string[],
  model?: string,
  targetLanguage?: string,
): Promise<AICompleteResponse> {
  const { data } = await api.post(`/glossary/${termId}/ai-complete`, { fields, model, target_language: targetLanguage })
  return data
}

export async function aiCompleteInline(
  termData: {
    source_term: string
    english?: string
    sanskrit?: string
    category?: string
    context_notes?: string
    tbs_notes?: string
    project_tags?: string
    tradition_group?: string
    fields?: string[]
    model?: string
    target_language?: string
  },
): Promise<AICompleteResponse> {
  const { data } = await api.post('/glossary/ai-complete', termData)
  return data
}

export async function aiBatchComplete(
  termIds: number[],
  model?: string,
): Promise<AIBatchResponse> {
  const { data } = await api.post('/glossary/ai-batch', { term_ids: termIds, model })
  return data
}

// Category management

export async function listCategories(): Promise<GlossaryCategory[]> {
  const { data } = await api.get('/glossary/categories')
  return data
}

export async function createCategory(
  category: { key: string; label: string; color?: string; sort_order?: number }
): Promise<GlossaryCategory> {
  const { data } = await api.post('/glossary/categories', category)
  return data
}

export async function updateCategory(
  key: string,
  updates: Partial<Pick<GlossaryCategory, 'label' | 'color' | 'sort_order'>>
): Promise<GlossaryCategory> {
  const { data } = await api.patch(`/glossary/categories/${key}`, updates)
  return data
}

export async function deleteCategory(key: string): Promise<void> {
  await api.delete(`/glossary/categories/${key}`)
}

// Project management

export async function listProjects(): Promise<GlossaryProject[]> {
  const { data } = await api.get('/glossary/projects')
  return data
}

export async function createProject(
  project: { name: string; description?: string; is_active?: boolean }
): Promise<GlossaryProject> {
  const { data } = await api.post('/glossary/projects', project)
  return data
}

export async function updateProject(
  id: number,
  updates: Partial<Pick<GlossaryProject, 'name' | 'description' | 'is_active'>>
): Promise<GlossaryProject> {
  const { data } = await api.patch(`/glossary/projects/${id}`, updates)
  return data
}

export async function deleteProject(id: number): Promise<void> {
  await api.delete(`/glossary/projects/${id}`)
}
