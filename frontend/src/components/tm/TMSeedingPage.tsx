import React, { useState, useEffect } from 'react'
import { Upload, Check, X, Database, Loader2 } from 'lucide-react'
import { seedAlign, seedCommit, listTMEntries } from '../../api/tm'
import { listBooks } from '../../api/books'
import { listLanguages } from '../../api/languages'
import { useAuth } from '../../stores/AuthContext'
import type { AlignmentPair, Book, Language, TMEntry } from '../../types'

export default function TMSeedingPage() {
  const { hasPermission } = useAuth()
  const canSeed = hasPermission('tm.seed')
  const [books, setBooks] = useState<Book[]>([])
  const [languages, setLanguages] = useState<Language[]>([])
  const [tmEntries, setTMEntries] = useState<TMEntry[]>([])
  const [selectedBookId, setSelectedBookId] = useState<number>(0)
  const [selectedLanguageId, setSelectedLanguageId] = useState<number>(0)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [translationFile, setTranslationFile] = useState<File | null>(null)
  const [pairs, setPairs] = useState<AlignmentPair[]>([])
  const [aligning, setAligning] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [tab, setTab] = useState<'seed' | 'browse'>(canSeed ? 'seed' : 'browse')

  useEffect(() => {
    Promise.all([
      listBooks({ limit: 200 }),
      listLanguages(),
      listTMEntries({ limit: 50 }),
    ]).then(([booksData, langs, entries]) => {
      setBooks(booksData.books)
      setLanguages(langs)
      setTMEntries(entries)
      const en = langs.find((l) => l.code === 'en')
      if (en) setSelectedLanguageId(en.id)
    }).catch(console.error)
  }, [])

  async function handleAlign() {
    if (!sourceFile || !translationFile) return
    setAligning(true)
    setResult(null)
    try {
      const aligned = await seedAlign(sourceFile, translationFile)
      setPairs(aligned.map((p) => ({ ...p, approved: p.confidence >= 0.5 })))
    } catch (err) {
      console.error('Alignment failed:', err)
      setResult('Alignment failed. Check file formats.')
    } finally {
      setAligning(false)
    }
  }

  async function handleCommit() {
    if (!selectedBookId || !selectedLanguageId) {
      setResult('Select a book and language first.')
      return
    }
    setCommitting(true)
    try {
      const res = await seedCommit({
        book_id: selectedBookId,
        language_id: selectedLanguageId,
        pairs: pairs.map((p) => ({
          source_text: p.source_text,
          translated_text: p.translated_text,
          approved: p.approved ?? true,
          confidence: p.confidence,
        })),
      })
      setResult(`Committed ${res.committed} entries to Translation Memory.`)
      setPairs([])
      setSourceFile(null)
      setTranslationFile(null)
      // Refresh TM entries
      const entries = await listTMEntries({ limit: 50 })
      setTMEntries(entries)
    } catch (err) {
      console.error('Commit failed:', err)
      setResult('Failed to commit to TM.')
    } finally {
      setCommitting(false)
    }
  }

  function togglePair(index: number) {
    setPairs((prev) =>
      prev.map((p, i) => (i === index ? { ...p, approved: !p.approved } : p)),
    )
  }

  function approveAll() {
    setPairs((prev) => prev.map((p) => ({ ...p, approved: true })))
  }

  function rejectAll() {
    setPairs((prev) => prev.map((p) => ({ ...p, approved: false })))
  }

  const approvedCount = pairs.filter((p) => p.approved).length

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-heading">Translation Memory</h1>
          <p className="page-subheading">{tmEntries.length} entries</p>
        </div>
        {canSeed && (
          <div className="flex items-center gap-1 bg-parchment-200 dark:bg-ink-800 border border-parchment-300 dark:border-ink-600 rounded-md p-0.5">
            <button
              onClick={() => setTab('seed')}
              className={`px-3 py-1.5 rounded text-sm font-medium font-body ${tab === 'seed' ? 'bg-white dark:bg-ink-700 text-ink-850 dark:text-gold-light shadow-sm' : 'text-parchment-500 dark:text-cream-muted'}`}
            >
              Seed TM
            </button>
            <button
              onClick={() => setTab('browse')}
              className={`px-3 py-1.5 rounded text-sm font-medium font-body ${tab === 'browse' ? 'bg-white dark:bg-ink-700 text-ink-850 dark:text-gold-light shadow-sm' : 'text-parchment-500 dark:text-cream-muted'}`}
            >
              Browse
            </button>
          </div>
        )}
      </div>

      {result && (
        <div className="mb-4 px-4 py-2 bg-gold/10 dark:bg-gold-faint text-gold-dim dark:text-gold-light text-sm font-body rounded-md">{result}</div>
      )}

      {tab === 'seed' ? (
        <div className="stagger-children">
          {/* Upload section */}
          <div className="surface p-6 mb-6">
            <h2 className="text-lg font-semibold font-heading text-ink-850 dark:text-cream mb-4">Upload File Pair</h2>
            <p className="text-sm text-parchment-500 dark:text-cream-muted font-body mb-4">
              Upload a Chinese source file and its corresponding translation to align and seed into Translation Memory.
            </p>

            <div className="grid grid-cols-2 gap-6 mb-4">
              <div>
                <label className="label mb-2">Chinese Source File</label>
                <label className="flex items-center justify-center gap-2 border-2 border-dashed border-parchment-300 dark:border-ink-500 rounded-lg p-6 cursor-pointer hover:border-gold/50 dark:hover:border-gold/50 transition-colors">
                  <Upload className="w-5 h-5 text-gold" />
                  <span className="text-sm text-parchment-500 dark:text-cream-muted font-body">
                    {sourceFile ? sourceFile.name : 'Choose .txt file'}
                  </span>
                  <input
                    type="file"
                    accept=".txt"
                    className="hidden"
                    onChange={(e) => setSourceFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
              <div>
                <label className="label mb-2">Translation File</label>
                <label className="flex items-center justify-center gap-2 border-2 border-dashed border-parchment-300 dark:border-ink-500 rounded-lg p-6 cursor-pointer hover:border-gold/50 dark:hover:border-gold/50 transition-colors">
                  <Upload className="w-5 h-5 text-gold" />
                  <span className="text-sm text-parchment-500 dark:text-cream-muted font-body">
                    {translationFile ? translationFile.name : 'Choose .txt file'}
                  </span>
                  <input
                    type="file"
                    accept=".txt"
                    className="hidden"
                    onChange={(e) => setTranslationFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-4">
              <div>
                <label className="label">Source Book</label>
                <select
                  value={selectedBookId}
                  onChange={(e) => setSelectedBookId(parseInt(e.target.value))}
                  className="select-field"
                >
                  <option value={0}>Select a book...</option>
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title_source} {b.title_translated ? `(${b.title_translated})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Target Language</label>
                <select
                  value={selectedLanguageId}
                  onChange={(e) => setSelectedLanguageId(parseInt(e.target.value))}
                  className="select-field"
                >
                  {languages.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleAlign}
              disabled={!sourceFile || !translationFile || aligning}
              className="btn-primary"
            >
              {aligning ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Aligning...</>
              ) : (
                <><Database className="w-4 h-4" /> Align Paragraphs</>
              )}
            </button>
          </div>

          {/* Alignment review */}
          {pairs.length > 0 && (
            <div className="surface overflow-hidden">
              <div className="px-4 py-3 bg-parchment-50 dark:bg-ink-900 border-b border-parchment-300 dark:border-ink-600 flex items-center justify-between">
                <div className="text-sm font-medium font-body text-ink-700 dark:text-cream-dim">
                  {pairs.length} pairs — {approvedCount} approved
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={approveAll} className="text-xs text-status-success dark:text-status-success hover:underline font-body">Approve All</button>
                  <button onClick={rejectAll} className="text-xs text-status-error dark:text-status-error hover:underline font-body">Reject All</button>
                  <button
                    onClick={handleCommit}
                    disabled={committing || approvedCount === 0}
                    className="flex items-center gap-2 bg-jade text-ink-950 px-3 py-1.5 rounded-md text-xs font-semibold font-body hover:bg-jade-light disabled:opacity-50"
                  >
                    {committing ? 'Committing...' : `Commit ${approvedCount} to TM`}
                  </button>
                </div>
              </div>

              <div className="divide-y divide-parchment-300 dark:divide-ink-600 max-h-[600px] overflow-y-auto">
                {pairs.map((pair, i) => (
                  <div
                    key={i}
                    className={`grid grid-cols-[auto,1fr,1fr] gap-4 px-4 py-3 ${
                      pair.approved ? 'bg-green-50/30 dark:bg-status-success-bg/30' : 'bg-red-50/30 dark:bg-status-error-bg/30'
                    }`}
                  >
                    <button
                      onClick={() => togglePair(i)}
                      className={`self-start mt-1 ${pair.approved ? 'text-status-success dark:text-status-success' : 'text-status-error dark:text-status-error'}`}
                    >
                      {pair.approved ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                    </button>
                    <div>
                      <p className="text-sm text-ink-850 dark:text-cream font-body whitespace-pre-wrap">{pair.source_text}</p>
                    </div>
                    <div>
                      <p className="text-sm text-ink-700 dark:text-cream-dim font-body whitespace-pre-wrap">{pair.translated_text}</p>
                      <span className="text-[10px] text-parchment-400 dark:text-ink-400 mt-1 inline-block font-body">
                        Confidence: {(pair.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Browse TM entries */
        <div className="surface overflow-hidden">
          {tmEntries.length === 0 ? (
            <div className="text-center py-12 text-parchment-500 dark:text-cream-muted font-body">
              No TM entries yet. Seed from existing translations or approve segments.
            </div>
          ) : (
            <table className="w-full text-sm font-body">
              <thead className="bg-parchment-50 dark:bg-ink-900 border-b border-parchment-300 dark:border-ink-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Translation</th>
                  <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted w-24">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-parchment-300 dark:divide-ink-600">
                {tmEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-parchment-50 dark:hover:bg-ink-700/50">
                    <td className="px-4 py-3 text-ink-850 dark:text-cream max-w-xs truncate">{entry.source_text}</td>
                    <td className="px-4 py-3 text-ink-700 dark:text-cream-dim max-w-xs truncate">{entry.translated_text}</td>
                    <td className="px-4 py-3 text-parchment-400 dark:text-ink-400">{(entry.alignment_confidence * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
