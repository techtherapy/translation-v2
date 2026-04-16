import React, { useState, useEffect, useRef } from 'react'
import { Settings } from 'lucide-react'
import { useAuth } from '../../stores/AuthContext'
import SearchAutocomplete from './SearchAutocomplete'
import type { GlossaryCategory, Language } from '../../types'

// Fallback labels used when categories haven't loaded yet
const defaultCategoryLabels: Record<string, string> = {
  dharma_concept: 'Dharma Concept',
  deity_buddha: 'Deity/Buddha',
  mantra: 'Mantra',
  mudra: 'Mudra',
  practice_ritual: 'Practice/Ritual',
  person: 'Person',
  place_temple: 'Place/Temple',
  honorific: 'Honorific',
  general: 'General',
}

export function buildCategoryLabels(categories: GlossaryCategory[]): Record<string, string> {
  const labels: Record<string, string> = { ...defaultCategoryLabels }
  for (const cat of categories) {
    labels[cat.key] = cat.label
  }
  return labels
}

export type TranslationStatusFilter = '' | 'needs_review' | 'missing'

interface GlossaryFiltersProps {
  search: string
  onSearchChange: (value: string) => void
  categoryFilter: string
  onCategoryChange: (value: string) => void
  projectFilter: string
  onProjectChange: (value: string) => void
  translationStatus: TranslationStatusFilter
  onTranslationStatusChange: (value: TranslationStatusFilter) => void
  projectOptions: string[]
  categories: GlossaryCategory[]
  languages: Language[]
  languageId: number
  onLanguageChange: (id: number) => void
  onManageCategories: () => void
  onManageProjects: () => void
}

export default function GlossaryFilters({
  search,
  onSearchChange,
  categoryFilter,
  onCategoryChange,
  projectFilter,
  onProjectChange,
  translationStatus,
  onTranslationStatusChange,
  projectOptions,
  categories,
  languages,
  languageId,
  onLanguageChange,
  onManageCategories,
  onManageProjects,
}: GlossaryFiltersProps) {
  const { hasPermission } = useAuth()
  const categoryLabels = buildCategoryLabels(categories)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false)
      }
    }
    if (showSettingsMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSettingsMenu])

  return (
    <div className="space-y-3 mb-6 relative z-10">
      <div className="flex items-center gap-4">
        <SearchAutocomplete
          value={search}
          onChange={onSearchChange}
          placeholder="Search terms, translations, or Sanskrit..."
        />
        <select
          value={languageId}
          onChange={(e) => onLanguageChange(Number(e.target.value))}
          className="select-field w-40 shrink-0"
        >
          {languages.filter((l) => l.is_enabled).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="select-field w-48 shrink-0"
        >
          <option value="">All Categories</option>
          {Object.entries(categoryLabels).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        {projectOptions.length > 0 && (
          <select
            value={projectFilter}
            onChange={(e) => onProjectChange(e.target.value)}
            className="select-field w-44 shrink-0"
          >
            <option value="">All Projects</option>
            {projectOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
        {hasPermission('glossary.manage_structure') && (
          <div ref={settingsRef} className="relative shrink-0">
            <button
              onClick={() => setShowSettingsMenu((prev) => !prev)}
              className="flex items-center border border-parchment-300 p-2 rounded-md text-ink-700 hover:bg-parchment-50 dark:border-ink-600 dark:text-cream-dim dark:hover:bg-ink-700"
              title="Manage categories & projects"
            >
              <Settings className="w-4 h-4" />
            </button>
            {showSettingsMenu && (
              <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-parchment-300 py-1 z-50 dark:bg-ink-800 dark:border-ink-600">
                <button
                  onClick={() => { onManageCategories(); setShowSettingsMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm font-body text-ink-700 hover:bg-parchment-100/50 dark:text-cream-dim dark:hover:bg-ink-700"
                >
                  Manage Categories
                </button>
                <button
                  onClick={() => { onManageProjects(); setShowSettingsMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm font-body text-ink-700 hover:bg-parchment-100/50 dark:text-cream-dim dark:hover:bg-ink-700"
                >
                  Manage Projects
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Translation status filter toggles */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-parchment-500 dark:text-cream-muted mr-1 font-body">Status:</span>
        {([
          { value: '' as TranslationStatusFilter, label: 'All' },
          { value: 'needs_review' as TranslationStatusFilter, label: 'Needs Review (?)', color: 'amber' },
          { value: 'missing' as TranslationStatusFilter, label: 'Missing Translation', color: 'red' },
        ]).map(({ value, label, color }) => (
          <button
            key={value}
            onClick={() => onTranslationStatusChange(value)}
            className={`px-3 py-1 rounded-full text-xs font-medium font-body transition-colors ${
              translationStatus === value
                ? value === 'needs_review'
                  ? 'bg-amber-100 text-amber-800 dark:bg-status-warning-bg dark:text-status-warning'
                  : value === 'missing'
                  ? 'bg-red-100 text-red-800 dark:bg-status-error-bg dark:text-status-error'
                  : 'bg-gold/10 text-gold-dim dark:bg-gold-faint dark:text-gold-light'
                : 'bg-parchment-100 text-parchment-500 hover:bg-parchment-200 dark:bg-ink-700 dark:text-cream-muted dark:hover:bg-ink-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
