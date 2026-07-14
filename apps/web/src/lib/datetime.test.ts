import { describe, expect, it } from 'vitest'
import { dateIsoInTimeZone, datetimeLocalValue, parseDatetimeLocal } from './datetime'

describe('timezone-aware datetime helpers', () => {
  it('formats the calendar date in the requested timezone', () => {
    const instant = new Date('2026-07-14T02:30:00.000Z')
    expect(dateIsoInTimeZone(instant, 'America/Toronto')).toBe('2026-07-13')
    expect(dateIsoInTimeZone(instant, 'UTC')).toBe('2026-07-14')
  })

  it('round-trips datetime-local values in the viewer timezone', () => {
    const instant = new Date('2026-01-15T19:30:00.000Z')
    expect(datetimeLocalValue(instant, 'America/Toronto')).toBe('2026-01-15T14:30')
    expect(parseDatetimeLocal('2026-01-15T14:30', 'America/Toronto')?.toISOString()).toBe(
      instant.toISOString(),
    )
  })

  it('preserves seconds and milliseconds when a caller supplies them', () => {
    expect(parseDatetimeLocal('2026-07-13T23:59:58.125', 'America/Toronto')?.toISOString()).toBe(
      '2026-07-14T03:59:58.125Z',
    )
  })

  it('accepts explicit offsets without applying the viewer timezone again', () => {
    expect(
      parseDatetimeLocal('2026-01-15T14:30:00-05:00', 'America/Vancouver')?.toISOString(),
    ).toBe('2026-01-15T19:30:00.000Z')
  })

  it('rejects normalized calendar dates and nonexistent DST wall-clock times', () => {
    expect(parseDatetimeLocal('2026-02-30T09:00', 'America/Toronto')).toBeNull()
    expect(parseDatetimeLocal('2026-13-01T09:00', 'America/Toronto')).toBeNull()
    expect(parseDatetimeLocal('2026-03-08T02:30', 'America/Toronto')).toBeNull()
  })
})
