import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './stores/AuthContext'
import { ChineseFontProvider } from './stores/ChineseFontContext'
import Layout from './components/common/Layout'
import ErrorBoundary from './components/common/ErrorBoundary'
import { ConfirmProvider } from './hooks/useConfirm'
import LoginPage from './components/common/LoginPage'
import BookLibrary from './components/library/BookLibrary'
import BookDetail from './components/library/BookDetail'
import TranslationDetail from './components/library/TranslationDetail'
import TranslationEditor from './components/editor/TranslationEditor'
import GlossaryPage from './components/glossary/GlossaryPage'
import TMSeedingPage from './components/tm/TMSeedingPage'
import SettingsPage from './components/settings/SettingsPage'

function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode
  allowedRoles?: Array<'admin' | 'translator' | 'reviewer'>
}) {
  const { isLoggedIn, user } = useAuth()
  if (!isLoggedIn) return <Navigate to="/login" replace />
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/books" replace />
  }
  return <Layout>{children}</Layout>
}

function AppRoutes() {
  const { isLoggedIn } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={isLoggedIn ? <Navigate to="/books" replace /> : <LoginPage />}
      />
      <Route
        path="/books"
        element={<ProtectedRoute><BookLibrary /></ProtectedRoute>}
      />
      <Route
        path="/books/:bookId"
        element={<ProtectedRoute><BookDetail /></ProtectedRoute>}
      />
      <Route
        path="/translations/:btId"
        element={<ProtectedRoute><TranslationDetail /></ProtectedRoute>}
      />
      <Route
        path="/translations/:btId/chapters/:chapterId"
        element={<ProtectedRoute><TranslationEditor /></ProtectedRoute>}
      />
      <Route
        path="/glossary"
        element={<ProtectedRoute><GlossaryPage /></ProtectedRoute>}
      />
      <Route
        path="/tm"
        element={<ProtectedRoute><TMSeedingPage /></ProtectedRoute>}
      />
      <Route
        path="/settings"
        element={<ProtectedRoute allowedRoles={['admin']}><SettingsPage /></ProtectedRoute>}
      />
      <Route path="*" element={<Navigate to="/books" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ChineseFontProvider>
        <ErrorBoundary>
          <ConfirmProvider>
            <AppRoutes />
          </ConfirmProvider>
        </ErrorBoundary>
      </ChineseFontProvider>
    </AuthProvider>
  )
}
