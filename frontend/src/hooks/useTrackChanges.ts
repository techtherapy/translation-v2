import { useState, useCallback } from 'react'
import { updateBookTranslation } from '../api/bookTranslations'

type DisplayMode = 'no-markup' | 'all-markup' | 'original'

export interface UseTrackChangesOptions {
  btId: string | undefined
  loadChapter: () => Promise<void>
}

export interface UseTrackChangesReturn {
  trackingEnabled: boolean
  displayMode: DisplayMode
  syncEnabled: (enabled: boolean) => void
  toggleTracking: () => Promise<void>
  cycleDisplayMode: () => void
  switchToMarkupIfOriginal: () => void
}

/**
 * Simplified track changes hook — manages toggle state and display mode only.
 * Accept/reject operations are handled by the @manuscripts/track-changes-plugin
 * via plugin commands dispatched from the editor.
 */
export function useTrackChanges({
  btId,
  loadChapter,
}: UseTrackChangesOptions): UseTrackChangesReturn {
  const [trackingEnabled, setTrackingEnabled] = useState(false)
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    const saved = localStorage.getItem('tc_display_mode')
    if (saved === 'no-markup' || saved === 'original') return saved
    return 'all-markup'
  })

  const syncEnabled = useCallback((enabled: boolean) => {
    setTrackingEnabled(enabled)
  }, [])

  const toggleTracking = useCallback(async () => {
    if (!btId) return
    const newVal = !trackingEnabled
    setTrackingEnabled(newVal)
    await updateBookTranslation(parseInt(btId), { track_changes: newVal })
    await loadChapter()
  }, [btId, trackingEnabled, loadChapter])

  const cycleDisplayMode = useCallback(() => {
    const order: DisplayMode[] = ['all-markup', 'no-markup', 'original']
    setDisplayMode((prev) => {
      const idx = order.indexOf(prev)
      const next = order[(idx + 1) % order.length]
      localStorage.setItem('tc_display_mode', next)
      return next
    })
  }, [])

  const switchToMarkupIfOriginal = useCallback(() => {
    setDisplayMode((prev) => {
      if (trackingEnabled && prev === 'original') {
        localStorage.setItem('tc_display_mode', 'all-markup')
        return 'all-markup'
      }
      return prev
    })
  }, [trackingEnabled])

  return {
    trackingEnabled,
    displayMode,
    syncEnabled,
    toggleTracking,
    cycleDisplayMode,
    switchToMarkupIfOriginal,
  }
}
