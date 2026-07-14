import { describe, expect, it } from 'vitest'
import { requiresEnrollmentRenewal, shouldRestartEnrollment } from './compliance-requirement'

describe('compliance enrollment renewal guard', () => {
  const requirement = {
    obligationId: '00000000-0000-4000-8000-000000000001',
    dueOn: '2026-07-20',
    computedAt: new Date('2026-07-15T12:00:00Z'),
  }

  it('restarts a completed enrollment only after a newer compliance calculation', () => {
    expect(
      requiresEnrollmentRenewal(
        { status: 'completed', completedAt: new Date('2026-07-01T12:00:00Z') },
        requirement,
      ),
    ).toBe(true)
  })

  it('does not restart from a scoreboard row made before completion', () => {
    expect(
      requiresEnrollmentRenewal(
        { status: 'completed', completedAt: new Date('2026-07-16T12:00:00Z') },
        requirement,
      ),
    ).toBe(false)
  })

  it('does not disturb an enrollment that is already in progress', () => {
    expect(
      requiresEnrollmentRenewal({ status: 'in_progress', completedAt: null }, requirement),
    ).toBe(false)
  })
})

describe('enrollment restart policy', () => {
  const completed = {
    status: 'completed',
    completedAt: new Date('2026-07-01T12:00:00Z'),
    deletedAt: null,
  }

  it('starts a new attempt when training staff reassign a completed course', () => {
    expect(
      shouldRestartEnrollment(completed, {
        assigning: true,
        requirement: null,
      }),
    ).toBe(true)
  })

  it('does not erase a completed self-enrollment without a proven new requirement', () => {
    expect(
      shouldRestartEnrollment(completed, {
        assigning: false,
        requirement: null,
      }),
    ).toBe(false)
  })
})
