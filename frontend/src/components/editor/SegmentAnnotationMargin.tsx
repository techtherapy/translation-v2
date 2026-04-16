import { useState, useEffect, useRef, memo } from 'react'
import { Check, X, Pencil, SmilePlus } from 'lucide-react'
import { createComment, resolveComment, unresolveComment, deleteComment, addReaction } from '../../api/comments'
import { ALLOWED_EMOJI } from './CommentReactions'
import { useConfirm } from '../../hooks/useConfirm'
import CommentThread, { avatarColor, timeAgo, fullTimestamp } from './CommentThread'
import CommentInput from './CommentInput'
import { getHunkItems as computeHunkItemsFn, computeDiffs } from './diffUtils'
import { extractCleanText } from '../../utils/translationContent'
import type { SegmentComment, Segment } from '../../types'

// Smooth expand/collapse wrapper using CSS grid-rows trick
function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}

// Three card states matching Notion: inactive → hover → active
// Cards shift LEFT via negative translateX as they become more prominent
const CARD_BASE = 'rounded-lg border mb-2 cursor-pointer transition-all duration-200 ease-out [transition-property:transform,box-shadow,border-color,background-color,margin-top,opacity]'
const CARD_IDLE = `${CARD_BASE} translate-x-0 border-parchment-200/40 dark:border-ink-600/30 bg-parchment-50/30 dark:bg-ink-800/20 hover:-translate-x-1 hover:shadow-md hover:border-parchment-300/60 dark:hover:border-ink-500/50 hover:bg-parchment-50/50 dark:hover:bg-ink-800/30`
const CARD_ACTIVE = `${CARD_BASE} -translate-x-2 border-parchment-300 dark:border-ink-500 bg-white dark:bg-ink-800/60 shadow-lg`

interface Props {
  segment: Segment
  comments: SegmentComment[]
  showComments: boolean
  showChanges: boolean
  isActive: boolean
  languageId: number
  currentUserId: number
  onUpdate: () => void
  onCommentCreated?: (comment: SegmentComment) => void
  onMutate?: (updater: (comments: SegmentComment[]) => SegmentComment[]) => void
  pendingQuotedText?: string
  onPendingQuotedTextConsumed?: () => void
  onNavigateToComment?: (commentId: number) => void
  onEnsureCommentsVisible?: () => void
  onAcceptChange?: (segmentId: number, translationId: number, resolvedText: string) => void
  onRejectChange?: (segmentId: number, translationId: number, previousText: string) => void
  onHunkResolve?: (segmentId: number, translationId: number, newTranslatedText: string, newPreviousText: string | null) => void
}

