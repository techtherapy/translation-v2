export interface StatusBadge {
  color: string
  label: string
}

/** Translation segment statuses (used in TranslationEditor) */
export const TRANSLATION_STATUS_BADGES: Record<string, StatusBadge> = {
  empty: { color: 'bg-parchment-300 text-parchment-700 dark:bg-ink-600 dark:text-cream-muted', label: 'Empty' },
  machine_translated: { color: 'bg-purple-500 text-white dark:bg-purple-500 dark:text-white', label: 'AI' },
  draft: { color: 'bg-amber-500 text-white dark:bg-amber-500 dark:text-white', label: 'Draft' },
  under_review: { color: 'bg-blue-500 text-white dark:bg-blue-500 dark:text-white', label: 'Review' },
  approved: { color: 'bg-green-500 text-white dark:bg-green-500 dark:text-white', label: 'Approved' },
  needs_revision: { color: 'bg-red-500 text-white dark:bg-red-500 dark:text-white', label: 'Revision' },
}

/** Book/article statuses (used in BookLibrary) */
export const BOOK_STATUS_BADGES: Record<string, StatusBadge> = {
  not_started: { color: 'bg-parchment-200 text-parchment-500 dark:bg-ink-700 dark:text-cream-muted', label: 'Not Started' },
  in_progress: { color: 'bg-blue-50 text-blue-700 dark:bg-status-info-bg dark:text-status-info', label: 'In Progress' },
  under_review: { color: 'bg-amber-50 text-amber-700 dark:bg-status-warning-bg dark:text-status-warning', label: 'Under Review' },
  published: { color: 'bg-green-50 text-green-700 dark:bg-status-success-bg dark:text-status-success', label: 'Published' },
}
