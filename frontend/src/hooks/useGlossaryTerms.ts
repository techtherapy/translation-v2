import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  listTerms,
  createTerm,
  updateTerm,
  deleteTerm,
  updateTranslation,
  addTranslation,
  listCategories,
  listProjects,
} from '../api/glossary'
import type { CreateTermPayload } from '../api/glossary'
import { listLanguages } from '../api/languages'
import type { GlossaryTerm, Language, GlossaryCategory, GlossaryProject } from '../types'
import type { GlossaryApiParams } from './useGlossaryFilters'
import type { TermFormData } from '../components/glossary/TermFormModal'

type ConfirmFn = (opts: { title?: string; message: string; confirmLabel?: string; variant?: 'danger' | 'warning' | 'default' }) => Promise<boolean>

export default function useGlossaryTerms(
  apiParams: GlossaryApiParams,
  page: number,
  pageSize: number,
  setPage: (p: number) => void,
  selectedLanguageId?: number,
  confirm?: ConfirmFn,
) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [languages, setLanguages] = useState<Language[]>([])
  const [categories, setCategories] = useState<GlossaryCategory[]>([])
  const [projects, setProjects] = useState<GlossaryProject[]>([])

  const abortRef = useRef<AbortController | null>(null)

  const projectOptions = useMemo(() => {
    const projectSet = new Set<string>()
    projects.filter((p) => p.is_active).forEach((p) => projectSet.add(p.name))
    terms.forEach((t) => {
      if (t.project_tags) {
        t.project_tags.split(',').forEach((p) => {
          const trimmed = p.trim()
          if (trimmed) projectSet.add(trimmed)
        })
      }
    })
    return Array.from(projectSet).sort()
  }, [terms, projects])

  useEffect(() => {
    listLanguages().then(setLanguages).catch(console.error)
    listCategories().then(setCategories).catch(console.error)
    listProjects().then(setProjects).catch(console.error)
  }, [])

  const loadTerms = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // Auto-inject reference_language_id from the selected language's setting
    const params = { ...apiParams }
    if (params.language_id && languages.length) {
      const lang = languages.find((l) => l.id === params.language_id)
      if (lang?.reference_language_id) {
        params.reference_language_id = lang.reference_language_id
      }
    }

    setLoading(true)
    try {
      const data = await listTerms(params, controller.signal)
      if (!controller.signal.aborted) {
        setTerms(data.terms)
        setTotal(data.total)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.error('Failed to load terms:', err)
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [apiParams, languages])

  useEffect(() => {
    loadTerms()
    return () => abortRef.current?.abort()
  }, [loadTerms])

  const patchLocalTerm = useCallback(
    (termId: number, updater: (t: GlossaryTerm) => GlossaryTerm) => {
      setTerms((prev) => prev.map((t) => (t.id === termId ? updater(t) : t)))
    },
    [],
  )

  const reloadReferenceData = useCallback(() => {
    listCategories().then(setCategories).catch(console.error)
    listProjects().then(setProjects).catch(console.error)
  }, [])

  async function handleModalSave(data: TermFormData, editingTerm?: GlossaryTerm) {
    const targetLang = languages.find((l) => l.id === selectedLanguageId) || languages.find((l) => l.code === 'en')

    if (editingTerm) {
      const updated = await updateTerm(editingTerm.id, {
        source_term: data.source_term,
        source_language_id: data.source_language_id,
        sanskrit_pali: data.sanskrit_pali,
        category: data.category,
        tbs_notes: data.tbs_notes,
        context_notes: data.context_notes,
        do_not_translate: data.do_not_translate,
        transliterate: data.transliterate,
        project_tags: data.project_tags,
        source_reference: data.source_reference,
        tradition_group: data.tradition_group,
      })

      const langTranslation = targetLang
        ? editingTerm.translations.find((t) => t.language_id === targetLang.id && t.is_preferred)
          || editingTerm.translations.find((t) => t.language_id === targetLang.id)
        : editingTerm.translations.find((t) => t.is_preferred) || editingTerm.translations[0]
      if (langTranslation && data.translated_term) {
        const updatedTrans = await updateTranslation(langTranslation.id, {
          translated_term: data.translated_term,
        })
        patchLocalTerm(editingTerm.id, (t) => ({
          ...updated,
          translations: t.translations.map((tr) => (tr.id === updatedTrans.id ? updatedTrans : tr)),
        }))
      } else if (!langTranslation && data.translated_term && targetLang) {
        const newTrans = await addTranslation(editingTerm.id, {
          language_id: targetLang.id,
          translated_term: data.translated_term,
          is_preferred: true,
        })
        patchLocalTerm(editingTerm.id, () => ({
          ...updated,
          translations: [...(updated.translations || []), newTrans],
        }))
      } else {
        patchLocalTerm(editingTerm.id, (t) => ({ ...updated, translations: t.translations }))
      }
    } else {
      const payload: CreateTermPayload = {
        source_term: data.source_term,
        source_language_id: data.source_language_id,
        sanskrit_pali: data.sanskrit_pali,
        category: data.category,
        tbs_notes: data.tbs_notes,
        context_notes: data.context_notes,
        do_not_translate: data.do_not_translate,
        transliterate: data.transliterate,
        project_tags: data.project_tags,
        source_reference: data.source_reference,
        tradition_group: data.tradition_group,
        translations:
          targetLang && data.translated_term
            ? [
                {
                  language_id: targetLang.id,
                  translated_term: data.translated_term,
                  is_preferred: true,
                  notes: '',
                },
              ]
            : [],
      }
      await createTerm(payload)
      loadTerms()
    }
  }

  async function handleInlineUpdateTerm(id: number, updates: Partial<GlossaryTerm>) {
    const updated = await updateTerm(id, updates)
    patchLocalTerm(id, (t) => ({ ...updated, translations: t.translations }))
  }

  async function handleInlineUpdateTranslation(
    translationId: number,
    updates: { translated_term: string },
  ) {
    const updatedTrans = await updateTranslation(translationId, updates)
    setTerms((prev) =>
      prev.map((t) => {
        if (!t.translations.some((tr) => tr.id === translationId)) return t
        return {
          ...t,
          translations: t.translations.map((tr) =>
            tr.id === translationId ? updatedTrans : tr,
          ),
        }
      }),
    )
  }

  async function handleInlineAddTranslation(termId: number, translatedTerm: string) {
    const targetLang = languages.find((l) => l.id === selectedLanguageId) || languages.find((l) => l.code === 'en')
    if (!targetLang) return
    const newTrans = await addTranslation(termId, {
      language_id: targetLang.id,
      translated_term: translatedTerm,
      is_preferred: true,
    })
    patchLocalTerm(termId, (t) => ({ ...t, translations: [...t.translations, newTrans] }))
  }

  async function handleDelete(id: number) {
    if (confirm && !await confirm({ title: 'Delete term', message: 'Delete this glossary term?', confirmLabel: 'Delete', variant: 'danger' })) return
    try {
      await deleteTerm(id)
      const newTotal = total - 1
      setTotal(newTotal)
      const newTotalPages = Math.max(1, Math.ceil(newTotal / pageSize))
      if (page > newTotalPages) {
        setPage(newTotalPages)
      } else {
        setTerms((prev) => prev.filter((t) => t.id !== id))
        if (terms.length <= 1) loadTerms()
      }
    } catch (err) {
      console.error('Failed to delete term:', err)
    }
  }

  return {
    terms,
    total,
    loading,
    languages,
    categories,
    setCategories,
    projects,
    setProjects,
    projectOptions,
    loadTerms,
    reloadReferenceData,
    handleModalSave,
    handleInlineUpdateTerm,
    handleInlineUpdateTranslation,
    handleInlineAddTranslation,
    handleDelete,
  }
}
