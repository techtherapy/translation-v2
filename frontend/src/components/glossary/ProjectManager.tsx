import React, { useState, useMemo } from 'react'
import { Plus, Trash2, Check, X } from 'lucide-react'
import type { GlossaryProject } from '../../types'
import { createProject, updateProject, deleteProject } from '../../api/glossary'
import { extractErrorMessage } from '../../utils/extractErrorMessage'
import { useConfirm } from '../../hooks/useConfirm'

interface ProjectManagerProps {
  projects: GlossaryProject[]
  onProjectsChange: (projects: GlossaryProject[]) => void
  onClose: () => void
}

export default function ProjectManager({ projects, onProjectsChange, onClose }: ProjectManagerProps) {
  const confirm = useConfirm()
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  const sorted = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  )

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return

    setSaving(true)
    setError(null)
    try {
      const project = await createProject({
        name,
        description: newDescription.trim(),
      })
      onProjectsChange([...projects, project])
      setNewName('')
      setNewDescription('')
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to create project'))
    } finally {
      setSaving(false)
    }
  }

  function startEdit(project: GlossaryProject) {
    setEditingId(project.id)
    setEditName(project.name)
    setEditDescription(project.description)
  }

  async function saveEdit() {
    if (editingId === null) return
    try {
      const updated = await updateProject(editingId, {
        name: editName.trim(),
        description: editDescription.trim(),
      })
      onProjectsChange(projects.map((p) => p.id === editingId ? updated : p))
      setEditingId(null)
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to update project'))
    }
  }

  async function handleToggleActive(project: GlossaryProject) {
    try {
      const updated = await updateProject(project.id, { is_active: !project.is_active })
      onProjectsChange(projects.map((p) => p.id === project.id ? updated : p))
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to update project'))
    }
  }

  async function handleDelete(id: number) {
    if (!await confirm({ title: 'Delete project', message: 'Delete this project?', confirmLabel: 'Delete', variant: 'danger' })) return
    try {
      await deleteProject(id)
      onProjectsChange(projects.filter((p) => p.id !== id))
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to delete project'))
    }
  }

  const inputClass = 'input-field'

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-ink-950/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div
        className="surface-glass shadow-surface-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold font-heading text-ink-850 dark:text-cream mb-4">Manage Projects</h2>

        {error && (
          <div className="mb-4 px-3 py-2 text-sm text-red-600 bg-red-50 rounded-md dark:text-status-error dark:bg-status-error-bg">
            {error}
          </div>
        )}

        {/* Add new project — at top */}
        <div className="mb-5 pb-5 border-b border-parchment-300 dark:border-ink-600">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="label">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="e.g. Vimala"
                className={inputClass + ' w-full'}
              />
            </div>
            <div className="flex-1">
              <label className="label">Description</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="Optional description"
                className={inputClass + ' w-full'}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={saving || !newName.trim()}
              className="btn-primary flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium font-body disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>

        {/* Existing projects — sorted alphabetically */}
        <div className="space-y-2 mb-6">
          {sorted.length === 0 && (
            <p className="text-sm text-parchment-500 dark:text-cream-muted py-4 text-center font-body">
              No projects yet. Add one above.
            </p>
          )}
          {sorted.map((project) => (
            <div key={project.id} className="flex items-center gap-3 p-3 bg-parchment-50 rounded-md dark:bg-ink-700/50">
              {editingId === project.id ? (
                <>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={`${inputClass} flex-1`}
                    placeholder="Project name"
                  />
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className={`${inputClass} flex-1`}
                    placeholder="Description (optional)"
                  />
                  <button onClick={saveEdit} className="text-green-600 hover:text-green-700 dark:text-green-400">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-parchment-400 hover:text-ink-700 dark:text-ink-400 dark:hover:text-cream-dim">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  {/* Active toggle */}
                  <button
                    onClick={() => handleToggleActive(project)}
                    className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${
                      project.is_active
                        ? 'bg-status-success'
                        : 'bg-parchment-300 dark:bg-ink-500'
                    }`}
                    title={project.is_active ? 'Active' : 'Inactive'}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      project.is_active ? 'left-5' : 'left-0.5'
                    }`} />
                  </button>

                  {/* Name & description */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onDoubleClick={() => startEdit(project)}
                    title="Double-click to edit"
                  >
                    <span className={`text-sm font-medium font-body ${project.is_active ? 'text-ink-850 dark:text-cream' : 'text-parchment-400 dark:text-ink-400'}`}>
                      {project.name}
                    </span>
                    {project.description && (
                      <span className="ml-2 text-xs text-parchment-500 dark:text-cream-muted">{project.description}</span>
                    )}
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(project.id)}
                    className="flex-shrink-0 text-parchment-400 hover:text-status-error dark:text-ink-400 dark:hover:text-status-error"
                    title="Delete project"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="btn-ghost px-4 py-2 text-sm font-body"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
