import { describe, it, expect } from 'vitest'
import {
  extractCleanText,
  extractCleanTextFromRaw,
  parseTranslationContent,
  isJsonContent,
} from './translationContent'

// Real JSON shapes from the spike (trackChangesSpike.test.ts findings)
const SPIKE_JSON_WITH_CHANGES = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { dataTracked: null },
      content: [
        { type: 'text', text: 'Hello ' },
        {
          type: 'text',
          marks: [
            {
              type: 'tracked_delete',
              attrs: {
                dataTracked: {
                  id: 'del-1',
                  authorID: 'user-42',
                  reviewedByID: null,
                  createdAt: 1700000000000,
                  updatedAt: 1700000000000,
                  statusUpdateAt: 0,
                  status: 'pending',
                  operation: 'delete',
                },
              },
            },
          ],
          text: 'world',
        },
        {
          type: 'text',
          marks: [
            {
              type: 'tracked_insert',
              attrs: {
                dataTracked: {
                  id: 'ins-1',
                  authorID: 'user-42',
                  reviewedByID: null,
                  createdAt: 1700000000000,
                  updatedAt: 1700000000000,
                  statusUpdateAt: 0,
                  status: 'pending',
                  operation: 'insert',
                },
              },
            },
          ],
          text: ' universe',
        },
      ],
    },
  ],
}

const CLEAN_JSON = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { dataTracked: null },
      content: [{ type: 'text', text: 'Hello world' }],
    },
  ],
}

