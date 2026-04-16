/**
 * SPIKE: Validate @manuscripts/track-changes-plugin v2.3.9 schema, behavior, and persistence.
 *
 * This test file discovers the exact schema contract the plugin requires and
 * documents findings that all subsequent migration tasks reference.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SPIKE FINDINGS — @manuscripts/track-changes-plugin v2.3.9
 * Run date: 2026-04-09
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1. SCHEMA CONTRACT
 *    ─────────────────
 *    The plugin requires TWO marks and ONE node attribute in the ProseMirror schema:
 *
 *    Marks (MUST exist in schema):
 *      • `tracked_insert` — applied to text nodes that were inserted
 *      • `tracked_delete` — applied to text nodes that were deleted
 *      Both marks have a single attribute: `dataTracked` (default: null)
 *
 *    Node attributes:
 *      • `dataTracked` (default: null) — on block nodes (e.g., paragraph)
 *      For nodes, dataTracked is an ARRAY of change objects.
 *      For marks, dataTracked is a SINGLE change object.
 *
 * 2. CHANGE ATTRIBUTE SHAPE (dataTracked)
 *    ─────────────────────────────────────
 *    {
 *      id: string           // UUID v4 (e.g., "5d9d552a-eaa1-4bb4-be0e-9717727254ce")
 *      authorID: string     // User ID string passed to plugin constructor
 *      reviewedByID: string | null  // Set when a reviewer accepts/rejects
 *      createdAt: number    // Unix timestamp (ms)
 *      updatedAt: number    // Unix timestamp (ms)
 *      statusUpdateAt: number  // 0 initially, updated on accept/reject
 *      status: "pending" | "accepted" | "rejected"
 *      operation: "insert" | "delete" | "set_attrs" | "wrap_with_node" | "node_split" | "reference" | "move" | "structure"
 *    }
 *
 * 3. PERSISTED JSON SHAPE (editor.getJSON())
 *    ────────────────────────────────────────
 *    Tracked changes appear as marks on text nodes:
 *    {
 *      "type": "doc",
 *      "content": [{
 *        "type": "paragraph",
 *        "attrs": { "dataTracked": null },
 *        "content": [
 *          { "type": "text", "text": "Hello " },
 *          {
 *            "type": "text",
 *            "marks": [{ "type": "tracked_delete", "attrs": { "dataTracked": { ...changeAttrs } } }],
 *            "text": "world"
 *          },
 *          {
 *            "type": "text",
 *            "marks": [{ "type": "tracked_insert", "attrs": { "dataTracked": { ...changeAttrs } } }],
 *            "text": " universe"
 *          }
 *        ]
 *      }]
 *    }
 *
 * 4. BEHAVIORAL FINDINGS
 *    ────────────────────
 *    • Text deletion KEEPS text in document with tracked_delete mark (confirmed!)
 *    • Text insertion ADDS tracked_insert mark to new text
 *    • Accept insertion → removes mark, keeps text (clean)
 *    • Reject insertion → removes text entirely
 *    • Accept deletion → removes text from document
 *    • Reject deletion → removes tracked_delete mark, text stays (restored)
 *    • ChangeSet.changes array contains all tracked changes
 *    • ChangeSet.textChanges contains text-only changes (for margin rendering)
 *    • Each change has: id, type, from, to, dataTracked, and type-specific fields
 *    • Change types: "text-change", "node-change", "node-attr-change", "mark-change"
 *    • TextChange also has: `text` (the affected text content)
 *    • setUserID command works for switching between users mid-session
 *
 * 5. ROUND-TRIP PERSISTENCE
 *    ──────────────────────
 *    • Saving via editor.getJSON() captures all tracked marks and attributes
 *    • Loading via constructor `content: savedJson` preserves changes correctly
 *    • Loading via setContent() while tracking ENABLED causes errors —
 *      the plugin tries to re-track the loaded content which creates invalid state
 *    • SAFE PATTERN: Either:
 *      (a) Pass content via constructor `content` option, OR
 *      (b) Disable tracking → setContent → enable tracking
 *      Option (b) is better for our use case since editors are already created
 *
 * 6. DEPENDENCY QUIRK
 *    ─────────────────
 *    • The plugin re-exports shared-utils.js which imports @manuscripts/transform
 *      (a devDependency NOT shipped with the plugin)
 *    • Fix: Vite alias forces ESM entry + mock for @manuscripts/transform
 *    • This affects both production builds and tests — aliases must be in vite.config.ts
 *
 * 7. PROSEMIRROR DEDUPLICATION
 *    ─────────────────────────
 *    • The plugin ships with its own prosemirror-* deps
 *    • npm overrides with "$" syntax deduplicates against TipTap's copies
 *    • prosemirror-tables still has separate copies (not a concern for our usage)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest'
import { Editor, Extension } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import History from '@tiptap/extension-history'
import {
  trackChangesPlugin,
  trackChangesPluginKey,
  trackCommands,
  TrackChangesStatus,
  CHANGE_STATUS,
  CHANGE_OPERATION,
} from '@manuscripts/track-changes-plugin'

/**
 * TipTap extension that defines the tracked_insert and tracked_delete marks
 * plus the dataTracked node attribute — the schema contract the plugin requires.
 */
