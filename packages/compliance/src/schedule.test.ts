import { describe, expect, it } from 'vitest'
import {
  frequencyProgress,
  resolveCronWindow,
  resolveFrequencyWindow,
  validateCronRecurrence,
} from './schedule'

const toronto = 'America/Toronto'

describe('frequency compliance schedule', () => {
  it('keeps the previous weekly period active until the next scheduled fire', () => {
    const beforeFire = resolveFrequencyWindow(
      { kind: 'frequency', frequency: 'week', cron: '0 8 * * 1' },
      { now: new Date('2026-07-13T11:00:00Z'), timezone: toronto },
      new Date('2026-01-01T00:00:00Z'),
    )
    expect(beforeFire.periodStart).toBe('2026-07-06')
    expect(beforeFire.dueAt.toISOString()).toBe('2026-07-06T12:00:00.000Z')

    const afterFire = resolveFrequencyWindow(
      { kind: 'frequency', frequency: 'week', cron: '0 8 * * 1' },
      { now: new Date('2026-07-13T13:00:00Z'), timezone: toronto },
      new Date('2026-01-01T00:00:00Z'),
    )
    expect(afterFire.periodStart).toBe('2026-07-13')
    expect(afterFire.dueOn).toBe('2026-07-13')
  })

  it('starts a newly-created mid-period obligation at the next fire', () => {
    const window = resolveFrequencyWindow(
      { kind: 'frequency', frequency: 'week', cron: '0 8 * * 1' },
      { now: new Date('2026-07-15T16:00:00Z'), timezone: toronto },
      new Date('2026-07-15T15:00:00Z'),
    )
    expect(window.periodStart).toBe('2026-07-20')
    expect(window.scheduledAt.toISOString()).toBe('2026-07-20T12:00:00.000Z')
  })

  it('allows a daily next-day due offset but rejects overlapping cycles', () => {
    const valid = resolveFrequencyWindow(
      {
        kind: 'frequency',
        frequency: 'day',
        cron: '0 8 * * *',
        dueOffsetMinutes: 1440,
      },
      { now: new Date('2026-07-13T13:00:00Z'), timezone: toronto },
      new Date('2026-01-01T00:00:00Z'),
    )
    expect(valid.dueAt.toISOString()).toBe('2026-07-14T12:00:00.000Z')

    expect(() =>
      resolveFrequencyWindow(
        {
          kind: 'frequency',
          frequency: 'day',
          cron: '0 8 * * *',
          dueOffsetMinutes: 1441,
        },
        { now: new Date('2026-07-13T13:00:00Z'), timezone: toronto },
        new Date('2026-01-01T00:00:00Z'),
      ),
    ).toThrow('must not extend beyond')
  })

  it('rejects cron expressions that do not fire exactly once per cadence period', () => {
    expect(() =>
      resolveFrequencyWindow(
        { kind: 'frequency', frequency: 'week', cron: '0 8 * * *' },
        { now: new Date('2026-07-13T13:00:00Z'), timezone: toronto },
        new Date('2026-01-01T00:00:00Z'),
      ),
    ).toThrow('more than once')

    expect(() =>
      resolveFrequencyWindow(
        { kind: 'frequency', frequency: 'week', cron: '0 0 8 * * 1' },
        { now: new Date('2026-07-13T13:00:00Z'), timezone: toronto },
        new Date('2026-01-01T00:00:00Z'),
      ),
    ).toThrow('exactly five fields')
  })
})

describe('frequency compliance threshold', () => {
  it('uses the configured threshold and caps displayed progress', () => {
    const due = new Date('2026-07-13T12:00:00Z')
    expect(frequencyProgress(4, 5, 80, due, new Date('2026-07-13T11:00:00Z'))).toEqual({
      status: 'completed',
      required: 4,
      percent: 80,
    })
    expect(frequencyProgress(7, 5, 100, due, new Date('2026-07-13T11:00:00Z')).percent).toBe(100)
  })

  it('becomes overdue only after the due instant', () => {
    const due = new Date('2026-07-13T12:00:00Z')
    expect(frequencyProgress(0, 1, 100, due, due).status).toBe('pending')
    expect(frequencyProgress(0, 1, 100, due, new Date(due.getTime() + 1)).status).toBe('overdue')
  })
})

describe('cron compliance schedule', () => {
  it('uses exact weekday fires and due offsets without a weekly fallback', () => {
    const window = resolveCronWindow(
      { kind: 'cron', cron: '0 7 * * 1-5', dueOffsetMinutes: 120 },
      { now: new Date('2026-07-13T12:00:00Z'), timezone: toronto },
      new Date('2026-01-01T00:00:00Z'),
    )
    expect(window.started).toBe(true)
    expect(window.scheduledAt.toISOString()).toBe('2026-07-13T11:00:00.000Z')
    expect(window.dueAt.toISOString()).toBe('2026-07-13T13:00:00.000Z')
    expect(window.nextScheduledAt.toISOString()).toBe('2026-07-14T11:00:00.000Z')
    expect(window.periodStart).toBe('2026-07-13')
    expect(window.periodEnd).toBe('2026-07-14')
  })

  it('starts a cron obligation created after a fire at the next occurrence', () => {
    const window = resolveCronWindow(
      { kind: 'cron', cron: '0 7 * * 1-5', dueOffsetMinutes: 60 },
      { now: new Date('2026-07-13T16:00:00Z'), timezone: toronto },
      new Date('2026-07-13T15:00:00Z'),
    )
    expect(window.started).toBe(false)
    expect(window.scheduledAt.toISOString()).toBe('2026-07-14T11:00:00.000Z')
    expect(window.evidenceStartAt.toISOString()).toBe('2026-07-14T11:00:00.000Z')
  })

  it('rejects an offset that overlaps the shortest upcoming cron interval', () => {
    expect(() =>
      validateCronRecurrence(
        { kind: 'cron', cron: '0 7 * * 1-5', dueOffsetMinutes: 1441 },
        { now: new Date('2026-07-17T10:00:00Z'), timezone: toronto },
      ),
    ).toThrow('must not extend beyond')
  })
})
