import React from 'react'

interface Props {
  className?: string
}

export default function LotusIcon({ className = 'w-6 h-6' }: Props) {
  return (
    <svg viewBox="0 0 200 110" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* 8-petal lotus — 4 symmetric pairs, no center petal */}

      {/* Inner pair */}
      <path d="M90 14 C86 38, 88 58, 100 90 C94 58, 90 38, 90 14Z" fill="currentColor" opacity="0.9"/>
      <path d="M110 14 C114 38, 112 58, 100 90 C106 58, 110 38, 110 14Z" fill="currentColor" opacity="0.9"/>

      {/* Inner-mid pair */}
      <path d="M68 26 C62 48, 68 66, 98 92 C80 66, 70 48, 68 26Z" fill="currentColor" opacity="0.72"/>
      <path d="M132 26 C138 48, 132 66, 102 92 C120 66, 130 48, 132 26Z" fill="currentColor" opacity="0.72"/>

      {/* Outer-mid pair */}
      <path d="M48 42 C38 58, 46 74, 96 94 C62 76, 48 60, 48 42Z" fill="currentColor" opacity="0.5"/>
      <path d="M152 42 C162 58, 154 74, 104 94 C138 76, 152 60, 152 42Z" fill="currentColor" opacity="0.5"/>

      {/* Outermost pair */}
      <path d="M30 56 C20 70, 30 82, 94 98 C52 82, 32 70, 30 56Z" fill="currentColor" opacity="0.32"/>
      <path d="M170 56 C180 70, 170 82, 106 98 C148 82, 168 70, 170 56Z" fill="currentColor" opacity="0.32"/>
    </svg>
  )
}
