import React, { useState, useEffect } from 'react'
import {
  Save, Loader2, CheckCircle, AlertCircle, Eye, EyeOff, Key, Check,
  Users, Plus, Edit2, KeyRound, X,
  Shield, UserCheck, UserX,
  Settings, Globe, Trash2, Cpu,
} from 'lucide-react'
import { getSettings, updateSettings, getPromptTemplates, updatePromptTemplates, type SettingValue, type PromptTemplate } from '../../api/settings'
import { listUsers, createUser, updateUser, resetUserPassword, type UserCreateData, type UserUpdateData } from '../../api/users'
import { listLanguages, createLanguage, updateLanguage, deleteLanguage } from '../../api/languages'
import { useChineseFont, type ChineseFont } from '../../stores/ChineseFontContext'
import { extractErrorMessage } from '../../utils/extractErrorMessage'
import type { User, Language } from '../../types'
import PermissionsPanel from '../users/PermissionsPanel'
import ModelsTab from './ModelsTab'
import { useConfirm } from '../../hooks/useConfirm'

type Tab = 'general' | 'users' | 'permissions' | 'languages' | 'models' | 'prompts'

const KEY_META: Record<string, { label: string; description: string; placeholder: string; secret: boolean }> = {
  ANTHROPIC_API_KEY: {
    label: 'Anthropic API Key',
    description: 'Required for Claude models (claude-sonnet, claude-opus, etc.)',
    placeholder: 'sk-ant-api03-...',
    secret: true,
  },
  OPENAI_API_KEY: {
    label: 'OpenAI API Key',
    description: 'For GPT-4, GPT-4o, and other OpenAI models',
    placeholder: 'sk-...',
    secret: true,
  },
  DEEPSEEK_API_KEY: {
    label: 'DeepSeek API Key',
    description: 'For DeepSeek models',
    placeholder: 'sk-...',
    secret: true,
  },
  GOOGLE_API_KEY: {
    label: 'Google API Key',
    description: 'For Gemini models',
    placeholder: 'AIza...',
    secret: true,
  },
}

const API_KEY_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'GOOGLE_API_KEY']
const DISPLAY_KEYS = ['CHINESE_FONT']

const ALL_KEYS = [...API_KEY_KEYS, ...DISPLAY_KEYS]

const FONT_OPTIONS: { value: ChineseFont; label: string; description: string; family: string }[] = [
  { value: 'noto-serif-sc', label: 'Noto Serif SC', description: 'Traditional serif', family: '"Noto Serif SC", serif' },
  { value: 'noto-sans-sc', label: 'Noto Sans SC', description: 'Clean sans-serif', family: '"Noto Sans SC", sans-serif' },
  { value: 'lxgw-wenkai', label: 'LXGW WenKai', description: 'Calligraphic', family: '"LXGW WenKai", cursive' },
]

const SAMPLE_TEXT = '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。'

const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  translator: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  reviewer: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

function emptyValues(): Record<string, string> {
  const obj: Record<string, string> = {}
  ALL_KEYS.forEach((k) => { obj[k] = '' })
  return obj
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general')

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="w-5 h-5 text-gold" />
        <h1 className="text-xl font-semibold font-heading text-ink-850 dark:text-cream">Settings</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-parchment-300 dark:border-ink-600/50">
        <button
          onClick={() => setTab('general')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'general'
              ? 'border-gold text-gold'
              : 'border-transparent text-parchment-500 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream'
          }`}
        >
          <Key className="w-4 h-4 inline mr-1.5" />
          General
        </button>
        <button
          onClick={() => setTab('models')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'models'
              ? 'border-gold text-gold'
              : 'border-transparent text-parchment-500 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream'
          }`}
        >
          <Cpu className="w-4 h-4 inline mr-1.5" />
          Models
        </button>
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
        <button
          onClick={() => setTab('languages')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'languages'
              ? 'border-gold text-gold'
              : 'border-transparent text-parchment-500 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream'
          }`}
        >
          <Globe className="w-4 h-4 inline mr-1.5" />
          Languages
        </button>
        <button
          onClick={() => setTab('prompts')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'prompts'
              ? 'border-gold text-gold'
              : 'border-transparent text-parchment-500 dark:text-cream-muted hover:text-ink-850 dark:hover:text-cream'
          }`}
        >
          <Edit2 className="w-4 h-4 inline mr-1.5" />
          Prompts
        </button>
      </div>

      <div key={tab} className="animate-fade-in-up">
        {tab === 'general' && <GeneralSettings />}
        {tab === 'models' && <ModelsTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'permissions' && <PermissionsPanel />}
        {tab === 'languages' && <LanguagesTab />}
        {tab === 'prompts' && <PromptsTab />}
      </div>
    </div>
  )
}


