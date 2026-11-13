import { describe, expect, it } from 'vitest'
import {
  afterEventDueOn,
  afterEventEvidenceCounts,
  afterEventNextDueAt,
  validateAfterEvent,
} from './after-event'
import {
  resolveCompletionCalendarWindow,
  resolveFrequencyWindow,
  rollingEvidenceBoundary,
  validateCronRecurrence,
  validateFrequencyRecurrence,
} from './schedule'
import { resolveEvidenceEvaluationWindow, trainingEvidenceOutcome } from './evidence-evaluation'

const toronto = 'America/Toronto'
const createdIn2026 = new Date('2026-03-10T15:00:00Z')

describe('every-N cadences', () => {
  it('runs multi-year calendar periods from the year the obligation started', () => {
    const recurrence = {
      kind: 'frequency' as const,
      frequency: 'year' as const,
      interval: 3,
      evidenceWindow: 'calendar' as const,
      deadline: { month: 12, day: 31, time: '23:59' },
    }
    const in2027 = resolveCompletionCalendarWindow(
      recurrence,
      { now: new Date('2027-06-01T16:00:00Z'), timezone: toronto },
      createdIn2026,
    )
    expect(in2027.periodStart).toBe('2026-01-01')
    expect(in2027.periodEnd).toBe('2028-12-31')
    // The deadline sits in the period's last year.
    expect(in2027.dueOn).toBe('2028-12-31')

    const in2029 = resolveCompletionCalendarWindow(
      recurrence,
      { now: new Date('2029-02-01T16:00:00Z'), timezone: toronto },
      createdIn2026,
    )
    expect(in2029.periodStart).toBe('2029-01-01')
    expect(in2029.periodEnd).toBe('2031-12-31')
  })

  it('splits fortnightly periods from the activation week', () => {
    const recurrence = { kind: 'frequency' as const, frequency: 'week' as const, interval: 2 }
    const activeFrom = new Date('2026-07-06T11:00:00Z') // Monday, before the 08:00 fire
    const first = resolveFrequencyWindow(
      recurrence,
      { now: new Date('2026-07-15T16:00:00Z'), timezone: toronto },
      activeFrom,
    )
    expect(first.periodStart).toBe('2026-07-06')
    expect(first.periodEnd).toBe('2026-07-19')
    const second = resolveFrequencyWindow(
      recurrence,
      { now: new Date('2026-07-22T16:00:00Z'), timezone: toronto },
      activeFrom,
    )
    expect(second.periodStart).toBe('2026-07-20')
    expect(second.periodEnd).toBe('2026-08-02')
  })

  it('stretches a rolling window and its validity by the interval', () => {
    const clock = { now: new Date('2026-07-15T16:00:00Z'), timezone: toronto }
    expect(rollingEvidenceBoundary(clock, 'year', 3).startOn).toBe('2023-07-15')
    const recurrence = {
      kind: 'frequency' as const,
      frequency: 'year' as const,
      interval: 3,
      evidenceWindow: 'rolling' as const,
    }
    const window = resolveEvidenceEvaluationWindow(recurrence, clock, createdIn2026)
    const outcome = trainingEvidenceOutcome({
      recurrence,
      window,
      today: '2026-07-15',
      evidence: { completedOn: '2024-01-20', expiresOn: null },
      hasProgress: false,
    })
    expect(outcome).toEqual({ status: 'completed', dueOn: '2027-01-20', completedOn: '2024-01-20' })
  })

  it('rejects invalid intervals and intervals on custom cron schedules', () => {
    const clock = { now: new Date('2026-07-15T16:00:00Z'), timezone: toronto }
    expect(() =>
      validateFrequencyRecurrence(
        { kind: 'frequency', frequency: 'month', evidenceWindow: 'rolling', interval: 0 },
        clock,
      ),
    ).toThrow('Repeat every')
    expect(() =>
      validateCronRecurrence({ kind: 'cron', cron: '0 8 * * 1', interval: 2 }, clock),
    ).toThrow('cannot repeat every N periods')
  })
})

describe('one-time after an event', () => {
  const rule = { event: 'hire' as const, days: 30, countPrior: false }

  it('is due the rule days after each person event', () => {
    expect(afterEventDueOn(rule, '2026-01-15')).toBe('2026-02-14')
    expect(afterEventDueOn(rule, null)).toBeNull()
  })

  it('only counts completions on or after the event unless prior work is allowed', () => {
    expect(afterEventEvidenceCounts(rule, '2026-01-15', '2025-06-01')).toBe(false)
    expect(afterEventEvidenceCounts(rule, '2026-01-15', '2026-01-15')).toBe(true)
    expect(
      afterEventEvidenceCounts({ ...rule, countPrior: true }, '2026-01-15', '2025-06-01'),
    ).toBe(true)
    // Unknown event date: any completion is accepted.
    expect(afterEventEvidenceCounts(rule, null, '2025-06-01')).toBe(true)
  })

  it('rescans when the earliest open due date passes', () => {
    const next = afterEventNextDueAt(
      [
        { status: 'completed', dueOn: '2026-07-16' },
        { status: 'pending', dueOn: '2026-07-20' },
        { status: 'overdue', dueOn: '2026-07-01' },
        { status: 'pending', dueOn: null },
      ],
      { now: new Date('2026-07-15T16:00:00Z'), timezone: toronto },
    )
    expect(next?.toISOString()).toBe('2026-07-21T04:00:00.000Z')
  })

  it('validates the rule', () => {
    expect(() => validateAfterEvent({ ...rule, days: -1 })).toThrow('Days after the event')
    expect(() => validateAfterEvent({ event: 'job_title', days: 7, countPrior: true })).toThrow(
      'Pick the job title',
    )
    expect(() => validateAfterEvent({ event: 'group_join', days: 7, countPrior: true })).toThrow(
      'Pick the people group',
    )
    expect(() => validateAfterEvent(rule)).not.toThrow()
  })
})
