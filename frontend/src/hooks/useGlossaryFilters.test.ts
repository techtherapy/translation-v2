import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useGlossaryFilters from './useGlossaryFilters'

describe('useGlossaryFilters', () => {
  it('returns default values', () => {
    const { result } = renderHook(() => useGlossaryFilters())

    expect(result.current.search).toBe('')
    expect(result.current.categoryFilter).toBe('')
    expect(result.current.projectFilter).toBe('')
    expect(result.current.translationStatus).toBe('')
    expect(result.current.sortBy).toBe('source_term')
    expect(result.current.sortOrder).toBe('asc')
    expect(result.current.page).toBe(1)
    expect(result.current.pageSize).toBe(50)
  })

  it('resets page to 1 when search changes', () => {
    const { result } = renderHook(() => useGlossaryFilters())

    act(() => result.current.setPage(3))
    expect(result.current.page).toBe(3)

    act(() => result.current.handleSearchChange('test'))
    expect(result.current.search).toBe('test')
    expect(result.current.page).toBe(1)
  })

  it('resets page to 1 when category changes', () => {
    const { result } = renderHook(() => useGlossaryFilters())

    act(() => result.current.setPage(5))
    act(() => result.current.handleCategoryChange('dharma_concept'))
    expect(result.current.categoryFilter).toBe('dharma_concept')
    expect(result.current.page).toBe(1)
  })

  it('resets page to 1 when project changes', () => {
    const { result } = renderHook(() => useGlossaryFilters())

    act(() => result.current.setPage(2))
    act(() => result.current.handleProjectChange('DLLB'))
    expect(result.current.projectFilter).toBe('DLLB')
    expect(result.current.page).toBe(1)
  })

  it('resets page to 1 when translation status changes', () => {
    const { result } = renderHook(() => useGlossaryFilters())

    act(() => result.current.setPage(4))
    act(() => result.current.handleTranslationStatusChange('missing'))
    expect(result.current.translationStatus).toBe('missing')
    expect(result.current.page).toBe(1)
  })

  it('handles sort cycling: asc -> desc -> reset', () => {
    const { result } = renderHook(() => useGlossaryFilters())

    // Default: source_term asc
    expect(result.current.sortBy).toBe('source_term')
    expect(result.current.sortOrder).toBe('asc')

    // Click same column -> desc
    act(() => result.current.handleSortChange('source_term'))
    expect(result.current.sortBy).toBe('source_term')
    expect(result.current.sortOrder).toBe('desc')

    // Click same column again -> reset to default
    act(() => result.current.handleSortChange('source_term'))
    expect(result.current.sortBy).toBe('source_term')
    expect(result.current.sortOrder).toBe('asc')
  })

  it('switches to new sort field with asc order', () => {
    const { result } = renderHook(() => useGlossaryFilters())

    act(() => result.current.handleSortChange('category'))
    expect(result.current.sortBy).toBe('category')
    expect(result.current.sortOrder).toBe('asc')
  })

  it('resets page to 1 on page size change', () => {
    const { result } = renderHook(() => useGlossaryFilters())

    act(() => result.current.setPage(3))
    act(() => result.current.handlePageSizeChange(100))
    expect(result.current.pageSize).toBe(100)
    expect(result.current.page).toBe(1)
  })

  it('computes correct apiParams', () => {
    const { result } = renderHook(() => useGlossaryFilters())

    act(() => {
      result.current.handleSearchChange('buddha')
      result.current.handleCategoryChange('dharma_concept')
    })

    const params = result.current.apiParams
    expect(params.search).toBe('buddha')
    expect(params.category).toBe('dharma_concept')
    expect(params.project).toBeUndefined()
    expect(params.translation_status).toBeUndefined()
    expect(params.sort_by).toBe('source_term')
    expect(params.sort_order).toBe('asc')
    expect(params.offset).toBe(0)
    expect(params.limit).toBe(50)
  })

  it('computes offset from page and pageSize', () => {
    const { result } = renderHook(() => useGlossaryFilters())

    act(() => result.current.setPage(3))
    expect(result.current.apiParams.offset).toBe(100) // (3-1) * 50
  })
})
