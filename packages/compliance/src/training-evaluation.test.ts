import { describe, expect, it } from 'vitest'
import {
  resolveTrainingEvaluationWindow,
  trainingEvidenceInWindow,
  trainingEvidenceOutcome,
} from './training-evaluation'

describe('training compliance evidence windows', () => {
  it('rejects an unexpired course record from a previous frequency period', () => {
    const recurrence = {
      kind: 'frequency' as const,
      frequency: 'week' as const,
      cron: '0 8 * * 1',
    }
    const clock = { now: new Date('2026-07-15T14:00:00Z'), timezone: 'UTC' }
    const window = resolveTrainingEvaluationWindow(
      recurrence,
      clock,
      new Date('2026-01-01T00:00:00Z'),
    )

    expect(window.periodStart).toBe('2026-07-13')
    expect(trainingEvidenceInWindow('2026-07-12', window)).toBe(false)
    expect(trainingEvidenceInWindow('2026-07-13', window)).toBe(true)
    expect(
      trainingEvidenceOutcome({
        recurrence,
        window,
        today: '2026-07-15',
        evidence: null,
        hasProgress: false,
      }).status,
    ).toBe('overdue')
  })

  it('uses exact timestamps for assessment evidence in an arbitrary cron interval', () => {
    const recurrence = {
      kind: 'cron' as const,
      cron: '0 7 * * 1-5',
      dueOffsetMinutes: 60,
    }
    const clock = { now: new Date('2026-07-15T10:00:00Z'), timezone: 'UTC' }
    const window = resolveTrainingEvaluationWindow(
      recurrence,
      clock,
      new Date('2026-01-01T00:00:00Z'),
    )

    expect(trainingEvidenceInWindow(new Date('2026-07-15T06:59:59Z'), window)).toBe(false)
    expect(trainingEvidenceInWindow(new Date('2026-07-15T07:00:00Z'), window)).toBe(true)
    expect(window.deadlinePassed).toBe(true)
  })

  it('does not start a cron period before the first eligible fire', () => {
    const recurrence = { kind: 'cron' as const, cron: '0 7 * * 1-5' }
    const clock = { now: new Date('2026-07-15T10:00:00Z'), timezone: 'UTC' }
    const window = resolveTrainingEvaluationWindow(
      recurrence,
      clock,
      new Date('2026-07-15T11:00:00Z'),
    )

    expect(window.periodStart).toBeNull()
    expect(window.deadlinePassed).toBe(false)
  })
})

describe('training compliance evidence outcomes', () => {
  const clock = { now: new Date('2026-07-15T10:00:00Z'), timezone: 'UTC' }

  it('lets a valid historical credential satisfy a one-time requirement', () => {
    const recurrence = { kind: 'one_time' as const, dueOn: '2026-07-20' }
    const window = resolveTrainingEvaluationWindow(
      recurrence,
      clock,
      new Date('2026-07-15T09:00:00Z'),
    )
    expect(
      trainingEvidenceOutcome({
        recurrence,
        window,
        today: '2026-07-15',
        evidence: { completedOn: '2026-01-10', expiresOn: '2027-01-10' },
        hasProgress: false,
      }),
    ).toEqual({ status: 'completed', dueOn: '2026-07-20', completedOn: '2026-01-10' })
  })

  it('marks credentials inside the configured expiry horizon as expiring', () => {
    const recurrence = { kind: 'expiry' as const, remindBeforeDays: 30 }
    const window = resolveTrainingEvaluationWindow(
      recurrence,
      clock,
      new Date('2026-01-01T00:00:00Z'),
    )
    expect(
      trainingEvidenceOutcome({
        recurrence,
        window,
        today: '2026-07-15',
        evidence: { completedOn: '2025-08-01', expiresOn: '2026-08-01' },
        hasProgress: false,
      }),
    ).toEqual({ status: 'expiring', dueOn: '2026-08-01', completedOn: '2025-08-01' })
  })

  it('keeps an expired credential overdue even when retraining has started', () => {
    const recurrence = { kind: 'expiry' as const, remindBeforeDays: 30 }
    const window = resolveTrainingEvaluationWindow(
      recurrence,
      clock,
      new Date('2026-01-01T00:00:00Z'),
    )
    expect(
      trainingEvidenceOutcome({
        recurrence,
        window,
        today: '2026-07-15',
        evidence: { completedOn: '2025-06-01', expiresOn: '2026-06-01' },
        hasProgress: true,
      }).status,
    ).toBe('overdue')
  })
})