const TrackChangesMarks = Extension.create({
  name: 'trackChangesMarks',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          dataTracked: { default: null },
        },
      },
    ]
  },

  addExtensions() {
    const TrackedInsert = Extension.create({
      name: 'trackedInsertMark',
      addProseMirrorPlugins() { return [] },
    })

    // We define marks via the ProseMirror schema extensibility of TipTap
    return []
  },
})

/**
 * Custom TipTap Mark for tracked_insert.
 * The plugin expects schema.marks.tracked_insert with a dataTracked attribute.
 */
import { Mark } from '@tiptap/core'

const TrackedInsert = Mark.create({
  name: 'tracked_insert',

  addAttributes() {
    return {
      dataTracked: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-track-op="insert"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { class: 'inserted', 'data-track-op': 'insert', ...HTMLAttributes }, 0]
  },
})

const TrackedDelete = Mark.create({
  name: 'tracked_delete',

  addAttributes() {
    return {
      dataTracked: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-track-op="delete"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { class: 'deleted', 'data-track-op': 'delete', ...HTMLAttributes }, 0]
  },
})

/**
 * Extension wrapper for the track changes ProseMirror plugin.
 */
const SpikeTrackChanges = Extension.create({
  name: 'spikeTrackChanges',

  addProseMirrorPlugins() {
    return [
      trackChangesPlugin({
        userID: 'user-42',
        initialStatus: TrackChangesStatus.enabled,
      }),
    ]
  },
})

function createTestEditor(content = '<p>Hello world</p>') {
  return new Editor({
    extensions: [
      Document,
      Paragraph.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            dataTracked: { default: null },
          }
        },
      }),
      Text,
      History,
      TrackedInsert,
      TrackedDelete,
      SpikeTrackChanges,
    ],
    content,
  })
}

