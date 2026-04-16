/**
 * Tests for SegmentEditor's save flow — specifically the ref-based pattern
 * that ensures auto-save and unmount-save always use the LATEST onSave callback.
 *
 * These tests don't mount the full TipTap editor (jsdom limitations).
 * Instead they verify the ref/closure mechanics that caused real production bugs:
 *
 * Bug 1: unmount save captured onSave from first render (stale trackingEnabled)
 * Bug 2: setTimeout in onUpdate captured doSave from timer-set time (stale closure)
 *
 * The fix: doSave reads onSaveRef.current (always current), and unmount cleanup
 * reads onSaveRef.current + hasChangesRef.current instead of closure values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('SegmentEditor save flow (ref pattern)', () => {
  /**
   * Simulate the ref-based save pattern from SegmentEditor.
   * This mirrors the actual code structure to verify the pattern works.
   */
  function createSaveRefs() {
    // These mirror the refs in SegmentEditor
    const onSaveRef = { current: vi.fn() }
    const hasChangesRef = { current: false }
    const latestTextRef = { current: '' }
    const autoSaveTimer = { current: null as ReturnType<typeof setTimeout> | null }

    // doSave reads from ref, not closure — mirrors useCallback([], [])
    const doSave = async (text: string) => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
      await onSaveRef.current(text)
      hasChangesRef.current = false
    }

    // Unmount cleanup reads from refs — mirrors useEffect cleanup
    const unmountCleanup = () => {
      if (hasChangesRef.current && latestTextRef.current) {
        onSaveRef.current(latestTextRef.current)
      }
    }

    // Simulates typing → sets auto-save timer (like onUpdate's setTimeout)
    const simulateType = (text: string, delay = 2000) => {
      hasChangesRef.current = true
      latestTextRef.current = text
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
      autoSaveTimer.current = setTimeout(() => doSave(text), delay)
    }

    return { onSaveRef, hasChangesRef, latestTextRef, autoSaveTimer, doSave, unmountCleanup, simulateType }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('doSave calls the LATEST onSave via ref, not a stale closure', async () => {
    const refs = createSaveRefs()

    const oldSave = vi.fn()
    const newSave = vi.fn()

    // Initially onSave is oldSave
    refs.onSaveRef.current = oldSave

    // User types — timer captures doSave
    refs.simulateType('hello', 2000)

    // onSave changes (e.g., trackingEnabled flipped)
    refs.onSaveRef.current = newSave

    // Timer fires — should call NEW save, not old
    vi.advanceTimersByTime(2000)
    await vi.runAllTimersAsync()

    expect(oldSave).not.toHaveBeenCalled()
    expect(newSave).toHaveBeenCalledWith('hello')
  })

  it('unmount cleanup calls the LATEST onSave via ref', () => {
    const refs = createSaveRefs()

    const oldSave = vi.fn()
    const newSave = vi.fn()

    // Initially onSave is oldSave
    refs.onSaveRef.current = oldSave
    refs.hasChangesRef.current = true
    refs.latestTextRef.current = 'unsaved text'

    // onSave changes
    refs.onSaveRef.current = newSave

    // Component unmounts
    refs.unmountCleanup()

    expect(oldSave).not.toHaveBeenCalled()
    expect(newSave).toHaveBeenCalledWith('unsaved text')
  })

  it('unmount cleanup does NOT save when hasChanges is false', () => {
    const refs = createSaveRefs()
    const save = vi.fn()
    refs.onSaveRef.current = save
    refs.hasChangesRef.current = false
    refs.latestTextRef.current = 'some text'

    refs.unmountCleanup()

    expect(save).not.toHaveBeenCalled()
  })

  it('unmount cleanup does NOT save when latestText is empty', () => {
    const refs = createSaveRefs()
    const save = vi.fn()
    refs.onSaveRef.current = save
    refs.hasChangesRef.current = true
    refs.latestTextRef.current = ''

    refs.unmountCleanup()

    expect(save).not.toHaveBeenCalled()
  })

  it('auto-save resets hasChanges after successful save', async () => {
    const refs = createSaveRefs()
    refs.onSaveRef.current = vi.fn().mockResolvedValue(undefined)

    refs.simulateType('text', 2000)
    expect(refs.hasChangesRef.current).toBe(true)

    vi.advanceTimersByTime(2000)
    await vi.runAllTimersAsync()

    expect(refs.hasChangesRef.current).toBe(false)
  })

  it('rapid typing resets the auto-save timer (debounce)', async () => {
    const refs = createSaveRefs()
    const save = vi.fn().mockResolvedValue(undefined)
    refs.onSaveRef.current = save

    // Type several characters rapidly
    refs.simulateType('h', 2000)
    vi.advanceTimersByTime(500)
    refs.simulateType('he', 2000)
    vi.advanceTimersByTime(500)
    refs.simulateType('hel', 2000)
    vi.advanceTimersByTime(500)

    // Only 1500ms since last keystroke — save should NOT have fired
    expect(save).not.toHaveBeenCalled()

    // Advance to 2000ms after last keystroke
    vi.advanceTimersByTime(1500)
    await vi.runAllTimersAsync()

    // Should save with the latest text
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('hel')
  })

  it('onSave can change multiple times before timer fires — always uses latest', async () => {
    const refs = createSaveRefs()

    const save1 = vi.fn()
    const save2 = vi.fn()
    const save3 = vi.fn().mockResolvedValue(undefined)

    refs.onSaveRef.current = save1
    refs.simulateType('text', 2000)

    // onSave changes twice before timer fires
    vi.advanceTimersByTime(500)
    refs.onSaveRef.current = save2
    vi.advanceTimersByTime(500)
    refs.onSaveRef.current = save3

    vi.advanceTimersByTime(1000)
    await vi.runAllTimersAsync()

    expect(save1).not.toHaveBeenCalled()
    expect(save2).not.toHaveBeenCalled()
    expect(save3).toHaveBeenCalledWith('text')
  })
})
