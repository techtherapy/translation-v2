import React, { useState, useCallback } from 'react'
import { importCSV } from '../api/glossary'
import { extractErrorMessage } from '../utils/extractErrorMessage'

export default function useGlossaryImport(onSuccess: () => void) {
  const [importResult, setImportResult] = useState<string | null>(null)
  const [importLoading, setImportLoading] = useState(false)

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setImportLoading(true)
      setImportResult(null)

      try {
        const result = await importCSV(file, 'en')
        let message = `Imported ${result.imported} terms, skipped ${result.skipped}`
        const extras: string[] = []
        if (result.categories_created) extras.push(`${result.categories_created} categories`)
        if (result.projects_created) extras.push(`${result.projects_created} projects`)
        if (extras.length) message += ` (created ${extras.join(', ')})`
        if (result.errors?.length) {
          message += `. Warnings: ${result.errors.join('; ')}`
        }
        setImportResult(message)
        onSuccess()
        setTimeout(() => setImportResult(null), 8000)
      } catch (err: unknown) {
        console.error('Import failed:', err)
        setImportResult(`Error: ${extractErrorMessage(err, 'Import failed')}`)
        setTimeout(() => setImportResult(null), 8000)
      } finally {
        setImportLoading(false)
      }
      // Reset file input
      e.target.value = ''
    },
    [onSuccess],
  )

  return { importResult, importLoading, handleImport }
}
