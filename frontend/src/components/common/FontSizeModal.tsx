import { X, Type, RotateCcw } from 'lucide-react'
import { useFontSize, type FontSize } from '../../hooks/useFontSize'

const SIZES: { value: FontSize; label: string }[] = [
  { value: 14, label: 'Small' },
  { value: 16, label: 'Default' },
  { value: 18, label: 'Large' },
  { value: 20, label: 'Extra Large' },
]

export default function FontSizeModal({ onClose }: { onClose: () => void }) {
  const { fontSize, setFontSize } = useFontSize()
  const index = SIZES.findIndex((s) => s.value === fontSize)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative surface-glass shadow-surface-lg w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink-850 dark:text-cream font-heading flex items-center gap-2">
            <Type className="w-5 h-5 text-gold" />
            Font Size
          </h3>
          <button onClick={onClose} className="p-1 text-parchment-400 hover:text-ink-850 dark:hover:text-cream">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <input
            type="range"
            min={0}
            max={3}
            step={1}
            value={index}
            onChange={(e) => setFontSize(SIZES[parseInt(e.target.value, 10)].value)}
            className="w-full accent-gold cursor-pointer"
          />
          <div className="flex justify-between text-xs text-parchment-500 dark:text-cream-muted">
            {SIZES.map((s) => (
              <span
                key={s.value}
                className={s.value === fontSize ? 'text-gold font-semibold' : ''}
              >
                {s.label}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-parchment-300 dark:border-ink-600/50 p-4">
          <p
            className="text-ink-850 dark:text-cream leading-relaxed"
            style={{ fontSize: `${fontSize}px` }}
          >
            The quick brown fox jumps over the lazy dog.
          </p>
          <p className="text-xs text-parchment-400 dark:text-cream-muted mt-2">
            {fontSize}px — {SIZES[index].label}
          </p>
        </div>

        {fontSize !== 16 && (
          <button
            onClick={() => setFontSize(16)}
            className="text-sm text-parchment-500 dark:text-cream-muted hover:text-gold transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to Default
          </button>
        )}
      </div>
    </div>
  )
}
