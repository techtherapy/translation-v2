import React, { useState, useMemo } from 'react'
import { Check, X, CheckCheck, XCircle } from 'lucide-react'
import { DiffHunk, computeHunks, buildResolvedText } from './diffUtils'

interface Props {
  oldText: string
  newText: string
  reviewerName: string
  onResolve: (resolvedText: string) => void
  onCancel: () => void
}

export default function DiffReviewView({ oldText, newText, reviewerName, onResolve, onCancel }: Props) {
  const initialHunks = useMemo(() => computeHunks(oldText, newText), [oldText, newText])
  const [hunks, setHunks] = useState<DiffHunk[]>(initialHunks)

  const pendingCount = hunks.filter(h => h.type !== 'equal' && h.status === 'pending').length
  const totalChanges = hunks.filter(h => h.type !== 'equal').length

  function updateHunk(index: number, status: 'accepted' | 'rejected' | 'pending') {
    setHunks(prev => {
      const next = [...prev]
      const hunk = next[index]
      next[index] = { ...hunk, status }
      // If this hunk is part of a replacement group, update the paired hunk
      if (hunk.groupId !== undefined) {
        const pairedStatus = hunk.type === 'delete'
          ? (status === 'accepted' ? 'rejected' : 'accepted') // accept delete = reject insert
          : (status === 'accepted' ? 'rejected' : 'accepted') // accept insert = reject delete
        // Actually: accept change = accept insert + reject delete; reject change = reject insert + accept delete
        const acceptChange = (hunk.type === 'insert' && status === 'accepted') || (hunk.type === 'delete' && status === 'rejected')
        for (let i = 0; i < next.length; i++) {
          if (i !== index && next[i].groupId === hunk.groupId) {
            if (next[i].type === 'delete') {
              next[i] = { ...next[i], status: acceptChange ? 'rejected' : 'accepted' }
            } else {
              next[i] = { ...next[i], status: acceptChange ? 'accepted' : 'rejected' }
            }
          }
        }
      }
      return next
    })
  }

  function acceptChange(index: number) {
    const hunk = hunks[index]
    if (hunk.type === 'insert') updateHunk(index, 'accepted')
    else if (hunk.type === 'delete') updateHunk(index, 'rejected') // accepting the change means removing old text
  }

  function rejectChange(index: number) {
    const hunk = hunks[index]
    if (hunk.type === 'insert') updateHunk(index, 'rejected')
    else if (hunk.type === 'delete') updateHunk(index, 'accepted') // rejecting the change means keeping old text
  }

  function acceptAll() {
    setHunks(prev => prev.map(h => {
      if (h.type === 'equal') return h
      if (h.type === 'insert') return { ...h, status: 'accepted' as const }
      return { ...h, status: 'rejected' as const } // delete → rejected means old text removed
    }))
  }

  function rejectAll() {
    setHunks(prev => prev.map(h => {
      if (h.type === 'equal') return h
      if (h.type === 'delete') return { ...h, status: 'accepted' as const } // keep old text
      return { ...h, status: 'rejected' as const } // discard insertions
    }))
  }

  function handleResolve() {
    onResolve(buildResolvedText(hunks))
  }

  // Render: skip delete hunks that are paired (show them inline with the insert)
  const renderedHunks: { hunk: DiffHunk; index: number; paired?: DiffHunk }[] = []
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i]
    if (h.type === 'delete' && h.groupId !== undefined) {
      // Find paired insert
      const pairedIdx = hunks.findIndex((ph, pi) => pi > i && ph.groupId === h.groupId && ph.type === 'insert')
      if (pairedIdx >= 0) {
        renderedHunks.push({ hunk: h, index: i, paired: hunks[pairedIdx] })
        continue
      }
    }
    // Skip insert if it's part of a group (already rendered with its delete)
    if (h.type === 'insert' && h.groupId !== undefined) continue
    renderedHunks.push({ hunk: h, index: i })
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs text-parchment-500 dark:text-cream-muted font-body">
          Edited by <span className="font-medium text-ink-850 dark:text-cream">{reviewerName}</span>
          {' · '}
          {pendingCount > 0
            ? <span>{pendingCount} of {totalChanges} changes pending</span>
            : <span className="text-jade dark:text-jade-light">All changes resolved</span>
          }
        </span>
        <div className="flex items-center gap-1">
          <button onClick={acceptAll} className="flex items-center gap-1 px-2 py-1 text-[10px] font-body rounded bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors" title="Accept all changes">
            <CheckCheck className="w-3 h-3" /> Accept All
          </button>
          <button onClick={rejectAll} className="flex items-center gap-1 px-2 py-1 text-[10px] font-body rounded bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors" title="Reject all changes">
            <XCircle className="w-3 h-3" /> Reject All
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div className="text-sm leading-relaxed whitespace-pre-wrap font-body">
        {renderedHunks.map(({ hunk, index, paired }) => {
          if (hunk.type === 'equal') {
            return <span key={index}>{hunk.text}</span>
          }

          // Replacement pair (delete + insert)
          if (paired) {
            const isResolved = hunk.status !== 'pending'
            // If resolved: show only the accepted text
            if (isResolved) {
              const showOld = hunk.status === 'accepted' // delete accepted = keep old
              const showNew = paired.status === 'accepted' // insert accepted = show new
              return (
                <span key={index} className="relative group">
                  {showOld && <span className="text-ink-850 dark:text-cream">{hunk.text}</span>}
                  {showNew && <span className="text-ink-850 dark:text-cream">{paired.text}</span>}
                  <button
                    onClick={() => { updateHunk(index, 'pending'); }}
                    className="invisible group-hover:visible ml-0.5 text-[9px] text-parchment-400 hover:text-gold"
                    title="Undo"
                  >↺</button>
                </span>
              )
            }
            // Pending: show both with buttons
            return (
              <span key={index} className="inline relative">
                <span className="bg-red-100 dark:bg-red-900/30 text-red-700/60 dark:text-red-400/60 line-through decoration-1 decoration-red-500/70 dark:decoration-red-400/70">{hunk.text}</span>
                <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">{paired.text}</span>
                <span className="inline-flex gap-0 ml-0.5 align-middle">
                  <button onClick={() => acceptChange(index)} className="p-0.5 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 rounded" title="Accept change">
                    <Check className="w-3 h-3" />
                  </button>
                  <button onClick={() => rejectChange(index)} className="p-0.5 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded" title="Reject change">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </span>
            )
          }

          // Standalone insert or delete
          const isInsert = hunk.type === 'insert'
          if (hunk.status !== 'pending') {
            const show = (isInsert && hunk.status === 'accepted') || (!isInsert && hunk.status === 'accepted')
            if (!show) return null
            return <span key={index} className="relative group">
              <span className="text-ink-850 dark:text-cream">{hunk.text}</span>
              <button
                onClick={() => updateHunk(index, 'pending')}
                className="invisible group-hover:visible ml-0.5 text-[9px] text-parchment-400 hover:text-gold"
                title="Undo"
              >↺</button>
            </span>
          }

          return (
            <span key={index} className="inline relative">
              <span className={isInsert
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : 'bg-red-100 dark:bg-red-900/30 text-red-700/60 dark:text-red-400/60 line-through decoration-1 decoration-red-500/70 dark:decoration-red-400/70'
              }>{hunk.text}</span>
              <span className="inline-flex gap-0 ml-0.5 align-middle">
                <button onClick={() => acceptChange(index)} className="p-0.5 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 rounded" title={isInsert ? "Accept addition" : "Accept deletion"}>
                  <Check className="w-3 h-3" />
                </button>
                <button onClick={() => rejectChange(index)} className="p-0.5 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded" title={isInsert ? "Reject addition" : "Reject deletion"}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            </span>
          )
        })}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-parchment-200 dark:border-ink-600/30">
        <button onClick={onCancel} className="btn-ghost text-xs">Cancel</button>
        <button
          onClick={handleResolve}
          disabled={pendingCount > 0}
          className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pendingCount > 0 ? `${pendingCount} changes remaining` : 'Save Resolved Text'}
        </button>
      </div>
    </div>
  )
}
