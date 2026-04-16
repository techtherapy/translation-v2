import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Loader2, X } from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import { autocompleteTerms, type AutocompleteSuggestion } from '../../api/glossary'

const PAGE_SIZE = 20

interface SearchAutocompleteProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return text
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-gold/30 rounded-sm px-0.5">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  )
}

export default function SearchAutocomplete({
  value,
  onChange,
  placeholder = 'Search terms...',
}: SearchAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value)
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([])
  const [total, setTotal] = useState(0)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listboxId = 'glossary-autocomplete-listbox'

  const debouncedQuery = useDebounce(inputValue, 300)

  // Sync when parent resets the value (e.g., clearing filters)
  useEffect(() => {
    setInputValue(value)
  }, [value])

  // Fetch suggestions on debounced query change (always resets to first page)
  useEffect(() => {
    if (debouncedQuery.length < 1) {
      setSuggestions([])
      setTotal(0)
      setShowDropdown(false)
      return
    }

    let cancelled = false
    setLoading(true)

    autocompleteTerms(debouncedQuery, PAGE_SIZE, 0)
      .then((result) => {
        if (!cancelled) {
          setSuggestions(result.suggestions)
          setTotal(result.total)
          setShowDropdown(result.suggestions.length > 0)
          setHighlightIndex(-1)
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return
    const items = listRef.current.children
    const target = items[highlightIndex] as HTMLElement | undefined
    target?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex])

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleLoadMore() {
    if (loadingMore) return
    setLoadingMore(true)

    autocompleteTerms(debouncedQuery, PAGE_SIZE, suggestions.length)
      .then((result) => {
        setSuggestions((prev) => [...prev, ...result.suggestions])
        setTotal(result.total)
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false))
  }

  const commitSearch = useCallback(
    (searchValue: string) => {
      onChange(searchValue)
      setShowDropdown(false)
      setHighlightIndex(-1)
    },
    [onChange],
  )

  const selectSuggestion = useCallback(
    (suggestion: AutocompleteSuggestion) => {
      setInputValue(suggestion.source_term)
      commitSearch(suggestion.source_term)
    },
    [commitSearch],
  )

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setInputValue(v)
    // Only update local state for autocomplete — don't call onChange (table filter)
    if (!v) {
      setSuggestions([])
      setTotal(0)
      setShowDropdown(false)
      onChange('')
    }
  }

  function handleClear() {
    setInputValue('')
    setSuggestions([])
    setTotal(0)
    setShowDropdown(false)
    onChange('')
    inputRef.current?.focus()
  }

  const hasMore = total > suggestions.length
  const loadMoreIndex = suggestions.length // index representing the "Load more" item
  const maxIndex = hasMore ? loadMoreIndex : suggestions.length - 1

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (showDropdown && highlightIndex === loadMoreIndex && hasMore) {
        handleLoadMore()
      } else if (showDropdown && highlightIndex >= 0 && highlightIndex < suggestions.length) {
        selectSuggestion(suggestions[highlightIndex])
      } else {
        commitSearch(inputValue)
      }
      return
    }

    if (e.key === 'Escape') {
      if (showDropdown) {
        setShowDropdown(false)
        setHighlightIndex(-1)
      } else {
        ;(e.target as HTMLInputElement).blur()
      }
      return
    }

    if (!showDropdown) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightIndex((prev) => Math.min(prev + 1, maxIndex))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightIndex((prev) => Math.max(prev - 1, -1))
        break
    }
  }

  function handleFocus() {
    if (suggestions.length > 0 && inputValue.length >= 1) {
      setShowDropdown(true)
    }
  }

  const activeDescendant =
    highlightIndex >= 0 ? `autocomplete-option-${suggestions[highlightIndex]?.id}` : undefined

  const remaining = total - suggestions.length

  return (
    <div ref={containerRef} className="relative flex-1 flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-parchment-400 dark:text-ink-400" />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          className="w-full pl-10 pr-8 py-2 border border-parchment-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 dark:border-ink-600 dark:bg-ink-800 dark:text-cream"
        />
        {inputValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-parchment-400 hover:text-ink-700 dark:text-ink-400 dark:hover:text-cream-dim"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {showDropdown && (
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            className="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-ink-800 border border-parchment-300 dark:border-ink-600 rounded-md shadow-lg max-h-64 overflow-y-auto"
            onMouseLeave={() => setHighlightIndex(-1)}
          >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={`autocomplete-option-${suggestion.id}`}
              role="option"
              aria-selected={index === highlightIndex}
              className={`px-3 py-2 cursor-pointer text-sm flex items-center gap-2 ${
                index === highlightIndex
                  ? 'bg-gold/10 dark:bg-gold-faint'
                  : 'hover:bg-parchment-100/50 dark:hover:bg-ink-750/50'
              }`}
              onMouseEnter={() => setHighlightIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault()
                selectSuggestion(suggestion)
              }}
            >
              <span className="font-medium text-ink-850 dark:text-cream truncate">
                {highlightMatch(suggestion.source_term, inputValue)}
              </span>
              {suggestion.translated_term && (
                <>
                  <span className="text-parchment-300 dark:text-ink-600">{'\u2014'}</span>
                  <span className="text-parchment-500 dark:text-cream-muted truncate">
                    {highlightMatch(suggestion.translated_term, inputValue)}
                  </span>
                </>
              )}
              {suggestion.match_field === 'sanskrit_pali' && (
                <span className="ml-auto text-xs text-jade dark:text-jade shrink-0">
                  Sanskrit
                </span>
              )}
            </li>
          ))}
          {loading && (
            <li className="px-3 py-2 text-xs text-parchment-400 dark:text-ink-400 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              Searching...
            </li>
          )}
          {!loading && hasMore && (
            <li
              className={`px-3 py-2 text-xs text-gold-dim dark:text-gold-light border-t border-parchment-200 dark:border-ink-700/50 cursor-pointer flex items-center gap-2 ${
                highlightIndex === loadMoreIndex
                  ? 'bg-gold/10 dark:bg-gold-faint'
                  : 'hover:bg-parchment-100/50 dark:hover:bg-ink-750/50'
              }`}
              onMouseEnter={() => setHighlightIndex(loadMoreIndex)}
              onMouseDown={(e) => {
                e.preventDefault()
                handleLoadMore()
              }}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading...
                </>
              ) : (
                <>Load more ({remaining} remaining)</>
              )}
            </li>
          )}
        </ul>
        )}
      </div>
      {inputValue && (
        <button
          type="button"
          onClick={() => commitSearch(inputValue)}
          className="btn-primary px-3 py-2 rounded-md text-sm font-medium font-body transition-colors shrink-0"
        >
          Search
        </button>
      )}
    </div>
  )
}
