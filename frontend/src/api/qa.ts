import api from './client'

export interface QAIssue {
  term_id: number
  source_term: string
  expected_translation: string
  found: boolean
  do_not_translate: boolean
  transliterate: boolean
}

export async function checkGlossaryConsistency(params: {
  source_text: string
  translated_text: string
  language_id: number
}): Promise<{ issues: QAIssue[] }> {
  const { data } = await api.post('/qa/glossary-check', params)
  return data
}
