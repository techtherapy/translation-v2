import React, { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BookOpen, Languages, Database, LogOut, Settings, Moon, Sun, KeyRound, Type, ChevronDown, Sparkles } from 'lucide-react'
import { useAuth } from '../../stores/AuthContext'
import { useTheme } from '../../hooks/useTheme'
import ChangePasswordModal from './ChangePasswordModal'
import FontSizeModal from './FontSizeModal'
import ReleaseNotesModal from './ReleaseNotesModal'
import { latestVersion } from '../../data/releaseNotes'

const SEEN_VERSION_KEY = 'release_notes_seen_version'

const navItems = [
  { path: '/books', label: 'Library', icon: BookOpen },
  { path: '/glossary', label: 'Glossary', icon: Languages },
  { path: '/tm', label: 'Translation Memory', icon: Database },
  { path: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const { isDark, toggle } = useTheme()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showFontSizeModal, setShowFontSizeModal] = useState(false)
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)
  const [hasUnread, setHasUnread] = useState(() => {
    return localStorage.getItem(SEEN_VERSION_KEY) !== latestVersion
  })
  const menuRef = useRef<HTMLDivElement>(null)

  function openReleaseNotes() {
    setShowReleaseNotes(true)
    localStorage.setItem(SEEN_VERSION_KEY, latestVersion)
    setHasUnread(false)
  }

  const visibleNav = navItems.filter(
    (item) => !item.adminOnly || user?.role === 'admin',
  )

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserMenu])

  return (
    <div className="min-h-screen flex flex-col font-body">
      <header className="bg-parchment-50 dark:bg-ink-900/95 dark:backdrop-blur-sm border-b border-parchment-300 dark:border-ink-600/50 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/books" className="flex items-center gap-2 text-lg font-semibold text-ink-850 dark:text-cream font-heading">
            <img src="/logo.svg" alt="BITS" className="w-8 h-8" />
            BITS
          </Link>
          <nav className="flex items-center gap-1">
            {visibleNav.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                className={location.pathname.startsWith(path)
                  ? 'nav-link-active'
                  : 'nav-link'
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-1.5 text-sm text-parchment-500 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream transition-colors duration-200"
            >
              {user?.full_name || user?.username}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-48 surface-glass shadow-surface-lg rounded-lg border border-parchment-300 dark:border-ink-600/50 py-1 z-50">
                <button
                  onClick={() => { setShowPasswordModal(true); setShowUserMenu(false) }}
                  className="w-full px-4 py-2 text-sm text-left text-ink-850 dark:text-cream hover:bg-parchment-100 dark:hover:bg-ink-700 flex items-center gap-2"
                >
                  <KeyRound className="w-4 h-4" />
                  Change Password
                </button>
                <button
                  onClick={() => { setShowFontSizeModal(true); setShowUserMenu(false) }}
                  className="w-full px-4 py-2 text-sm text-left text-ink-850 dark:text-cream hover:bg-parchment-100 dark:hover:bg-ink-700 flex items-center gap-2"
                >
                  <Type className="w-4 h-4" />
                  Font Size
                </button>
                <button
                  onClick={logout}
                  className="w-full px-4 py-2 text-sm text-left text-ink-850 dark:text-cream hover:bg-parchment-100 dark:hover:bg-ink-700 flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
            )}
          </div>
          <button
            onClick={openReleaseNotes}
            className={`transition-colors duration-200 ${
              hasUnread
                ? 'text-gold animate-pulse'
                : 'text-parchment-400 dark:text-cream-muted hover:text-gold'
            }`}
            title="What's new"
          >
            <Sparkles className="w-4 h-4" />
          </button>
          <button
            onClick={toggle}
            className="text-parchment-400 dark:text-cream-muted hover:text-gold transition-colors duration-200"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
      {showFontSizeModal && <FontSizeModal onClose={() => setShowFontSizeModal(false)} />}
      {showReleaseNotes && <ReleaseNotesModal onClose={() => setShowReleaseNotes(false)} />}
    </div>
  )
}
