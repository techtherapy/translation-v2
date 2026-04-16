import React, { useState, useEffect } from 'react'
import { Save, Loader2, CheckCircle, AlertCircle, RotateCcw } from 'lucide-react'
import { getPermissions, updatePermissions } from '../../api/users'
import { extractErrorMessage } from '../../utils/extractErrorMessage'
import type { PermissionGroup } from '../../types'

const EDITABLE_ROLES = ['translator', 'reviewer'] as const

export default function PermissionsPanel() {
  const [groups, setGroups] = useState<PermissionGroup[]>([])
  const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({})
  const [originalPerms, setOriginalPerms] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    loadPermissions()
  }, [])

  async function loadPermissions() {
    setLoading(true)
    try {
      const data = await getPermissions()
      setGroups(data.groups)
      setRolePerms(data.role_permissions)
      setOriginalPerms(data.role_permissions)
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load permissions'))
    } finally {
      setLoading(false)
    }
  }

  function togglePermission(role: string, permKey: string) {
    setRolePerms((prev) => {
      const current = prev[role] || []
      const has = current.includes(permKey)
      return {
        ...prev,
        [role]: has
          ? current.filter((p) => p !== permKey)
          : [...current, permKey],
      }
    })
    setSuccess('')
  }

  function hasChanged(): boolean {
    for (const role of EDITABLE_ROLES) {
      const a = new Set(rolePerms[role] || [])
      const b = new Set(originalPerms[role] || [])
      if (a.size !== b.size) return true
      for (const item of a) if (!b.has(item)) return true
    }
    return false
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const data = await updatePermissions(rolePerms)
      setRolePerms(data.role_permissions)
      setOriginalPerms(data.role_permissions)
      setSuccess('Permissions saved successfully')
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to save permissions'))
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setRolePerms({ ...originalPerms })
    setSuccess('')
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-status-error-bg text-red-700 dark:text-status-error text-sm rounded border border-red-200 dark:border-status-error/20">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded border border-green-200 dark:border-green-700/30">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      <p className="text-sm text-parchment-500 dark:text-cream-muted">
        Configure what each role can do. Admin always has all permissions.
      </p>

      <div className="surface-glass overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-parchment-200 dark:border-ink-600/50">
              <th className="text-left px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted w-1/2">Permission</th>
              {EDITABLE_ROLES.map((role) => (
                <th key={role} className="text-center px-4 py-3 font-medium text-parchment-500 dark:text-cream-muted capitalize">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <React.Fragment key={group.name}>
                <tr className="bg-parchment-50/50 dark:bg-ink-800/30">
                  <td colSpan={3} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-parchment-400 dark:text-cream-muted/60">
                    {group.name}
                  </td>
                </tr>
                {group.permissions.map((perm) => (
                  <tr key={perm.key} className="border-b border-parchment-100 dark:border-ink-700/20">
                    <td className="px-4 py-2.5 text-ink-850 dark:text-cream">
                      {perm.label}
                      <span className="ml-2 text-xs text-parchment-400 dark:text-cream-muted/40 font-mono">{perm.key}</span>
                    </td>
                    {EDITABLE_ROLES.map((role) => {
                      const checked = (rolePerms[role] || []).includes(perm.key)
                      return (
                        <td key={role} className="text-center px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePermission(role, perm.key)}
                            className="w-4 h-4 rounded border-parchment-300 dark:border-ink-600 text-gold focus:ring-gold/30 cursor-pointer"
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={handleReset}
          disabled={!hasChanged() || saving}
          className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-40"
        >
          <RotateCcw className="w-4 h-4" />
          Reset
        </button>
        <button
          onClick={handleSave}
          disabled={!hasChanged() || saving}
          className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Permissions
        </button>
      </div>
    </div>
  )
}
