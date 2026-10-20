import { describe, expect, it } from 'vitest'
import {
  resolveEvidenceEvaluationWindow,
  evidenceInWindow,
  trainingEvidenceOutcome,
} from './evidence-evaluation'

describe('training compliance evidence windows', () => {
  it('rejects an unexpired course record from a previous frequency period', () => {
    const recurrence = {
      kind: 'frequency' as const,
      frequency: 'week' as const,
      cron: '0 8 * * 1',
    }
    const clock = { now: new Date('2026-07-15T14:00:00Z'), timezone: 'UTC' }
    const window = resolveEvidenceEvaluationWindow(
      recurrence,
      clock,
      new Date('2026-01-01T00:00:00Z'),
    )

    expect(window.periodStart).toBe('2026-07-13')
    expect(evidenceInWindow('2026-07-12', window)).toBe(false)
    expect(evidenceInWindow('2026-07-13', window)).toBe(true)
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
    const window = resolveEvidenceEvaluationWindow(
      recurrence,
      clock,
      new Date('2026-01-01T00:00:00Z'),
    )

    expect(evidenceInWindow(new Date('2026-07-15T06:59:59Z'), window)).toBe(false)
    expect(evidenceInWindow(new Date('2026-07-15T07:00:00Z'), window)).toBe(true)
    expect(window.deadlinePassed).toBe(true)
  })

  it('does not start a cron period before the first eligible fire', () => {
    const recurrence = { kind: 'cron' as const, cron: '0 7 * * 1-5' }
    const clock = { now: new Date('2026-07-15T10:00:00Z'), timezone: 'UTC' }
    const window = resolveEvidenceEvaluationWindow(
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
    const window = resolveEvidenceEvaluationWindow(
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
    const window = resolveEvidenceEvaluationWindow(
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
    const window = resolveEvidenceEvaluationWindow(
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

describe('rolling completion validity', () => {
  const recurrence = {
    kind: 'frequency' as const,
    frequency: 'year' as const,
    evidenceWindow: 'rolling' as const,
  }
  it.each([
    ['2026-10-20', '2025-11-20', 'completed', '2026-11-20'],
    ['2026-10-20', '2025-10-20', 'completed', '2026-10-20'],
    ['2026-10-20', '2025-10-19', 'overdue', '2026-10-19'],
    ['2025-02-28', '2024-02-29', 'completed', '2025-02-28'],
    ['2025-03-01', '2024-02-29', 'overdue', '2025-02-28'],
    ['2026-10-20', '2026-10-21', 'overdue', '2027-10-21'],
  ])('evaluates %s against completion %s as %s', (today, completedOn, status, dueOn) => {
    const clock = { now: new Date(`${today}T16:00:00Z`), timezone: 'America/Toronto' }
    const window = resolveEvidenceEvaluationWindow(recurrence, clock, clock.now)
    expect(
      trainingEvidenceOutcome({
        recurrence,
        window,
        today,
        evidence: { completedOn, expiresOn: null },
        hasProgress: false,
      }),
    ).toMatchObject({ status, dueOn })
  })
  it('uses the tenant date at midnight and excludes future attempts', () => {
    const clock = { now: new Date('2026-01-01T02:00:00Z'), timezone: 'America/Toronto' }
    const window = resolveEvidenceEvaluationWindow(recurrence, clock, clock.now)
    expect(window.evidenceStartOn).toBe('2024-12-31')
    expect(window.evidenceEndOn).toBe('2025-12-31')
    expect(evidenceInWindow(new Date('2026-01-01T03:00:00Z'), window)).toBe(false)
    expect(window.nextDueAt?.toISOString()).toBe('2026-01-01T05:00:00.000Z')
  })
  it('does not extend validity beyond a certificate expiry', () => {
    const clock = { now: new Date('2026-10-20T16:00:00Z'), timezone: 'America/Toronto' }
    const window = resolveEvidenceEvaluationWindow(recurrence, clock, clock.now)
    expect(
      trainingEvidenceOutcome({
        recurrence,
        window,
        today: '2026-10-20',
        evidence: { completedOn: '2026-01-20', expiresOn: '2026-09-01' },
        hasProgress: false,
      }),
    ).toMatchObject({ status: 'overdue', dueOn: '2026-09-01' })
  })
})

it('keeps a rolling requirement overdue until the in-progress quiz is passed', () => {
  const recurrence = {
    kind: 'frequency' as const,
    frequency: 'year' as const,
    evidenceWindow: 'rolling' as const,
  }
  const clock = { now: new Date('2026-10-20T16:00:00Z'), timezone: 'America/Toronto' }
  const window = resolveEvidenceEvaluationWindow(recurrence, clock, clock.now)
  expect(
    trainingEvidenceOutcome({
      recurrence,
      window,
      today: '2026-10-20',
      evidence: null,
      hasProgress: true,
    }).status,
  ).toBe('overdue')
})

describe('completion windows across all frequencies', () => {
  it.each([
    ['day', '2026-10-19', '2026-10-20'],
    ['week', '2026-10-13', '2026-10-20'],
    ['month', '2026-09-20', '2026-10-20'],
    ['quarter', '2026-07-20', '2026-10-20'],
    ['year', '2025-10-20', '2026-10-20'],
  ] as const)(
    'keeps rolling %s valid through its completion anniversary',
    (frequency, completedOn, dueOn) => {
      const recurrence = {
        kind: 'frequency' as const,
        frequency,
        evidenceWindow: 'rolling' as const,
      }
      const clock = { now: new Date('2026-10-20T16:00:00Z'), timezone: 'America/Toronto' }
      const window = resolveEvidenceEvaluationWindow(recurrence, clock, clock.now)
      expect(
        trainingEvidenceOutcome({
          recurrence,
          window,
          today: '2026-10-20',
          evidence: { completedOn, expiresOn: null },
          hasProgress: false,
        }),
      ).toMatchObject({ status: 'completed', dueOn })
    },
  )
  it.each([
    ['year', { month: 12, day: 31, time: '17:00' }, '2026-01-01', '2026-12-31', '2026-12-31'],
    ['quarter', { month: 2, day: 15, time: '17:00' }, '2026-10-01', '2026-12-31', '2026-11-15'],
    ['month', { day: 15, time: '17:00' }, '2026-10-01', '2026-10-31', '2026-10-15'],
    ['week', { weekday: 5, time: '17:00' }, '2026-10-19', '2026-10-25', '2026-10-23'],
    ['day', { time: '17:00' }, '2026-10-20', '2026-10-20', '2026-10-20'],
  ] as const)(
    'resolves a fixed %s deadline independently of the assignment creation date',
    (frequency, deadline, periodStart, periodEnd, dueOn) => {
      const recurrence = {
        kind: 'frequency' as const,
        frequency,
        evidenceWindow: 'calendar' as const,
        deadline,
      }
      const clock = { now: new Date('2026-10-20T16:00:00Z'), timezone: 'America/Toronto' }
      const window = resolveEvidenceEvaluationWindow(recurrence, clock, clock.now)
      expect(window).toMatchObject({ periodStart, periodEnd, dueOn })
      expect(evidenceInWindow(periodStart, window)).toBe(true)
      expect(evidenceInWindow(new Date('2026-10-20T17:00:00Z'), window)).toBe(false)
      expect(
        trainingEvidenceOutcome({
          recurrence,
          window,
          today: '2026-10-20',
          evidence: null,
          hasProgress: false,
        }).status,
      ).toBe(frequency === 'month' ? 'overdue' : 'pending')
    },
  )
  it('clamps the 31st in a short month and applies daylight-saving time', () => {
    const recurrence = {
      kind: 'frequency' as const,
      frequency: 'month' as const,
      evidenceWindow: 'calendar' as const,
      deadline: { day: 31, time: '17:00' },
    }
    const feb = resolveEvidenceEvaluationWindow(
      recurrence,
      { now: new Date('2026-02-01T16:00:00Z'), timezone: 'America/Toronto' },
      new Date(),
    )
    expect(feb.dueOn).toBe('2026-02-28')
    expect(feb.nextDueAt?.toISOString()).toBe('2026-02-28T22:00:00.000Z')
    const march = resolveEvidenceEvaluationWindow(
      recurrence,
      { now: new Date('2026-03-01T16:00:00Z'), timezone: 'America/Toronto' },
      new Date(),
    )
    expect(march.nextDueAt?.toISOString()).toBe('2026-03-31T21:00:00.000Z')
  })
})
