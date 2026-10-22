import { describe, expect, it } from 'vitest'
import { addIntervalToDate, isDailyOrPreUseInspection } from './intervals'

describe('maintenance calendar intervals', () => {
  it('clamps monthly dates rather than skipping February', () => {
    expect(addIntervalToDate('2026-01-31', 1, 'month')).toBe('2026-02-28')
    expect(addIntervalToDate('2028-01-31', 1, 'month')).toBe('2028-02-29')
  })
  it('supports tenant configured multi-year inspections and leap years', () => {
    expect(addIntervalToDate('2024-02-29', 5, 'year')).toBe('2029-02-28')
    expect(addIntervalToDate('2026-10-02', 5, 'year')).toBe('2031-10-02')
  })
})

describe('before-use inspection choices', () => {
  it('includes daily checklists as well as explicitly pre-use checklists', () => {
    expect(
      isDailyOrPreUseInspection({ isPreUse: false, intervalValue: 1, intervalUnit: 'day' }),
    ).toBe(true)
    expect(
      isDailyOrPreUseInspection({ isPreUse: true, intervalValue: null, intervalUnit: null }),
    ).toBe(true)
    expect(
      isDailyOrPreUseInspection({ isPreUse: false, intervalValue: 2, intervalUnit: 'day' }),
    ).toBe(false)
    expect(
      isDailyOrPreUseInspection({ isPreUse: false, intervalValue: 1, intervalUnit: 'year' }),
    ).toBe(false)
  })
})
