import { useState, useCallback, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  TrackChangesExtension,
  TrackedInsert,
  TrackedDelete,
  trackChangesPluginKey,
  trackCommands,
  TrackChangesStatus,
} from './TrackChangesExtension'
import type { ChangeSet } from './TrackChangesExtension'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Translation, SegmentComment } from '../../types'

const commentHighlightKey = new PluginKey('commentHighlights')

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface SegmentEditorHandle {
  save: () => void
  getText: () => string
  hasUnsavedChanges: () => boolean
  clearUnsavedChanges: () => void
  getEditor: () => ReturnType<typeof useEditor> | null
  getSaveStatus: () => SaveStatus
}

export interface EditorSelectionInfo {
  text: string
  from: number
  to: number
  rect: { left: number; top: number; width: number; height: number }
}

interface Props {
  translation: Translation
  onSave: (text: string, format?: 'plain' | 'prosemirror') => Promise<void> | void
  autoSave?: boolean
  autoSaveDelay?: number
  trackingEnabled?: boolean
  currentUserId?: number
  onSaveStatusChange?: (status: SaveStatus) => void
  onSelectionChange?: (selection: EditorSelectionInfo | null) => void
  onChangeSetUpdate?: (changeSet: ChangeSet | null) => void
  comments?: SegmentComment[]
}

/**
 * Parse initial content for the editor.
 * For 'prosemirror' format, parse JSON. For 'plain', wrap in paragraph tags.
 */
function parseInitialContent(translation: Translation): string | Record<string, unknown> {
  const text = translation.translated_text
  if (!text) return ''

  if (translation.content_format === 'prosemirror') {
    try {
      return JSON.parse(text)
    } catch {
      console.warn('[SegmentEditor] content_format is prosemirror but JSON parse failed')
      return ''
    }
  }

  return `<p>${text.replace(/\n/g, '</p><p>')}</p>`
}

