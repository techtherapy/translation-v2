import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Loader2, X, AlertCircle, Check } from 'lucide-react'
import { getAvailableModels, type ProviderModels, type ModelCost } from '../../api/settings'

interface ModelSelectorProps {
  value: string
  onChange: (value: string) => void
}

export default function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const [inputValue, setInputValue] = useState(value)
  const [providers, setProviders] = useState<ProviderModels[]>([])
  const [loading, setLoading] = useState(true)
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Sync when parent resets the value
  useEffect(() => {
    setInputValue(value)
  }, [value])

  // Fetch available models on mount
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getAvailableModels()
      .then((data) => {
        if (!cancelled) setProviders(data)
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return
    const el = listRef.current.querySelector(`[data-index="${highlightIndex}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex])

  // Build flat list of selectable items for keyboard nav, filtering by input
  const filter = inputValue.toLowerCase().trim()
  const flatItems: { id: string; name: string; providerName: string; apiKeySet: boolean; cost?: ModelCost | null }[] = []
  for (const p of providers) {
    for (const m of p.models) {
      if (filter && !m.id.toLowerCase().includes(filter) && !m.name.toLowerCase().includes(filter)) {
        continue
      }
      flatItems.push({ id: m.id, name: m.name, providerName: p.provider, apiKeySet: p.api_key_set, cost: m.cost })
    }
  }

  // Group filtered items by provider for rendering
  const groupedItems: { provider: string; apiKeySet: boolean; models: { id: string; name: string; flatIndex: number; cost?: ModelCost | null }[] }[] = []
  let flatIndex = 0
  for (const p of providers) {
    const models: { id: string; name: string; flatIndex: number; cost?: ModelCost | null }[] = []
    for (const m of p.models) {
      if (filter && !m.id.toLowerCase().includes(filter) && !m.name.toLowerCase().includes(filter)) {
        continue
      }
      models.push({ id: m.id, name: m.name, flatIndex, cost: m.cost })
      flatIndex++
    }
    if (models.length > 0) {
      groupedItems.push({ provider: p.provider, apiKeySet: p.api_key_set, models })
    }
  }

  const hasAnyKeys = providers.some((p) => p.api_key_set)
  const isCustomValue = value && !providers.some((p) => p.models.some((m) => m.id === value))

  function selectModel(modelId: string) {
    setInputValue(modelId)
    onChange(modelId)
    setIsOpen(false)
    setHighlightIndex(-1)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setInputValue(v)
    onChange(v)
    setHighlightIndex(-1)
    if (!isOpen) setIsOpen(true)
  }

  function handleClear() {
    setInputValue('')
    onChange('')
    setIsOpen(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setHighlightIndex(-1)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      if (isOpen && highlightIndex >= 0 && highlightIndex < flatItems.length) {
        selectModel(flatItems[highlightIndex].id)
      } else {
        setIsOpen(false)
      }
      return
    }

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setIsOpen(true)
        setHighlightIndex(0)
        e.preventDefault()
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((prev) => Math.min(prev + 1, flatItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((prev) => Math.max(prev - 1, -1))
    }
  }

  function handleFocus() {
    if (!isOpen && flatItems.length > 0) {
      setIsOpen(true)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-parchment-400 dark:text-ink-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading available models...
      </div>
    )
  }

  if (!hasAnyKeys && providers.length > 0) {
    return (
      <div className="flex items-center gap-2 py-3 px-4 rounded-md bg-parchment-100 dark:bg-ink-750 text-sm text-parchment-500 dark:text-cream-muted">
        <AlertCircle className="w-4 h-4 shrink-0" />
        No API keys configured. Add at least one API key above to see available models.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder="Select or type a model ID..."
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          className="input-field pr-16 font-mono text-sm"
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {inputValue && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 text-parchment-400 hover:text-ink-700 dark:text-ink-400 dark:hover:text-cream-dim rounded"
              aria-label="Clear"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setIsOpen(!isOpen)
              if (!isOpen) inputRef.current?.focus()
            }}
            className="p-1 text-parchment-400 hover:text-ink-700 dark:text-ink-400 dark:hover:text-cream-dim rounded"
            aria-label="Toggle model list"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {isCustomValue && !isOpen && (
        <span className="text-xs text-gold mt-1 inline-block">Custom model ID</span>
      )}

      {isOpen && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-ink-800 border border-parchment-300 dark:border-ink-600 rounded-md shadow-lg max-h-72 overflow-y-auto"
        >
          {groupedItems.length === 0 ? (
            <div className="px-3 py-4 text-sm text-parchment-400 dark:text-ink-400 text-center">
              No matching models
            </div>
          ) : (
            groupedItems.map((group) => (
              <div key={group.provider}>
                {/* Provider header */}
                <div className="sticky top-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider bg-parchment-50 dark:bg-ink-750 text-parchment-500 dark:text-cream-muted border-b border-parchment-200 dark:border-ink-700/50 flex items-center justify-between">
                  <span>{group.provider}</span>
                  {group.apiKeySet ? (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-[10px] font-normal normal-case">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                      Key set
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-parchment-400 dark:text-ink-400 text-[10px] font-normal normal-case">
                      <span className="w-1.5 h-1.5 rounded-full bg-parchment-300 dark:bg-ink-600 inline-block" />
                      No key
                    </span>
                  )}
                </div>
                {/* Models */}
                {group.models.map((m) => {
                  const isHighlighted = m.flatIndex === highlightIndex
                  const isSelected = m.id === value
                  return (
                    <div
                      key={m.id}
                      data-index={m.flatIndex}
                      role="option"
                      aria-selected={isHighlighted}
                      className={`px-3 py-2 cursor-pointer text-sm flex items-center justify-between gap-2 ${
                        isHighlighted
                          ? 'bg-gold/10 dark:bg-gold-faint'
                          : 'hover:bg-parchment-100/50 dark:hover:bg-ink-750/50'
                      } ${!group.apiKeySet ? 'opacity-50' : ''}`}
                      onMouseEnter={() => setHighlightIndex(m.flatIndex)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        selectModel(m.id)
                      }}
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-ink-850 dark:text-cream truncate">{m.name}</span>
                          {m.cost && (m.cost.input_per_million != null || m.cost.output_per_million != null) && (
                            <span className="text-[10px] text-parchment-400 dark:text-ink-400 font-mono shrink-0">
                              ${m.cost.input_per_million?.toFixed(2) ?? '?'} / ${m.cost.output_per_million?.toFixed(2) ?? '?'}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-parchment-400 dark:text-ink-400 font-mono truncate">{m.id}</span>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-gold shrink-0" />}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
