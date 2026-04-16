/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        heading: ['"Crimson Pro"', 'Georgia', 'serif'],
        body: ['"Outfit"', 'sans-serif'],
        chinese: ['"Noto Serif SC"', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        ink: {
          950: '#0f0f14',
          900: '#151520',
          850: '#1a1a28',
          800: '#1e1e2d',
          750: '#252536',
          700: '#2a2a3d',
          600: '#2e2e3e',
          500: '#3a3a4d',
          400: '#4a4a60',
          300: '#6a6a80',
        },
        gold: {
          DEFAULT: '#d4a853',
          light: '#e8c468',
          dim: '#b8923f',
          muted: '#8a7040',
          faint: '#3d3520',
        },
        jade: {
          DEFAULT: '#2dd4bf',
          light: '#5eead4',
          dim: '#14b8a6',
          muted: '#0d9488',
          faint: '#1a3a36',
        },
        cream: {
          DEFAULT: '#f5f0e8',
          dim: '#d4cfc5',
          muted: '#a09b8c',
          dark: '#706b5e',
        },
        status: {
          success: '#4ade80',
          'success-bg': '#1a3d2a',
          warning: '#f59e0b',
          'warning-bg': '#3d3520',
          error: '#ef4444',
          'error-bg': '#3d1a1a',
          info: '#60a5fa',
          'info-bg': '#1a2a3d',
          purple: '#a78bfa',
          'purple-bg': '#2a1a3d',
        },
        parchment: {
          DEFAULT: '#f5f0e8',
          50: '#faf8f4',
          100: '#f5f0e8',
          200: '#ece5d8',
          300: '#ddd4c3',
          400: '#c4b9a5',
          500: '#a09b8c',
        },
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.5s ease-out forwards',
        'fade-in': 'fadeIn 0.4s ease-out forwards',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'subtle-lift': 'subtleLift 0.2s ease-out forwards',
        'highlight-pulse': 'highlightPulse 0.8s ease-out forwards',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(212, 168, 83, 0)' },
          '50%': { boxShadow: '0 0 16px 4px rgba(212, 168, 83, 0.15)' },
        },
        subtleLift: {
          '0%': { transform: 'translateY(0)', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' },
          '100%': { transform: 'translateY(-2px)', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' },
        },
        highlightPulse: {
          '0%': { boxShadow: '0 0 0 0 rgba(212, 168, 83, 0)' },
          '30%': { boxShadow: '0 0 8px 2px rgba(212, 168, 83, 0.5)' },
          '100%': { boxShadow: '0 0 4px 1px rgba(212, 168, 83, 0.25)' },
        },
      },
      boxShadow: {
        'gold-sm': '0 1px 3px rgba(212, 168, 83, 0.1)',
        'gold-md': '0 4px 12px rgba(212, 168, 83, 0.15)',
        'gold-lg': '0 8px 24px rgba(212, 168, 83, 0.2)',
        'surface': '0 1px 3px rgba(0, 0, 0, 0.3)',
        'surface-lg': '0 4px 16px rgba(0, 0, 0, 0.4)',
      },
      backgroundImage: {
        'ink-gradient': 'linear-gradient(135deg, #0f0f14 0%, #1a1a28 50%, #151520 100%)',
        'surface-gradient': 'linear-gradient(180deg, #1e1e2d 0%, #252536 100%)',
        'header-gradient': 'linear-gradient(90deg, #151520 0%, #1a1a28 50%, #151520 100%)',
      },
    },
  },
  plugins: [],
}
