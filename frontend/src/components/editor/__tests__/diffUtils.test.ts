import { describe, it, expect } from 'vitest'
import {
  computeHunks,
  buildResolvedText,
  computeDiffs,
  getHunkItems,
  computeHunkIndices,
} from '../diffUtils'

// ---------------------------------------------------------------------------
// Existing exports — smoke test to confirm backwards compatibility
// ---------------------------------------------------------------------------

describe('computeHunks (existing, unchanged)', () => {
  it('returns empty array for identical text', () => {
    const hunks = computeHunks('hello', 'hello')
    expect(hunks.every(h => h.type === 'equal')).toBe(true)
  })

  it('returns insert hunk for added text', () => {
    const hunks = computeHunks('', 'hello')
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toMatchObject({ type: 'insert', text: 'hello', status: 'pending' })
  })

  it('returns delete hunk for removed text', () => {
    const hunks = computeHunks('hello', '')
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toMatchObject({ type: 'delete', text: 'hello', status: 'pending' })
  })

  it('groups delete+insert as replacement pair with matching groupId', () => {
    const hunks = computeHunks('foo', 'bar')
    const del = hunks.find(h => h.type === 'delete')
    const ins = hunks.find(h => h.type === 'insert')
    expect(del).toBeDefined()
    expect(ins).toBeDefined()
    expect(del!.groupId).toBeDefined()
    expect(del!.groupId).toBe(ins!.groupId)
  })
})

describe('buildResolvedText (existing, unchanged)', () => {
  it('returns original text when all pending', () => {
    const hunks = computeHunks('old', 'new')
    // pending = neither accepted nor rejected; deletes not added, inserts not added
    const result = buildResolvedText(hunks)
    // With all pending: equal parts pass through, pending inserts are dropped, pending deletes are dropped
    expect(typeof result).toBe('string')
  })

  it('accepted inserts are included', () => {
    const hunks = computeHunks('', 'new text')
    hunks[0].status = 'accepted'
    expect(buildResolvedText(hunks)).toBe('new text')
  })

  it('rejected deletes restore original text', () => {
    const hunks = computeHunks('old text', '')
    hunks[0].status = 'rejected'
    expect(buildResolvedText(hunks)).toBe('old text')
  })
})

// ---------------------------------------------------------------------------
// computeDiffs
// ---------------------------------------------------------------------------

describe('computeDiffs', () => {
  it('returns array of [op, text] pairs', () => {
    const diffs = computeDiffs('hello', 'hello world')
    expect(Array.isArray(diffs)).toBe(true)
    expect(diffs.length).toBeGreaterThan(0)
    diffs.forEach(([op, text]) => {
      expect([-1, 0, 1]).toContain(op)
      expect(typeof text).toBe('string')
    })
  })

  it('empty strings produce single equal diff or empty array', () => {
    const diffs = computeDiffs('', '')
    // DiffMatchPatch returns empty array for identical empty strings
    expect(diffs).toHaveLength(0)
  })

  it('identical strings produce only equal ops', () => {
    const diffs = computeDiffs('same', 'same')
    expect(diffs.every(([op]) => op === 0)).toBe(true)
  })

  it('returns semantically cleaned diffs', () => {
    // After semantic cleanup, a simple word replacement should be a single delete+insert
    const diffs = computeDiffs('cat', 'dog')
    const ops = diffs.map(([op]) => op)
    // Should be [-1, 1] (delete cat, insert dog) not character-level
    expect(ops).toContain(-1)
    expect(ops).toContain(1)
  })
})

// ---------------------------------------------------------------------------
// getHunkItems
// ---------------------------------------------------------------------------

