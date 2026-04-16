import React, { useState, useEffect } from 'react'
import { History, RotateCcw, X, Loader2, User } from 'lucide-react'
import DiffMatchPatch from 'diff-match-patch'
import { getVersionHistory, restoreVersion, type TranslationVersionInfo } from '../../api/translate'
import { extractCleanTextFromRaw } from '../../utils/translationContent'

interface Props {
  translationId: number
  currentText: string
  onRestore: (text: string, status: string) => void
  onClose: () => void
}

function renderDiff(oldText: string, newText: string): React.ReactNode {
  if (oldText === newText) {
    return <span className="text-parchment-400 dark:text-cream-muted/60 italic">identical to current</span>
  }
  const dmp = new DiffMatchPatch()
  const diffs = dmp.diff_main(oldText, newText)
  dmp.diff_cleanupSemantic(diffs)

  return (
    <span className="text-sm leading-relaxed whitespace-pre-wrap font-body">
      {diffs.map(([op, text], i) => {
        if (op === 0) return <span key={i}>{text}</span>
        if (op === -1) return <span key={i} className="bg-red-100 dark:bg-red-900/30 text-red-700/60 dark:text-red-400/60 line-through decoration-1 decoration-red-500/70 dark:decoration-red-400/70">{text}</span>
        return <span key={i} className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">{text}</span>
      })}
    </span>
  )
}

export default function VersionHistoryPanel({ translationId, currentText, onRestore, onClose }: Props) {
  const [versions, setVersions] = useState<TranslationVersionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<number | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<TranslationVersionInfo | null>(null)

  useEffect(() => {
    loadVersions()
  }, [translationId])

  async function loadVersions() {
    setLoading(true)
    try {
      const data = await getVersionHistory(translationId)
      setVersions(data)
    } catch {
      setVersions([])
    } finally {
      setLoading(false)
    }
  }

  async function handleRestore(version: TranslationVersionInfo) {
    setRestoring(version.id)
    try {
      const result = await restoreVersion(translationId, version.id)
      setConfirmRestore(null)
      onRestore(result.translated_text, result.status)
    } catch {
      // error handled by parent
    } finally {
      setRestoring(null)
    }
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const statusLabels: Record<string, string> = {
    empty: 'Empty',
    machine_translated: 'AI',
    draft: 'Draft',
    under_review: 'Review',
    approved: 'Approved',
    needs_revision: 'Revision',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50">
      <div className="bg-white dark:bg-ink-850 rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-parchment-200 dark:border-ink-600/50">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-parchment-200 dark:border-ink-700/50">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-850 dark:text-cream font-body">
            <History className="w-4 h-4 text-gold" />
            Version History
            <span className="text-xs text-parchment-400 dark:text-cream-muted font-normal">
              ({versions.length} version{versions.length !== 1 ? 's' : ''})
            </span>
          </div>
          <button onClick={onClose} className="text-parchment-400 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-parchment-400 dark:text-cream-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-parchment-400 dark:text-cream-muted/60 font-body">
              No previous versions
            </div>
          ) : (
            <div className="divide-y divide-parchment-200/50 dark:divide-ink-700/30">
              {versions.map((version) => {
                const versionClean = extractCleanTextFromRaw(version.translated_text, version.content_format || 'plain')
                const isCurrent = versionClean === currentText
                return (
                <div
                  key={version.id}
                  className={`px-4 py-3 ${isCurrent ? '' : 'hover:bg-parchment-100/50 dark:hover:bg-ink-800/50 cursor-pointer'} transition-colors ${
                    selectedVersion === version.id ? 'bg-gold/5 dark:bg-gold-faint/20' : ''
                  }`}
                  onClick={() => !isCurrent && setSelectedVersion(selectedVersion === version.id ? null : version.id)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-parchment-500 dark:text-cream-muted font-body">
                        v{version.version_number}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold font-body bg-gold/20 text-gold-dim dark:bg-gold-faint dark:text-gold-light">
                          Current
                        </span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium font-body bg-parchment-200/50 text-parchment-500 dark:bg-ink-700 dark:text-cream-muted">
                        {statusLabels[version.status] || version.status}
                      </span>
                      {version.llm_model_used && (
                        <span className="text-[10px] text-parchment-400 dark:text-cream-muted/60 font-body">
                          {version.llm_model_used.split('/').pop()}
                        </span>
                      )}
                      {version.created_by_username && (
                        <span className="flex items-center gap-0.5 text-[10px] text-parchment-400 dark:text-cream-muted/60 font-body">
                          <User className="w-2.5 h-2.5" />
                          {version.created_by_username}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-parchment-400 dark:text-cream-muted/60 font-body">
                        {formatDate(version.created_at)}
                      </span>
                      {!isCurrent && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmRestore(version)
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 text-xs font-body text-gold hover:text-gold-dark dark:hover:text-gold-light hover:bg-gold/10 rounded transition-colors"
                          title="Preview changes and restore this version"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Preview
                        </button>
                      )}
                    </div>
                  </div>
                  {selectedVersion === version.id && !isCurrent && (
                    <div className="mt-2 p-2 rounded bg-parchment-50 dark:bg-ink-900 text-sm">
                      {renderDiff(currentText, versionClean)}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Confirm restore — compare view */}
        {confirmRestore && (
          <div className="border-t border-parchment-200 dark:border-ink-700/50">
            <div className="px-4 py-3">
              <div className="text-xs font-semibold text-ink-850 dark:text-cream font-body mb-2">
                Restore v{confirmRestore.version_number}? Changes:
              </div>
              <div className="p-3 rounded bg-parchment-50 dark:bg-ink-900 max-h-48 overflow-y-auto">
                {renderDiff(currentText, extractCleanTextFromRaw(confirmRestore.translated_text, confirmRestore.content_format || 'plain'))}
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <button
                  onClick={() => setConfirmRestore(null)}
                  className="btn-ghost text-xs"
                  disabled={restoring === confirmRestore.id}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRestore(confirmRestore)}
                  disabled={restoring === confirmRestore.id}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-body font-medium rounded-md bg-gold text-ink-950 hover:bg-gold-light transition-colors disabled:opacity-50"
                >
                  {restoring === confirmRestore.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3 h-3" />
                  )}
                  Confirm Restore
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
