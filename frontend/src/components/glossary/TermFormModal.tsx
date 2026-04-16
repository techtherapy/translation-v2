import React, { useState, useEffect } from 'react'
import { CheckCircle, Sparkles, Loader2, AlertTriangle } from 'lucide-react'
import type { GlossaryTerm, Language, GlossaryCategory } from '../../types'
import { buildCategoryLabels } from './GlossaryFilters'
import { aiCompleteTerm, aiCompleteInline, listTerms, type AICompleteResponse } from '../../api/glossary'
import { extractErrorMessage } from '../../utils/extractErrorMessage'

interface TermFormModalProps {
  term?: GlossaryTerm
  initialSourceTerm?: string
  initialTranslatedTerm?: string
  selectedLanguageId?: number
  languages: Language[]
  categories: GlossaryCategory[]
  projectOptions: string[]
  onSave: (data: TermFormData) => Promise<void>
  onClose: () => void
}

export interface TermFormData {
  source_term: string
  source_language_id: number | null
  translated_term: string
  sanskrit_pali: string
  category: string
  tbs_notes: string
  context_notes: string
  do_not_translate: boolean
  transliterate: boolean
  project_tags: string
  source_reference: string
  tradition_group: string
}

const defaultFormData: TermFormData = {
  source_term: '',
  source_language_id: null,
  translated_term: '',
  sanskrit_pali: '',
  category: 'general',
  tbs_notes: '',
  context_notes: '',
  do_not_translate: false,
  transliterate: false,
  project_tags: '',
  source_reference: '',
  tradition_group: '',
}

type AIField = 'english' | 'sanskrit' | 'category'

