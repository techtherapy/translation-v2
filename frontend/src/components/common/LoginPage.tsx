import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../../api/auth'
import { useAuth } from '../../stores/AuthContext'
import { extractErrorMessage } from '../../utils/extractErrorMessage'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setUser } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { user } = await login(username, password)
      setUser(user)
      navigate('/books')
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Login failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-parchment-50 dark:bg-ink-950 relative overflow-hidden font-body">
      {/* Atmospheric background gradients */}
      <div className="absolute inset-0 dark:bg-[radial-gradient(ellipse_at_30%_20%,rgba(61,53,32,0.4)_0%,transparent_50%),radial-gradient(ellipse_at_70%_80%,rgba(26,58,54,0.3)_0%,transparent_50%)] bg-[radial-gradient(ellipse_at_30%_20%,rgba(212,168,83,0.08)_0%,transparent_50%),radial-gradient(ellipse_at_70%_80%,rgba(45,212,191,0.06)_0%,transparent_50%)]" />

      <div className="w-full max-w-sm relative z-10 animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex animate-glow-pulse rounded-2xl p-3 mb-4">
            <img src="/logo.svg" alt="BITS" className="w-24 h-24" />
          </div>
          <h1 className="text-3xl font-bold text-ink-850 dark:text-cream font-heading">BITS</h1>
          <p className="text-sm text-parchment-500 dark:text-cream-muted mt-1 font-body">Buddha Intelligence Translation System</p>
        </div>
        <form onSubmit={handleSubmit} className="surface-glass shadow-surface-lg p-8 space-y-5">
          {error && (
            <div className="bg-red-50 dark:bg-status-error-bg text-red-700 dark:text-status-error text-sm px-3 py-2 rounded border border-red-200 dark:border-status-error/20">{error}</div>
          )}
          <div>
            <label className="label">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-field"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          <p className="text-xs text-parchment-400 dark:text-cream-muted/50 text-center">Default: admin / admin</p>
        </form>
      </div>
    </div>
  )
}
