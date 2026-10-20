import { describe, expect, it } from 'vitest'
import { complianceReminderAvailableAt } from './reminders'

describe('independent reminder cadence', () => {
  it('holds an afternoon status transition until the next local morning', () => {
    expect(
      complianceReminderAvailableAt(
        '0 8 * * *',
        'America/Toronto',
        new Date('2026-10-20T16:00:00Z'),
      ).toISOString(),
    ).toBe('2026-10-21T12:00:00.000Z')
  })
  it('can deliver during the scheduled minute without waiting another day', () => {
    expect(
      complianceReminderAvailableAt(
        '0 8 * * *',
        'America/Toronto',
        new Date('2026-10-20T12:00:42Z'),
      ).toISOString(),
    ).toBe('2026-10-20T12:00:42.000Z')
  })
  it('follows the local morning across the DST change', () => {
    expect(
      complianceReminderAvailableAt(
        '0 8 * * *',
        'America/Toronto',
        new Date('2026-10-31T16:00:00Z'),
      ).toISOString(),
    ).toBe('2026-11-01T13:00:00.000Z')
  })
})
