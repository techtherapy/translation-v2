import { useEffect, useCallback } from 'react'

export interface EditorShortcutActions {
  onSave?: () => void
  onTranslate?: () => void
  onNextSegment?: () => void
  onPrevSegment?: () => void
  onSaveAndAdvance?: () => void
  onActivateSegment?: () => void
  onDeselect?: () => void
  onToggleHelp?: () => void
  onSetStatus?: (status: string) => void
  onFind?: () => void
  onFindReplace?: () => void
  enabled?: boolean
}

const STATUS_MAP: Record<string, string> = {
  '1': 'draft',
  '2': 'under_review',
  '3': 'approved',
  '4': 'needs_revision',
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea') return true
  if (target.isContentEditable) return true
  if (target.closest('.ProseMirror') || target.closest('.tiptap')) return true
  return false
}

export function useEditorShortcuts(actions: EditorShortcutActions) {
  const {
    onSave,
    onTranslate,
    onNextSegment,
    onPrevSegment,
    onSaveAndAdvance,
    onActivateSegment,
    onDeselect,
    onToggleHelp,
    onSetStatus,
    onFind,
    onFindReplace,
    enabled = true,
  } = actions

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return

      const mod = e.metaKey || e.ctrlKey
      const editable = isEditableTarget(e.target)

      // Ctrl+Shift+Enter → onSaveAndAdvance (check before Ctrl+Enter)
      if (mod && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        onSaveAndAdvance?.()
        return
      }

      // Ctrl+S / Cmd+S → onSave
      if (mod && e.key === 's') {
        e.preventDefault()
        onSave?.()
        return
      }

      // Ctrl+Enter → onTranslate
      if (mod && !e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        onTranslate?.()
        return
      }

      // Ctrl+ArrowDown → onNextSegment
      if (mod && e.key === 'ArrowDown') {
        e.preventDefault()
        onNextSegment?.()
        return
      }

      // Ctrl+ArrowUp → onPrevSegment
      if (mod && e.key === 'ArrowUp') {
        e.preventDefault()
        onPrevSegment?.()
        return
      }

      // Tab → onNextSegment (only when not in editable)
      if (e.key === 'Tab' && !e.shiftKey && !mod && !editable) {
        e.preventDefault()
        onNextSegment?.()
        return
      }

      // Shift+Tab → onPrevSegment (only when not in editable)
      if (e.key === 'Tab' && e.shiftKey && !mod && !editable) {
        e.preventDefault()
        onPrevSegment?.()
        return
      }

      // Ctrl+1 through Ctrl+4 → onSetStatus
      if (mod && STATUS_MAP[e.key]) {
        e.preventDefault()
        onSetStatus?.(STATUS_MAP[e.key])
        return
      }

      // Ctrl+H / Cmd+H → onFindReplace (check before Ctrl+F)
      if (mod && e.key === 'h') {
        e.preventDefault()
        onFindReplace?.()
        return
      }

      // Ctrl+F / Cmd+F → onFind
      if (mod && e.key === 'f') {
        e.preventDefault()
        onFind?.()
        return
      }

      // Enter → onActivateSegment (only when no editable is focused)
      if (e.key === 'Enter' && !mod && !e.shiftKey && !editable) {
        e.preventDefault()
        onActivateSegment?.()
        return
      }

      // Escape → onDeselect
      if (e.key === 'Escape') {
        onDeselect?.()
        return
      }

      // ? → onToggleHelp (only when not typing in input)
      if (e.key === '?' && !mod && !editable) {
        onToggleHelp?.()
        return
      }
    },
    [
      enabled,
      onSave,
      onTranslate,
      onNextSegment,
      onPrevSegment,
      onSaveAndAdvance,
      onActivateSegment,
      onDeselect,
      onToggleHelp,
      onSetStatus,
      onFind,
      onFindReplace,
    ]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}
