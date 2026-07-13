import { describe, expect, it } from 'vitest'
import { cronOccursAt, lastCronOccurrenceBetween, nextCronAfter, parseCron } from './cron'

describe('cron scheduling', () => {
  it('requires a standard five-field expression', () => {
    expect(() => parseCron('0 0 0 * * *')).toThrow(/5 fields/)
    expect(() => parseCron('not a cron')).toThrow()
  })

  it('uses Vixie OR semantics when day-of-month and day-of-week are restricted', () => {
    const expression = '0 9 13 * 1'
    expect(cronOccursAt(expression, new Date('2026-07-13T09:00:00.000Z'))).toBe(true) // both
    expect(cronOccursAt(expression, new Date('2026-07-20T09:00:00.000Z'))).toBe(true) // Monday
    expect(cronOccursAt(expression, new Date('2026-08-13T09:00:00.000Z'))).toBe(true) // 13th
    expect(cronOccursAt(expression, new Date('2026-07-14T09:00:00.000Z'))).toBe(false)
  })

  it('evaluates an IANA timezone across daylight-saving changes', () => {
    const expression = '30 8 * * *'
    expect(cronOccursAt(expression, new Date('2026-07-12T12:30:00.000Z'), 'America/Toronto')).toBe(
      true,
    )
    expect(cronOccursAt(expression, new Date('2026-01-12T13:30:00.000Z'), 'America/Toronto')).toBe(
      true,
    )
  })

  it('finds the latest missed occurrence directly, including leap-day schedules', () => {
    const cron = parseCron('0 6 29 2 *')
    expect(
      lastCronOccurrenceBetween(
        cron,
        new Date('2024-03-01T00:00:00.000Z'),
        new Date('2028-03-01T00:00:00.000Z'),
      )?.toISOString(),
    ).toBe('2028-02-29T06:00:00.000Z')
    expect(nextCronAfter(cron, new Date('2024-03-01T00:00:00.000Z'))?.toISOString()).toBe(
      '2028-02-29T06:00:00.000Z',
    )
  })
})
