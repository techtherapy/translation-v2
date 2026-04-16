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
  isTrackingEnabled,
  trackCommands,
  trackChangesPluginKey,
  TrackChangesStatus,
  CHANGE_STATUS,
} from '../TrackChangesExtension'

function createEditor(options: { enabled: boolean; userID?: string; content?: string }) {
  return new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      History,
      TrackedInsert,
      TrackedDelete,
      TrackChangesExtension.configure({
        enabled: options.enabled,
        userID: options.userID ?? 'test-user',
      }),
    ],
    content: options.content ?? '<p>Hello world</p>',
  })
}

describe('TrackChangesExtension', () => {
  it('registers tracked marks in the schema', () => {
    const editor = createEditor({ enabled: true })
    expect(editor.schema.marks.tracked_insert).toBeTruthy()
    expect(editor.schema.marks.tracked_delete).toBeTruthy()
    editor.destroy()
  })

  it('adds dataTracked attribute to paragraph nodes', () => {
    const editor = createEditor({ enabled: true })
    const spec = editor.schema.nodes.paragraph.spec
    expect(spec.attrs).toHaveProperty('dataTracked')
    editor.destroy()
  })

  it('activates plugin when enabled: true', () => {
    const editor = createEditor({ enabled: true })
    expect(isTrackingEnabled(editor.state)).toBe(true)
    const cs = getChangeSet(editor.state)
    expect(cs).toBeTruthy()
    editor.destroy()
  })

  it('does NOT activate plugin when enabled: false', () => {
    const editor = createEditor({ enabled: false })
    const pluginState = trackChangesPluginKey.getState(editor.state)
    expect(pluginState).toBeUndefined()
    expect(isTrackingEnabled(editor.state)).toBe(false)
    expect(getChangeSet(editor.state)).toBeNull()
    editor.destroy()
  })

  it('tracks insertions with tracked_insert mark', () => {
    const editor = createEditor({ enabled: true, content: '<p>Hello</p>' })
    editor.commands.focus('end')
    editor.commands.insertContent(' world')

    const cs = getChangeSet(editor.state)!
    expect(cs.changes.length).toBe(1)
    expect(cs.changes[0].dataTracked.operation).toBe('insert')
    expect(cs.changes[0].dataTracked.status).toBe('pending')
    expect(cs.changes[0].dataTracked.authorID).toBe('test-user')

    editor.destroy()
  })

  it('tracks deletions — text stays in document', () => {
    const editor = createEditor({ enabled: true, content: '<p>Hello world</p>' })
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.commands.deleteSelection()

    // Text stays in document
    expect(editor.state.doc.textContent).toContain('world')

    const cs = getChangeSet(editor.state)!
    expect(cs.changes.length).toBe(1)
    expect(cs.changes[0].dataTracked.operation).toBe('delete')

    editor.destroy()
  })

  it('accept removes mark, keeps text', () => {
    const editor = createEditor({ enabled: true, content: '<p>Hello</p>' })
    editor.commands.focus('end')
    editor.commands.insertContent(' world')

    const cs = getChangeSet(editor.state)!
    const ids = cs.changes.map(c => c.dataTracked.id)
    const cmd = trackCommands.setChangeStatuses(CHANGE_STATUS.accepted, ids)
    cmd(editor.state, editor.view.dispatch)

    expect(editor.state.doc.textContent).toContain('Hello world')
    expect(getChangeSet(editor.state)!.changes.length).toBe(0)

    editor.destroy()
  })

  it('reject removes inserted text', () => {
    const editor = createEditor({ enabled: true, content: '<p>Hello</p>' })
    editor.commands.focus('end')
    editor.commands.insertContent(' world')

    const cs = getChangeSet(editor.state)!
    const ids = cs.changes.map(c => c.dataTracked.id)
    const cmd = trackCommands.setChangeStatuses(CHANGE_STATUS.rejected, ids)
    cmd(editor.state, editor.view.dispatch)

    expect(editor.state.doc.textContent).toBe('Hello')

    editor.destroy()
  })

  it('getChangeSet returns null when plugin is disabled', () => {
    const editor = createEditor({ enabled: false })
    expect(getChangeSet(editor.state)).toBeNull()
    editor.destroy()
  })

  it('setUserID command works', () => {
    const editor = createEditor({ enabled: true, content: '<p>Hello</p>' })

    const cmd = trackCommands.setUserID('new-user')
    cmd(editor.state, editor.view.dispatch)

    const pluginState = trackChangesPluginKey.getState(editor.state)!
    expect(pluginState.userID).toBe('new-user')

    editor.destroy()
  })

  it('persists tracked changes in JSON output', () => {
    const editor = createEditor({ enabled: true, content: '<p>Hello world</p>' })
    editor.commands.focus()
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.commands.deleteSelection()

    const json = editor.getJSON()
    // Should contain tracked_delete mark in the output
    const marks = json.content?.[0]?.content?.flatMap(
      (n: any) => n.marks?.map((m: any) => m.type) ?? []
    )
    expect(marks).toContain('tracked_delete')

    editor.destroy()
  })
})
