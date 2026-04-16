import React, { useState, useRef, useEffect } from 'react'
import { Trash2, ExternalLink, Pencil, Check, X, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../stores/AuthContext'
import type { GlossaryTerm, Language, GlossaryCategory } from '../../types'
import { buildCategoryLabels } from './GlossaryFilters'

// Map category color names to Tailwind classes
const colorClassMap: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-400',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
  gray: 'bg-parchment-100 text-ink-700 dark:bg-ink-700 dark:text-cream-dim',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400',
}

export function buildCategoryColors(categories: GlossaryCategory[]): Record<string, string> {
  const colors: Record<string, string> = {
    dharma_concept: colorClassMap.amber,
    deity_buddha: colorClassMap.purple,
    mantra: colorClassMap.red,
    mudra: colorClassMap.pink,
    practice_ritual: colorClassMap.blue,
    person: colorClassMap.green,
    place_temple: colorClassMap.cyan,
    honorific: colorClassMap.orange,
    general: colorClassMap.gray,
  }
  for (const cat of categories) {
    colors[cat.key] = colorClassMap[cat.color] || colorClassMap.gray
  }
  return colors
}

interface GlossaryRowProps {
  term: GlossaryTerm
  languages: Language[]
  categories: GlossaryCategory[]
  selectedLanguageId: number
  referenceLanguageId: number
  onUpdateTerm: (id: number, updates: Partial<GlossaryTerm>) => Promise<void>
  onUpdateTranslation: (translationId: number, updates: { translated_term: string }) => Promise<void>
  onAddTranslation: (termId: number, translated_term: string) => Promise<void>
  onDeleteTerm: (id: number) => void
  onEditTerm: (term: GlossaryTerm) => void
}

type EditingField = 'chinese' | 'english' | 'sanskrit' | 'category' | 'project' | 'tradition' | null