const SegmentEditor = forwardRef<SegmentEditorHandle, Props>(
  function SegmentEditor({
    translation,
    onSave,
    autoSave = true,
    autoSaveDelay = 2000,
    trackingEnabled,
    currentUserId,
    onSaveStatusChange,
    onSelectionChange,
    onChangeSetUpdate,
    comments: segComments,
  }, ref) {
    const [hasChanges, setHasChanges] = useState(false)
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>()
    const savedTimer = useRef<ReturnType<typeof setTimeout>>()
    const latestTextRef = useRef<string>(translation.translated_text || '')
    const latestFormatRef = useRef<'plain' | 'prosemirror'>(
      translation.content_format === 'prosemirror' ? 'prosemirror' : 'plain'
    )
    const onSaveRef = useRef(onSave)
    onSaveRef.current = onSave
    const hasChangesRef = useRef(false)
    hasChangesRef.current = hasChanges
    const onChangeSetUpdateRef = useRef(onChangeSetUpdate)
    onChangeSetUpdateRef.current = onChangeSetUpdate

    // Memoize extensions — Extension.configure() creates new instances, so without
    // memoization, useEditor would destroy/recreate the editor on every render.
    const extensions = useMemo(() => [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: 'Enter translation...',
      }),
      TrackedInsert,
      TrackedDelete,
      // Always include the plugin — toggling is done via commands in useEffect
      TrackChangesExtension.configure({
        enabled: true,
        userID: String(currentUserId || 0),
      }),
      // Comment highlight decorations
      {
        name: 'commentHighlights',
        addProseMirrorPlugins: () => [
          new Plugin<{ comments: SegmentComment[]; decorations: DecorationSet }>({
            key: commentHighlightKey,
            state: {
              init() {
                return { comments: [], decorations: DecorationSet.empty }
              },
              apply(tr, prev, _oldState, newState) {
                const newComments = tr.getMeta(commentHighlightKey)
                const comments = newComments !== undefined ? newComments as SegmentComment[] : prev.comments
                if (!tr.docChanged && newComments === undefined) return prev
                // Build decorations from comments
                const decos: Decoration[] = []
                const docText = newState.doc.textBetween(0, newState.doc.content.size, '\n')
                for (const c of comments) {
                  if (!c.quoted_text || c.is_resolved) continue
                  const idx = docText.indexOf(c.quoted_text)
                  if (idx === -1) continue
                  // Map text offset to doc position
                  let textCursor = 0
                  let fromPos: number | null = null
                  let toPos: number | null = null
                  newState.doc.descendants((node, pos) => {
                    if (fromPos !== null && toPos !== null) return false
                    if (node.isText) {
                      const nodeEnd = textCursor + node.nodeSize
                      if (fromPos === null && idx >= textCursor && idx < nodeEnd) {
                        fromPos = pos + (idx - textCursor)
                      }
                      const endIdx = idx + c.quoted_text!.length
                      if (toPos === null && endIdx > textCursor && endIdx <= nodeEnd) {
                        toPos = pos + (endIdx - textCursor)
                      }
                      textCursor = nodeEnd
                    } else if (node.isBlock && textCursor > 0) {
                      textCursor++ // newline between blocks
                    }
                    return true
                  })
                  if (fromPos !== null && toPos !== null && fromPos < toPos) {
                    decos.push(Decoration.inline(fromPos, toPos, {
                      class: 'bg-amber-100/60 dark:bg-amber-900/20 border-b-2 border-amber-400 dark:border-amber-600/60 rounded-sm',
                      'data-comment-id': String(c.id),
                    }))
                  }
                }
                return { comments, decorations: DecorationSet.create(newState.doc, decos) }
              },
            },
            props: {
              decorations(state) {
                return this.getState(state)?.decorations ?? DecorationSet.empty
              },
            },
          }),
        ],
      } as any,
    // Only recreate when user changes (not on tracking toggle — that's handled via commands)
    ], [currentUserId])

    const initialContent = useMemo(() => parseInitialContent(translation), [translation.id, translation.content_format])

    const editor = useEditor({
      extensions,
      content: initialContent,
      onSelectionUpdate: ({ editor: ed }) => {
        const { from, to } = ed.state.selection
        if (from === to) {
          onSelectionChange?.(null)
          return
        }
        const text = ed.state.doc.textBetween(from, to)
        if (!text.trim()) {
          onSelectionChange?.(null)
          return
        }
        // Get DOM coordinates of the selection
        const view = ed.view
        const startCoords = view.coordsAtPos(from)
        const endCoords = view.coordsAtPos(to)
        onSelectionChange?.({
          text: text.trim(),
          from,
          to,
          rect: {
            left: Math.min(startCoords.left, endCoords.left),
            top: startCoords.top,
            width: Math.abs(endCoords.right - startCoords.left),
            height: endCoords.bottom - startCoords.top,
          },
        })
      },
      onTransaction: ({ editor: ed }) => {
        // Push ChangeSet snapshots to parent for margin rendering
        if (!trackingEnabled) return
        const tcState = trackChangesPluginKey.getState(ed.state)
        onChangeSetUpdateRef.current?.(tcState?.changeSet ?? null)
      },
      onUpdate: ({ editor: ed }) => {
        setHasChanges(true)
        setSaveStatus('idle')

        // Determine format based on tracking state
        const tcState = trackChangesPluginKey.getState(ed.state)
        const isTracking = tcState?.status === TrackChangesStatus.enabled
        latestTextRef.current = isTracking
          ? JSON.stringify(ed.getJSON())
          : ed.getText({ blockSeparator: '\n' })
        latestFormatRef.current = isTracking ? 'prosemirror' : 'plain'

        // Reset auto-save timer on each keystroke
        if (autoSave) {
          clearTimeout(autoSaveTimer.current)
          autoSaveTimer.current = setTimeout(() => {
            doSave()
          }, autoSaveDelay)
        }
      },
      editorProps: {
        attributes: {
          class: 'outline-none text-ink-700 dark:text-cream-dim',
        },
        handleKeyDown: (_view, event) => {
          // Ctrl+S saves immediately
          if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault()
            doSave()
            return true
          }
          return false
        },
      },
    })

    const doSave = useCallback(async () => {
      clearTimeout(autoSaveTimer.current)
      try {
        await onSaveRef.current(latestTextRef.current, latestFormatRef.current)
        setHasChanges(false)
        hasChangesRef.current = false
        setSaveStatus('saved')
      } catch {
        setSaveStatus('error')
        clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSaveStatus('idle'), 4000)
      }
    }, []) // stable — reads onSave via ref

    // Expose imperative methods
    useImperativeHandle(ref, () => ({
      save: () => {
        if (editor && hasChanges) doSave()
      },
      getText: () => editor?.getText({ blockSeparator: '\n' }) || '',
      hasUnsavedChanges: () => hasChanges,
      clearUnsavedChanges: () => {
        setHasChanges(false)
        hasChangesRef.current = false
      },
      getEditor: () => editor,
      getSaveStatus: () => saveStatus,
    }), [editor, hasChanges, doSave, saveStatus])

    // Notify parent of save status changes
    useEffect(() => {
      onSaveStatusChange?.(saveStatus)
    }, [saveStatus, onSaveStatusChange])

    // Toggle tracking status via plugin commands (not editor recreation)
    useEffect(() => {
      if (!editor) return
      const targetStatus = trackingEnabled ? TrackChangesStatus.enabled : TrackChangesStatus.disabled
      const cmd = trackCommands.setTrackingStatus(targetStatus)
      cmd(editor.state, editor.view.dispatch)
    }, [editor, trackingEnabled])

    // Update user ID in the tracking plugin when it changes
    useEffect(() => {
      if (!editor || !currentUserId) return
      const cmd = trackCommands.setUserID(String(currentUserId))
      cmd(editor.state, editor.view.dispatch)
    }, [editor, currentUserId])

    // Update comment highlight decorations when comments change
    useEffect(() => {
      if (!editor) return
      const tr = editor.state.tr.setMeta(commentHighlightKey, segComments || [])
      editor.view.dispatch(tr)
    }, [editor, segComments])

    // Cleanup timers
    useEffect(() => {
      return () => {
        clearTimeout(autoSaveTimer.current)
        clearTimeout(savedTimer.current)
      }
    }, [])

    // Save on unmount if there are unsaved changes
    useEffect(() => {
      return () => {
        if (hasChangesRef.current && latestTextRef.current) {
          onSaveRef.current(latestTextRef.current, latestFormatRef.current)
        }
      }
    }, []) // intentionally empty deps — we read refs

    return (
      <div className="relative tc-edit-indicator">
        <EditorContent editor={editor} />
      </div>
    )
  },
)

export default SegmentEditor
