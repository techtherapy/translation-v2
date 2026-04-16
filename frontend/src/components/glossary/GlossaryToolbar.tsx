import React, { useRef } from 'react'
import { Plus, Upload, Sparkles, Loader2 } from 'lucide-react'
import { useAuth } from '../../stores/AuthContext'

interface GlossaryToolbarProps {
  total: number
  onAddTerm: () => void
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void
  importResult: string | null
  importLoading: boolean
  onBatchAiComplete: () => void
  batchAiLoading: boolean
  batchAiResult: string | null
}

export default function GlossaryToolbar({
  total,
  onAddTerm,
  onImport,
  importResult,
  importLoading,
  onBatchAiComplete,
  batchAiLoading,
  batchAiResult,
}: GlossaryToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { hasPermission } = useAuth()

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-heading font-heading">Glossary</h1>
          <p className="page-subheading">{total} terms</p>
        </div>
        <div className="flex items-center gap-3">
          {hasPermission('glossary.ai') && (
            <button
              onClick={onBatchAiComplete}
              disabled={batchAiLoading}
              className="flex items-center gap-2 border border-jade/40 px-4 py-2 rounded-md text-sm font-medium font-body text-jade hover:bg-jade-faint dark:border-jade/40 dark:text-jade dark:hover:bg-jade-faint disabled:opacity-50 disabled:cursor-not-allowed"
              title="AI-complete all terms with missing translations"
            >
              {batchAiLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              AI Batch
            </button>
          )}
          {hasPermission('glossary.import') && (
            <>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={onImport} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importLoading}
                className="flex items-center gap-2 border border-parchment-300 px-4 py-2 rounded-md text-sm font-medium font-body text-ink-700 hover:bg-parchment-50 dark:border-ink-600 dark:text-cream-dim dark:hover:bg-ink-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {importLoading ? 'Importing...' : 'Import CSV'}
              </button>
            </>
          )}
          {hasPermission('glossary.create') && (
            <button
              onClick={onAddTerm}
              className="btn-primary flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium font-body"
            >
              <Plus className="w-4 h-4" />
              Add Term
            </button>
          )}
        </div>
      </div>

      {importResult && (
        <div className={`mb-4 px-4 py-2 text-sm rounded-md ${
          importResult.startsWith('Error:')
            ? 'bg-red-50 text-red-600 dark:bg-status-error-bg dark:text-status-error'
            : importResult.includes('Warnings:')
              ? 'bg-amber-50 text-amber-700 dark:bg-status-warning-bg dark:text-status-warning'
              : 'bg-green-50 text-green-700 dark:bg-status-success-bg dark:text-status-success'
        }`}>
          {importResult}
        </div>
      )}

      {batchAiResult && (
        <div className="mb-4 px-4 py-2 bg-jade-faint text-jade-dim dark:bg-jade-faint dark:text-jade text-sm rounded-md flex items-center gap-2">
          <Sparkles className="w-4 h-4 flex-shrink-0" />
          {batchAiResult}
        </div>
      )}
    </>
  )
}