function SegmentAnnotationMargin({
  segment, comments, showComments, showChanges, isActive, languageId, currentUserId,
  onUpdate, onCommentCreated, onMutate, pendingQuotedText, onPendingQuotedTextConsumed,
  onNavigateToComment, onEnsureCommentsVisible, onAcceptChange, onRejectChange, onHunkResolve,
}: Props) {
  const confirm = useConfirm()
  const translation = segment.translations[0]
  const translatedClean = translation ? extractCleanText(translation) : ''
  const hasTrackChanges = showChanges && !!translation?.previous_text && translation.previous_text !== translatedClean
  const unresolved = comments.filter(c => !c.is_resolved)
  const resolved = comments.filter(c => c.is_resolved)
  const [showAllComments, setShowAllComments] = useState(false)
  // Only one card can be active at a time: 'h-{idx}' for hunk, 'c-{id}' for comment
  const [activeCard, setActiveCard] = useState<string | null>(null)
  const [hunkEmojiPicker, setHunkEmojiPicker] = useState<number | null>(null)
  const [showAllReplies, setShowAllReplies] = useState<Set<number>>(new Set())
  const [dismissingCards, setDismissingCards] = useState<Set<string>>(new Set())

  // Collapse active card when segment loses focus (#2)
  useEffect(() => {
    if (!isActive) { setActiveCard(null); setShowAllReplies(new Set()) }
  }, [isActive])

  // Animate card out then run action
  function dismissCard(cardKey: string, action: () => Promise<void> | void) {
    setDismissingCards(s => new Set(s).add(cardKey))
    setTimeout(async () => {
      await action()
      setDismissingCards(s => { const n = new Set(s); n.delete(cardKey); return n })
    }, 200)
  }

  if (!showComments && !hasTrackChanges) return null
  if (showComments && comments.length === 0 && !pendingQuotedText && !hasTrackChanges && !isActive) return null

  // --- Comment action handlers ---
  async function handleResolve(commentId: number) {
    dismissCard(`c-${commentId}`, async () => {
      try {
        await resolveComment(commentId)
        onMutate?.(cs => cs.map(c => c.id === commentId ? { ...c, is_resolved: true, resolved_by: currentUserId } : c))
        onUpdate()
      } catch (err) { console.error('Failed to resolve:', err) }
    })
  }
  async function handleUnresolve(commentId: number) {
    try {
      await unresolveComment(commentId)
      onMutate?.(cs => cs.map(c => c.id === commentId ? { ...c, is_resolved: false, resolved_by: null, resolved_at: null } : c))
      onUpdate()
    } catch (err) { console.error('Failed to unresolve:', err) }
  }
  async function handleDelete(commentId: number) {
    if (!await confirm({ title: 'Delete comment', message: 'Delete this comment?', confirmLabel: 'Delete', variant: 'danger' })) return
    dismissCard(`c-${commentId}`, async () => {
      try {
        await deleteComment(commentId)
        onMutate?.(cs => cs.filter(c => c.id !== commentId))
        onUpdate()
      } catch (err) { console.error('Failed to delete:', err) }
    })
  }
  async function handleReply(parentId: number, text: string) {
    try {
      const reply = await createComment({ segment_id: segment.id, language_id: languageId, text, parent_id: parentId })
      onMutate?.(cs => cs.map(c => c.id === parentId ? { ...c, replies: [...(c.replies || []), reply] } : c))
      onUpdate()
    } catch (err) { console.error('Failed to reply:', err) }
  }

  // --- Track changes ---
  function getHunkItems() {
    if (!hasTrackChanges || !translation?.previous_text) return []
    return computeHunkItemsFn(translation.previous_text, translatedClean)
  }

  function handleHunkAction(targetHunkIdx: number, action: 'accept' | 'reject') {
    if (!translation?.previous_text || !onHunkResolve) return
    const diffs = computeDiffs(translation.previous_text, translatedClean)
    const hunkMap: number[] = []
    let hIdx = 0
    for (let i = 0; i < diffs.length; i++) {
      const [op] = diffs[i]
      if (op === 0) { hunkMap.push(-1); continue }
      if (op === -1) { hunkMap.push(hIdx); if (!(i + 1 < diffs.length && diffs[i + 1][0] === 1)) hIdx++ }
      else { hunkMap.push(hIdx); hIdx++ }
    }
    let newPrev = '', newTrans = '', skipP = false, skipT = false
    for (let i = 0; i < diffs.length; i++) {
      const [op, text] = diffs[i]
      const isT = hunkMap[i] === targetHunkIdx
      if (action === 'accept') {
        if (!skipP) {
          if (op === 0) newPrev += text
          else if (op === -1) { if (!isT) newPrev += text; if (i + 1 < diffs.length && diffs[i + 1][0] === 1) skipP = true }
          else if (op === 1 && isT) newPrev += text
        } else skipP = false
      }
      if (action === 'reject') {
        if (!skipT) {
          if (op === 0) newTrans += text
          else if (op === -1) { if (isT) { newTrans += text; if (i + 1 < diffs.length && diffs[i + 1][0] === 1) skipT = true } }
          else if (op === 1 && !isT) newTrans += text
        } else skipT = false
      }
    }
    if (action === 'accept') {
      onHunkResolve(segment.id, translation.id, translatedClean, newPrev === translatedClean ? null : newPrev || null)
    } else {
      onHunkResolve(segment.id, translation.id, newTrans, translation.previous_text === newTrans ? null : translation.previous_text || null)
    }
  }

  function navigateToHunk(hunkIdx: number) {
    const el = document.getElementById(`segment-${segment.id}`)
    if (!el) return
    const targets = el.querySelectorAll(`[data-diff-hunk="${hunkIdx}"]`)
    document.querySelectorAll('.tc-hunk-focus').forEach(e => e.classList.remove('tc-hunk-focus'))
    if (targets.length > 0) {
      targets.forEach(e => e.classList.add('tc-hunk-focus'))
      // Don't scrollIntoView — cards are already positioned next to their text.
      // Scrolling causes viewport jumps (#3, #4).
    }
  }

  const hunkItems = getHunkItems()
  const marginRef = useRef<HTMLDivElement>(null)

  // Vertically align cards to their corresponding hunk positions in the editor
  useEffect(() => {
    const marginEl = marginRef.current
    if (!marginEl) return
    const segEl = document.getElementById(`segment-${segment.id}`)
    if (!segEl) return

    // Reset all inline positioning before recalculating (#5 — prevents drift)
    marginEl.querySelectorAll<HTMLElement>('[data-card-hunk]').forEach(el => {
      el.style.marginTop = ''
    })

    if (hunkItems.length === 0) return

    // Defer measurement to next frame so DOM has settled after reset
    requestAnimationFrame(() => {
      const segRect = segEl.getBoundingClientRect()

      for (const item of hunkItems) {
        const hunkEl = segEl.querySelector(`[data-diff-hunk="${item.hunkIdx}"]`) as HTMLElement
        const cardEl = marginEl.querySelector(`[data-card-hunk="${item.hunkIdx}"]`) as HTMLElement
        if (!hunkEl || !cardEl) continue

        const hunkRect = hunkEl.getBoundingClientRect()
        const cardRect = cardEl.getBoundingClientRect()
        const desiredTop = hunkRect.top - segRect.top
        const currentTop = cardRect.top - segRect.top

        // Only push cards DOWN to align (never pull up past previous cards)
        const offset = desiredTop - currentTop
        if (offset > 0) {
          cardEl.style.marginTop = `${offset}px`
        }
      }
    })
  })

  // Build set of quoted_text values shown inside change cards so we don't duplicate them
  const changeQuotedTexts = new Set(hunkItems.map(item => item.deleted || item.inserted).filter(Boolean))
  const standaloneComments = unresolved.filter(c => !c.quoted_text || !changeQuotedTexts.has(c.quoted_text))
  const maxVisible = showAllComments ? standaloneComments.length : 3
  const visibleComments = standaloneComments.slice(0, maxVisible)
  const hiddenCount = standaloneComments.length - maxVisible

  // Describe a hunk action for the card summary
  function hunkSummary(item: typeof hunkItems[0]) {
    const trunc = (s: string) => s.length > 28 ? s.slice(0, 28) + '…' : s
    if (item.deleted && item.inserted) return { label: 'Replace:', text: `"${trunc(item.deleted)}"` }
    if (item.deleted) return { label: 'Delete:', text: `"${trunc(item.deleted)}"` }
    return { label: 'Add:', text: `"${trunc(item.inserted)}"` }
  }

  return (
    <div ref={marginRef} className="px-1.5 py-2 space-y-0">
      {/* Track change cards */}
      {hunkItems.map(item => {
        const summary = hunkSummary(item)
        const cardKey = `h-${item.hunkIdx}`
        const isExpanded = activeCard === cardKey
        const hunkQuotedText = item.deleted || item.inserted
        const hunkRelated = comments.filter(c => c.quoted_text === hunkQuotedText && !c.is_resolved)
        const emojiComments = hunkRelated.filter(c => ALLOWED_EMOJI.includes(c.text))
        const hunkTextComments = hunkRelated.filter(c => !ALLOWED_EMOJI.includes(c.text))
        const hasReplies = hunkTextComments.length > 0
        const hunkEmojis: Record<string, { count: number; myCommentId: number | null }> = {}
        for (const c of emojiComments) {
          if (!hunkEmojis[c.text]) hunkEmojis[c.text] = { count: 0, myCommentId: null }
          hunkEmojis[c.text].count++
          if (c.user_id === currentUserId) hunkEmojis[c.text].myCommentId = c.id
        }
        return (
          <Collapsible key={`h-${item.hunkIdx}`} open={!dismissingCards.has(cardKey)}>
          <div data-card-hunk={item.hunkIdx} className={`${isExpanded ? CARD_ACTIVE : CARD_IDLE} group/card ${!isExpanded && hasReplies ? 'card-threaded' : ''}`} onClick={() => {
            if (isExpanded) { setActiveCard(null); setShowAllReplies(new Set()) }
            else { setActiveCard(cardKey); setShowAllReplies(new Set()); navigateToHunk(item.hunkIdx) }
          }}>
            {/* Card header — avatar with edit badge + username + hover controls */}
            <div className="flex items-center gap-2 px-3.5 py-2">
              <div className="relative shrink-0">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white"
                  style={{ backgroundColor: avatarColor(translation?.updated_by ?? 0) }}
                >
                  {(translation?.updated_by_username || '?').charAt(0).toUpperCase()}
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-blue-500 dark:bg-blue-400 flex items-center justify-center ring-1 ring-parchment-50 dark:ring-ink-800">
                  <Pencil className="w-1.5 h-1.5 text-white" />
                </div>
              </div>
              <span className="text-[12px] font-semibold text-ink-850 dark:text-cream font-body truncate">
                {translation?.updated_by_username || 'Unknown'}
              </span>
              {translation?.updated_at && (
                <span
                  className="text-[11px] text-parchment-500 dark:text-cream-muted font-body shrink-0"
                  title={fullTimestamp(translation.updated_at)}
                >
                  {timeAgo(translation.updated_at)}
                </span>
              )}
              {/* Hover controls — Emoji + Accept / Reject */}
              <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity bg-parchment-50 dark:bg-ink-700 rounded-md border border-parchment-200 dark:border-ink-600 shadow-sm px-1 py-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); setHunkEmojiPicker(hunkEmojiPicker === item.hunkIdx ? null : item.hunkIdx) }}
                  className="p-0.5 text-parchment-500 dark:text-cream-muted hover:text-gold dark:hover:text-gold-light transition-colors"
                  title="React"
                >
                  <SmilePlus className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); dismissCard(cardKey, () => handleHunkAction(item.hunkIdx, 'accept')) }}
                  className="p-0.5 text-parchment-500 dark:text-cream-muted hover:text-green-600 dark:hover:text-green-400 transition-colors"
                  title="Accept"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); dismissCard(cardKey, () => handleHunkAction(item.hunkIdx, 'reject')) }}
                  className="p-0.5 text-parchment-500 dark:text-cream-muted hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  title="Reject"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {/* Card body */}
            <div className="px-3.5 pb-2.5">
              <div className="text-[12px] font-body leading-snug">
                {isExpanded ? (
                  /* Expanded: show full text inline */
                  <div className="space-y-0.5">
                    {item.deleted && (
                      <div><span className="font-medium text-ink-850 dark:text-cream">Delete: </span><span className="text-red-600/80 dark:text-red-400/80">{item.deleted}</span></div>
                    )}
                    {item.inserted && (
                      <div><span className="font-medium text-ink-850 dark:text-cream">Add: </span><span className="text-green-700 dark:text-green-400">{item.inserted}</span></div>
                    )}
                  </div>
                ) : (
                  /* Collapsed: truncated summary with "… more" */
                  <>
                    <span className="font-medium text-ink-850 dark:text-cream">
                      {summary.label}
                    </span>{' '}
                    <span className="text-ink-600 dark:text-cream-dim">{summary.text}</span>
                    {(item.deleted.length > 28 || item.inserted.length > 28 || (item.deleted && item.inserted)) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveCard(cardKey) }}
                        className="text-parchment-400 dark:text-cream-muted/50 hover:text-ink-700 dark:hover:text-cream ml-1 font-body"
                      >
                        … more
                      </button>
                    )}
                  </>
                )}
              {/* Inline emoji picker — smooth expand */}
              <Collapsible open={hunkEmojiPicker === item.hunkIdx}>
                <div className="flex gap-0.5 mt-1.5 p-1 bg-parchment-100/50 dark:bg-ink-700/30 rounded-md" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  {ALLOWED_EMOJI.map(emoji => (
                    <button
                      key={emoji}
                      onClick={async () => {
                        setHunkEmojiPicker(null)
                        setActiveCard(cardKey)
                        try {
                          const quotedText = item.deleted || item.inserted
                          const newComment = await createComment({ segment_id: segment.id, language_id: languageId, text: emoji, quoted_text: quotedText })
                          onCommentCreated?.(newComment)
                          onEnsureCommentsVisible?.()
                        } catch (err) { console.error('Failed to add reaction:', err) }
                      }}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-parchment-200 dark:hover:bg-ink-600 transition-colors text-sm"
                    >{emoji}</button>
                  ))}
                </div>
              </Collapsible>
              {/* Emoji reaction badges — always visible */}
              {Object.keys(hunkEmojis).length > 0 && (
                <div className={`flex items-center gap-1 flex-wrap mt-1 ${hasReplies ? 'mb-2' : ''}`} onClick={(e) => e.stopPropagation()}>
                  {Object.entries(hunkEmojis).map(([emoji, { count, myCommentId }]) => (
                    <button
                      key={emoji}
                      onClick={async () => {
                        if (myCommentId) {
                          // Remove my reaction
                          await deleteComment(myCommentId)
                          onMutate?.(cs => cs.filter(c => c.id !== myCommentId))
                          onUpdate()
                        } else {
                          // Add my reaction
                          try {
                            const newComment = await createComment({ segment_id: segment.id, language_id: languageId, text: emoji, quoted_text: hunkQuotedText })
                            onCommentCreated?.(newComment)
                          } catch (err) { console.error('Failed to add reaction:', err) }
                        }
                      }}
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                        myCommentId
                          ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700'
                          : 'bg-parchment-100/50 dark:bg-ink-700/30 border-parchment-200 dark:border-ink-600/30 hover:bg-parchment-200 dark:hover:bg-ink-600/30'
                      }`}
                    >
                      <span>{emoji}</span>
                      <span className="text-parchment-500 dark:text-cream-muted">{count}</span>
                    </button>
                  ))}
                </div>
              )}
              </div>
              {/* Replies section */}
              {(() => {
                const quotedText = item.deleted || item.inserted
                const relatedComments = comments.filter(c => c.quoted_text === quotedText && !c.is_resolved)
                const textComments = relatedComments.filter(c => !ALLOWED_EMOJI.includes(c.text))
                const lastTextComment = textComments.length > 0 ? textComments[textComments.length - 1] : null
                const showAll = showAllReplies.has(item.hunkIdx)
                const lastComment = textComments[textComments.length - 1]
                const hiddenCount2 = textComments.length > 1 ? textComments.length - 1 : 0
                if (!lastTextComment && !isExpanded) return null
                return (
                  <div className="mt-1.5 border-t border-parchment-200/50 dark:border-ink-600/30 pt-1.5" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                    {/* Show collapsed replies link */}
                    {!showAll && hiddenCount2 > 0 && (
                      <button
                        onClick={() => { setShowAllReplies(s => new Set(s).add(item.hunkIdx)); setActiveCard(cardKey) }}
                        className="text-[10px] text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 font-body transition-colors mb-1.5 px-0.5"
                      >
                        Show {hiddenCount2} {hiddenCount2 === 1 ? 'reply' : 'replies'}
                      </button>
                    )}
                    {/* All earlier replies when expanded */}
                    {showAll && textComments.slice(0, -1).map(c => (
                      <CommentThread
                        key={c.id}
                        comment={c}
                        currentUserId={currentUserId}
                        translationText={translatedClean}
                        onResolve={handleResolve}
                        onUnresolve={handleUnresolve}
                        onDelete={handleDelete}
                        onReply={handleReply}
                        onUpdate={onUpdate}
                        onMutate={onMutate}
                        hideQuotedText
                        individualHover
                        compact
                      />
                    ))}
                    {/* Always show last comment */}
                    {lastComment && (
                      <CommentThread
                        key={lastComment.id}
                        comment={lastComment}
                        currentUserId={currentUserId}
                        translationText={translatedClean}
                        onResolve={handleResolve}
                        onUnresolve={handleUnresolve}
                        onDelete={handleDelete}
                        onReply={handleReply}
                        onUpdate={onUpdate}
                        onMutate={onMutate}
                        hideQuotedText
                        individualHover
                        compact
                      />
                    )}
                  </div>
                )
              })()}
              {/* Reply input — smooth expand/collapse */}
              <Collapsible open={isExpanded}>
                <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  <CommentInput
                    segmentId={segment.id}
                    languageId={languageId}
                    pendingQuotedText={hunkQuotedText}
                    onPendingQuotedTextConsumed={() => {}}
                    onCommentCreated={(newComment) => {
                      onCommentCreated?.(newComment)
                      onEnsureCommentsVisible?.()
                    }}
                    onUpdate={onUpdate}
                    hideQuotedPreview
                    placeholder="Reply..."
                  />
                </div>
              </Collapsible>
            </div>
          </div>
          </Collapsible>
        )
      })}

      {/* Comment cards */}
      {showComments && (comments.length > 0 || pendingQuotedText) && (
        <>
          {visibleComments.map(c => {
            const isCommentActive = activeCard === `c-${c.id}`
            const commentCardKey = `c-${c.id}`
            return (
              <Collapsible key={c.id} open={!dismissingCards.has(commentCardKey)}>
              <div className={`${isCommentActive ? CARD_ACTIVE : CARD_IDLE} group/card`} onClick={() => {
                if (isCommentActive) { setActiveCard(null); setShowAllReplies(new Set()) }
                else { setActiveCard(`c-${c.id}`); setShowAllReplies(new Set()); if (c.quoted_text) onNavigateToComment?.(c.id) }
              }}>
                <div className="px-3.5 py-2.5">
                  <CommentThread
                    comment={c}
                    currentUserId={currentUserId}
                    translationText={translatedClean}
                    onResolve={handleResolve}
                    onUnresolve={handleUnresolve}
                    onDelete={handleDelete}
                    onReply={handleReply}
                    onUpdate={onUpdate}
                    onMutate={onMutate}
                    onNavigateToComment={onNavigateToComment}
                    isActive={isCommentActive}
                    onShowAllReplies={() => setActiveCard(`c-${c.id}`)}
                  />
                </div>
                <Collapsible open={isCommentActive}>
                  <div className="px-3.5 pb-3" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                    <CommentInput
                      segmentId={segment.id}
                      languageId={languageId}
                      parentId={c.id}
                      onPendingQuotedTextConsumed={() => {}}
                      onCommentCreated={(newComment) => {
                        onMutate?.(cs => cs.map(existing =>
                          existing.id === c.id ? { ...existing, replies: [...(existing.replies || []), newComment] } : existing
                        ))
                      }}
                      onUpdate={onUpdate}
                      hideQuotedPreview
                      placeholder="Reply..."
                    />
                  </div>
                </Collapsible>
              </div>
              </Collapsible>
            )
          })}
          {hiddenCount > 0 && (
            <button onClick={() => setShowAllComments(true)} className="text-[10px] text-parchment-500 hover:text-gold dark:text-cream-muted dark:hover:text-gold-light font-body transition-colors mb-1 px-2">
              +{hiddenCount} more
            </button>
          )}
          {resolved.length > 0 && (
            <details className="mt-1 px-1">
              <summary className="text-[10px] text-parchment-400 dark:text-cream-muted cursor-pointer font-body select-none">{resolved.length} resolved</summary>
              <div className="mt-1 opacity-60">
                {resolved.map(c => (
                  <div key={c.id} className={CARD_IDLE}>
                    <div className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <CommentThread comment={c} currentUserId={currentUserId} translationText={translation?.translated_text || ''} onResolve={handleResolve} onUnresolve={handleUnresolve} onDelete={handleDelete} onReply={handleReply} onUpdate={onUpdate} onMutate={onMutate} />
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          {pendingQuotedText && (
            <div className="px-1">
              <CommentInput
                segmentId={segment.id}
                languageId={languageId}
                pendingQuotedText={pendingQuotedText}
                onPendingQuotedTextConsumed={onPendingQuotedTextConsumed}
                onCommentCreated={onCommentCreated}
                onUpdate={onUpdate}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default memo(SegmentAnnotationMargin)
