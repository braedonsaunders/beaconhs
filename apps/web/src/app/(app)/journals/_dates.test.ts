import { afterEach, describe, expect, it, vi } from 'vitest'
import { isJournalDate, journalDateChoices } from './_dates'
import { isToday } from './_format'

afterEach(() => vi.useRealTimers())

describe('journal calendar dates', () => {
  it.each([
    ['2026-10-06T01:00:00Z', 'America/Toronto', '2026-10-05', '2026-10-06'],
    ['2026-10-05T23:30:00Z', 'Asia/Tokyo', '2026-10-06', '2026-10-07'],
    ['2026-03-08T05:30:00Z', 'America/Toronto', '2026-03-08', '2026-03-09'],
    ['2026-11-01T04:30:00Z', 'America/Toronto', '2026-11-01', '2026-11-02'],
    ['2026-12-31T18:00:00Z', 'America/Toronto', '2026-12-31', '2027-01-01'],
    ['2028-02-28T18:00:00Z', 'America/Toronto', '2028-02-28', '2028-02-29'],
  ])('uses the viewer calendar at %s in %s', (instant, timeZone, today, tomorrow) => {
    expect(journalDateChoices(new Date(instant!), timeZone!)).toEqual({ today, tomorrow })
  })

  it.each(['2026-02-30', '2026-13-01', '', '2026-2-01', '2026-10-06T00:00:00Z', null])(
    'rejects invalid date %s at every journal boundary',
    (value) => expect(isJournalDate(value)).toBe(false),
  )

  it('accepts any valid future calendar date including leap days', () => {
    expect(isJournalDate('2028-02-29')).toBe(true)
    expect(isJournalDate('2027-01-01')).toBe(true)
  })

  it('labels today using the same timezone as journal creation', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T01:00:00Z'))
    expect(isToday('2026-10-05', 'America/Toronto')).toBe(true)
    expect(isToday('2026-10-06', 'America/Toronto')).toBe(false)
    expect(isToday('2026-10-06', 'Asia/Tokyo')).toBe(true)
  })
})
