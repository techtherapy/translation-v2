/**
 * Behavioral integration tests for the track changes migration.
 *
 * These test the production extension (TrackChangesExtension) and verify
 * end-to-end flows: insert, delete, accept, reject, round-trip, clean text
 * extraction, and graceful error handling.
 */

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import History from '@tiptap/extension-history'
import {
  TrackChangesExtension,
  TrackedInsert,
  TrackedDelete,
  getChangeSet,
  trackCommands,
  CHANGE_STATUS,
  TrackChangesStatus,
} from '../TrackChangesExtension'
import { extractCleanText } from '../../../utils/translationContent'

function createTrackedEditor(content: string | object = '<p>Hello world</p>', enabled = true) {
  return new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      History,
      TrackedInsert,
      TrackedDelete,
      TrackChangesExtension.configure({
        enabled,
        userID: 'user-1',
      }),
    ],
    content,
  })
}

describe('Track Changes Integration', () => {
  describe('deletion keeps text in document', () => {
    it('deleting text adds tracked_delete mark instead of removing', () => {
      const editor = createTrackedEditor('<p>Hello world</p>')
      editor.commands.focus()
      editor.commands.setTextSelection({ from: 7, to: 12 })
      editor.commands.deleteSelection()

      // Text stays in document
      expect(editor.state.doc.textContent).toContain('world')

      // Has tracked_delete mark
      let hasDeleteMark = false
      editor.state.doc.descendants((node) => {
        for (const mark of node.marks || []) {
          if (mark.type.name === 'tracked_delete') hasDeleteMark = true
        }
        return true
      })
      expect(hasDeleteMark).toBe(true)

      editor.destroy()
    })
  })

  describe('insertion gets tracked_insert mark', () => {
    it('inserted text has tracked_insert mark', () => {
      const editor = createTrackedEditor('<p>Hello</p>')
      editor.commands.focus('end')
      editor.commands.insertContent(' world')

      const cs = getChangeSet(editor.state)!
      expect(cs.changes.length).toBe(1)
      expect(cs.changes[0].dataTracked.operation).toBe('insert')

      let hasInsertMark = false
      editor.state.doc.descendants((node) => {
        for (const mark of node.marks || []) {
          if (mark.type.name === 'tracked_insert') hasInsertMark = true
        }
        return true
      })
      expect(hasInsertMark).toBe(true)

      editor.destroy()
    })
  })

  describe('round-trip persistence', () => {
    it('save JSON → create new editor → pending changes preserved', () => {
      const editor1 = createTrackedEditor('<p>Hello world</p>')
      editor1.commands.focus()
      editor1.commands.setTextSelection({ from: 7, to: 12 })
      editor1.commands.deleteSelection()

      const savedJson = editor1.getJSON()
      const changeCount = getChangeSet(editor1.state)!.changes.length
      editor1.destroy()

      // Load from saved JSON
      const editor2 = createTrackedEditor(savedJson)
      const cs = getChangeSet(editor2.state)!
      expect(cs.changes.length).toBe(changeCount)
      expect(editor2.state.doc.textContent).toContain('world')

      editor2.destroy()
    })
  })

  describe('accept deletion removes text', () => {
    it('accepting a deletion actually removes the text from the document', () => {
      const editor = createTrackedEditor('<p>Hello world</p>')
      editor.commands.focus()
      editor.commands.setTextSelection({ from: 7, to: 12 })
      editor.commands.deleteSelection()

      // Accept the deletion
      const cs = getChangeSet(editor.state)!
      const ids = cs.changes.map(c => c.dataTracked.id)
      trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, ids)(editor.state, editor.view.dispatch)

      expect(editor.state.doc.textContent).not.toContain('world')
      expect(getChangeSet(editor.state)!.changes.length).toBe(0)

      editor.destroy()
    })
  })

  describe('reject insertion removes text', () => {
    it('rejecting an insertion removes the inserted text', () => {
      const editor = createTrackedEditor('<p>Hello</p>')
      editor.commands.focus('end')
      editor.commands.insertContent(' world')

      expect(editor.state.doc.textContent).toContain(' world')

      const cs = getChangeSet(editor.state)!
      const ids = cs.changes.map(c => c.dataTracked.id)
      trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, ids)(editor.state, editor.view.dispatch)

      expect(editor.state.doc.textContent).toBe('Hello')

      editor.destroy()
    })
  })

  describe('plain text → tracking enabled → first edit upgrades to JSON', () => {
    it('editor with tracking produces JSON output containing tracked marks', () => {
      // Start with plain text content (as if loaded from legacy)
      const editor = createTrackedEditor('<p>Hello world</p>', true)
      editor.commands.focus('end')
      editor.commands.insertContent(' test')

      const json = editor.getJSON()
      const jsonStr = JSON.stringify(json)

      // JSON should contain tracked_insert mark
      expect(jsonStr).toContain('tracked_insert')
      expect(jsonStr).toContain('"operation":"insert"')

      editor.destroy()
    })
  })

  describe('malformed JSON handling', () => {
    it('extractCleanText returns raw string for malformed JSON', () => {
      const result = extractCleanText({
        content_format: 'prosemirror',
        translated_text: 'not valid json {{{',
      })
      expect(result).toBe('not valid json {{{')
    })

    it('extractCleanText returns empty string for null text', () => {
      expect(extractCleanText({ content_format: 'prosemirror', translated_text: null } as any)).toBe('')
    })
  })

  describe('extractCleanText with tracked deletes', () => {
    it('excludes pending deletions from clean text', () => {
      const editor = createTrackedEditor('<p>Hello world</p>')
      editor.commands.focus()
      editor.commands.setTextSelection({ from: 7, to: 12 })
      editor.commands.deleteSelection()

      // Get JSON and use extractCleanText
      const json = JSON.stringify(editor.getJSON())
      const cleanText = extractCleanText({
        content_format: 'prosemirror',
        translated_text: json,
      })

      // "world" was deleted → should be excluded from clean text
      expect(cleanText).not.toContain('world')
      expect(cleanText).toContain('Hello')

      editor.destroy()
    })

    it('includes pending insertions in clean text', () => {
      const editor = createTrackedEditor('<p>Hello</p>')
      editor.commands.focus('end')
      editor.commands.insertContent(' universe')

      const json = JSON.stringify(editor.getJSON())
      const cleanText = extractCleanText({
        content_format: 'prosemirror',
        translated_text: json,
      })

      expect(cleanText).toContain(' universe')

      editor.destroy()
    })

    it('includes both inserts and excludes deletes in mixed document', () => {
      const editor = createTrackedEditor('<p>Hello world</p>')
      // Delete "world"
      editor.commands.focus()
      editor.commands.setTextSelection({ from: 7, to: 12 })
      editor.commands.deleteSelection()
      // Insert "universe"
      editor.commands.focus('end')
      editor.commands.insertContent(' universe')

      const json = JSON.stringify(editor.getJSON())
      const cleanText = extractCleanText({
        content_format: 'prosemirror',
        translated_text: json,
      })

      expect(cleanText).not.toContain('world')
      expect(cleanText).toContain('universe')

      editor.destroy()
    })
  })

  describe('tracking disabled does not track', () => {
    it('edits in disabled editor produce no tracked marks', () => {
      const editor = createTrackedEditor('<p>Hello</p>', false)
      editor.commands.focus('end')
      editor.commands.insertContent(' world')

      // No tracked marks
      let hasTrackedMarks = false
      editor.state.doc.descendants((node) => {
        for (const mark of node.marks || []) {
          if (mark.type.name.startsWith('tracked_')) hasTrackedMarks = true
        }
        return true
      })
      expect(hasTrackedMarks).toBe(false)
      expect(getChangeSet(editor.state)).toBeNull()

      editor.destroy()
    })
  })
})
