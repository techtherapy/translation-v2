import DiffMatchPatch from 'diff-match-patch'

// Raw diff tuple as returned by DiffMatchPatch: [op, text]
// op: -1 = delete, 0 = equal, 1 = insert
export type RawDiff = [number, string]

export interface HunkItem {
  hunkIdx: number
  deleted: string
  inserted: string
}

export interface DiffHunk {
  type: 'equal' | 'insert' | 'delete'
  text: string
  status: 'pending' | 'accepted' | 'rejected'
  groupId?: number // links paired delete+insert (replacement)
}

export function computeHunks(oldText: string, newText: string): DiffHunk[] {
  const dmp = new DiffMatchPatch()
  const diffs = dmp.diff_main(oldText, newText)
  dmp.diff_cleanupSemantic(diffs)

  const hunks: DiffHunk[] = []
  let groupId = 0

  for (let i = 0; i < diffs.length; i++) {
    const [op, text] = diffs[i]
    if (op === 0) {
      hunks.push({ type: 'equal', text, status: 'accepted' })
    } else if (op === -1) {
      // Check if next is an insert (forming a replacement pair)
      const nextIsInsert = i + 1 < diffs.length && diffs[i + 1][0] === 1
      const gid = groupId++
      hunks.push({ type: 'delete', text, status: 'pending', groupId: nextIsInsert ? gid : undefined })
      if (nextIsInsert) {
        hunks.push({ type: 'insert', text: diffs[i + 1][1], status: 'pending', groupId: gid })
        i++ // skip the insert since we handled it
      }
    } else if (op === 1) {
      // Standalone insert (not preceded by delete)
      hunks.push({ type: 'insert', text, status: 'pending' })
    }
  }
  return hunks
}

export function buildResolvedText(hunks: DiffHunk[]): string {
  let text = ''
  for (const h of hunks) {
    if (h.type === 'equal') {
      text += h.text
    } else if (h.type === 'delete') {
      if (h.status === 'rejected') text += h.text // keep old text
    } else if (h.type === 'insert') {
      if (h.status === 'accepted') text += h.text // keep new text
    }
  }
  return text
}

/**
 * Run DiffMatchPatch on two strings and return semantically-cleaned raw diffs.
 * This is the single place that creates a DMP instance so all consumers agree.
 */
export function computeDiffs(oldText: string, newText: string): RawDiff[] {
  const dmp = new DiffMatchPatch()
  const diffs = dmp.diff_main(oldText, newText)
  dmp.diff_cleanupSemantic(diffs)
  return diffs as RawDiff[]
}

/**
 * Convert raw diffs into a flat list of hunk items for the annotation margin.
 *
 * Mirrors the inline `getHunkItems()` in SegmentAnnotationMargin.tsx:111-133:
 * - Pairs consecutive delete+insert as a single replacement item
 * - Skips whitespace-only deletions
 * - Assigns sequential hunkIdx (paired delete+insert share the same index)
 */
export function getHunkItems(oldText: string, newText: string): HunkItem[] {
  const diffs = computeDiffs(oldText, newText)
  const items: HunkItem[] = []
  let hunkIdx = 0

  for (let i = 0; i < diffs.length; i++) {
    const [op, text] = diffs[i]
    if (op === 0) continue

    if (op === -1) {
      const cur = hunkIdx
      const nextIns = i + 1 < diffs.length && diffs[i + 1][0] === 1
      if (!nextIns) hunkIdx++
      if (text.trim().length === 0) continue
      items.push({ hunkIdx: cur, deleted: text, inserted: nextIns ? diffs[i + 1][1] : '' })
      if (nextIns) i++ // skip the insert — already consumed
    } else if (op === 1) {
      const cur = hunkIdx
      hunkIdx++
      // Only emit a standalone insert item; paired inserts are handled by the delete branch above
      if (!(i > 0 && diffs[i - 1][0] === -1)) {
        items.push({ hunkIdx: cur, deleted: '', inserted: text })
      }
    }
  }

  return items
}

/**
 * Assign a hunk index (or null for equal parts) to each raw diff entry.
 *
 * Mirrors the inline index assignment in InlineDiff.tsx:91-104:
 * - Equal parts → null
 * - Delete followed by insert → both get the same hunkIdx; hunkIdx increments after the insert
 * - Standalone delete → gets current hunkIdx, then hunkIdx increments
 * - Insert (standalone or paired) → always increments hunkIdx after assignment
 */
export function computeHunkIndices(diffs: RawDiff[]): (number | null)[] {
  let hunkIdx = 0
  return diffs.map(([op], i) => {
    if (op === 0) return null
    if (op === -1) {
      const currentHunk = hunkIdx
      const nextIsInsert = i + 1 < diffs.length && diffs[i + 1][0] === 1
      if (!nextIsInsert) hunkIdx++
      return currentHunk
    }
    // op === 1
    const currentHunk = hunkIdx
    hunkIdx++
    return currentHunk
  })
}
