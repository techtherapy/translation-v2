import { createContext, useContext } from 'react'
import React from 'react'

type DisplayMode = 'no-markup' | 'all-markup' | 'original'

interface EditorContextValue {
  selectedLanguageId: number
  currentUserId: number
  trackingEnabled: boolean
  displayMode: DisplayMode
  sourceFont: string
  hasPermission: (permission: string) => boolean
  highlightedCommentId: number | null
  setHighlightedCommentId: (id: number | null) => void
  userMap: Record<string, string>  // string user ID → display name
}

const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error('useEditorContext must be used within EditorProvider')
  return ctx
}

interface EditorProviderProps extends EditorContextValue {
  children: React.ReactNode
}

export function EditorProvider({ children, ...value }: EditorProviderProps) {
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}
