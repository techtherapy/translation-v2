import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import GlossaryRow from './GlossaryRow'
import type { GlossaryTerm, Language, GlossaryCategory } from '../../types'

export type SortField = 'source_term' | 'translated_term' | 'sanskrit_pali' | 'category' | 'project_tags' | 'tradition_group' | 'do_not_translate' | ''
export type SortOrder = 'asc' | 'desc'

interface GlossaryTableProps {
  terms: GlossaryTerm[]
  languages: Language[]
  categories: GlossaryCategory[]
  selectedLanguageId: number
  translationColumnLabel: string
  sortBy: SortField
  sortOrder: SortOrder
  onSortChange: (field: SortField) => void
  onUpdateTerm: (id: number, updates: Partial<GlossaryTerm>) => Promise<void>
  onUpdateTranslation: (translationId: number, updates: { translated_term: string }) => Promise<void>
  onAddTranslation: (termId: number, translated_term: string) => Promise<void>
  onDeleteTerm: (id: number) => void
  onEditTerm: (term: GlossaryTerm) => void
  referenceLanguageId: number
  referenceColumnLabel: string
}

const columns: { field: SortField; label: string; sortable: boolean }[] = [
  { field: 'source_term', label: 'Source', sortable: true },
  { field: 'translated_term', label: 'English', sortable: true },
  { field: 'sanskrit_pali', label: 'Sanskrit', sortable: true },
  { field: 'category', label: 'Category', sortable: true },
  { field: 'project_tags', label: 'Project', sortable: true },
  { field: 'tradition_group', label: 'Tradition', sortable: true },
  { field: 'do_not_translate', label: 'Flags', sortable: true },
]

function SortIcon({ field, sortBy, sortOrder }: { field: SortField; sortBy: SortField; sortOrder: SortOrder }) {
  if (field !== sortBy) return <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />
  if (sortOrder === 'asc') return <ArrowUp className="w-3 h-3" />
  return <ArrowDown className="w-3 h-3" />
}

export default function GlossaryTable({
  terms,
  languages,
  categories,
  selectedLanguageId,
  translationColumnLabel,
  sortBy,
  sortOrder,
  onSortChange,
  onUpdateTerm,
  onUpdateTranslation,
  onAddTranslation,
  onDeleteTerm,
  onEditTerm,
  referenceLanguageId,
  referenceColumnLabel,
}: GlossaryTableProps) {
  const baseColumns = columns.map((col) =>
    col.field === 'translated_term' ? { ...col, label: translationColumnLabel } : col,
  )
  const displayColumns = referenceLanguageId > 0
    ? [
        baseColumns[0],
        { field: '' as SortField, label: `${referenceColumnLabel} (ref)`, sortable: false },
        ...baseColumns.slice(1),
      ]
    : baseColumns
  return (
    <div className="surface border border-parchment-300 dark:border-ink-600 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-parchment-100 dark:bg-ink-900/50 border-b border-parchment-300 dark:border-ink-600">
          <tr>
            {displayColumns.map((col) => (
              <th
                key={col.label}
                onClick={col.sortable ? () => onSortChange(col.field) : undefined}
                className={`text-left px-4 py-3 font-bold text-parchment-500 dark:text-cream-muted ${
                  col.sortable ? 'cursor-pointer select-none group hover:text-ink-850 dark:hover:text-cream' : ''
                }`}
              >
                <div className="flex items-center gap-1">
                  {col.label}
                  {col.sortable && <SortIcon field={col.field} sortBy={sortBy} sortOrder={sortOrder} />}
                </div>
              </th>
            ))}
            <th className="w-20"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-parchment-200 dark:divide-ink-700/50">
          {terms.map((term) => (
            <GlossaryRow
              key={term.id}
              term={term}
              languages={languages}
              categories={categories}
              selectedLanguageId={selectedLanguageId}
              referenceLanguageId={referenceLanguageId}
              onUpdateTerm={onUpdateTerm}
              onUpdateTranslation={onUpdateTranslation}
              onAddTranslation={onAddTranslation}
              onDeleteTerm={onDeleteTerm}
              onEditTerm={onEditTerm}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
