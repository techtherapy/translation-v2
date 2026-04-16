import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  Upload, X, Loader2, CheckCircle, AlertCircle, Trash2,
  FileText, Archive,
} from 'lucide-react'
import {
  bulkImportPreview, bulkImportConfirm,
  type BulkImportFilePreview, type BulkImportFileItem,
  type BulkImportResult,
} from '../../api/books'

type Step = 'select' | 'preview' | 'results'

interface Props {
  onClose: () => void
  onDone: () => void
  initialFiles?: File[]
}

export default function BulkImportModal({ onClose, onDone, initialFiles }: Props) {
  const [step, setStep] = useState<Step>('select')
  const [files, setFiles] = useState<File[]>(initialFiles || [])
  const [contentType, setContentType] = useState<'book' | 'article'>('book')
  const [granularity, setGranularity] = useState<'sentence' | 'paragraph' | 'chapter'>('sentence')
  const [previews, setPreviews] = useState<BulkImportFilePreview[]>([])
  const [editItems, setEditItems] = useState<BulkImportFileItem[]>([])
  const [results, setResults] = useState<BulkImportResult[]>([])
  const [importStats, setImportStats] = useState({ total: 0, succeeded: 0, failed: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter((f) => {
      const ext = f.name.toLowerCase()
      return ext.endsWith('.txt') || ext.endsWith('.docx') || ext.endsWith('.zip')
    })
    setFiles((prev) => [...prev, ...arr])
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    addFiles(e.dataTransfer.files)
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handlePreview() {
    if (files.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const res = await bulkImportPreview(files)
      setPreviews(res.previews)
      setEditItems(
        res.previews.map((p) => ({
          filename: p.filename,
          book_number: p.book_number,
          title_source: p.title_source,
          title_translated: p.title_translated,
          content_type: contentType,
        })),
      )
      setStep('preview')
    } catch (err) {
      setError('Failed to parse files. Please check file formats.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Auto-preview when opened with initial files
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      handlePreview()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function updateItem(index: number, updates: Partial<BulkImportFileItem>) {
    setEditItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...updates } : item)),
    )
  }

  function removeItem(index: number) {
    setPreviews((prev) => prev.filter((_, i) => i !== index))
    setEditItems((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleConfirm() {
    if (editItems.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const res = await bulkImportConfirm(files, {
        translate_titles: false,
        granularity,
        items: editItems,
      })
      setResults(res.results)
      setImportStats({ total: res.total, succeeded: res.succeeded, failed: res.failed })
      setStep('results')
    } catch (err) {
      setError('Import failed. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    if (step === 'results') onDone()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="surface-glass shadow-surface-lg w-full max-w-4xl max-h-[85vh] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-parchment-200 dark:border-ink-600/50">
          <h2 className="text-lg font-semibold text-ink-850 dark:text-cream font-heading">
            {step === 'select' && 'Bulk Import'}
            {step === 'preview' && 'Review & Edit'}
            {step === 'results' && 'Import Results'}
          </h2>
          <button onClick={handleClose} className="text-parchment-400 dark:text-ink-400 hover:text-ink-850 dark:hover:text-cream">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mt-4 px-4 py-2 bg-red-50 dark:bg-status-error-bg text-red-700 dark:text-status-error text-sm rounded-md flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: File Selection */}
        {step === 'select' && (
          <div className="p-5 space-y-4 overflow-y-auto">
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-gold bg-gold/5 dark:bg-gold-faint/30'
                  : 'border-parchment-300 dark:border-ink-500 hover:border-gold/50'
              }`}
            >
              <Upload className="w-8 h-8 mx-auto text-gold mb-3" />
              <p className="text-sm font-medium text-ink-850 dark:text-cream font-body mb-1">
                Drop files here or click to browse
              </p>
              <p className="text-xs text-parchment-400 dark:text-cream-muted font-body">
                Accepts .txt, .docx, or .zip files
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.docx,.zip"
              className="hidden"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
            />

            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-parchment-500 dark:text-cream-muted font-body mb-2">
                  {files.length} file{files.length !== 1 ? 's' : ''} selected
                </div>
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 bg-parchment-50 dark:bg-ink-800 rounded-md">
                    {f.name.endsWith('.zip')
                      ? <Archive className="w-4 h-4 text-gold shrink-0" />
                      : <FileText className="w-4 h-4 text-parchment-400 dark:text-ink-400 shrink-0" />
                    }
                    <span className="text-sm text-ink-850 dark:text-cream font-body truncate flex-1">{f.name}</span>
                    <span className="text-xs text-parchment-400 dark:text-cream-muted font-body">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    <button onClick={() => removeFile(i)} className="text-parchment-300 dark:text-ink-400 hover:text-status-error">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Options */}
            <div>
              <label className="label">Content Type</label>
              <select
                value={contentType}
                onChange={(e) => setContentType(e.target.value as 'book' | 'article')}
                className="select-field w-48"
              >
                <option value="book">Book</option>
                <option value="article">Article</option>
              </select>
            </div>
          </div>
        )}

        {/* Step 2: Preview & Edit */}
        {step === 'preview' && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="text-xs text-parchment-500 dark:text-cream-muted font-body mb-3">
              {editItems.length} file{editItems.length !== 1 ? 's' : ''} to import. Edit details below before confirming.
            </div>
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="border-b border-parchment-200 dark:border-ink-600/50">
                  <th className="text-left px-2 py-2 text-parchment-500 dark:text-cream-muted font-medium w-16">#</th>
                  <th className="text-left px-2 py-2 text-parchment-500 dark:text-cream-muted font-medium">Source Title</th>
                  <th className="text-left px-2 py-2 text-parchment-500 dark:text-cream-muted font-medium w-32">Status</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {editItems.map((item, i) => {
                  const preview = previews[i]
                  const hasWarnings = preview?.warnings?.length > 0

                  return (
                    <tr
                      key={i}
                      className={`border-b border-parchment-100 dark:border-ink-700/30 ${
                        hasWarnings ? 'bg-amber-50/30 dark:bg-status-warning-bg/10' : ''
                      }`}
                    >
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          value={item.book_number ?? ''}
                          onChange={(e) => updateItem(i, {
                            book_number: e.target.value ? parseInt(e.target.value) : null,
                          })}
                          className="w-16 px-1.5 py-1 text-xs bg-transparent border border-parchment-200 dark:border-ink-600 rounded text-ink-850 dark:text-cream tabular-nums"
                          placeholder="—"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="text"
                          value={item.title_source}
                          onChange={(e) => updateItem(i, { title_source: e.target.value })}
                          className="w-full px-2 py-1 text-sm bg-transparent border border-parchment-200 dark:border-ink-600 rounded text-ink-850 dark:text-cream"
                        />
                      </td>
                      <td className="px-2 py-2">
                        {hasWarnings && (
                          <div className="space-y-0.5">
                            {preview.warnings.map((w, j) => (
                              <div key={j} className="text-[10px] text-amber-600 dark:text-status-warning">
                                {w}
                              </div>
                            ))}
                          </div>
                        )}
                        {!hasWarnings && (
                          <span className="text-xs text-jade">Ready</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => removeItem(i)}
                          className="text-parchment-300 dark:text-ink-400 hover:text-status-error"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Granularity selector */}
            <div className="mt-4 pt-4 border-t border-parchment-200 dark:border-ink-600/50">
              <label className="label mb-2">Segment Granularity</label>
              <div className="flex gap-4">
                {[
                  { value: 'sentence' as const, label: 'Sentence', desc: 'Split on punctuation (finest)' },
                  { value: 'paragraph' as const, label: 'Paragraph', desc: 'One segment per paragraph' },
                  { value: 'chapter' as const, label: contentType === 'article' ? 'Full text' : 'Full chapter', desc: 'Entire content as one segment' },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex-1 cursor-pointer rounded-lg border p-3 transition-colors ${
                      granularity === opt.value
                        ? 'border-gold bg-gold/5 dark:bg-gold-faint/20'
                        : 'border-parchment-200 dark:border-ink-600 hover:border-parchment-300 dark:hover:border-ink-500'
                    }`}
                  >
                    <input
                      type="radio"
                      name="granularity"
                      value={opt.value}
                      checked={granularity === opt.value}
                      onChange={() => setGranularity(opt.value)}
                      className="sr-only"
                    />
                    <div className="text-sm font-medium text-ink-850 dark:text-cream font-body">{opt.label}</div>
                    <div className="text-xs text-parchment-400 dark:text-cream-muted font-body mt-0.5">{opt.desc}</div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Results */}
        {step === 'results' && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex items-center gap-1.5 text-sm font-body">
                <CheckCircle className="w-4 h-4 text-jade" />
                <span className="text-jade font-medium">{importStats.succeeded} succeeded</span>
              </div>
              {importStats.failed > 0 && (
                <div className="flex items-center gap-1.5 text-sm font-body">
                  <AlertCircle className="w-4 h-4 text-status-error" />
                  <span className="text-status-error font-medium">{importStats.failed} failed</span>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 px-4 py-3 rounded-md ${
                    r.status === 'success'
                      ? 'bg-green-50/50 dark:bg-status-success-bg/20'
                      : 'bg-red-50/50 dark:bg-status-error-bg/20'
                  }`}
                >
                  {r.status === 'success'
                    ? <CheckCircle className="w-4 h-4 text-jade shrink-0" />
                    : <AlertCircle className="w-4 h-4 text-status-error shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {r.book_number != null && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-bold font-body bg-gold/10 text-gold-dim dark:bg-gold-faint dark:text-gold-light tabular-nums">
                          #{String(r.book_number).padStart(3, '0')}
                        </span>
                      )}
                      <span className="text-sm font-medium text-ink-850 dark:text-cream truncate">
                        {r.title_source}
                      </span>
                      {r.title_translated && (
                        <span className="text-xs text-parchment-400 dark:text-cream-muted truncate">
                          ({r.title_translated})
                        </span>
                      )}
                    </div>
                    {r.status === 'success' && (
                      <div className="text-xs text-parchment-400 dark:text-cream-muted mt-0.5">
                        {r.chapter_count} chapters, {r.segment_count} segments
                      </div>
                    )}
                    {r.error && (
                      <div className="text-xs text-status-error mt-0.5">{r.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-parchment-200 dark:border-ink-600/50">
          {step === 'select' && (
            <>
              <button onClick={handleClose} className="btn-ghost">Cancel</button>
              <button
                onClick={handlePreview}
                disabled={files.length === 0 || loading}
                className="btn-primary"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Parsing...</>
                ) : (
                  'Preview'
                )}
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button onClick={() => setStep('select')} className="btn-ghost">Back</button>
              <button
                onClick={handleConfirm}
                disabled={editItems.length === 0 || loading}
                className="btn-primary"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</>
                ) : (
                  `Import ${editItems.length} File${editItems.length !== 1 ? 's' : ''}`
                )}
              </button>
            </>
          )}
          {step === 'results' && (
            <button onClick={handleClose} className="btn-primary">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
