import { describe, expect, it } from 'vitest'
import { classDayCount } from './class-days'

// The calendar bucketed classes on starts_at alone, so a three-day course
// showed on one day and vanished for the rest of its run. Day count decides how
// many cells a class occupies, so it is worth pinning exactly.

const at = (iso: string) => new Date(iso)

describe('classDayCount', () => {
  it('is one day for a class that starts and ends the same day', () => {
    expect(classDayCount(at('2026-09-08T08:00:00'), at('2026-09-08T16:00:00'), null)).toBe(1)
  })

  it('counts the calendar days spanned when no explicit length is set', () => {
    expect(classDayCount(at('2026-09-08T08:00:00'), at('2026-09-10T16:00:00'), null)).toBe(3)
  })

  it('trusts lengthDays over the start/end times', () => {
    // A three-day course entered as one day's hours plus lengthDays: 3.
    expect(classDayCount(at('2026-09-08T08:00:00'), at('2026-09-08T16:00:00'), 3)).toBe(3)
  })

  it('counts an overnight class that ends the next morning as two days', () => {
    expect(classDayCount(at('2026-09-08T20:00:00'), at('2026-09-09T04:00:00'), null)).toBe(2)
  })

  it('never returns less than a day, even if ends_at precedes starts_at', () => {
    expect(classDayCount(at('2026-09-08T08:00:00'), at('2026-09-07T08:00:00'), null)).toBe(1)
    expect(classDayCount(at('2026-09-08T08:00:00'), at('2026-09-08T16:00:00'), 0)).toBe(1)
  })

  it('spans a month boundary correctly', () => {
    expect(classDayCount(at('2026-09-30T08:00:00'), at('2026-10-02T16:00:00'), null)).toBe(3)
  })
})
