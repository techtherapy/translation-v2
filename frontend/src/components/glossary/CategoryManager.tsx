import React, { useState, useMemo, useRef, useEffect } from 'react'
import { Plus, Trash2, Check } from 'lucide-react'
import type { GlossaryCategory } from '../../types'
import { createCategory, updateCategory, deleteCategory } from '../../api/glossary'
import { extractErrorMessage } from '../../utils/extractErrorMessage'
import { useConfirm } from '../../hooks/useConfirm'

const COLOR_OPTIONS = [
  { value: 'gray', tw: 'bg-parchment-300 dark:bg-ink-400' },
  { value: 'amber', tw: 'bg-amber-300 dark:bg-amber-500' },
  { value: 'purple', tw: 'bg-purple-300 dark:bg-purple-500' },
  { value: 'red', tw: 'bg-red-300 dark:bg-red-500' },
  { value: 'pink', tw: 'bg-pink-300 dark:bg-pink-500' },
  { value: 'blue', tw: 'bg-blue-300 dark:bg-blue-500' },
  { value: 'green', tw: 'bg-green-300 dark:bg-green-500' },
  { value: 'cyan', tw: 'bg-cyan-300 dark:bg-cyan-500' },
  { value: 'orange', tw: 'bg-orange-300 dark:bg-orange-500' },
  { value: 'indigo', tw: 'bg-indigo-300 dark:bg-indigo-500' },
]

function getColorTw(value: string) {
  return COLOR_OPTIONS.find((c) => c.value === value)?.tw || COLOR_OPTIONS[0].tw
}

function CompactColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`w-6 h-6 rounded-full ${getColorTw(value)} ring-2 ring-offset-1 ring-gold/60 dark:ring-offset-ink-800`}
        title="Change color"
      />
      {open && (
        <div className="absolute left-0 top-8 z-10 grid grid-cols-5 gap-1.5 p-2 w-[170px] bg-white rounded-lg shadow-lg border border-parchment-300 dark:bg-ink-800 dark:border-ink-600">
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => { onChange(c.value); setOpen(false) }}
              className={`w-6 h-6 rounded-full ${c.tw} flex items-center justify-center transition-all hover:scale-110 ${
                value === c.value ? 'ring-2 ring-offset-1 ring-gold dark:ring-offset-ink-800' : ''
              }`}
              title={c.value}
            >
              {value === c.value && (
                <Check className="w-3 h-3 text-white dark:text-cream" strokeWidth={3} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface CategoryManagerProps {
  categories: GlossaryCategory[]
  onCategoriesChange: (categories: GlossaryCategory[]) => void
  onClose: () => void
}

export default function CategoryManager({ categories, onCategoriesChange, onClose }: CategoryManagerProps) {
  const confirm = useConfirm()
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState('gray')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...categories].sort((a, b) => a.label.localeCompare(b.label)),
    [categories],
  )

  async function handleAdd() {
    const label = newLabel.trim()
    if (!label) return
    const key = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    if (!key) return

    setSaving(true)
    setError(null)
    try {
      const cat = await createCategory({
        key,
        label,
        color: newColor,
        sort_order: categories.length,
      })
      onCategoriesChange([...categories, cat])
      setNewLabel('')
      setNewColor('gray')
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to create category'))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(key: string, updates: Partial<Pick<GlossaryCategory, 'label' | 'color' | 'sort_order'>>) {
    try {
      const updated = await updateCategory(key, updates)
      onCategoriesChange(categories.map((c) => c.key === key ? updated : c))
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to update category'))
    }
  }

  async function handleDelete(key: string) {
    if (!await confirm({ title: 'Delete category', message: `Delete category "${key}"? Terms using this category will keep the value but it won't appear in filters.`, confirmLabel: 'Delete', variant: 'danger' })) return
    try {
      await deleteCategory(key)
      onCategoriesChange(categories.filter((c) => c.key !== key))
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to delete category'))
    }
  }

  const inputClass = 'input-field'

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div
        className="surface-glass shadow-surface-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold font-heading text-ink-850 dark:text-cream mb-4">Manage Categories</h2>

        {error && (
          <div className="mb-4 px-3 py-2 text-sm text-red-600 bg-red-50 rounded-md dark:text-status-error dark:bg-status-error-bg">
            {error}
          </div>
        )}

        {/* Add new category — at top */}
        <div className="mb-5 pb-5 border-b border-parchment-300 dark:border-ink-600">
          <label className="label mb-2 block">New Category</label>
          <div className="flex items-center gap-3">
            <CompactColorPicker value={newColor} onChange={setNewColor} />
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="e.g. Mudra/Seal"
              className={inputClass + ' flex-1 min-w-0'}
            />
            <button
              onClick={handleAdd}
              disabled={saving || !newLabel.trim()}
              className="btn-primary flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium font-body disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>

        {/* Existing categories — sorted alphabetically */}
        <div className="space-y-2 mb-6">
          {sorted.map((cat) => (
            <div key={cat.key} className="flex items-center gap-3 p-3 bg-parchment-50 rounded-md dark:bg-ink-700/50">
              <CompactColorPicker
                value={cat.color}
                onChange={(color) => handleUpdate(cat.key, { color })}
              />

              <input
                type="text"
                value={cat.label}
                onChange={(e) => handleUpdate(cat.key, { label: e.target.value })}
                className={`${inputClass} flex-1 min-w-0`}
              />

              <button
                onClick={() => handleDelete(cat.key)}
                className="flex-shrink-0 text-parchment-400 hover:text-status-error dark:text-ink-400 dark:hover:text-status-error"
                title="Delete category"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="btn-ghost px-4 py-2 text-sm font-body"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