function GeneralSettings() {
  const { setFont } = useChineseFont()
  const [savedValues, setSavedValues] = useState<Record<string, string>>(emptyValues)
  const [editedValues, setEditedValues] = useState<Record<string, string>>(emptyValues)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set())


  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    setLoading(true)
    try {
      const data = await getSettings()
      const vals: Record<string, string> = {}
      data.forEach((s) => { vals[s.key] = s.value })
      setSavedValues(vals)
      setEditedValues(vals)
    } catch (err: unknown) {
      setMessage({ type: 'error', text: extractErrorMessage(err, 'Failed to load settings — you can still enter values and save.') })
    } finally {
      setLoading(false)
    }
  }

  function handleChange(key: string, value: string) {
    setEditedValues((prev) => ({ ...prev, [key]: value }))
    setMessage(null)
  }

  function toggleVisibility(key: string) {
    setVisibleKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      const payload = Object.entries(editedValues).map(([key, value]) => ({
        key,
        value,
        updated_at: null,
      }))
      const updated = await updateSettings(payload)
      const refreshed: Record<string, string> = {}
      updated.forEach((s) => { refreshed[s.key] = s.value })
      setSavedValues(refreshed)
      setEditedValues(refreshed)
      if (refreshed['CHINESE_FONT']) {
        setFont(refreshed['CHINESE_FONT'] as ChineseFont)
      }
      setMessage({ type: 'success', text: 'Settings saved. API keys are active immediately.' })
    } catch (err: unknown) {
      setMessage({ type: 'error', text: extractErrorMessage(err, 'Failed to save settings') })
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = ALL_KEYS.some((key) => (editedValues[key] ?? '') !== (savedValues[key] ?? ''))

  function renderField(key: string) {
    const meta = KEY_META[key]
    if (!meta) return null
    const value = editedValues[key] ?? ''
    const isMasked = meta.secret && value.startsWith('••')
    const isVisible = visibleKeys.has(key)

    return (
      <div key={key} className="flex flex-col gap-1.5">
        <label className="label">{meta.label}</label>
        <div className="relative">
          <input
            type={meta.secret && !isVisible ? 'password' : 'text'}
            value={value}
            onChange={(e) => handleChange(key, e.target.value)}
            placeholder={meta.placeholder}
            className="input-field pr-10 font-mono"
          />
          {meta.secret && (
            <button
              type="button"
              onClick={() => toggleVisibility(key)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-parchment-400 dark:text-cream-muted hover:text-cream"
            >
              {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
        </div>
        <p className="text-xs text-parchment-400 dark:text-ink-400 font-body">{meta.description}</p>
        {isMasked && (
          <p className="text-xs text-gold font-body">Key is set. Clear the field and type a new value to change it.</p>
        )}
      </div>
    )
  }

  if (loading) {
    return <div className="text-center py-12 text-parchment-400 dark:text-ink-400 font-body">Loading settings...</div>
  }

  return (
    <div className="max-w-2xl">
      {message && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-md text-sm font-body mb-6 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-status-success-bg/30 dark:text-status-success dark:border-green-800'
              : 'bg-red-50 text-red-700 border border-red-200 dark:bg-status-error-bg/30 dark:text-status-error dark:border-red-800'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          {message.text}
        </div>
      )}

      {/* API Keys */}
      <section className="surface p-6 mb-6 stagger-children">
        <h2 className="text-sm font-semibold font-heading text-ink-850 dark:text-cream uppercase tracking-wider mb-1">LLM API Keys</h2>
        <p className="text-xs text-parchment-400 dark:text-ink-400 font-body mb-5">
          Add your API keys to enable AI translation. Keys are stored on the server and never sent to the browser.
        </p>
        <div className="space-y-5">
          {API_KEY_KEYS.map(renderField)}
        </div>
      </section>

      {/* Display */}
      <section className="surface p-6 mb-6">
        <h2 className="text-sm font-semibold font-heading text-ink-850 dark:text-cream uppercase tracking-wider mb-1">Display</h2>
        <p className="text-xs text-parchment-400 dark:text-ink-400 font-body mb-5">
          Choose the Chinese font used throughout the application.
        </p>
        <div className="space-y-3">
          {FONT_OPTIONS.map((opt) => {
            const selected = (editedValues['CHINESE_FONT'] || 'noto-serif-sc') === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleChange('CHINESE_FONT', opt.value)}
                className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                  selected
                    ? 'border-gold bg-gold/5 dark:bg-gold-faint/30'
                    : 'border-parchment-300 dark:border-ink-600 hover:border-gold/40'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {selected && <Check className="w-4 h-4 text-gold" />}
                    <span className="font-medium text-sm text-ink-850 dark:text-cream">{opt.label}</span>
                  </div>
                  <span className="text-xs text-parchment-400 dark:text-ink-400">{opt.description}</span>
                </div>
                <p
                  className="text-lg leading-relaxed text-ink-850 dark:text-cream"
                  style={{ fontFamily: opt.family }}
                >
                  {SAMPLE_TEXT}
                </p>
              </button>
            )
          })}
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="btn-primary"
        >
          {saving ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
          ) : (
            <><Save className="w-4 h-4" /> Save Settings</>
          )}
        </button>
      </div>
    </div>
  )
}


