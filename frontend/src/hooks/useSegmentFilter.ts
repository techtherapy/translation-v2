import { useState, useMemo } from 'react'
import type { Segment } from '../types'

export type StatusFilter = 'all' | 'empty' | 'machine_translated' | 'draft' | 'under_review' | 'approved' | 'needs_revision'

export interface SegmentProgress {
  total: number
  empty: number
  machine_translated: number
  draft: number
  under_review: number
  approved: number
  needs_revision: number
}

export function useSegmentFilter(segments: Segment[]) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const progress = useMemo<SegmentProgress>(() => {
    const p: SegmentProgress = {
      total: segments.length,
      empty: 0,
      machine_translated: 0,
      draft: 0,
      under_review: 0,
      approved: 0,
      needs_revision: 0,
    }
    for (const seg of segments) {
      const status = seg.translations[0]?.status || 'empty'
      if (status in p) {
        p[status as keyof Omit<SegmentProgress, 'total'>]++
      }
    }
    return p
  }, [segments])

  const filteredSegments = useMemo(() => {
    if (statusFilter === 'all') return segments
    return segments.filter((seg) => {
      const status = seg.translations[0]?.status || 'empty'
      return status === statusFilter
    })
  }, [segments, statusFilter])

  return { statusFilter, setStatusFilter, filteredSegments, progress }
}
