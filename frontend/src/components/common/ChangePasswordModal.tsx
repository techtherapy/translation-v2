import React, { useState } from 'react'
import { X, Loader2, CheckCircle, KeyRound } from 'lucide-react'
import { changeMyPassword } from '../../api/users'
import { extractErrorMessage } from '../../utils/extractErrorMessage'

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }
    setSaving(true)
    setError('')
    try {
      await changeMyPassword(currentPassword, newPassword)
      setSuccess(true)
      setTimeout(onClose, 2000)
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to change password'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative surface-glass shadow-surface-lg w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink-850 dark:text-cream font-heading flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-gold" />
            Change Password
          </h3>
          <button onClick={onClose} className="p-1 text-parchment-400 hover:text-ink-850 dark:hover:text-cream">
            <X className="w-4 h-4" />
          </button>
        </div>

        {success ? (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm py-4">
            <CheckCircle className="w-5 h-5" />
            Password changed successfully
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-sm text-red-600 dark:text-status-error bg-red-50 dark:bg-status-error-bg px-3 py-2 rounded border border-red-200 dark:border-status-error/20">
                {error}
              </div>
            )}
            <div>
              <label className="label">Current Password</label>
              <input
                type="password"
                className="input-field"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">New Password</label>
              <input
                type="password"
                className="input-field"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                required
                placeholder="Min 6 characters"
              />
            </div>
            <div>
              <label className="label">Confirm New Password</label>
              <input
                type="password"
                className="input-field"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary w-full flex items-center justify-center gap-1.5"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Change Password
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
