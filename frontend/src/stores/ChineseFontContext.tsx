import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getPublicSettings } from '../api/settings'
import { useAuth } from './AuthContext'

export type ChineseFont = 'noto-serif-sc' | 'noto-sans-sc' | 'lxgw-wenkai'

const FONT_FAMILY_MAP: Record<ChineseFont, string> = {
  'noto-serif-sc': '"Noto Serif SC", serif',
  'noto-sans-sc': '"Noto Sans SC", sans-serif',
  'lxgw-wenkai': '"LXGW WenKai", cursive',
}

interface ChineseFontContextType {
  font: ChineseFont
  setFont: (font: ChineseFont) => void
}

const ChineseFontContext = createContext<ChineseFontContextType>({
  font: 'noto-serif-sc',
  setFont: () => {},
})

function applyFontToDOM(font: ChineseFont) {
  document.documentElement.style.setProperty(
    '--font-chinese',
    FONT_FAMILY_MAP[font],
  )
}

export function ChineseFontProvider({ children }: { children: React.ReactNode }) {
  const [font, setFontState] = useState<ChineseFont>('noto-serif-sc')
  const { isLoggedIn } = useAuth()

  useEffect(() => {
    if (!isLoggedIn) return
    getPublicSettings()
      .then((settings) => {
        const s = settings.find((s) => s.key === 'CHINESE_FONT')
        if (s?.value && s.value in FONT_FAMILY_MAP) {
          setFontState(s.value as ChineseFont)
          applyFontToDOM(s.value as ChineseFont)
        }
      })
      .catch(() => {})
  }, [isLoggedIn])

  const setFont = useCallback((newFont: ChineseFont) => {
    setFontState(newFont)
    applyFontToDOM(newFont)
  }, [])

  return (
    <ChineseFontContext.Provider value={{ font, setFont }}>
      {children}
    </ChineseFontContext.Provider>
  )
}

export function useChineseFont() {
  return useContext(ChineseFontContext)
}
