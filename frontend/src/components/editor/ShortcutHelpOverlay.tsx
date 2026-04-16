import React from 'react'
import { X, Keyboard } from 'lucide-react'

interface Props {
  onClose: () => void
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
const mod = isMac ? '⌘' : 'Ctrl'

const shortcuts = [
  { section: 'Editing', items: [
    { keys: `${mod}+S`, description: 'Save current segment' },
    { keys: `${mod}+Enter`, description: 'AI translate segment' },
    { keys: `${mod}+Shift+Enter`, description: 'Save and advance to next' },
  ]},
  { section: 'Navigation', items: [
    { keys: `${mod}+↓ / Tab`, description: 'Next segment' },
    { keys: `${mod}+↑ / Shift+Tab`, description: 'Previous segment' },
    { keys: 'Enter', description: 'Edit selected segment' },
    { keys: 'Escape', description: 'Exit edit / deselect / close' },
  ]},
  { section: 'Status', items: [
    { keys: `${mod}+1`, description: 'Set Draft' },
    { keys: `${mod}+2`, description: 'Set Under Review' },
    { keys: `${mod}+3`, description: 'Set Approved' },
    { keys: `${mod}+4`, description: 'Set Needs Revision' },
  ]},
  { section: 'Tools', items: [
    { keys: `${mod}+F`, description: 'Find in segments' },
    { keys: `${mod}+H`, description: 'Find and replace' },
    { keys: '?', description: 'Show this help' },
  ]},
]

export default function ShortcutHelpOverlay({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-ink-850 rounded-lg shadow-2xl w-full max-w-lg border border-parchment-200 dark:border-ink-600/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-parchment-200 dark:border-ink-700/50">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-850 dark:text-cream font-body">
            <Keyboard className="w-4 h-4 text-gold" />
            Keyboard Shortcuts
          </div>
          <button onClick={onClose} className="text-parchment-400 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {shortcuts.map((group) => (
            <div key={group.section}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-parchment-500 dark:text-cream-muted mb-2 font-body">
                {group.section}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div key={item.keys} className="flex items-center justify-between py-1">
                    <span className="text-sm text-ink-700 dark:text-cream-dim font-body">{item.description}</span>
                    <kbd className="px-2 py-0.5 text-xs font-mono bg-parchment-100 dark:bg-ink-700 text-parchment-600 dark:text-cream-muted rounded border border-parchment-200 dark:border-ink-600/50">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
