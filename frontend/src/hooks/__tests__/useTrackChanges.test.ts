// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTrackChanges } from '../useTrackChanges'

vi.mock('../../api/bookTranslations', () => ({
  updateBookTranslation: vi.fn().mockResolvedValue({}),
}))

// localStorage stub for Node.js 25 compatibility
const localStorageStore: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value },
  removeItem: (key: string) => { delete localStorageStore[key] },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]) },
  get length() { return Object.keys(localStorageStore).length },
  key: (index: number) => Object.keys(localStorageStore)[index] ?? null,
}
vi.stubGlobal('localStorage', localStorageMock)

import { updateBookTranslation } from '../../api/bookTranslations'

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    btId: '42',
    loadChapter: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('useTrackChanges', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorageMock.clear()
  })

  describe('initial state', () => {
    it('starts with trackingEnabled = false', () => {
      const { result } = renderHook(() => useTrackChanges(makeOptions()))
      expect(result.current.trackingEnabled).toBe(false)
    })

    it('defaults displayMode to all-markup when no localStorage value', () => {
      const { result } = renderHook(() => useTrackChanges(makeOptions()))
      expect(result.current.displayMode).toBe('all-markup')
    })

    it('reads displayMode from localStorage on init — no-markup', () => {
      localStorage.setItem('tc_display_mode', 'no-markup')
      const { result } = renderHook(() => useTrackChanges(makeOptions()))
      expect(result.current.displayMode).toBe('no-markup')
    })

    it('reads displayMode from localStorage on init — original', () => {
      localStorage.setItem('tc_display_mode', 'original')
      const { result } = renderHook(() => useTrackChanges(makeOptions()))
      expect(result.current.displayMode).toBe('original')
    })

    it('falls back to all-markup for unrecognised localStorage value', () => {
      localStorage.setItem('tc_display_mode', 'bogus')
      const { result } = renderHook(() => useTrackChanges(makeOptions()))
      expect(result.current.displayMode).toBe('all-markup')
    })
  })

  describe('syncEnabled', () => {
    it('sets trackingEnabled to the provided value', () => {
      const { result } = renderHook(() => useTrackChanges(makeOptions()))
      act(() => result.current.syncEnabled(true))
      expect(result.current.trackingEnabled).toBe(true)

      act(() => result.current.syncEnabled(false))
      expect(result.current.trackingEnabled).toBe(false)
    })
  })

  describe('toggleTracking', () => {
    it('flips trackingEnabled and calls updateBookTranslation', async () => {
      const options = makeOptions()
      const { result } = renderHook(() => useTrackChanges(options))

      await act(async () => { await result.current.toggleTracking() })

      expect(result.current.trackingEnabled).toBe(true)
      expect(updateBookTranslation).toHaveBeenCalledWith(42, { track_changes: true })
      expect(options.loadChapter).toHaveBeenCalled()
    })

    it('toggles back to false on second call', async () => {
      const options = makeOptions()
      const { result } = renderHook(() => useTrackChanges(options))

      await act(async () => { await result.current.toggleTracking() })
      await act(async () => { await result.current.toggleTracking() })

      expect(result.current.trackingEnabled).toBe(false)
      expect(updateBookTranslation).toHaveBeenLastCalledWith(42, { track_changes: false })
    })

    it('does nothing if btId is undefined', async () => {
      const options = makeOptions({ btId: undefined })
      const { result } = renderHook(() => useTrackChanges(options))

      await act(async () => { await result.current.toggleTracking() })

      expect(updateBookTranslation).not.toHaveBeenCalled()
      expect(result.current.trackingEnabled).toBe(false)
    })
  })

  describe('cycleDisplayMode', () => {
    it('cycles all-markup -> no-markup -> original -> all-markup', () => {
      const { result } = renderHook(() => useTrackChanges(makeOptions()))

      expect(result.current.displayMode).toBe('all-markup')

      act(() => result.current.cycleDisplayMode())
      expect(result.current.displayMode).toBe('no-markup')
      expect(localStorage.getItem('tc_display_mode')).toBe('no-markup')

      act(() => result.current.cycleDisplayMode())
      expect(result.current.displayMode).toBe('original')
      expect(localStorage.getItem('tc_display_mode')).toBe('original')

      act(() => result.current.cycleDisplayMode())
      expect(result.current.displayMode).toBe('all-markup')
      expect(localStorage.getItem('tc_display_mode')).toBe('all-markup')
    })
  })

  describe('switchToMarkupIfOriginal', () => {
    it('switches original to all-markup when tracking is enabled', () => {
      localStorage.setItem('tc_display_mode', 'original')
      const { result } = renderHook(() => useTrackChanges(makeOptions()))

      act(() => result.current.syncEnabled(true))
      act(() => result.current.switchToMarkupIfOriginal())

      expect(result.current.displayMode).toBe('all-markup')
      expect(localStorage.getItem('tc_display_mode')).toBe('all-markup')
    })

    it('does not switch when display mode is not original', () => {
      const { result } = renderHook(() => useTrackChanges(makeOptions()))

      act(() => result.current.syncEnabled(true))
      act(() => result.current.switchToMarkupIfOriginal())

      expect(result.current.displayMode).toBe('all-markup')
    })

    it('does not switch when tracking is disabled', () => {
      localStorage.setItem('tc_display_mode', 'original')
      const { result } = renderHook(() => useTrackChanges(makeOptions()))

      act(() => result.current.switchToMarkupIfOriginal())

      expect(result.current.displayMode).toBe('original')
    })
  })
})
