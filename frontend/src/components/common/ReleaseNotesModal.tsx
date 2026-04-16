import React from 'react'
import { X, Sparkles } from 'lucide-react'
import releaseNotes from '../../data/releaseNotes'

interface Props {
  onClose: () => void
}

export default function ReleaseNotesModal({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/40 dark:bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="surface-glass shadow-surface-lg w-full max-w-lg max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-parchment-200 dark:border-ink-600/50">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gold" />
            <h2 className="text-lg font-semibold font-heading text-ink-850 dark:text-cream">
              What&rsquo;s New
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-parchment-400 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {releaseNotes.map((release, idx) => (
            <div key={release.version}>
              <div className="flex items-baseline gap-3 mb-2">
                <span className="text-sm font-semibold font-heading text-ink-850 dark:text-cream">
                  v{release.version}
                </span>
                <span className="text-xs text-parchment-400 dark:text-cream-muted/60">
                  {release.date}
                </span>
                {idx === 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium font-body bg-gold/15 text-gold border border-gold/30">
                    Latest
                  </span>
                )}
              </div>
              <ul className="space-y-1.5">
                {release.highlights.map((note, i) => (
                  <li
                    key={i}
                    className="text-sm text-ink-700 dark:text-cream-dim font-body flex gap-2"
                  >
                    <span className="text-gold mt-1 shrink-0">&bull;</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
              {idx < releaseNotes.length - 1 && (
                <div className="mt-4 border-b border-parchment-200 dark:border-ink-700/50" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
