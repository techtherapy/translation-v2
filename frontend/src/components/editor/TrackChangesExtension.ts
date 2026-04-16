/**
 * TipTap extension wrapping @manuscripts/track-changes-plugin.
 *
 * Schema contract (validated in trackChangesSpike.test.ts):
 *   Marks: tracked_insert, tracked_delete — each with { dataTracked } attribute
 *   Node attrs: paragraph.dataTracked (array of change objects)
 *   Change shape: { id, authorID, reviewedByID, createdAt, updatedAt, statusUpdateAt, status, operation }
 */

import { Extension, Mark } from '@tiptap/core'
import {
  trackChangesPlugin,
  trackChangesPluginKey,
  trackCommands,
  TrackChangesStatus,
  CHANGE_STATUS,
  CHANGE_OPERATION,
  ChangeSet,
} from '@manuscripts/track-changes-plugin'
import type { EditorState } from '@tiptap/pm/state'

// Re-export for consumers
export {
  trackChangesPluginKey,
  trackCommands,
  TrackChangesStatus,
  CHANGE_STATUS,
  CHANGE_OPERATION,
  ChangeSet,
}

export type TrackedChangeData = {
  id: string
  authorID: string
  reviewedByID: string | null
  createdAt: number
  updatedAt: number
  statusUpdateAt: number
  status: 'pending' | 'accepted' | 'rejected'
  operation: string
}

// ---------------------------------------------------------------------------
// Mark definitions — must match what the plugin expects (schema.marks.tracked_insert / tracked_delete)
// ---------------------------------------------------------------------------

export const TrackedInsert = Mark.create({
  name: 'tracked_insert',

  addAttributes() {
    return {
      dataTracked: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-track-op="insert"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { class: 'tc-insert-mark', 'data-track-op': 'insert', ...HTMLAttributes }, 0]
  },
})

export const TrackedDelete = Mark.create({
  name: 'tracked_delete',

  addAttributes() {
    return {
      dataTracked: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-track-op="delete"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { class: 'tc-delete-mark', 'data-track-op': 'delete', ...HTMLAttributes }, 0]
  },
})

// ---------------------------------------------------------------------------
// Main extension
// ---------------------------------------------------------------------------

export interface TrackChangesOptions {
  enabled: boolean
  userID: string
}

export const TrackChangesExtension = Extension.create<TrackChangesOptions>({
  name: 'trackChanges',

  addOptions() {
    return {
      enabled: false,
      userID: 'anonymous',
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          dataTracked: { default: null },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    if (!this.options.enabled) return []

    return [
      trackChangesPlugin({
        userID: this.options.userID,
        initialStatus: TrackChangesStatus.enabled,
      }),
    ]
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the current ChangeSet from editor state.
 * Returns null if the plugin is not active.
 */
export function getChangeSet(state: EditorState): ChangeSet | null {
  const pluginState = trackChangesPluginKey.getState(state)
  return pluginState?.changeSet ?? null
}

/**
 * Check if track changes is currently enabled in the editor state.
 */
export function isTrackingEnabled(state: EditorState): boolean {
  const pluginState = trackChangesPluginKey.getState(state)
  return pluginState?.status === TrackChangesStatus.enabled
}
