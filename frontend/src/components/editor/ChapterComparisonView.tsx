import React, { useState, useEffect } from 'react'
import {
  X, Loader2, Plus, Minus, GitCompareArrows, AlertCircle, Check, Save,
} from 'lucide-react'
import { getAvailableModels, type ProviderModels } from '../../api/settings'
import {
  batchCompare, batchPickWinners,
  type BatchCompareSegmentResult, type CompareVariant,
} from '../../api/translate'

interface ChapterComparisonViewProps {
  bookId: number
  chapterId: number
  languageId: number
  onDone: () => void
  sourceFontClass?: string
}

interface SegmentPick {
  winning_model: string
  winning_text: string
}

export default function ChapterComparisonView({
  bookId,
  chapterId,
  languageId,
  onDone,
  sourceFontClass = 'font-chinese',
}: ChapterComparisonViewProps) {
  const [providers, setProviders] = useState<ProviderModels[]>([])
  const [selectedModels, setSelectedModels] = useState<string[]>(['', ''])
  const [segments, setSegments] = useState<BatchCompareSegmentResult[]>([])
  const [picks, setPicks] = useState<Record<number, SegmentPick>>({})
  const [phase, setPhase] = useState<'setup' | 'running' | 'review' | 'saving'>('setup')
  const [error, setError] = useState<string | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [saveResult, setSaveResult] = useState<{ saved: number; errors: number } | null>(null)
  const [progress, setProgress] = useState<{ completed: number; total: number }>({ completed: 0, total: 0 })

  useEffect(() => {
    getAvailableModels()
      .then((p) => {
        setProviders(p)
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

  // All distinct model names that appear in results
  const modelNames = segments.length > 0
    ? [...new Set(segments.flatMap((s) => s.variants.filter((v) => !v.error).map((v) => v.model)))]
    : []

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

  async function handleRunComparison() {
    const models = selectedModels.filter(Boolean)
    if (models.length < 2) {
      setError('Select at least 2 models')
      return
    }
    setPhase('running')
    setError(null)
    setSegments([])
    setPicks({})
    setProgress({ completed: 0, total: 0 })
    try {
      const result = await batchCompare(
        { chapter_id: chapterId, language_id: languageId, models },
        (completed, total, segment) => {
          setProgress({ completed, total })
          if (segment) {
            setSegments((prev) => [...prev, segment])
          }
        },
      )
      setSegments(result.segments)
      setPhase('review')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Batch comparison failed'
      setError(msg)
      setPhase('setup')
    }
  }

  function pickSegment(segmentId: number, variant: CompareVariant) {
    setPicks((prev) => ({
      ...prev,
      [segmentId]: { winning_model: variant.model, winning_text: variant.translated_text },
    }))
  }

  function pickAllForModel(model: string) {
    const newPicks: Record<number, SegmentPick> = {}
    for (const seg of segments) {
      const variant = seg.variants.find((v) => v.model === model && !v.error)
      if (variant) {
        newPicks[seg.segment_id] = {
          winning_model: variant.model,
          winning_text: variant.translated_text,
        }
      }
    }
    setPicks((prev) => ({ ...prev, ...newPicks }))
  }

  async function handleSavePicks() {
    const pickEntries = Object.entries(picks)
    if (pickEntries.length === 0) {
      setError('No picks selected')
      return
    }
    setPhase('saving')
    setError(null)
    try {
      const picksList = pickEntries.map(([segIdStr, pick]) => {
        const segId = parseInt(segIdStr)
        const seg = segments.find((s) => s.segment_id === segId)
        const losingVariants = seg
          ? seg.variants.filter((v) => v.model !== pick.winning_model && !v.error)
          : []
        return {
          segment_id: segId,
          winning_model: pick.winning_model,
          winning_text: pick.winning_text,
          losing_variants: losingVariants,
        }
      })
      const result = await batchPickWinners({
        chapter_id: chapterId,
        language_id: languageId,
        picks: picksList,
      })
      setSaveResult({ saved: result.saved, errors: result.errors })
      // Auto-return after short delay
      setTimeout(() => onDone(), 1500)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save picks'
      setError(msg)
      setPhase('review')
    }
  }

  const pickedCount = Object.keys(picks).length
  const totalSegments = segments.length

  return (
    <div className="h-full flex flex-col bg-parchment-50 dark:bg-ink-900">
      {/* Header */}
      <div className="border-b border-parchment-300 dark:border-ink-600/50 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="w-4 h-4 text-gold" />
          <h2 className="text-sm font-semibold text-ink-850 dark:text-cream font-body">
            Chapter A/B Comparison
          </h2>
          {phase === 'review' && (
            <span className="text-xs text-parchment-400 dark:text-cream-muted font-body ml-2">
              {pickedCount}/{totalSegments} picked
            </span>
          )}
        </div>
        <button
          onClick={onDone}
          className="flex items-center gap-1.5 text-sm text-parchment-400 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream transition-colors font-body"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 flex items-center gap-2 text-sm text-red-700 dark:text-status-error bg-red-50 dark:bg-status-error-bg px-3 py-2 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Setup phase */}
      {phase === 'setup' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-lg space-y-4 px-5">
            <div className="text-[10px] uppercase tracking-wider text-parchment-500 dark:text-cream-muted font-body">
              Select Models to Compare
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

            <button
              onClick={handleRunComparison}
              disabled={selectedModels.filter(Boolean).length < 2}
              className="flex items-center gap-2 bg-jade text-ink-950 px-4 py-2 rounded-md text-sm font-semibold font-body hover:bg-jade-light disabled:opacity-50 transition-all duration-200"
            >
              <GitCompareArrows className="w-4 h-4" />
              Run Comparison
            </button>
          </div>
        </div>
      )}

      {/* Running phase */}
      {phase === 'running' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 w-full max-w-sm px-5">
            <Loader2 className="w-8 h-8 animate-spin text-gold mx-auto" />
            <p className="text-sm text-ink-850 dark:text-cream font-body">
              Comparing models across segments...
            </p>
            {progress.total > 0 && (
              <>
                <div className="w-full bg-parchment-200 dark:bg-ink-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gold h-2 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-parchment-400 dark:text-cream-muted font-body tabular-nums">
                  {progress.completed} / {progress.total} segments
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Review phase */}
      {phase === 'review' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Bulk pick buttons */}
          <div className="px-5 py-3 border-b border-parchment-200 dark:border-ink-700/50 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-parchment-500 dark:text-cream-muted font-body mr-1">
              Pick all:
            </span>
            {modelNames.map((model) => (
              <button
                key={model}
                onClick={() => pickAllForModel(model)}
                className="text-xs px-2.5 py-1 rounded-md bg-parchment-100 dark:bg-ink-800 text-ink-850 dark:text-cream hover:bg-gold/20 dark:hover:bg-gold-faint/30 border border-parchment-200 dark:border-ink-700/50 font-body transition-colors"
              >
                {model}
              </button>
            ))}
          </div>

          {/* Segment list */}
          <div className="flex-1 overflow-y-auto">
            {segments.map((seg) => {
              const pick = picks[seg.segment_id]
              return (
                <div
                  key={seg.segment_id}
                  className="border-b border-parchment-200 dark:border-ink-700/50 px-5 py-4 space-y-2"
                >
                  {/* Source */}
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-parchment-300 dark:text-cream-muted/40 text-segment-num shrink-0 mt-0.5">
                      {seg.order}
                    </span>
                    <p className={`text-sm text-ink-850 dark:text-cream leading-relaxed whitespace-pre-wrap ${sourceFontClass}`}>
                      {seg.source_text}
                    </p>
                  </div>

                  {/* Variants */}
                  <div className={`grid gap-2 ${seg.variants.length <= 2 ? 'grid-cols-2' : seg.variants.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    {seg.variants.map((variant) => {
                      const isPicked = pick?.winning_model === variant.model
                      return (
                        <button
                          key={variant.model}
                          onClick={() => !variant.error && pickSegment(seg.segment_id, variant)}
                          disabled={!!variant.error}
                          className={`text-left rounded-lg border p-3 transition-all duration-200 ${
                            variant.error
                              ? 'border-red-300 dark:border-status-error/30 bg-red-50/50 dark:bg-status-error-bg/50 cursor-not-allowed'
                              : isPicked
                                ? 'border-gold bg-gold/10 dark:bg-gold-faint/40 ring-1 ring-gold'
                                : 'border-parchment-200 dark:border-ink-700/50 bg-parchment-100 dark:bg-ink-800 hover:border-gold/50'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold text-ink-850 dark:text-cream font-body truncate">
                              {variant.model}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              {!variant.error && (
                                <span className="text-[10px] text-parchment-400 dark:text-cream-muted font-body">
                                  {variant.token_count}t
                                </span>
                              )}
                              {isPicked && (
                                <Check className="w-3.5 h-3.5 text-gold" />
                              )}
                            </div>
                          </div>
                          {variant.error ? (
                            <p className="text-xs text-red-600 dark:text-status-error italic font-body">
                              {variant.error}
                            </p>
                          ) : (
                            <p className="text-sm text-ink-700 dark:text-cream-dim leading-relaxed whitespace-pre-wrap font-body">
                              {variant.translated_text}
                            </p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Save bar */}
          <div className="border-t border-parchment-300 dark:border-ink-600/50 px-5 py-3 flex items-center justify-between bg-parchment-50 dark:bg-ink-900">
            <span className="text-xs text-parchment-400 dark:text-cream-muted font-body">
              {pickedCount} of {totalSegments} segments picked
            </span>
            <button
              onClick={handleSavePicks}
              disabled={pickedCount === 0}
              className="flex items-center gap-2 bg-jade text-ink-950 px-4 py-2 rounded-md text-sm font-semibold font-body hover:bg-jade-light disabled:opacity-50 transition-all duration-200"
            >
              <Save className="w-4 h-4" />
              Save Picks ({pickedCount})
            </button>
          </div>
        </div>
      )}

      {/* Saving phase */}
      {phase === 'saving' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            {saveResult ? (
              <>
                <Check className="w-8 h-8 text-jade mx-auto" />
                <p className="text-sm text-ink-850 dark:text-cream font-body">
                  Saved {saveResult.saved} translations
                  {saveResult.errors > 0 && (
                    <span className="text-red-600 dark:text-status-error"> ({saveResult.errors} errors)</span>
                  )}
                </p>
                <p className="text-xs text-parchment-400 dark:text-cream-muted font-body">
                  Returning to editor...
                </p>
              </>
            ) : (
              <>
                <Loader2 className="w-8 h-8 animate-spin text-gold mx-auto" />
                <p className="text-sm text-ink-850 dark:text-cream font-body">
                  Saving picks...
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
