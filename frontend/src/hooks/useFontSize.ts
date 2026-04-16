import { useState, useEffect } from 'react'

export type FontSize = 14 | 16 | 18 | 20

function applyFontSize(size: FontSize) {
  if (size === 16) {
    document.documentElement.style.removeProperty('font-size')
  } else {
    document.documentElement.style.fontSize = `${size}px`
  }
}

export function useFontSize() {
  const [fontSize, setFontSizeState] = useState<FontSize>(() => {
    const stored = localStorage.getItem('fontSize')
    return (stored ? parseInt(stored, 10) : 16) as FontSize
  })

  useEffect(() => {
    applyFontSize(fontSize)
    if (fontSize === 16) {
      localStorage.removeItem('fontSize')
    } else {
      localStorage.setItem('fontSize', String(fontSize))
    }
  }, [fontSize])

  return { fontSize, setFontSize: setFontSizeState }
}