describe('translationContent utilities', () => {
  describe('isJsonContent', () => {
    it('returns false for plain format', () => {
      expect(isJsonContent({ content_format: 'plain', translated_text: 'hello' })).toBe(false)
    })

    it('returns true for prosemirror format', () => {
      expect(isJsonContent({ content_format: 'prosemirror', translated_text: '{}' })).toBe(true)
    })

    it('returns false for undefined/missing format', () => {
      expect(isJsonContent({ translated_text: 'hello' } as any)).toBe(false)
      expect(isJsonContent({ content_format: undefined, translated_text: 'hello' } as any)).toBe(false)
    })
  })

  describe('parseTranslationContent', () => {
    it('returns string for plain format', () => {
      const result = parseTranslationContent({ content_format: 'plain', translated_text: 'hello' })
      expect(result).toBe('hello')
    })

    it('returns parsed object for prosemirror format', () => {
      const json = JSON.stringify(CLEAN_JSON)
      const result = parseTranslationContent({ content_format: 'prosemirror', translated_text: json })
      expect(typeof result).toBe('object')
      expect((result as any).type).toBe('doc')
    })

    it('returns raw string for malformed JSON', () => {
      const result = parseTranslationContent({ content_format: 'prosemirror', translated_text: 'bad json' })
      expect(result).toBe('bad json')
    })

    it('returns empty string for null/empty text', () => {
      expect(parseTranslationContent({ content_format: 'plain', translated_text: '' })).toBe('')
      expect(parseTranslationContent({ content_format: 'plain', translated_text: null } as any)).toBe('')
    })
  })

  describe('extractCleanText', () => {
    it('returns text directly for plain format', () => {
      expect(extractCleanText({ content_format: 'plain', translated_text: 'Hello world' })).toBe('Hello world')
    })

    it('returns empty string for null/undefined/empty text', () => {
      expect(extractCleanText({ content_format: 'plain', translated_text: '' })).toBe('')
      expect(extractCleanText({ translated_text: null } as any)).toBe('')
      expect(extractCleanText({ translated_text: undefined } as any)).toBe('')
    })

    it('returns raw string for malformed JSON (does not silently blank)', () => {
      expect(extractCleanText({ content_format: 'prosemirror', translated_text: 'not json' })).toBe('not json')
    })

    it('extracts text from clean ProseMirror JSON', () => {
      const json = JSON.stringify(CLEAN_JSON)
      const result = extractCleanText({ content_format: 'prosemirror', translated_text: json })
      expect(result).toBe('Hello world')
    })

    it('excludes pending deletions from clean text', () => {
      const json = JSON.stringify(SPIKE_JSON_WITH_CHANGES)
      const result = extractCleanText({ content_format: 'prosemirror', translated_text: json })
      // "world" is pending delete → excluded
      // " universe" is pending insert → included
      expect(result).toBe('Hello  universe')
    })

    it('excludes accepted deletions from clean text', () => {
      const doc = structuredClone(SPIKE_JSON_WITH_CHANGES)
      doc.content[0].content[1].marks![0].attrs.dataTracked.status = 'accepted'
      const json = JSON.stringify(doc)
      const result = extractCleanText({ content_format: 'prosemirror', translated_text: json })
      expect(result).not.toContain('world')
    })

    it('includes rejected deletions (text restored)', () => {
      const doc = structuredClone(SPIKE_JSON_WITH_CHANGES)
      doc.content[0].content[1].marks![0].attrs.dataTracked.status = 'rejected'
      const json = JSON.stringify(doc)
      const result = extractCleanText({ content_format: 'prosemirror', translated_text: json })
      expect(result).toContain('world')
    })

    it('includes pending insertions', () => {
      const doc = structuredClone(SPIKE_JSON_WITH_CHANGES)
      const json = JSON.stringify(doc)
      const result = extractCleanText({ content_format: 'prosemirror', translated_text: json })
      expect(result).toContain(' universe')
    })

    it('includes accepted insertions', () => {
      const doc = structuredClone(SPIKE_JSON_WITH_CHANGES)
      doc.content[0].content[2].marks![0].attrs.dataTracked.status = 'accepted'
      const json = JSON.stringify(doc)
      const result = extractCleanText({ content_format: 'prosemirror', translated_text: json })
      expect(result).toContain(' universe')
    })

    it('excludes rejected insertions', () => {
      const doc = structuredClone(SPIKE_JSON_WITH_CHANGES)
      doc.content[0].content[2].marks![0].attrs.dataTracked.status = 'rejected'
      const json = JSON.stringify(doc)
      const result = extractCleanText({ content_format: 'prosemirror', translated_text: json })
      expect(result).not.toContain(' universe')
    })

    it('handles node-level dataTracked (block deletes)', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: {
              dataTracked: [
                { id: 'n1', operation: 'delete', status: 'pending', authorID: 'u1' },
              ],
            },
            content: [{ type: 'text', text: 'Deleted paragraph' }],
          },
          {
            type: 'paragraph',
            attrs: { dataTracked: null },
            content: [{ type: 'text', text: 'Kept paragraph' }],
          },
        ],
      }
      const json = JSON.stringify(doc)
      const result = extractCleanText({ content_format: 'prosemirror', translated_text: json })
      expect(result).not.toContain('Deleted paragraph')
      expect(result).toContain('Kept paragraph')
    })

    it('handles multiple paragraphs with newline separation', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { dataTracked: null },
            content: [{ type: 'text', text: 'First' }],
          },
          {
            type: 'paragraph',
            attrs: { dataTracked: null },
            content: [{ type: 'text', text: 'Second' }],
          },
        ],
      }
      const json = JSON.stringify(doc)
      const result = extractCleanText({ content_format: 'prosemirror', translated_text: json })
      expect(result).toBe('First\nSecond')
    })
  })

  describe('extractCleanTextFromRaw', () => {
    it('returns text directly for non-prosemirror format', () => {
      expect(extractCleanTextFromRaw('hello', 'plain')).toBe('hello')
    })

    it('extracts clean text from prosemirror JSON string', () => {
      const json = JSON.stringify(CLEAN_JSON)
      expect(extractCleanTextFromRaw(json, 'prosemirror')).toBe('Hello world')
    })

    it('returns raw string for malformed JSON', () => {
      expect(extractCleanTextFromRaw('not json', 'prosemirror')).toBe('not json')
    })

    it('returns empty string for empty input', () => {
      expect(extractCleanTextFromRaw('', 'prosemirror')).toBe('')
    })
  })
})
