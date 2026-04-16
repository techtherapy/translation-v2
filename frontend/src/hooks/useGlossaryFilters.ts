import { useState, useCallback, useMemo } from 'react'
import type { SortField, SortOrder } from '../components/glossary/GlossaryTable'
import type { TranslationStatusFilter } from '../components/glossary/GlossaryFilters'

export interface GlossaryApiParams {
  search?: string
  category?: string
  project?: string
  translation_status?: string
  language_id?: number
  reference_language_id?: number
  sort_by?: string
  sort_order: string
  offset: number
  limit: number
}

export default function useGlossaryFilters() {
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [translationStatus, setTranslationStatus] = useState<TranslationStatusFilter>('')
  const [sortBy, setSortBy] = useState<SortField>('source_term')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [languageId, setLanguageId] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v)
    setPage(1)
  }, [])

  const handleCategoryChange = useCallback((v: string) => {
    setCategoryFilter(v)
    setPage(1)
  }, [])

  const handleProjectChange = useCallback((v: string) => {
    setProjectFilter(v)
    setPage(1)
  }, [])

  const handleTranslationStatusChange = useCallback((v: TranslationStatusFilter) => {
    setTranslationStatus(v)
    setPage(1)
  }, [])

  const handleSortChange = useCallback(
    (field: SortField) => {
      if (sortBy === field) {
        if (sortOrder === 'asc') {
          setSortOrder('desc')
        } else {
          setSortBy('source_term')
          setSortOrder('asc')
        }
      } else {
        setSortBy(field)
        setSortOrder('asc')
      }
      setPage(1)
    },
    [sortBy, sortOrder],
  )

  const handleLanguageChange = useCallback((id: number) => {
    setLanguageId(id)
    setPage(1)
  }, [])

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size)
    setPage(1)
  }, [])

  const apiParams = useMemo<GlossaryApiParams>(
    () => ({
      search: search || undefined,
      category: categoryFilter || undefined,
      project: projectFilter || undefined,
      translation_status: translationStatus || undefined,
      language_id: languageId || undefined,
      sort_by: sortBy || undefined,
      sort_order: sortOrder,
      offset: (page - 1) * pageSize,
      limit: pageSize,
    }),
    [search, categoryFilter, projectFilter, translationStatus, languageId, sortBy, sortOrder, page, pageSize],
  )

  return {
    search,
    categoryFilter,
    projectFilter,
    translationStatus,
    languageId,
    sortBy,
    sortOrder,
    page,
    pageSize,
    setPage,
    apiParams,
    handleSearchChange,
    handleCategoryChange,
    handleProjectChange,
    handleTranslationStatusChange,
    handleLanguageChange,
    handleSortChange,
    handlePageSizeChange,
  }
}