function UsersTab() {
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
        <CheckCircle className="w-4 h-4" />
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


function LanguagesTab() {
  const confirm = useConfirm()
  const [languages, setLanguages] = useState<Language[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [addCode, setAddCode] = useState('')
  const [addName, setAddName] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editRefLangId, setEditRefLangId] = useState<number | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => {
    loadLanguages()
  }, [])

  async function loadLanguages() {
    setLoading(true)
    try {
      const data = await listLanguages()
      setLanguages(data)
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load languages'))
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddSaving(true)
    setError('')
    try {
      const lang = await createLanguage({ code: addCode.trim().toLowerCase(), name: addName.trim() })
      setLanguages([...languages, lang])
      setShowAddForm(false)
      setAddCode('')
      setAddName('')
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to add language'))
    } finally {
      setAddSaving(false)
    }
  }

  async function handleToggleEnabled(lang: Language) {
    try {
      const updated = await updateLanguage(lang.id, { is_enabled: !lang.is_enabled })
      setLanguages(languages.map((l) => (l.id === updated.id ? updated : l)))
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update language'))
    }
  }

  function startEdit(lang: Language) {
    setEditingId(lang.id)
    setEditName(lang.name)
    setEditRefLangId(lang.reference_language_id)
    setEditPrompt(lang.prompt_template_override || '')
  }

  async function saveEdit() {
    if (!editingId) return
    setEditSaving(true)
    setError('')
    try {
      const updated = await updateLanguage(editingId, {
        name: editName,
        reference_language_id: editRefLangId || null,
        prompt_template_override: editPrompt || null,
      })
      setLanguages(languages.map((l) => (l.id === updated.id ? updated : l)))
      setEditingId(null)
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to update language'))
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(lang: Language) {
    if (!await confirm({ title: 'Delete language', message: `Delete language "${lang.name}" (${lang.code})? This cannot be undone.`, confirmLabel: 'Delete', variant: 'danger' })) return
    try {
      await deleteLanguage(lang.id)
      setLanguages(languages.filter((l) => l.id !== lang.id))
    } catch (err) {
      setError(extractErrorMessage(err, 'Cannot delete language'))
    }
  }

  const protectedCodes = new Set<string>()

  return (
    <div>
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-status-error-bg text-red-700 dark:text-status-error text-sm rounded border border-red-200 dark:border-status-error/20">
          {error}
        </div>
      )}

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowAddForm(true)}
          className="btn-primary text-sm flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Add Language
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAdd} className="surface-glass p-5 mb-4 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-ink-850 dark:text-cream">Add New Language</h3>
            <button type="button" onClick={() => setShowAddForm(false)} className="p-1 text-parchment-400 hover:text-ink-850 dark:hover:text-cream">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Code</label>
              <input
                className="input-field font-mono"
                value={addCode}
                onChange={(e) => setAddCode(e.target.value)}
                placeholder="e.g. id, fr, es"
                required
                maxLength={10}
              />
            </div>
            <div>
              <label className="label">Name</label>
              <input
                className="input-field"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="e.g. Indonesian"
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowAddForm(false)} className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={addSaving} className="btn-primary text-sm flex items-center gap-1.5">
              {addSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Language
            </button>
          </div>
        </form>
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
                <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Code</th>
                <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Name</th>
                <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Enabled</th>
                <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Reference</th>
                <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Prompt Override</th>
                <th className="text-right px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {languages.map((lang) => (
                <React.Fragment key={lang.id}>
                  <tr className={`border-b border-parchment-100 dark:border-ink-700/30 ${!lang.is_enabled ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-mono text-xs text-ink-850 dark:text-cream">{lang.code}</td>
                    <td className="px-4 py-3 text-ink-850 dark:text-cream">{lang.name}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleEnabled(lang)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          lang.is_enabled ? 'bg-gold' : 'bg-parchment-300 dark:bg-ink-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                            lang.is_enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-parchment-500 dark:text-cream-muted">
                      {lang.reference_language_id
                        ? languages.find((l) => l.id === lang.reference_language_id)?.name || '\u2014'
                        : '\u2014'}
                    </td>
                    <td className="px-4 py-3 text-xs text-parchment-500 dark:text-cream-muted max-w-[200px] truncate">
                      {lang.prompt_template_override || '\u2014'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => editingId === lang.id ? setEditingId(null) : startEdit(lang)}
                          className="p-1.5 rounded hover:bg-parchment-200 dark:hover:bg-ink-700 text-parchment-500 dark:text-cream-muted transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {!protectedCodes.has(lang.code) && (
                          <button
                            onClick={() => handleDelete(lang)}
                            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-parchment-500 dark:text-cream-muted hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {editingId === lang.id && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 bg-parchment-50 dark:bg-ink-800/50">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium text-ink-850 dark:text-cream">Edit {lang.code}</h4>
                            <button type="button" onClick={() => setEditingId(null)} className="p-1 text-parchment-400 hover:text-ink-850 dark:hover:text-cream">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="flex gap-4 items-end">
                            <div className="w-48">
                              <label className="label">Name</label>
                              <input
                                className="input-field"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                              />
                            </div>
                            <div className="w-44">
                              <label className="label">Reference Language</label>
                              <select
                                className="input-field text-xs"
                                value={editRefLangId ?? ''}
                                onChange={(e) => setEditRefLangId(e.target.value ? Number(e.target.value) : null)}
                              >
                                <option value="">None</option>
                                {languages.filter((l) => l.is_enabled && l.id !== editingId).map((l) => (
                                  <option key={l.id} value={l.id}>{l.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex gap-2 ml-auto">
                              <button type="button" onClick={() => setEditingId(null)} className="btn-secondary text-sm">Cancel</button>
                              <button onClick={saveEdit} disabled={editSaving} className="btn-primary text-sm flex items-center gap-1.5">
                                {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="label">Prompt Instructions for {editName || lang.name}</label>
                            <p className="text-[10px] text-parchment-400 dark:text-cream-muted/50 mb-1.5 font-body">
                              Extra instructions appended to the system prompt when translating to this language. Use for style guides, formality, dialect, or terminology preferences.
                            </p>
                            <textarea
                              className="w-full px-3 py-2 text-sm font-mono bg-parchment-50 dark:bg-ink-900 border border-parchment-200 dark:border-ink-600 rounded-md text-ink-850 dark:text-cream-dim focus:ring-1 focus:ring-gold focus:border-gold"
                              value={editPrompt}
                              onChange={(e) => setEditPrompt(e.target.value)}
                              placeholder={"e.g. Use formal register. Prefer traditional Chinese Buddhist terminology over modern simplified forms.\nTransliterate Sanskrit terms into the target script rather than leaving them in romanized form."}
                              rows={4}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {languages.length === 0 && (
            <div className="py-8 text-center text-parchment-400 dark:text-cream-muted/50">
              No languages configured
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function PromptsTab() {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadPrompts()
  }, [])

  async function loadPrompts() {
    setLoading(true)
    try {
      const data = await getPromptTemplates()
      setPrompts(data)
      const vals: Record<string, string> = {}
      data.forEach(p => { vals[p.key] = p.value })
      setEditValues(vals)
    } catch (err) {
      console.error('Failed to load prompts:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updatePromptTemplates(
        prompts.map(p => ({ key: p.key, value: editValues[p.key] || '' }))
      )
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      loadPrompts()
    } catch (err) {
      console.error('Failed to save prompts:', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-center py-8 text-parchment-400 dark:text-cream-muted">Loading prompts...</div>

  const VARIABLE_HELP: Record<string, string> = {
    PROMPT_SYSTEM_DIRECT: '{source_language}, {target_language}, {era_context}, {glossary_context}, {custom_instructions}',
    PROMPT_USER_DIRECT: '{source_language}, {source_text}, {target_language}, {context_before}, {context_after}, {extra_instructions}',
    PROMPT_SYSTEM_PIVOT: '{source_language}, {target_language}, {original_language}, {era_context}, {glossary_context}, {custom_instructions}',
    PROMPT_USER_PIVOT: '{pivot_text}, {original_text}, {original_language}, {source_language}, {target_language}, {context_before}, {context_after}, {extra_instructions}',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink-850 dark:text-cream font-heading">Translation Prompts</h2>
          <p className="text-sm text-parchment-400 dark:text-cream-muted/60 mt-1">
            Customize the system and user prompts sent to the LLM. Changes apply after saving — no restart needed.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? 'Saved' : 'Save All'}
        </button>
      </div>

      {prompts.map(prompt => (
        <div key={prompt.key} className="surface p-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-ink-850 dark:text-cream font-body">{prompt.label}</label>
            {!prompt.is_default && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-body">customized</span>
            )}
          </div>
          <textarea
            value={editValues[prompt.key] || ''}
            onChange={(e) => setEditValues(prev => ({ ...prev, [prompt.key]: e.target.value }))}
            className="w-full px-3 py-2 text-sm font-mono bg-parchment-50 dark:bg-ink-900 border border-parchment-200 dark:border-ink-600 rounded-md text-ink-850 dark:text-cream-dim focus:ring-1 focus:ring-gold focus:border-gold"
            rows={10}
          />
          <p className="text-[10px] text-parchment-400 dark:text-cream-muted/50 mt-1 font-mono">
            Variables: {VARIABLE_HELP[prompt.key]}
          </p>
        </div>
      ))}
    </div>
  )
}
