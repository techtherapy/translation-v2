import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { ChevronUp, ChevronDown, CheckCheck, XCircle, Undo2, Check, X } from 'lucide-react'
import { getHunkItems, computeDiffs } from './diffUtils'
import { extractCleanText } from '../../utils/translationContent'
import type { Segment } from '../../types'

interface HunkItem {
  segmentId: number
  segmentOrder: number
  hunkIdx: number
  deleted: string
  inserted: string
  authorName: string
}

interface UndoEntry {
  segmentId: number
  translationId: number
  previousTranslatedText: string
  previousPreviousText: string | null
}

interface ChangesPanelProps {
  segments: Segment[]
  activeSegment: number | null
  activeHunkIdx: number | null
  onNavigate: (segmentId: number, hunkIdx: number) => void
  onAcceptChange: (segmentId: number, translationId: number, resolvedText: string) => Promise<void>
  onRejectChange: (segmentId: number, translationId: number, previousText: string) => Promise<void>
  onHunkResolve: (segmentId: number, translationId: number, newTranslatedText: string, newPreviousText: string | null) => Promise<void>
  onBulkAccept: () => Promise<void>
  onBulkReject: () => Promise<void>
}

export default function ChangesPanel({
  segments,
  activeSegment,
  activeHunkIdx,
  onNavigate,
  onAcceptChange,
  onRejectChange,
  onHunkResolve,
  onBulkAccept,
  onBulkReject,
}: ChangesPanelProps) {
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])

  // Build flat list of individual hunks across all changed segments
  const hunkItems = useMemo(() => {
    const items: HunkItem[] = []
    for (const seg of segments) {
      const t = seg.translations[0]
      const tClean = t ? extractCleanText(t) : ''
      if (!t?.previous_text || t.previous_text === tClean) continue
      const authorName = t.updated_by_username || 'Unknown'
      const segHunks = getHunkItems(t.previous_text, tClean)
      for (const hunk of segHunks) {
        items.push({
          segmentId: seg.id,
          segmentOrder: seg.order,
          hunkIdx: hunk.hunkIdx,
          deleted: hunk.deleted,
          inserted: hunk.inserted,
          authorName,
        })
      }
    }
    return items
  }, [segments])

  const activeItemIdx = hunkItems.findIndex(
    item => item.segmentId === activeSegment && item.hunkIdx === activeHunkIdx
  )

  function navigatePrev() {
    if (hunkItems.length === 0) return
    const prevIdx = activeItemIdx > 0 ? activeItemIdx - 1 : hunkItems.length - 1
    const item = hunkItems[prevIdx]
    onNavigate(item.segmentId, item.hunkIdx)
  }

  function navigateNext() {
    if (hunkItems.length === 0) return
    const nextIdx = activeItemIdx < hunkItems.length - 1 ? activeItemIdx + 1 : 0
    const item = hunkItems[nextIdx]
    onNavigate(item.segmentId, item.hunkIdx)
  }

  const handleAcceptSegment = useCallback(async (segmentId: number) => {
    const seg = segments.find(s => s.id === segmentId)
    const t = seg?.translations[0]
    if (!t) return
    setUndoStack(prev => [...prev, {
      segmentId,
      translationId: t.id,
      previousTranslatedText: t.translated_text,
      previousPreviousText: t.previous_text || null,
    }])
    await onAcceptChange(segmentId, t.id, t.translated_text)
  }, [segments, onAcceptChange])

  const handleRejectSegment = useCallback(async (segmentId: number) => {
    const seg = segments.find(s => s.id === segmentId)
    const t = seg?.translations[0]
    if (!t || !t.previous_text) return
    setUndoStack(prev => [...prev, {
      segmentId,
      translationId: t.id,
      previousTranslatedText: t.translated_text,
      previousPreviousText: t.previous_text || null,
    }])
    await onRejectChange(segmentId, t.id, t.previous_text)
  }, [segments, onRejectChange])

  // Accept or reject a single hunk within a segment.
  // Accept: keep translated_text, advance previous_text to include this hunk's change
  // Reject: revert this hunk in translated_text, keep previous_text
  const handleHunkAction = useCallback(async (segmentId: number, targetHunkIdx: number, action: 'accept' | 'reject') => {
    const seg = segments.find(s => s.id === segmentId)
    const t = seg?.translations[0]
    if (!t?.previous_text) return

    const tClean = extractCleanText(t)
    const diffs = computeDiffs(t.previous_text, tClean)

    // Assign hunk indices (same logic as InlineDiff)
    const hunkMap: number[] = []
    let hIdx = 0
    for (let i = 0; i < diffs.length; i++) {
      const [op] = diffs[i]
      if (op === 0) { hunkMap.push(-1); continue }
      if (op === -1) {
        hunkMap.push(hIdx)
        const nextIsInsert = i + 1 < diffs.length && diffs[i + 1][0] === 1
        if (!nextIsInsert) hIdx++
      } else {
        hunkMap.push(hIdx)
        hIdx++
      }
    }

    // Build new previous_text (for accept) or new translated_text (for reject)
    // Accept: update previous_text to include the target hunk's change
    //   → for target: include insert, skip delete. For others: include delete, skip insert.
    // Reject: update translated_text to revert the target hunk
    //   → for target: include delete, skip insert. For others: skip delete, include insert.

    let newPreviousText = ''
    let newTranslatedText = ''
    let skipNextForPrev = false
    let skipNextForTrans = false

    for (let i = 0; i < diffs.length; i++) {
      const [op, text] = diffs[i]
      const isTarget = hunkMap[i] === targetHunkIdx

      // Build newPreviousText: accept target hunk into baseline
      if (!skipNextForPrev) {
        if (op === 0) {
          newPreviousText += text
        } else if (op === -1) {
          if (isTarget) {
            // Accept into baseline: skip old text, will include insert
          } else {
            newPreviousText += text // keep old text in baseline
            if (i + 1 < diffs.length && diffs[i + 1][0] === 1 && hunkMap[i + 1] !== targetHunkIdx) {
              skipNextForPrev = true // skip paired insert for non-target
            }
          }
        } else if (op === 1) {
          if (isTarget) {
            newPreviousText += text // accept: include insert in baseline
          }
          // non-target inserts skipped (baseline keeps old text)
        }
      } else {
        skipNextForPrev = false
      }

      // Build newTranslatedText: revert target hunk
      if (!skipNextForTrans) {
        if (op === 0) {
          newTranslatedText += text
        } else if (op === -1) {
          if (isTarget) {
            newTranslatedText += text // revert: keep old text
            if (i + 1 < diffs.length && diffs[i + 1][0] === 1) {
              skipNextForTrans = true // skip paired insert
            }
          }
          // non-target deletes skipped (keep new text)
        } else if (op === 1) {
          if (isTarget) {
            // revert standalone insert: omit
          } else {
            newTranslatedText += text
          }
        }
      } else {
        skipNextForTrans = false
      }
    }

    setUndoStack(prev => [...prev, {
      segmentId,
      translationId: t.id,
      previousTranslatedText: t.translated_text,
      previousPreviousText: t.previous_text || null,
    }])

    if (action === 'accept') {
      // Keep translated_text, update previous_text to include accepted change
      // If all hunks are now resolved, clear previous_text
      const finalPrev = newPreviousText === t.translated_text ? '' : newPreviousText
      await onHunkResolve(segmentId, t.id, t.translated_text, finalPrev || null)
    } else {
      // Update translated_text to revert this hunk, keep previous_text
      // If all hunks resolved, clear previous_text
      const finalPrev = t.previous_text === newTranslatedText ? '' : t.previous_text
      await onHunkResolve(segmentId, t.id, newTranslatedText, finalPrev || null)
    }
  }, [segments, onHunkResolve])

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return
    const entry = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    // Restore both translated_text and previous_text to their prior values
    onHunkResolve(entry.segmentId, entry.translationId, entry.previousTranslatedText, entry.previousPreviousText)
  }, [undoStack, onHunkResolve])

  // Ctrl+Z undo shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).getAttribute('contenteditable')) return
        if (undoStack.length > 0) {
          e.preventDefault()
          handleUndo()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleUndo, undoStack.length])

  if (hunkItems.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-parchment-400 dark:text-cream-muted/50 font-body">
        No changes to review
      </div>
    )
  }

  // Group hunk count per segment for accept/reject all per segment
  const segmentIds = [...new Set(hunkItems.map(h => h.segmentId))]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 bg-parchment-50 dark:bg-ink-850 border-b border-parchment-200 dark:border-ink-600/50 px-3 py-2 z-10">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-parchment-500 dark:text-cream-muted uppercase tracking-wider font-body">
            Changes ({hunkItems.length})
          </span>
          <div className="flex items-center gap-0.5">
            <button onClick={navigatePrev} className="p-0.5 text-parchment-400 hover:text-amber-500 transition-colors" title="Previous change">
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-parchment-400 dark:text-cream-muted/60 font-body tabular-nums min-w-[3ch] text-center">
              {activeItemIdx >= 0 ? activeItemIdx + 1 : '–'}
            </span>
            <button onClick={navigateNext} className="p-0.5 text-parchment-400 hover:text-amber-500 transition-colors" title="Next change">
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onBulkAccept}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-body font-medium rounded bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
          >
            <CheckCheck className="w-3 h-3" /> Accept All
          </button>
          <button
            onClick={onBulkReject}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-body font-medium rounded bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            <XCircle className="w-3 h-3" /> Reject All
          </button>
          {undoStack.length > 0 && (
            <button
              onClick={handleUndo}
              className="flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-body font-medium rounded bg-parchment-100 text-parchment-600 dark:bg-ink-700 dark:text-cream-muted hover:bg-parchment-200 dark:hover:bg-ink-600 transition-colors"
              title={`Undo last action (${undoStack.length})`}
            >
              <Undo2 className="w-3 h-3" /> {undoStack.length}
            </button>
          )}
        </div>
      </div>

      {/* Hunk list */}
      <div className="flex-1 overflow-y-auto">
        {segmentIds.map(segId => {
          const segHunks = hunkItems.filter(h => h.segmentId === segId)
          const segOrder = segHunks[0].segmentOrder
          return (
            <div key={segId}>
              {/* Segment header */}
              <div className="flex items-center justify-between px-3 py-1 bg-parchment-100/50 dark:bg-ink-800/50 border-b border-parchment-100 dark:border-ink-700/30">
                <span className="text-[10px] font-mono text-parchment-400 dark:text-cream-muted/50">
                  Segment {segOrder}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleAcceptSegment(segId)}
                    className="text-[9px] font-body text-green-600 dark:text-green-400 hover:underline"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleRejectSegment(segId)}
                    className="text-[9px] font-body text-red-500 dark:text-red-400 hover:underline"
                  >
                    Reject
                  </button>
                </div>
              </div>
              {/* Individual hunks */}
              {segHunks.map(item => {
                const isActive = activeSegment === item.segmentId && activeHunkIdx === item.hunkIdx
                const truncate = (s: string) => s.length > 40 ? s.slice(0, 40) + '...' : s
                return (
                  <div
                    key={`${item.segmentId}-${item.hunkIdx}`}
                    onClick={() => onNavigate(item.segmentId, item.hunkIdx)}
                    title={`Changed by ${item.authorName}`}
                    className={`flex items-start gap-1.5 px-3 py-1.5 border-b border-parchment-100 dark:border-ink-700/30 cursor-pointer transition-colors text-xs font-body leading-snug ${
                      isActive
                        ? 'bg-amber-50/70 dark:bg-amber-900/15'
                        : 'hover:bg-parchment-50 dark:hover:bg-ink-800/50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      {item.deleted && (
                        <span className="text-red-600/70 dark:text-red-400/70 line-through decoration-1 mr-0.5">
                          {truncate(item.deleted)}
                        </span>
                      )}
                      {item.inserted && (
                        <span className="text-green-700 dark:text-green-400">
                          {truncate(item.inserted)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleHunkAction(item.segmentId, item.hunkIdx, 'accept') }}
                        className="p-0.5 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 rounded transition-colors"
                        title="Accept this change"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleHunkAction(item.segmentId, item.hunkIdx, 'reject') }}
                        className="p-0.5 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded transition-colors"
                        title="Reject this change"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
