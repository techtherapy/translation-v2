import { describe, it, expect } from 'vitest'
import { TRANSLATION_STATUS_BADGES, BOOK_STATUS_BADGES } from './statusBadges'

describe('TRANSLATION_STATUS_BADGES', () => {
  it('has all expected statuses', () => {
    const expectedStatuses = [
      'empty',
      'machine_translated',
      'draft',
      'under_review',
      'approved',
      'needs_revision',
    ]
    for (const status of expectedStatuses) {
      expect(TRANSLATION_STATUS_BADGES[status]).toBeDefined()
      expect(TRANSLATION_STATUS_BADGES[status].color).toBeTruthy()
      expect(TRANSLATION_STATUS_BADGES[status].label).toBeTruthy()
    }
  })

  it('has correct labels', () => {
    expect(TRANSLATION_STATUS_BADGES.empty.label).toBe('Empty')
    expect(TRANSLATION_STATUS_BADGES.machine_translated.label).toBe('AI')
    expect(TRANSLATION_STATUS_BADGES.approved.label).toBe('Approved')
  })
})

describe('BOOK_STATUS_BADGES', () => {
  it('has all expected statuses', () => {
    const expectedStatuses = ['not_started', 'in_progress', 'under_review', 'published']
    for (const status of expectedStatuses) {
      expect(BOOK_STATUS_BADGES[status]).toBeDefined()
      expect(BOOK_STATUS_BADGES[status].color).toBeTruthy()
      expect(BOOK_STATUS_BADGES[status].label).toBeTruthy()
    }
  })

  it('has correct labels', () => {
    expect(BOOK_STATUS_BADGES.not_started.label).toBe('Not Started')
    expect(BOOK_STATUS_BADGES.published.label).toBe('Published')
  })
})
