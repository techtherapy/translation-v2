import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { EditorProvider, useEditorContext } from '../EditorContext'
import React from 'react'

describe('EditorContext', () => {
  it('throws when used outside provider', () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => {
      renderHook(() => useEditorContext())
    }).toThrow('useEditorContext must be used within EditorProvider')
    spy.mockRestore()
  })

  it('provides values when inside provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EditorProvider
        selectedLanguageId={1}
        currentUserId={42}
        trackingEnabled={true}
        displayMode="all-markup"
        sourceFont="font-chinese"
        hasPermission={() => true}
        highlightedCommentId={null}
        setHighlightedCommentId={() => {}}
        userMap={{}}
      >
        {children}
      </EditorProvider>
    )
    const { result } = renderHook(() => useEditorContext(), { wrapper })
    expect(result.current.selectedLanguageId).toBe(1)
    expect(result.current.currentUserId).toBe(42)
    expect(result.current.trackingEnabled).toBe(true)
    expect(result.current.displayMode).toBe('all-markup')
    expect(result.current.sourceFont).toBe('font-chinese')
    expect(result.current.highlightedCommentId).toBeNull()
  })
})
