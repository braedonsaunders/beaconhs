import { describe, expect, it } from 'vitest'
import {
  validateAfterEvent,
  validateCronRecurrence,
  validateFrequencyRecurrence,
} from '@beaconhs/compliance'
import type { ComplianceRecurrence } from '@beaconhs/db/schema'
import { buildRecurrence } from './_build-recurrence'
import { KIND_META, OBLIGATION_KINDS } from './_meta'

const clock = { now: new Date('2026-11-13T15:00:00Z'), timezone: 'America/Toronto' }

/** What the save action checks before writing. */
function assertSavable(recurrence: ComplianceRecurrence) {
  if (recurrence.kind === 'frequency') validateFrequencyRecurrence(recurrence, clock)
  if (recurrence.kind === 'cron') validateCronRecurrence(recurrence, clock)
  if (recurrence.afterEvent) validateAfterEvent(recurrence.afterEvent)
}

describe('obligation recurrences built from the form', () => {
  it('saves every kind with its default recurring cadence', () => {
    for (const kind of OBLIGATION_KINDS) {
      const fields = KIND_META[kind].recurrence
      expect(() =>
        assertSavable(
          buildRecurrence(kind, {
            kind: fields.recurring ? 'frequency' : 'one_time',
            frequency: 'year',
            evidenceWindow: fields.rolling ? 'rolling' : undefined,
            quantity: 1,
          }),
        ),
      ).not.toThrow()
    }
  })

  it('saves rolling and calendar documents even with a stale cron or offset in the form', () => {
    for (const evidenceWindow of ['rolling', 'calendar'] as const) {
      for (const kind of ['document', 'training'] as const) {
        const recurrence = buildRecurrence(kind, {
          kind: 'frequency',
          frequency: 'year',
          interval: 3,
          evidenceWindow,
          cron: '0 8 * * 1',
          dueOffsetMinutes: 60,
        })
        expect(recurrence.cron).toBeUndefined()
        expect(recurrence.dueOffsetMinutes).toBeUndefined()
        expect(recurrence.interval).toBe(3)
        expect(() => assertSavable(recurrence)).not.toThrow()
      }
    }
  })

  it('stores an after-event rule as a one-time recurrence with only its own fields', () => {
    const recurrence = buildRecurrence('document', {
      kind: 'after_event',
      afterEvent: {
        event: 'hire',
        days: 30,
        countPrior: false,
        titleId: '10000000-0000-4000-8000-000000000001',
      },
    })
    expect(recurrence).toEqual({
      kind: 'one_time',
      afterEvent: { event: 'hire', days: 30, countPrior: false },
      remindBeforeDays: 7,
    })
    expect(() => assertSavable(recurrence)).not.toThrow()
  })
})
