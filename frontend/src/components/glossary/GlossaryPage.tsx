import { useState, useCallback, useEffect } from 'react'
import type { GlossaryTerm } from '../../types'
import useGlossaryFilters from '../../hooks/useGlossaryFilters'
import useGlossaryTerms from '../../hooks/useGlossaryTerms'
import useGlossaryImport from '../../hooks/useGlossaryImport'
import useBatchAI from '../../hooks/useBatchAI'
import { useConfirm } from '../../hooks/useConfirm'
import GlossaryToolbar from './GlossaryToolbar'
import GlossaryFilters from './GlossaryFilters'
import GlossaryTable from './GlossaryTable'
import TermFormModal, { type TermFormData } from './TermFormModal'
import GlossaryPagination from './GlossaryPagination'
import CategoryManager from './CategoryManager'
import ProjectManager from './ProjectManager'

export default function GlossaryPage() {
  const confirm = useConfirm()
  const filters = useGlossaryFilters()
  const glossary = useGlossaryTerms(filters.apiParams, filters.page, filters.pageSize, filters.setPage, filters.languageId, confirm)
  const { loadTerms, reloadReferenceData } = glossary

  // Default language to English once languages load
  useEffect(() => {
    if (filters.languageId === 0 && glossary.languages.length > 0) {
      const english = glossary.languages.find((l) => l.code === 'en')
      if (english) filters.handleLanguageChange(english.id)
    }
  }, [glossary.languages, filters.languageId])

  const selectedLanguage = glossary.languages.find((l) => l.id === filters.languageId)
  const selectedLanguageName = selectedLanguage?.name || 'English'
  const referenceLanguageId = selectedLanguage?.reference_language_id ?? 0
  const referenceLanguageName = glossary.languages.find((l) => l.id === referenceLanguageId)?.name || ''

  const onImportSuccess = useCallback(() => {
    loadTerms()
    reloadReferenceData()
  }, [loadTerms, reloadReferenceData])

  const { importResult, importLoading, handleImport } = useGlossaryImport(onImportSuccess)
  const { batchAiLoading, batchAiResult, handleBatchAiComplete } = useBatchAI(
    glossary.terms,
    loadTerms,
    confirm,
  )

  // Modal state
  const [modalTerm, setModalTerm] = useState<GlossaryTerm | undefined>(undefined)
  const [showModal, setShowModal] = useState(false)
  const [showCategoryManager, setShowCategoryManager] = useState(false)
  const [showProjectManager, setShowProjectManager] = useState(false)

  async function handleModalSave(data: TermFormData) {
    await glossary.handleModalSave(data, modalTerm)
    setShowModal(false)
    setModalTerm(undefined)
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {showModal && (
        <TermFormModal
          term={modalTerm}
          selectedLanguageId={filters.languageId}
          languages={glossary.languages}
          categories={glossary.categories}
          projectOptions={glossary.projectOptions}
          onSave={handleModalSave}
          onClose={() => { setShowModal(false); setModalTerm(undefined) }}
        />
      )}

      {showCategoryManager && (
        <CategoryManager
          categories={glossary.categories}
          onCategoriesChange={glossary.setCategories}
          onClose={() => setShowCategoryManager(false)}
        />
      )}

      {showProjectManager && (
        <ProjectManager
          projects={glossary.projects}
          onProjectsChange={glossary.setProjects}
          onClose={() => setShowProjectManager(false)}
        />
      )}

      <GlossaryToolbar
        total={glossary.total}
        onAddTerm={() => { setModalTerm(undefined); setShowModal(true) }}
        onImport={handleImport}
        importResult={importResult}
        importLoading={importLoading}
        onBatchAiComplete={handleBatchAiComplete}
        batchAiLoading={batchAiLoading}
        batchAiResult={batchAiResult}
      />

      <div className="stagger-children">
        <GlossaryFilters
          search={filters.search}
          onSearchChange={filters.handleSearchChange}
          categoryFilter={filters.categoryFilter}
          onCategoryChange={filters.handleCategoryChange}
          projectFilter={filters.projectFilter}
          onProjectChange={filters.handleProjectChange}
          translationStatus={filters.translationStatus}
          onTranslationStatusChange={filters.handleTranslationStatusChange}
          projectOptions={glossary.projectOptions}
          categories={glossary.categories}
          languages={glossary.languages}
          languageId={filters.languageId}
          onLanguageChange={filters.handleLanguageChange}
          onManageCategories={() => setShowCategoryManager(true)}
          onManageProjects={() => setShowProjectManager(true)}
        />

        {glossary.loading ? (
          <div className="text-center py-12 text-parchment-400 dark:text-ink-400">Loading...</div>
        ) : glossary.terms.length === 0 ? (
          <div className="text-center py-12 text-parchment-500 dark:text-cream-muted">No terms found. Add terms or import a CSV.</div>
        ) : (
          <>
            <GlossaryTable
              terms={glossary.terms}
              languages={glossary.languages}
              categories={glossary.categories}
              selectedLanguageId={filters.languageId}
              translationColumnLabel={selectedLanguageName}
              sortBy={filters.sortBy}
              sortOrder={filters.sortOrder}
              onSortChange={filters.handleSortChange}
              onUpdateTerm={glossary.handleInlineUpdateTerm}
              onUpdateTranslation={glossary.handleInlineUpdateTranslation}
              onAddTranslation={glossary.handleInlineAddTranslation}
              onDeleteTerm={glossary.handleDelete}
              onEditTerm={(term) => { setModalTerm(term); setShowModal(true) }}
              referenceLanguageId={referenceLanguageId}
              referenceColumnLabel={referenceLanguageName}
            />
            <GlossaryPagination
              page={filters.page}
              pageSize={filters.pageSize}
              total={glossary.total}
              onPageChange={filters.setPage}
              onPageSizeChange={filters.handlePageSizeChange}
            />
          </>
        )}
      </div>
    </div>
  )
}