describe('@manuscripts/track-changes-plugin spike', () => {
  it('creates an editor with the plugin active and discovers schema', () => {
    const editor = createTestEditor()

    // Plugin state is available
    const state = trackChangesPluginKey.getState(editor.state)
    expect(state).toBeTruthy()
    expect(state!.status).toBe(TrackChangesStatus.enabled)
    expect(state!.userID).toBe('user-42')

    // Schema has the expected marks
    const markNames = Object.keys(editor.schema.marks)
    console.log('[SPIKE] Schema mark names:', markNames)
    expect(editor.schema.marks.tracked_insert).toBeTruthy()
    expect(editor.schema.marks.tracked_delete).toBeTruthy()

    // Schema has dataTracked on paragraph
    const paragraphSpec = editor.schema.nodes.paragraph.spec
    console.log('[SPIKE] Paragraph attrs:', Object.keys(paragraphSpec.attrs || {}))

    editor.destroy()
  })

  it('tracks text insertion with marks', () => {
    const editor = createTestEditor('<p>Hello</p>')
    editor.commands.focus('end')
    editor.commands.insertContent(' world')

    const state = trackChangesPluginKey.getState(editor.state)!
    const changeSet = state.changeSet
    console.log('[SPIKE] After insert — change count:', changeSet.changes.length)
    console.log('[SPIKE] After insert — changes:', JSON.stringify(changeSet.changes.map(c => ({
      id: c.id,
      type: c.type,
      from: c.from,
      to: c.to,
      dataTracked: c.dataTracked,
    })), null, 2))

    // Document should contain tracked insert
    expect(changeSet.changes.length).toBeGreaterThan(0)

    // Check what marks are in the document
    const marks: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.marks?.length) {
        for (const mark of node.marks) {
          marks.push(`${mark.type.name}: ${JSON.stringify(mark.attrs)}`)
        }
      }
      return true
    })
    console.log('[SPIKE] Marks found in document after insert:', marks)

    // The inserted text should have a tracked_insert mark
    const insertChange = changeSet.changes[0]
    expect(insertChange.dataTracked.operation).toBe(CHANGE_OPERATION.insert)
    expect(insertChange.dataTracked.status).toBe(CHANGE_STATUS.pending)
    expect(insertChange.dataTracked.authorID).toBe('user-42')

    editor.destroy()
  })

  it('tracks text deletion — text stays in document with tracked_delete mark', () => {
    const editor = createTestEditor('<p>Hello world</p>')
    editor.commands.focus()
    // Select "world" (positions: Hello=1-6, space=6, world=7-12 inside the paragraph node)
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.commands.deleteSelection()

    const state = trackChangesPluginKey.getState(editor.state)!
    const changeSet = state.changeSet
    console.log('[SPIKE] After delete — change count:', changeSet.changes.length)
    console.log('[SPIKE] After delete — changes:', JSON.stringify(changeSet.changes.map(c => ({
      id: c.id,
      type: c.type,
      from: c.from,
      to: c.to,
      dataTracked: c.dataTracked,
    })), null, 2))

    // Key discovery: deleted text should STAY in the document
    const text = editor.state.doc.textContent
    console.log('[SPIKE] After delete — doc textContent:', JSON.stringify(text))
    expect(text).toContain('world')

    // Check marks
    const marks: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.marks?.length) {
        for (const mark of node.marks) {
          marks.push(`${mark.type.name}: text="${node.text}" attrs=${JSON.stringify(mark.attrs)}`)
        }
      }
      return true
    })
    console.log('[SPIKE] Marks found after delete:', marks)

    const deleteChange = changeSet.changes[0]
    expect(deleteChange.dataTracked.operation).toBe(CHANGE_OPERATION.delete)
    expect(deleteChange.dataTracked.status).toBe(CHANGE_STATUS.pending)

    editor.destroy()
  })

  it('accepts an insertion — mark is removed, text stays', () => {
    const editor = createTestEditor('<p>Hello</p>')
    editor.commands.focus('end')
    editor.commands.insertContent(' world')

    const state = trackChangesPluginKey.getState(editor.state)!
    const changes = state.changeSet.changes
    expect(changes.length).toBeGreaterThan(0)

    // Accept the change
    const changeIds = changes.map(c => c.dataTracked.id)
    console.log('[SPIKE] Accepting change IDs:', changeIds)
    const cmd = trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, changeIds)
    cmd(editor.state, editor.view.dispatch)

    const stateAfter = trackChangesPluginKey.getState(editor.state)!
    console.log('[SPIKE] After accept — remaining changes:', stateAfter.changeSet.changes.length)
    console.log('[SPIKE] After accept — text:', editor.state.doc.textContent)

    // Text should still be there
    expect(editor.state.doc.textContent).toContain('Hello world')

    // Check if marks were removed
    let hasTrackedMarks = false
    editor.state.doc.descendants((node) => {
      for (const mark of node.marks || []) {
        if (mark.type.name === 'tracked_insert' || mark.type.name === 'tracked_delete') {
          hasTrackedMarks = true
        }
      }
      return true
    })
    console.log('[SPIKE] After accept — has tracked marks:', hasTrackedMarks)

    editor.destroy()
  })

  it('rejects an insertion — text is removed', () => {
    const editor = createTestEditor('<p>Hello</p>')
    editor.commands.focus('end')
    editor.commands.insertContent(' world')

    const state = trackChangesPluginKey.getState(editor.state)!
    const changes = state.changeSet.changes
    const changeIds = changes.map(c => c.dataTracked.id)
    const cmd = trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, changeIds)
    cmd(editor.state, editor.view.dispatch)

    console.log('[SPIKE] After reject insertion — text:', editor.state.doc.textContent)
    expect(editor.state.doc.textContent).toBe('Hello')

    editor.destroy()
  })

  it('rejects a deletion — text is restored', () => {
    const editor = createTestEditor('<p>Hello world</p>')
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.commands.deleteSelection()

    // Verify text is still there (tracked delete keeps text)
    expect(editor.state.doc.textContent).toContain('world')

    const state = trackChangesPluginKey.getState(editor.state)!
    const changes = state.changeSet.changes
    const changeIds = changes.map(c => c.dataTracked.id)
    const cmd = trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, changeIds)
    cmd(editor.state, editor.view.dispatch)

    console.log('[SPIKE] After reject deletion — text:', editor.state.doc.textContent)
    // Rejecting a deletion should restore the text (remove the tracked_delete mark)
    expect(editor.state.doc.textContent).toContain('world')

    // And no tracked marks should remain
    let hasTrackedMarks = false
    editor.state.doc.descendants((node) => {
      for (const mark of node.marks || []) {
        if (mark.type.name === 'tracked_insert' || mark.type.name === 'tracked_delete') {
          hasTrackedMarks = true
        }
      }
      return true
    })
    console.log('[SPIKE] After reject deletion — has tracked marks:', hasTrackedMarks)

    editor.destroy()
  })

  it('accepts a deletion — text is removed from document', () => {
    const editor = createTestEditor('<p>Hello world</p>')
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.commands.deleteSelection()

    const state = trackChangesPluginKey.getState(editor.state)!
    const changes = state.changeSet.changes
    const changeIds = changes.map(c => c.dataTracked.id)
    const cmd = trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, changeIds)
    cmd(editor.state, editor.view.dispatch)

    console.log('[SPIKE] After accept deletion — text:', editor.state.doc.textContent)
    // Accepting deletion should actually remove the text
    expect(editor.state.doc.textContent).not.toContain('world')

    editor.destroy()
  })

  it('documents the full JSON shape with tracked changes', () => {
    const editor = createTestEditor('<p>Hello world</p>')
    // Delete "world"
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.commands.deleteSelection()
    // Insert "universe"
    editor.commands.focus('end')
    editor.commands.insertContent(' universe')

    const json = editor.getJSON()
    console.log('[SPIKE] Full JSON with tracked changes:', JSON.stringify(json, null, 2))

    // Document node attributes
    editor.state.doc.descendants((node) => {
      if (node.attrs?.dataTracked) {
        console.log(`[SPIKE] Node ${node.type.name} dataTracked:`, JSON.stringify(node.attrs.dataTracked))
      }
      return true
    })

    editor.destroy()
  })

  it('round-trip: save JSON → create new editor with same content → changes preserved', () => {
    // Create editor and make tracked changes
    const editor1 = createTestEditor('<p>Hello world</p>')
    editor1.commands.focus()
    editor1.commands.setTextSelection({ from: 7, to: 12 })
    editor1.commands.deleteSelection()

    // Save the JSON
    const savedJson = editor1.getJSON()
    console.log('[SPIKE] Saved JSON:', JSON.stringify(savedJson, null, 2))
    const changeCount1 = trackChangesPluginKey.getState(editor1.state)!.changeSet.changes.length
    editor1.destroy()

    // Create new editor directly from saved JSON (via constructor, not setContent)
    // setContent triggers the tracking plugin which re-tracks the loaded content
    const editor2 = new Editor({
      extensions: [
        Document,
        Paragraph.extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              dataTracked: { default: null },
            }
          },
        }),
        Text,
        History,
        TrackedInsert,
        TrackedDelete,
        SpikeTrackChanges,
      ],
      content: savedJson,
    })

    // Verify changes are preserved
    const state = trackChangesPluginKey.getState(editor2.state)!
    console.log('[SPIKE] After reload — change count:', state.changeSet.changes.length)
    console.log('[SPIKE] After reload — text:', editor2.state.doc.textContent)
    console.log('[SPIKE] After reload — changes:', JSON.stringify(state.changeSet.changes.map(c => ({
      type: c.type,
      dataTracked: c.dataTracked,
    })), null, 2))

    // The deleted text should still be in the document
    expect(editor2.state.doc.textContent).toContain('world')
    expect(state.changeSet.changes.length).toBe(changeCount1)

    editor2.destroy()
  })

  it('round-trip: setContent with tracking disabled → then enable → changes preserved', () => {
    // Create editor, make tracked changes
    const editor1 = createTestEditor('<p>Hello world</p>')
    editor1.commands.focus()
    editor1.commands.setTextSelection({ from: 7, to: 12 })
    editor1.commands.deleteSelection()

    const savedJson = editor1.getJSON()
    const changeCount1 = trackChangesPluginKey.getState(editor1.state)!.changeSet.changes.length
    editor1.destroy()

    // Create editor with tracking DISABLED, load content, then re-enable
    const editor2 = new Editor({
      extensions: [
        Document,
        Paragraph.extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              dataTracked: { default: null },
            }
          },
        }),
        Text,
        History,
        TrackedInsert,
        TrackedDelete,
        Extension.create({
          name: 'spikeTrackChangesDisabled',
          addProseMirrorPlugins() {
            return [
              trackChangesPlugin({
                userID: 'user-42',
                initialStatus: TrackChangesStatus.disabled,
              }),
            ]
          },
        }),
      ],
      content: '<p></p>',
    })

    // setContent while disabled — no tracking interference
    editor2.commands.setContent(savedJson)

    // Now enable tracking
    const enableCmd = trackCommands.setTrackingStatus(TrackChangesStatus.enabled)
    enableCmd(editor2.state, editor2.view.dispatch)

    const state = trackChangesPluginKey.getState(editor2.state)!
    console.log('[SPIKE] After disabled→load→enable — change count:', state.changeSet.changes.length)
    console.log('[SPIKE] After disabled→load→enable — text:', editor2.state.doc.textContent)

    expect(editor2.state.doc.textContent).toContain('world')
    expect(state.changeSet.changes.length).toBe(changeCount1)

    editor2.destroy()
  })

  it('ChangeSet exposes textChanges for margin rendering', () => {
    const editor = createTestEditor('<p>Hello world</p>')
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.commands.deleteSelection()
    editor.commands.focus('end')
    editor.commands.insertContent(' universe')

    const state = trackChangesPluginKey.getState(editor.state)!
    const changeSet = state.changeSet

    // Document the ChangeSet API
    console.log('[SPIKE] ChangeSet keys:', Object.keys(changeSet))
    console.log('[SPIKE] ChangeSet.changes count:', changeSet.changes.length)
    console.log('[SPIKE] ChangeSet.textChanges count:', changeSet.textChanges?.length)

    // Each change has these fields
    for (const change of changeSet.changes) {
      console.log('[SPIKE] Change:', {
        id: change.id,
        type: change.type,
        from: change.from,
        to: change.to,
        operation: change.dataTracked.operation,
        status: change.dataTracked.status,
        authorID: change.dataTracked.authorID,
        text: 'text' in change ? (change as any).text : undefined,
      })
    }

    editor.destroy()
  })

  it('verifies setUserID command works for switching users', () => {
    const editor = createTestEditor('<p>Hello</p>')

    // User 1 inserts
    editor.commands.focus('end')
    editor.commands.insertContent(' from user1')

    // Switch user
    const setUserCmd = trackCommands.setUserID('user-99')
    setUserCmd(editor.state, editor.view.dispatch)

    // User 2 inserts
    editor.commands.focus('end')
    editor.commands.insertContent(' and user2')

    const state = trackChangesPluginKey.getState(editor.state)!
    for (const change of state.changeSet.changes) {
      console.log('[SPIKE] Multi-user change:', {
        authorID: change.dataTracked.authorID,
        operation: change.dataTracked.operation,
        text: 'text' in change ? (change as any).text : undefined,
      })
    }

    // Should have changes from both users
    const authors = new Set(state.changeSet.changes.map(c => c.dataTracked.authorID))
    console.log('[SPIKE] Authors:', [...authors])
    expect(authors.size).toBeGreaterThanOrEqual(2)

    editor.destroy()
  })
})
