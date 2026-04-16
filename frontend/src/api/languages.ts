import api from './client'
import type { Language } from '../types'

export async function listLanguages(): Promise<Language[]> {
  const { data } = await api.get('/languages')
  return data
}

export async function createLanguage(params: {
  code: string
  name: string
}): Promise<Language> {
  const { data } = await api.post('/languages', params)
  return data
}

export async function updateLanguage(
  id: number,
  updates: { name?: string; is_enabled?: boolean; reference_language_id?: number | null; prompt_template_override?: string | null },
): Promise<Language> {
  const { data } = await api.patch(`/languages/${id}`, updates)
  return data
}

export async function deleteLanguage(id: number): Promise<void> {
  await api.delete(`/languages/${id}`)
}