export default function GlossaryRow({
  term,
  languages,
  categories,
  selectedLanguageId,
  referenceLanguageId,
  onUpdateTerm,
  onUpdateTranslation,
  onAddTranslation,
  onDeleteTerm,
  onEditTerm,
}: GlossaryRowProps) {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('glossary.edit')
  const [editing, setEditing] = useState<EditingField>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  const categoryLabels = buildCategoryLabels(categories)
  const categoryColors = buildCategoryColors(categories)

  const enTranslation = selectedLanguageId
    ? term.translations.find((t) => t.language_id === selectedLanguageId && t.is_preferred)
      || term.translations.find((t) => t.language_id === selectedLanguageId)
    : term.translations.find((t) => t.is_preferred) || term.translations[0]
  const translatedTerm = enTranslation?.translated_term || ''
  const hasQuestion = translatedTerm.includes('?')
  const isMissing = !enTranslation || !translatedTerm.trim()

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select()
      }
    }
  }, [editing])

  function startEdit(field: EditingField) {
    switch (field) {
      case 'chinese': setEditValue(term.source_term || ''); break
      case 'english': setEditValue(translatedTerm); break
      case 'sanskrit': setEditValue(term.sanskrit_pali || ''); break
      case 'category': setEditValue(term.category); break
      case 'project': setEditValue(term.project_tags || ''); break
      case 'tradition': setEditValue(term.tradition_group || ''); break
    }
    setEditing(field)
  }

  function cancelEdit() {
    setEditing(null)
    setEditValue('')
  }

  async function saveEdit() {
    if (saving) return
    setSaving(true)
    try {
      if (editing === 'english') {
        if (enTranslation) {
          await onUpdateTranslation(enTranslation.id, { translated_term: editValue })
        } else if (editValue.trim()) {
          await onAddTranslation(term.id, editValue.trim())
        }
      } else if (editing === 'chinese') {
        await onUpdateTerm(term.id, { source_term: editValue })
      } else if (editing === 'sanskrit') {
        await onUpdateTerm(term.id, { sanskrit_pali: editValue })
      } else if (editing === 'category') {
        await onUpdateTerm(term.id, { category: editValue })
      } else if (editing === 'project') {
        await onUpdateTerm(term.id, { project_tags: editValue })
      } else if (editing === 'tradition') {
        await onUpdateTerm(term.id, { tradition_group: editValue })
      }
      setEditing(null)
    } catch (err) {
      console.error('Failed to save:', err)
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveEdit()
    } else if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  function renderEditableCell(
    field: EditingField,
    displayContent: React.ReactNode,
    className: string = ''
  ) {
    if (editing === field) {
      if (field === 'category') {
        return (
          <td className="px-4 py-2">
            <div className="flex items-center gap-1">
              <select
                ref={inputRef as React.RefObject<HTMLSelectElement>}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={handleKeyDown}
                className="w-full px-2 py-1 border border-gold/60 rounded text-xs focus:outline-none focus:ring-1 focus:ring-gold/40 dark:border-gold/60 dark:bg-ink-700 dark:text-cream"
                disabled={saving}
              >
                {Object.entries(categoryLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </td>
        )
      }

      return (
        <td className="px-4 py-2">
          <div className="flex items-center gap-1">
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full px-2 py-1 border border-gold/60 rounded text-sm focus:outline-none focus:ring-1 focus:ring-gold/40 dark:border-gold/60 dark:bg-ink-700 dark:text-cream"
              disabled={saving}
            />
            <button onClick={saveEdit} className="text-green-600 hover:text-green-700 dark:text-green-400 flex-shrink-0" disabled={saving}>
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={cancelEdit} className="text-parchment-400 hover:text-ink-700 dark:text-ink-400 flex-shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      )
    }

    if (!canEdit) {
      return (
        <td className={`px-4 py-3 ${className}`}>
          <span>{displayContent}</span>
        </td>
      )
    }

    return (
      <td
        className={`px-4 py-3 cursor-pointer group/cell hover:bg-gold/5 dark:hover:bg-gold-faint ${className}`}
        onDoubleClick={() => startEdit(field)}
        title="Double-click to edit"
      >
        <div className="flex items-center gap-1">
          <span className="flex-1 min-w-0">{displayContent}</span>
          <button
            onClick={(e) => { e.stopPropagation(); startEdit(field) }}
            className="opacity-0 group-hover/cell:opacity-100 flex-shrink-0 text-parchment-400 hover:text-gold dark:text-ink-400 dark:hover:text-gold"
            title="Edit"
          >
            <Pencil className="w-3 h-3" />
          </button>
        </div>
      </td>
    )
  }

  // English display content with status indicators
  let englishDisplay: React.ReactNode
  if (isMissing) {
    englishDisplay = (
      <span className="inline-flex items-center gap-1 text-red-500 dark:text-status-error">
        <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-600 dark:bg-status-error-bg dark:text-status-error rounded font-medium">Missing</span>
      </span>
    )
  } else if (hasQuestion) {
    englishDisplay = (
      <span className="inline-flex items-center gap-1.5">
        <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 dark:bg-status-warning-bg dark:text-status-warning rounded text-sm">
          {translatedTerm}
        </span>
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
      </span>
    )
  } else {
    englishDisplay = <span className="text-ink-700 dark:text-cream-dim">{translatedTerm}</span>
  }

  return (
    <tr className="hover:bg-parchment-100/50 dark:hover:bg-ink-750/50 group">
      {/* Source term - inline editable */}
      {renderEditableCell(
        'chinese',
        <span className="flex items-center gap-1.5">
          <span className={`font-medium text-ink-850 dark:text-cream ${(() => { const code = term.source_language_id ? languages.find(l => l.id === term.source_language_id)?.code : 'zh'; return ['zh', 'ja', 'ko'].includes(code || '') ? 'font-chinese' : ''; })()}`}>{term.source_term}</span>
          {term.source_language_id && (() => {
            const srcLang = languages.find((l) => l.id === term.source_language_id)
            return srcLang ? (
              <span className="text-[10px] px-1 py-0.5 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 rounded uppercase font-mono shrink-0">{srcLang.code}</span>
            ) : null
          })()}
        </span>
      )}

      {/* Reference language (read-only) */}
      {referenceLanguageId > 0 && (() => {
        const refTranslation = term.translations.find((t) => t.language_id === referenceLanguageId && t.is_preferred)
          || term.translations.find((t) => t.language_id === referenceLanguageId)
        return (
          <td className="px-4 py-3">
            <span className="text-parchment-500 dark:text-cream-muted text-sm">
              {refTranslation?.translated_term || '\u2014'}
            </span>
          </td>
        )
      })()}

      {/* Translation - inline editable */}
      {renderEditableCell('english', englishDisplay)}

      {/* Sanskrit - inline editable */}
      {renderEditableCell(
        'sanskrit',
        <span className="text-parchment-500 italic dark:text-cream-muted">{term.sanskrit_pali || '\u2014'}</span>
      )}

      {/* Category - inline editable */}
      {renderEditableCell(
        'category',
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${categoryColors[term.category] || colorClassMap.gray}`}>
          {categoryLabels[term.category] || term.category}
        </span>
      )}

      {/* Project - inline editable */}
      {renderEditableCell(
        'project',
        term.project_tags ? (
          <div className="flex flex-wrap gap-1">
            {term.project_tags.split(',').map((p) => p.trim()).filter(Boolean).map((p) => (
              <span key={p} className="px-1.5 py-0.5 bg-teal-100 text-teal-700 dark:bg-jade-faint dark:text-jade rounded text-xs">{p}</span>
            ))}
          </div>
        ) : <span className="text-parchment-400 dark:text-ink-400">{'\u2014'}</span>,
        'text-xs'
      )}

      {/* Tradition - inline editable */}
      {renderEditableCell(
        'tradition',
        <span className="text-parchment-500 dark:text-cream-muted text-xs">{term.tradition_group || '\u2014'}</span>,
        'text-xs'
      )}

      {/* Flags */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {term.do_not_translate && (
            <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-600 dark:bg-status-error-bg dark:text-status-error rounded">DNT</span>
          )}
          {term.transliterate && (
            <span className="text-[10px] px-1.5 py-0.5 bg-gold/10 text-gold-dim dark:bg-gold-faint dark:text-gold-light rounded">TLIT</span>
          )}
          {term.source_reference && term.source_reference.startsWith('http') && (
            <a
              href={term.source_reference}
              target="_blank"
              rel="noopener noreferrer"
              className="text-parchment-400 hover:text-gold dark:text-ink-400 dark:hover:text-gold"
              title={term.source_reference}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        {(canEdit || hasPermission('glossary.delete')) && (
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {canEdit && (
              <button
                onClick={() => onEditTerm(term)}
                className="text-parchment-400 hover:text-gold dark:text-ink-400 dark:hover:text-gold"
                title="Edit all fields"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            {hasPermission('glossary.delete') && (
              <button
                onClick={() => onDeleteTerm(term.id)}
                className="text-parchment-400 hover:text-status-error dark:text-ink-400 dark:hover:text-status-error"
                title="Delete term"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}
