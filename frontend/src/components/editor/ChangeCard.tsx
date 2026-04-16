import React, { useState, useMemo } from 'react'
import { Check, X, Undo2 } from 'lucide-react'
import { computeHunks, buildResolvedText, type DiffHunk } from './diffUtils'

interface ChangeCardProps {
  segmentNumber: number
  segmentId: number
  oldText: string
  newText: string
  authorName: string
  isActive: boolean
  onAccept: (segmentId: number, resolvedText: string) => void
  onReject: (segmentId: number) => void
  onClick: (segmentId: number) => void
}

export default function ChangeCard({
  segmentNumber,
  segmentId,
  oldText,
  newText,
  authorName,
  isActive,
  onAccept,
  onReject,
  onClick,
}: ChangeCardProps) {
  const initialHunks = useMemo(() => computeHunks(oldText, newText), [oldText, newText])
  const [hunks, setHunks] = useState<DiffHunk[]>(initialHunks)

  const pendingCount = hunks.filter(h => h.type !== 'equal' && h.status === 'pending').length
  const allResolved = pendingCount === 0

  function acceptHunk(index: number) {
    setHunks(prev => {
      const next = [...prev]
      const hunk = next[index]
      if (hunk.type === 'insert') {
        next[index] = { ...hunk, status: 'accepted' }
      } else if (hunk.type === 'delete') {
        next[index] = { ...hunk, status: 'rejected' }
      }
      // Handle paired hunks
      if (hunk.groupId !== undefined) {
        for (let i = 0; i < next.length; i++) {
          if (i !== index && next[i].groupId === hunk.groupId) {
            next[i] = { ...next[i], status: next[i].type === 'insert' ? 'accepted' : 'rejected' }
          }
        }
      }
      return next
    })
  }

  function rejectHunk(index: number) {
    setHunks(prev => {
      const next = [...prev]
      const hunk = next[index]
      if (hunk.type === 'insert') {
        next[index] = { ...hunk, status: 'rejected' }
      } else if (hunk.type === 'delete') {
        next[index] = { ...hunk, status: 'accepted' }
      }
      // Handle paired hunks
      if (hunk.groupId !== undefined) {
        for (let i = 0; i < next.length; i++) {
          if (i !== index && next[i].groupId === hunk.groupId) {
            next[i] = { ...next[i], status: next[i].type === 'delete' ? 'accepted' : 'rejected' }
          }
        }
      }
      return next
    })
  }

  function undoHunk(index: number) {
    setHunks(prev => {
      const next = [...prev]
      next[index] = { ...next[index], status: 'pending' }
      if (next[index].groupId !== undefined) {
        for (let i = 0; i < next.length; i++) {
          if (i !== index && next[i].groupId === next[index].groupId) {
            next[i] = { ...next[i], status: 'pending' }
          }
        }
      }
      return next
    })
  }

  function acceptAll() {
    setHunks(prev => prev.map(h => {
      if (h.type === 'equal') return h
      if (h.type === 'insert') return { ...h, status: 'accepted' as const }
      return { ...h, status: 'rejected' as const }
    }))
  }

  function rejectAll() {
    setHunks(prev => prev.map(h => {
      if (h.type === 'equal') return h
      if (h.type === 'delete') return { ...h, status: 'accepted' as const }
      return { ...h, status: 'rejected' as const }
    }))
  }

  function handleConfirm() {
    onAccept(segmentId, buildResolvedText(hunks))
  }

  return (
    <div
      onClick={() => onClick(segmentId)}
      className={`rounded-lg border transition-all cursor-pointer ${
        isActive
          ? 'border-amber-400 dark:border-amber-500/50 bg-amber-50/50 dark:bg-amber-900/10 shadow-sm'
          : 'border-parchment-200 dark:border-ink-600/50 bg-white dark:bg-ink-800/50 hover:border-amber-300 dark:hover:border-amber-600/40'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-parchment-200 dark:border-ink-600/30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-parchment-400 dark:text-cream-muted/50">#{segmentNumber}</span>
          <span className="text-[10px] text-parchment-500 dark:text-cream-muted font-body">
            by <span className="font-medium text-ink-700 dark:text-cream-dim">{authorName}</span>
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); acceptAll() }}
            className="px-1.5 py-0.5 text-[9px] font-body font-medium rounded text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
            title="Accept all hunks"
          >
            Accept
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); rejectAll() }}
            className="px-1.5 py-0.5 text-[9px] font-body font-medium rounded text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
            title="Reject all hunks"
          >
            Reject
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div className="px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap font-body">
        {hunks.map((hunk, idx) => {
          if (hunk.type === 'equal') {
            return <span key={idx} className="text-ink-700 dark:text-cream-dim">{hunk.text}</span>
          }

          // Skip insert if part of a group — rendered with the delete
          if (hunk.type === 'insert' && hunk.groupId !== undefined) return null

          // Paired replacement
          const paired = hunk.type === 'delete' && hunk.groupId !== undefined
            ? hunks.find((h, i) => i > idx && h.groupId === hunk.groupId && h.type === 'insert')
            : null

          if (hunk.status !== 'pending' || (paired && paired.status !== 'pending')) {
            // Resolved: show accepted text
            const resolved = paired
              ? (hunk.status === 'rejected' ? paired.text : hunk.text) // rejected delete = accepted insert
              : (hunk.status === 'accepted' ? hunk.text : '')
            return (
              <span key={idx} className="relative group/undo">
                <span className="text-ink-700 dark:text-cream-dim">{resolved}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); undoHunk(idx) }}
                  className="invisible group-hover/undo:visible ml-0.5 text-parchment-400 hover:text-gold transition-colors"
                  title="Undo"
                >
                  <Undo2 className="w-2.5 h-2.5 inline" />
                </button>
              </span>
            )
          }

          // Pending: show diff with accept/reject buttons
          return (
            <span key={idx} className="inline">
              <span className="bg-red-100 dark:bg-red-900/30 text-red-700/60 dark:text-red-400/60 line-through decoration-1 decoration-red-500/70 dark:decoration-red-400/70">
                {hunk.text}
              </span>
              {paired && (
                <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                  {paired.text}
                </span>
              )}
              <span className="inline-flex gap-0 ml-0.5 align-middle">
                <button
                  onClick={(e) => { e.stopPropagation(); acceptHunk(idx) }}
                  className="p-0.5 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 rounded"
                  title="Accept"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); rejectHunk(idx) }}
                  className="p-0.5 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded"
                  title="Reject"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            </span>
          )
        })}
      </div>

      {/* Footer action */}
      {allResolved && (
        <div className="px-3 py-1.5 border-t border-parchment-200 dark:border-ink-600/30 flex justify-end">
          <button
            onClick={(e) => { e.stopPropagation(); handleConfirm() }}
            className="px-2.5 py-1 text-[10px] font-body font-medium rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
          >
            Save Resolved
          </button>
        </div>
      )}
    </div>
  )
}