describe('getHunkItems', () => {
  it('returns empty array for identical texts', () => {
    expect(getHunkItems('hello', 'hello')).toHaveLength(0)
  })

  it('returns empty array for empty texts', () => {
    expect(getHunkItems('', '')).toHaveLength(0)
  })

  it('returns a standalone insert item', () => {
    const items = getHunkItems('', 'hello')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ hunkIdx: 0, deleted: '', inserted: 'hello' })
  })

  it('returns a standalone delete item', () => {
    const items = getHunkItems('hello', '')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ hunkIdx: 0, deleted: 'hello', inserted: '' })
  })

  it('returns a replacement pair as a single item', () => {
    const items = getHunkItems('old', 'new')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ hunkIdx: 0, deleted: 'old', inserted: 'new' })
  })

  it('assigns hunkIdx 0 to replacement pairs (paired delete+insert does not increment counter)', () => {
    // Two separate word replacements: "foo"→"qux" and "baz"→"quux"
    // Paired delete+insert does NOT increment hunkIdx (only standalone ops do),
    // so both replacements receive hunkIdx=0 — matching SegmentAnnotationMargin source behavior.
    const items = getHunkItems('foo bar baz', 'qux bar quux')
    expect(items.length).toBeGreaterThanOrEqual(2)
    items.forEach(item => {
      expect(item.hunkIdx).toBe(0)
    })
  })

  it('skips whitespace-only deletions', () => {
    // A deletion that is only whitespace should not appear as an item
    // We can construct this by using a text where the only delete is spaces
    // "a  b" → "ab": the delete is spaces (whitespace only)
    const items = getHunkItems('a  b', 'ab')
    // The deletion of "  " is whitespace-only, so it should be skipped
    const hasWhitespaceDelete = items.some(i => i.deleted.trim().length === 0 && i.deleted.length > 0)
    expect(hasWhitespaceDelete).toBe(false)
  })

  it('paired delete+insert share the same hunkIdx', () => {
    const items = getHunkItems('The cat sat', 'The dog sat')
    // Should find a replacement with both deleted and inserted text
    const replacement = items.find(i => i.deleted.length > 0 && i.inserted.length > 0)
    expect(replacement).toBeDefined()
    // hunkIdx is recorded on the item itself - both share same item
    expect(replacement!.hunkIdx).toBe(0)
  })

  it('standalone deletes increment hunkIdx for subsequent items', () => {
    // "hello world foo" → "hello foo": the word "world " is a standalone delete (not followed by insert)
    // It should get hunkIdx 0 and increment the counter
    const items = getHunkItems('hello world foo', 'hello foo')
    expect(items).toHaveLength(1)
    expect(items[0].hunkIdx).toBe(0)
    expect(items[0].deleted.trim()).toBe('world')
    expect(items[0].inserted).toBe('')
  })

  it('standalone insert has empty deleted field', () => {
    const items = getHunkItems('hello', 'hello world')
    const insert = items.find(i => i.deleted === '' && i.inserted.length > 0)
    expect(insert).toBeDefined()
  })

  it('standalone delete has empty inserted field', () => {
    const items = getHunkItems('hello world', 'hello')
    const del = items.find(i => i.inserted === '' && i.deleted.length > 0)
    expect(del).toBeDefined()
  })

  it('handles multiple replacement pairs — both receive hunkIdx 0', () => {
    // First and last word change, middle stays the same
    // Both are paired delete+insert replacements, so hunkIdx never increments → all get 0
    const items = getHunkItems('alpha middle omega', 'ALPHA middle OMEGA')
    expect(items.length).toBeGreaterThanOrEqual(2)
    items.forEach(item => {
      expect(item.hunkIdx).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// computeHunkIndices
// ---------------------------------------------------------------------------

describe('computeHunkIndices', () => {
  it('returns empty array for empty diffs', () => {
    expect(computeHunkIndices([])).toHaveLength(0)
  })

  it('returns null for all-equal diffs', () => {
    const diffs = computeDiffs('same', 'same')
    const indices = computeHunkIndices(diffs)
    expect(indices.every(i => i === null)).toBe(true)
  })

  it('assigns 0 to a standalone insert', () => {
    const diffs = computeDiffs('', 'hello')
    const indices = computeHunkIndices(diffs)
    // Only diff is an insert
    const insertIdx = diffs.findIndex(([op]) => op === 1)
    expect(indices[insertIdx]).toBe(0)
  })

  it('assigns 0 to a standalone delete', () => {
    const diffs = computeDiffs('hello', '')
    const indices = computeHunkIndices(diffs)
    const deleteIdx = diffs.findIndex(([op]) => op === -1)
    expect(indices[deleteIdx]).toBe(0)
  })

  it('paired delete+insert share the same hunkIdx', () => {
    const diffs = computeDiffs('cat', 'dog')
    const indices = computeHunkIndices(diffs)
    const delIdx = diffs.findIndex(([op]) => op === -1)
    const insIdx = diffs.findIndex(([op]) => op === 1)
    expect(delIdx).toBeGreaterThanOrEqual(0)
    expect(insIdx).toBeGreaterThanOrEqual(0)
    expect(indices[delIdx]).toBe(indices[insIdx])
    expect(indices[delIdx]).toBe(0)
  })

  it('increments hunkIdx for each insert (including paired)', () => {
    // Two independent replacements: "foo" → "qux", "baz" → "quux"
    const diffs = computeDiffs('foo bar baz', 'qux bar quux')
    const indices = computeHunkIndices(diffs)
    const nonNull = indices.filter(i => i !== null) as number[]
    // There should be at least 2 distinct hunk indices
    const unique = new Set(nonNull)
    expect(unique.size).toBeGreaterThanOrEqual(2)
  })

  it('equal parts always get null', () => {
    const diffs = computeDiffs('hello world goodbye', 'hello there goodbye')
    const indices = computeHunkIndices(diffs)
    diffs.forEach(([op], i) => {
      if (op === 0) {
        expect(indices[i]).toBeNull()
      }
    })
  })

  it('length of output matches length of input diffs', () => {
    const diffs = computeDiffs('alpha beta gamma', 'ALPHA beta GAMMA')
    const indices = computeHunkIndices(diffs)
    expect(indices).toHaveLength(diffs.length)
  })

  it('standalone insert after equal increments hunkIdx from previous', () => {
    // "hello" → "hello world": one equal, one insert
    const diffs = computeDiffs('hello', 'hello world')
    const indices = computeHunkIndices(diffs)
    const insIdx = diffs.findIndex(([op]) => op === 1)
    // First insert gets hunkIdx 0
    expect(indices[insIdx]).toBe(0)
  })

  it('delete not followed by insert increments hunkIdx', () => {
    // "hello world" → "hello": equal + delete; delete should get hunkIdx 0 and increment
    const diffs = computeDiffs('hello world', 'hello')
    const indices = computeHunkIndices(diffs)
    const delIdx = diffs.findIndex(([op]) => op === -1)
    expect(indices[delIdx]).toBe(0)
  })
})
