import React, { useState, useEffect } from 'react'
import { X, Check, Loader2, Plus, Minus, GitCompareArrows, AlertCircle } from 'lucide-react'
import { getAvailableModels, type ProviderModels } from '../../api/settings'
import { compareModels, pickComparisonWinner, type CompareVariant } from '../../api/translate'
import type { Segment } from '../../types'

interface ComparisonModalProps {
  segment: Segment
  languageId: number
  onPick: () => void
  onClose: () => void
  sourceFontClass?: string
}

export default function ComparisonModal({ segment, languageId, onPick, onClose, sourceFontClass = 'font-chinese' }: ComparisonModalProps) {
  const [providers, setProviders] = useState<ProviderModels[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>(['', ''])
  const [variants, setVariants] = useState<CompareVariant[]>([])
  const [comparing, setComparing] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)

  useEffect(() => {
    getAvailableModels()
      .then((p) => {
        setProviders(p)
        // Pre-select first two available models from providers with API keys
        const available = p
          .filter((prov) => prov.api_key_set)
          .flatMap((prov) => prov.models.map((m) => m.id))
        if (available.length >= 2) {
          setSelectedModels([available[0], available[1]])
        } else if (available.length === 1) {
          setSelectedModels([available[0], ''])
        }
      })
      .catch(() => setError('Failed to load available models'))
      .finally(() => setLoadingModels(false))
  }, [])

  const activeProviders = providers.filter((p) => p.api_key_set)

  function updateModel(index: number, value: string) {
    setSelectedModels((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  function addModelSlot() {
    if (selectedModels.length < 4) {
      setSelectedModels((prev) => [...prev, ''])
    }
  }

  function removeModelSlot(index: number) {
    if (selectedModels.length > 2) {
      setSelectedModels((prev) => prev.filter((_, i) => i !== index))
    }
  }

  async function handleCompare() {
    const models = selectedModels.filter(Boolean)
    if (models.length < 2) {
      setError('Select at least 2 models to compare')
      return
    }
    setComparing(true)
    setError(null)
    setVariants([])
    try {
      const result = await compareModels({
        segment_id: segment.id,
        language_id: languageId,
        models,
      })
      setVariants(result.variants)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Comparison failed'
      setError(msg)
    } finally {
      setComparing(false)
    }
  }

  async function handlePick(variant: CompareVariant) {
    setPicking(variant.model)
    setError(null)
    try {
      const losers = variants.filter((v) => v.model !== variant.model && !v.error)
      await pickComparisonWinner({
        segment_id: segment.id,
        language_id: languageId,
        winning_model: variant.model,
        winning_text: variant.translated_text,
        losing_variants: losers,
      })
      onPick()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save pick'
      setError(msg)
    } finally {
      setPicking(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[85vh] bg-parchment-50 dark:bg-ink-900 rounded-xl shadow-2xl border border-parchment-300 dark:border-ink-600/50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-parchment-300 dark:border-ink-600/50">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="w-4 h-4 text-gold" />
            <h2 className="text-sm font-semibold text-ink-850 dark:text-cream font-body">
              A/B Model Comparison
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-parchment-400 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Source text */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-parchment-500 dark:text-cream-muted font-body mb-1">
              Source Text
            </div>
            <p className={`text-sm text-ink-850 dark:text-cream leading-relaxed whitespace-pre-wrap ${sourceFontClass} bg-parchment-100 dark:bg-ink-800 rounded-lg px-3 py-2 border border-parchment-200 dark:border-ink-700/50`}>
              {segment.source_text}
            </p>
          </div>

          {/* Model selectors */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-parchment-500 dark:text-cream-muted font-body">
              Models to Compare
            </div>
            {loadingModels ? (
              <div className="flex items-center gap-2 text-sm text-parchment-400 dark:text-cream-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading models...
              </div>
            ) : (
              <div className="space-y-2">
                {selectedModels.map((model, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={model}
                      onChange={(e) => updateModel(idx, e.target.value)}
                      className="select-field flex-1 py-1.5 text-sm"
                    >
                      <option value="">Select model...</option>
                      {activeProviders.map((prov) => (
                        <optgroup key={prov.provider} label={prov.provider}>
                          {prov.models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {selectedModels.length > 2 && (
                      <button
                        onClick={() => removeModelSlot(idx)}
                        className="p-1.5 text-parchment-400 dark:text-ink-400 hover:text-red-500 dark:hover:text-status-error transition-colors"
                        title="Remove"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {selectedModels.length < 4 && (
                  <button
                    onClick={addModelSlot}
                    className="flex items-center gap-1 text-xs text-parchment-400 dark:text-cream-muted hover:text-gold transition-colors font-body"
                  >
                    <Plus className="w-3 h-3" />
                    Add model
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Compare button */}
          <button
            onClick={handleCompare}
            disabled={comparing || selectedModels.filter(Boolean).length < 2}
            className="flex items-center gap-2 bg-jade text-ink-950 px-4 py-2 rounded-md text-sm font-semibold font-body hover:bg-jade-light disabled:opacity-50 transition-all duration-200"
          >
            {comparing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Comparing...</>
            ) : (
              <><GitCompareArrows className="w-4 h-4" /> Compare</>
            )}
          </button>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-700 dark:text-status-error bg-red-50 dark:bg-status-error-bg px-3 py-2 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Results */}
          {variants.length > 0 && (
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-parchment-500 dark:text-cream-muted font-body">
                Results
              </div>
              <div className={`grid gap-3 ${variants.length <= 2 ? 'grid-cols-2' : variants.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {variants.map((variant) => (
                  <div
                    key={variant.model}
                    className={`rounded-lg border p-3 flex flex-col ${
                      variant.error
                        ? 'border-red-300 dark:border-status-error/30 bg-red-50/50 dark:bg-status-error-bg/50'
                        : 'border-parchment-200 dark:border-ink-700/50 bg-parchment-100 dark:bg-ink-800'
                    }`}
                  >
                    {/* Model name + token count */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-ink-850 dark:text-cream font-body truncate">
                        {variant.model}
                      </span>
                      {!variant.error && (
                        <span className="text-[10px] text-parchment-400 dark:text-cream-muted font-body ml-2 shrink-0">
                          {variant.token_count} tokens
                        </span>
                      )}
                    </div>

                    {/* Translation or error */}
                    {variant.error ? (
                      <p className="text-sm text-red-600 dark:text-status-error italic font-body flex-1">
                        {variant.error}
                      </p>
                    ) : (
                      <p className="text-sm text-ink-700 dark:text-cream-dim leading-relaxed whitespace-pre-wrap font-body flex-1 mb-3">
                        {variant.translated_text}
                      </p>
                    )}

                    {/* Pick button */}
                    {!variant.error && (
                      <button
                        onClick={() => handlePick(variant)}
                        disabled={picking !== null}
                        className="mt-auto flex items-center justify-center gap-1.5 bg-gold/20 hover:bg-gold/40 text-gold-dark dark:text-gold px-3 py-1.5 rounded-md text-xs font-semibold font-body transition-all duration-200 disabled:opacity-50"
                      >
                        {picking === variant.model ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</>
                        ) : (
                          <><Check className="w-3 h-3" /> Pick Winner</>
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
