import React from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  title = 'Confirm',
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: Props) {
  const confirmColor = variant === 'danger'
    ? 'bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600'
    : variant === 'warning'
    ? 'bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500'
    : 'btn-primary'

  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-ink-950/50 flex items-center justify-center z-[60] animate-fade-in"
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="surface-glass shadow-surface-lg w-full max-w-sm p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          {variant !== 'default' && (
            <div className={`shrink-0 mt-0.5 ${variant === 'danger' ? 'text-red-500' : 'text-amber-500'}`}>
              <AlertTriangle className="w-5 h-5" />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-ink-850 dark:text-cream font-heading">{title}</h3>
            <p className="text-sm text-ink-700 dark:text-cream-dim font-body mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="btn-ghost text-sm">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${confirmColor}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
