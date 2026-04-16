import { useState, useCallback } from 'react'
import { aiBatchComplete } from '../api/glossary'
import { extractErrorMessage } from '../utils/extractErrorMessage'
import type { GlossaryTerm } from '../types'

type ConfirmFn = (opts: { title?: string; message: string; confirmLabel?: string; variant?: 'danger' | 'warning' | 'default' }) => Promise<boolean>

export default function useBatchAI(terms: GlossaryTerm[], onSuccess: () => void, confirm: ConfirmFn) {
  const [batchAiLoading, setBatchAiLoading] = useState(false)
  const [batchAiResult, setBatchAiResult] = useState<string | null>(null)

  const handleBatchAiComplete = useCallback(async () => {
    const missingTermIds = terms
      .filter((t) => {
        const enTrans = t.translations.find((tr) => tr.is_preferred) || t.translations[0]
        return !enTrans || !enTrans.translated_term.trim()
      })
      .map((t) => t.id)

    if (missingTermIds.length === 0) {
      setBatchAiResult('All visible terms already have translations')
      setTimeout(() => setBatchAiResult(null), 3000)
      return
    }

    if (!await confirm({ title: 'AI complete', message: `AI-complete ${missingTermIds.length} terms with missing translations?`, confirmLabel: 'AI Complete', variant: 'default' })) return

    setBatchAiLoading(true)
    setBatchAiResult(null)

    try {
      const result = await aiBatchComplete(missingTermIds)
      setBatchAiResult(
        `AI completed ${result.results.length} of ${missingTermIds.length} terms` +
          (result.model ? ` using ${result.model}` : ''),
      )
      onSuccess()
      setTimeout(() => setBatchAiResult(null), 8000)
    } catch (err: unknown) {
      setBatchAiResult(`Error: ${extractErrorMessage(err, 'Batch AI completion failed')}`)
      setTimeout(() => setBatchAiResult(null), 5000)
    } finally {
      setBatchAiLoading(false)
    }
  }, [terms, onSuccess])

  return { batchAiLoading, batchAiResult, handleBatchAiComplete }
}
