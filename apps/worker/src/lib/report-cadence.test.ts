import { describe, expect, it } from 'vitest'
import { computeNextRunAt } from '@beaconhs/reports'

describe('scheduled report cadence', () => {
  it('keeps the configured local hour across spring DST', () => {
    expect(
      computeNextRunAt(
        { cadence: 'daily', hour: 8, minute: 0, timezone: 'America/Toronto' },
        new Date('2026-03-07T13:01:00.000Z'),
      ).toISOString(),
    ).toBe('2026-03-08T12:00:00.000Z')
  })

  it('keeps the configured local hour across fall DST', () => {
    expect(
      computeNextRunAt(
        { cadence: 'daily', hour: 8, minute: 0, timezone: 'America/Toronto' },
        new Date('2026-10-31T12:01:00.000Z'),
      ).toISOString(),
    ).toBe('2026-11-01T13:00:00.000Z')
  })

  it('skips months that do not contain the requested day', () => {
    expect(
      computeNextRunAt(
        {
          cadence: 'monthly',
          dayOfMonth: 31,
          hour: 9,
          minute: 0,
          timezone: 'UTC',
        },
        new Date('2026-04-01T00:00:00.000Z'),
      ).toISOString(),
    ).toBe('2026-05-31T09:00:00.000Z')
  })
})
