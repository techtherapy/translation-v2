import { ChevronLeft, ChevronRight } from 'lucide-react'

interface GlossaryPaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export default function GlossaryPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: GlossaryPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = Math.min((page - 1) * pageSize + 1, total)
  const end = Math.min(page * pageSize, total)

  function getPageNumbers(): (number | '...')[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    const pages: (number | '...')[] = [1]
    if (page > 3) pages.push('...')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i)
    }
    if (page < totalPages - 2) pages.push('...')
    pages.push(totalPages)
    return pages
  }

  if (total === 0) return null

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-white border border-t-0 border-parchment-300 rounded-b-lg dark:bg-ink-800 dark:border-ink-600">
      <div className="flex items-center gap-4">
        <span className="text-sm text-parchment-500 dark:text-cream-muted font-body">
          {start}{'\u2013'}{end} of {total}
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="select-field py-1"
        >
          {[25, 50, 100].map((size) => (
            <option key={size} value={size}>{size} per page</option>
          ))}
        </select>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="p-1.5 rounded hover:bg-parchment-100/50 dark:hover:bg-ink-700 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {getPageNumbers().map((p, i) =>
            p === '...' ? (
              <span key={`dots-${i}`} className="px-2 text-parchment-400 dark:text-ink-400">{'\u2026'}</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`px-3 py-1 rounded text-sm font-medium font-body ${
                  p === page
                    ? 'bg-gold text-ink-950'
                    : 'hover:bg-parchment-100/50 text-ink-700 dark:hover:bg-ink-700 dark:text-cream-dim'
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="p-1.5 rounded hover:bg-parchment-100/50 dark:hover:bg-ink-700 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}
