import React, { useState, useEffect } from 'react'
import {
  Users, Plus, Edit2, KeyRound, Save, X, Loader2,
  Shield, ShieldCheck, ShieldAlert, UserCheck, UserX,
} from 'lucide-react'
import { listUsers, createUser, updateUser, resetUserPassword, type UserCreateData, type UserUpdateData } from '../../api/users'
import { extractErrorMessage } from '../../utils/extractErrorMessage'
import type { User } from '../../types'
import PermissionsPanel from './PermissionsPanel'

type Tab = 'users' | 'permissions'

const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  translator: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  reviewer: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

export default function UserManagementPage() {
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [resetId, setResetId] = useState<number | null>(null)

  useEffect(() => {
    loadUsers()
  }, [])

  async function loadUsers() {
    setLoading(true)
    try {
      const data = await listUsers()
      setUsers(data)
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load users'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Users className="w-6 h-6 text-gold" />
        <h1 className="text-2xl font-bold text-ink-850 dark:text-cream font-heading">
          User Management
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-parchment-300 dark:border-ink-600/50">
        <button
          onClick={() => setTab('users')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'users'
              ? 'border-gold text-gold'
              : 'border-transparent text-parchment-500 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream'
          }`}
        >
          <Users className="w-4 h-4 inline mr-1.5" />
          Users
        </button>
        <button
          onClick={() => setTab('permissions')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'permissions'
              ? 'border-gold text-gold'
              : 'border-transparent text-parchment-500 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream'
          }`}
        >
          <Shield className="w-4 h-4 inline mr-1.5" />
          Permissions
        </button>
      </div>

      {tab === 'users' ? (
        <div>
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-status-error-bg text-red-700 dark:text-status-error text-sm rounded border border-red-200 dark:border-status-error/20">
              {error}
            </div>
          )}

          <div className="flex justify-end mb-4">
            <button
              onClick={() => { setShowAddForm(true); setEditingId(null) }}
              className="btn-primary text-sm flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add User
            </button>
          </div>

          {showAddForm && (
            <AddUserForm
              onCreated={(user) => {
                setUsers([...users, user])
                setShowAddForm(false)
              }}
              onCancel={() => setShowAddForm(false)}
            />
          )}

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gold" />
            </div>
          ) : (
            <div className="surface-glass overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-parchment-200 dark:border-ink-600/50">
                    <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Username</th>
                    <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Email</th>
                    <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Role</th>
                    <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Status</th>
                    <th className="text-right px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <React.Fragment key={user.id}>
                      <tr className={`border-b border-parchment-100 dark:border-ink-700/30 ${!user.is_active ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3 text-ink-850 dark:text-cream">{user.full_name || '—'}</td>
                        <td className="px-4 py-3 text-ink-850 dark:text-cream font-mono text-xs">{user.username}</td>
                        <td className="px-4 py-3 text-parchment-500 dark:text-cream-muted">{user.email}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${ROLE_STYLES[user.role] || ''}`}>
                            {user.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {user.is_active ? (
                            <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs">
                              <UserCheck className="w-3.5 h-3.5" /> Active
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-parchment-400 dark:text-cream-muted/50 text-xs">
                              <UserX className="w-3.5 h-3.5" /> Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditingId(editingId === user.id ? null : user.id)}
                              className="p-1.5 rounded hover:bg-parchment-200 dark:hover:bg-ink-700 text-parchment-500 dark:text-cream-muted transition-colors"
                              title="Edit user"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setResetId(resetId === user.id ? null : user.id)}
                              className="p-1.5 rounded hover:bg-parchment-200 dark:hover:bg-ink-700 text-parchment-500 dark:text-cream-muted transition-colors"
                              title="Reset password"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editingId === user.id && (
                        <tr>
                          <td colSpan={6} className="px-4 py-3 bg-parchment-50 dark:bg-ink-800/50">
                            <EditUserForm
                              user={user}
                              onUpdated={(updated) => {
                                setUsers(users.map((u) => u.id === updated.id ? updated : u))
                                setEditingId(null)
                              }}
                              onCancel={() => setEditingId(null)}
                            />
                          </td>
                        </tr>
                      )}
                      {resetId === user.id && (
                        <tr>
                          <td colSpan={6} className="px-4 py-3 bg-parchment-50 dark:bg-ink-800/50">
                            <ResetPasswordForm
                              userId={user.id}
                              username={user.username}
                              onDone={() => setResetId(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && (
                <div className="py-8 text-center text-parchment-400 dark:text-cream-muted/50">
                  No users found
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <PermissionsPanel />
      )}
    </div>
  )
}


function AddUserForm({
  onCreated,
  onCancel,
}: {
  onCreated: (user: User) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<UserCreateData>({
    username: '',
    email: '',
    password: '',
    full_name: '',
    role: 'translator',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const user = await createUser(form)
      onCreated(user)
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to create user'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="surface-glass p-5 mb-4 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-ink-850 dark:text-cream">Add New User</h3>
        <button type="button" onClick={onCancel} className="p-1 text-parchment-400 hover:text-ink-850 dark:hover:text-cream">
          <X className="w-4 h-4" />
        </button>
      </div>
      {error && <div className="text-sm text-red-600 dark:text-status-error">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Username</label>
          <input
            className="input-field"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            className="input-field"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">Full Name</label>
          <input
            className="input-field"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            type="password"
            className="input-field"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            minLength={6}
            required
          />
        </div>
        <div>
          <label className="label">Role</label>
          <select
            className="input-field"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as UserCreateData['role'] })}
          >
            <option value="translator">Translator</option>
            <option value="reviewer">Reviewer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
        <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Create User
        </button>
      </div>
    </form>
  )
}


function EditUserForm({
  user,
  onUpdated,
  onCancel,
}: {
  user: User
  onUpdated: (user: User) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<UserUpdateData>({
    full_name: user.full_name,
    role: user.role,
    is_active: user.is_active,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const updated = await updateUser(user.id, form)
      onUpdated(updated)
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update user'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-ink-850 dark:text-cream">Edit {user.username}</h4>
        <button type="button" onClick={onCancel} className="p-1 text-parchment-400 hover:text-ink-850 dark:hover:text-cream">
          <X className="w-4 h-4" />
        </button>
      </div>
      {error && <div className="text-sm text-red-600 dark:text-status-error">{error}</div>}
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <label className="label">Full Name</label>
          <input
            className="input-field"
            value={form.full_name || ''}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
        </div>
        <div className="w-36">
          <label className="label">Role</label>
          <select
            className="input-field"
            value={form.role || user.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="translator">Translator</option>
            <option value="reviewer">Reviewer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="w-28">
          <label className="label">Active</label>
          <select
            className="input-field"
            value={form.is_active ? 'true' : 'false'}
            onChange={(e) => setForm({ ...form, is_active: e.target.value === 'true' })}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>
    </form>
  )
}


function ResetPasswordForm({
  userId,
  username,
  onDone,
}: {
  userId: number
  username: string
  onDone: () => void
}) {
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await resetUserPassword(userId, password)
      setSuccess(true)
      setTimeout(onDone, 1500)
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to reset password'))
    } finally {
      setSaving(false)
    }
  }

  if (success) {
    return (
      <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm py-2">
        <ShieldCheck className="w-4 h-4" />
        Password reset successfully for {username}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-ink-850 dark:text-cream">Reset password for {username}</h4>
        <button type="button" onClick={onDone} className="p-1 text-parchment-400 hover:text-ink-850 dark:hover:text-cream">
          <X className="w-4 h-4" />
        </button>
      </div>
      {error && <div className="text-sm text-red-600 dark:text-status-error">{error}</div>}
      <div className="flex gap-4 items-end">
        <div className="flex-1 max-w-xs">
          <label className="label">New Password</label>
          <input
            type="password"
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
            placeholder="Min 6 characters"
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onDone} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Reset
          </button>
        </div>
      </div>
    </form>
  )
}