export default function TermFormModal({ term, initialSourceTerm, initialTranslatedTerm, selectedLanguageId, languages, categories, projectOptions, onSave, onClose }: TermFormModalProps) {
  const categoryLabels = buildCategoryLabels(categories)
  const isEdit = !!term
  const [formData, setFormData] = useState<TermFormData>({ ...defaultFormData })
  const [saving, setSaving] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)

  // AI completion state
  const [aiLoading, setAiLoading] = useState<AIField | 'all' | null>(null)
  const [aiConfidence, setAiConfidence] = useState<number | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  // Track which fields were just filled by AI for visual highlight
  const [aiFilledFields, setAiFilledFields] = useState<Set<AIField>>(new Set())

  useEffect(() => {
    if (term) {
      const langTranslation = selectedLanguageId
        ? term.translations.find((t) => t.language_id === selectedLanguageId && t.is_preferred)
          || term.translations.find((t) => t.language_id === selectedLanguageId)
        : term.translations.find((t) => t.is_preferred) || term.translations[0]
      setFormData({
        source_term: term.source_term,
        source_language_id: term.source_language_id,
        translated_term: langTranslation?.translated_term || '',
        sanskrit_pali: term.sanskrit_pali || '',
        category: term.category,
        tbs_notes: term.tbs_notes || '',
        context_notes: term.context_notes || '',
        do_not_translate: term.do_not_translate,
        transliterate: term.transliterate,
        project_tags: term.project_tags || '',
        source_reference: term.source_reference || '',
        tradition_group: term.tradition_group || '',
      })
    } else {
      setFormData({
        ...defaultFormData,
        source_term: initialSourceTerm || '',
        translated_term: initialTranslatedTerm || '',
      })
    }
    setAiConfidence(null)
    setAiError(null)
    setAiFilledFields(new Set())
    setDuplicateWarning(null)
  }, [term, initialSourceTerm, initialTranslatedTerm])

  // Check for duplicate glossary entries when source_term changes
  useEffect(() => {
    if (isEdit || !formData.source_term.trim()) {
      setDuplicateWarning(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const result = await listTerms(
          { search: formData.source_term, limit: 5, language_id: selectedLanguageId },
          controller.signal,
        )
        const exact = result.terms.find(
          (t) => t.source_term === formData.source_term,
        )
        if (exact) {
          const translation = exact.translations[0]?.translated_term
          setDuplicateWarning(
            `"${exact.source_term}" already exists in the glossary` +
            (translation ? ` (${translation})` : ''),
          )
        } else {
          setDuplicateWarning(null)
        }
      } catch {
        // Ignore aborted/failed lookups
      }
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [formData.source_term, isEdit, selectedLanguageId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave(formData)
    } catch (err) {
      console.error('Failed to save:', err)
    } finally {
      setSaving(false)
    }
  }

  function handleAcceptTranslation() {
    setFormData({
      ...formData,
      translated_term: formData.translated_term.replace(/\?/g, '').trim(),
    })
  }

  function applyAiSuggestions(result: AICompleteResponse) {
    const filled = new Set<AIField>()
    const updates: Partial<TermFormData> = {}

    if (result.english != null && result.english !== '') {
      updates.translated_term = result.english
      filled.add('english')
    }
    if (result.sanskrit != null && result.sanskrit !== '') {
      updates.sanskrit_pali = result.sanskrit
      filled.add('sanskrit')
    }
    if (result.category != null && result.category !== '') {
      updates.category = result.category
      filled.add('category')
    }

    if (Object.keys(updates).length > 0) {
      setFormData((prev) => ({ ...prev, ...updates }))
    }
    setAiFilledFields(filled)
    setAiConfidence(result.confidence)

    // Clear highlight after 3 seconds
    setTimeout(() => setAiFilledFields(new Set()), 3000)
  }

  const targetLanguageName = selectedLanguageId
    ? languages.find((l) => l.id === selectedLanguageId)?.name || 'English'
    : 'English'

  async function handleAiComplete(field?: AIField) {
    if (!formData.source_term.trim()) return
    const loadingState = field || 'all'
    setAiLoading(loadingState)
    setAiError(null)
    setAiConfidence(null)

    try {
      let result: AICompleteResponse
      if (term) {
        // Existing term: use the term_id endpoint
        result = await aiCompleteTerm(
          term.id,
          field ? [field] : undefined,
          undefined,
          targetLanguageName,
        )
      } else {
        // New term: use the inline endpoint with current form data
        result = await aiCompleteInline({
          source_term: formData.source_term,
          english: formData.translated_term,
          sanskrit: formData.sanskrit_pali,
          category: formData.category,
          context_notes: formData.context_notes,
          tbs_notes: formData.tbs_notes,
          project_tags: formData.project_tags,
          tradition_group: formData.tradition_group,
          fields: field ? [field] : undefined,
          target_language: targetLanguageName,
        })
      }
      applyAiSuggestions(result)
    } catch (err: unknown) {
      setAiError(extractErrorMessage(err, 'AI completion failed'))
      setTimeout(() => setAiError(null), 5000)
    } finally {
      setAiLoading(null)
    }
  }

  const hasQuestion = formData.translated_term.includes('?')
  const isAiDisabled = !formData.source_term.trim() || aiLoading !== null

  const inputClass = 'input-field'
  const labelClass = 'label'

  function aiFieldHighlight(field: AIField): string {
    if (aiFilledFields.has(field)) {
      return 'ring-2 ring-jade/50 border-jade/50'
    }
    return ''
  }

  function renderSparkleButton(field: AIField) {
    const isFieldLoading = aiLoading === field
    return (
      <button
        type="button"
        onClick={() => handleAiComplete(field)}
        disabled={isAiDisabled}
        className="ml-1.5 inline-flex items-center text-jade hover:text-jade-light dark:text-jade dark:hover:text-jade-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title={`AI suggest ${field}`}
      >
        {isFieldLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Sparkles className="w-3.5 h-3.5" />
        )}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="surface-glass shadow-surface-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold font-heading text-ink-850 dark:text-cream">
            {isEdit ? 'Edit Glossary Term' : 'Add Glossary Term'}
          </h2>
          <button
            type="button"
            onClick={() => handleAiComplete()}
            disabled={isAiDisabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-body text-jade bg-jade-faint hover:bg-teal-200 hover:border-teal-400 rounded-md border border-jade/40 dark:text-jade dark:bg-jade-faint dark:hover:bg-jade/20 dark:hover:border-jade/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Use AI to fill all empty fields"
          >
            {aiLoading === 'all' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            Complete All with AI
          </button>
        </div>

        {/* AI status messages */}
        {aiError && (
          <div className="px-3 py-2 text-xs text-red-600 bg-red-50 rounded-md dark:text-status-error dark:bg-status-error-bg">
            {aiError}
          </div>
        )}
        {aiConfidence !== null && !aiError && (
          <div className="px-3 py-2 text-xs text-jade-dim bg-jade-faint rounded-md dark:text-jade dark:bg-jade-faint flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            AI suggestions applied (confidence: {Math.round(aiConfidence * 100)}%)
          </div>
        )}
        {duplicateWarning && (
          <div className="px-3 py-2 text-xs text-amber-700 bg-amber-50 rounded-md dark:text-status-warning dark:bg-status-warning-bg flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            {duplicateWarning}
          </div>
        )}

        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className={labelClass}>Source Term *</label>
            <input
              type="text"
              value={formData.source_term}
              onChange={(e) => setFormData({ ...formData, source_term: e.target.value })}
              className={`${inputClass} ${(() => { const code = formData.source_language_id ? languages.find(l => l.id === formData.source_language_id)?.code : 'zh'; return ['zh', 'ja', 'ko'].includes(code || '') ? 'font-chinese' : ''; })()}`}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Source Language</label>
            <select
              value={formData.source_language_id ?? ''}
              onChange={(e) => setFormData({ ...formData, source_language_id: e.target.value ? Number(e.target.value) : null })}
              className="select-field"
            >
              <option value="">Default</option>
              {languages.filter((l) => l.is_enabled).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className={labelClass}>
            {selectedLanguageId ? (languages.find((l) => l.id === selectedLanguageId)?.name || 'English') : 'English'} Translation
            {renderSparkleButton('english')}
            {hasQuestion && (
              <button
                type="button"
                onClick={handleAcceptTranslation}
                className="ml-2 inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-700 dark:text-green-400"
                title="Accept translation (remove ?)"
              >
                <CheckCircle className="w-3 h-3" />
                Accept
              </button>
            )}
          </label>
          <input
            type="text"
            value={formData.translated_term}
            onChange={(e) => setFormData({ ...formData, translated_term: e.target.value })}
            className={`${inputClass} ${hasQuestion ? 'border-amber-400 bg-amber-50/50 dark:border-amber-500 dark:bg-amber-900/20' : ''} ${aiFieldHighlight('english')}`}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              Sanskrit/Pali
              {renderSparkleButton('sanskrit')}
            </label>
            <input
              type="text"
              value={formData.sanskrit_pali}
              onChange={(e) => setFormData({ ...formData, sanskrit_pali: e.target.value })}
              className={`${inputClass} ${aiFieldHighlight('sanskrit')}`}
            />
          </div>
          <div>
            <label className={labelClass}>
              Category
              {renderSparkleButton('category')}
            </label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className={`select-field ${aiFieldHighlight('category')}`}
            >
              {Object.entries(categoryLabels)
                .sort(([, a], [, b]) => a.localeCompare(b))
                .map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Project</label>
            <select
              value={formData.project_tags}
              onChange={(e) => setFormData({ ...formData, project_tags: e.target.value })}
              className="select-field"
            >
              <option value="">{'\u2014'} None {'\u2014'}</option>
              {[...projectOptions].sort((a, b) => a.localeCompare(b)).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Tradition/Group</label>
            <input
              type="text"
              value={formData.tradition_group}
              onChange={(e) => setFormData({ ...formData, tradition_group: e.target.value })}
              className={inputClass}
              placeholder="e.g. Kagyupa"
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Source Reference</label>
          <input
            type="text"
            value={formData.source_reference}
            onChange={(e) => setFormData({ ...formData, source_reference: e.target.value })}
            className={inputClass}
            placeholder="URL or citation"
          />
        </div>

        <div>
          <label className={labelClass}>TBS Notes</label>
          <textarea
            value={formData.tbs_notes}
            onChange={(e) => setFormData({ ...formData, tbs_notes: e.target.value })}
            className={inputClass}
            rows={2}
            placeholder="How this term is used in True Buddha School context..."
          />
        </div>

        <div>
          <label className={labelClass}>Context Notes</label>
          <textarea
            value={formData.context_notes}
            onChange={(e) => setFormData({ ...formData, context_notes: e.target.value })}
            className={inputClass}
            rows={2}
            placeholder="Related information..."
          />
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm font-body text-ink-700 dark:text-cream-dim">
            <input
              type="checkbox"
              checked={formData.do_not_translate}
              onChange={(e) => setFormData({ ...formData, do_not_translate: e.target.checked })}
              className="rounded"
            />
            Do Not Translate
          </label>
          <label className="flex items-center gap-2 text-sm font-body text-ink-700 dark:text-cream-dim">
            <input
              type="checkbox"
              checked={formData.transliterate}
              onChange={(e) => setFormData({ ...formData, transliterate: e.target.checked })}
              className="rounded"
            />
            Transliterate Only
          </label>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost px-4 py-2 text-sm font-body"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary px-4 py-2 rounded-md text-sm font-medium font-body disabled:opacity-50"
          >
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
