import { describe, expect, it } from 'vitest'
import {
  assertBoundedReportFilters,
  assertReportRecipientLimit,
  normalizeReportRecipientEmails,
  normalizeReportRecipientUserIds,
  REPORT_SCHEDULE_LIMITS,
} from './schedule-policy'

describe('report schedule policy', () => {
  it('normalizes and deduplicates recipient addresses and member identifiers', () => {
    expect(
      normalizeReportRecipientEmails([' Manager@Example.com ', 'manager@example.com']),
    ).toEqual(['manager@example.com'])
    expect(normalizeReportRecipientUserIds([' user_123 ', 'user_123'])).toEqual(['user_123'])
  })

  it('rejects malformed or oversized recipient values', () => {
    expect(() => normalizeReportRecipientEmails(['not-an-email'])).toThrow(/Invalid/)
    expect(() => normalizeReportRecipientEmails([`a@${'x'.repeat(320)}.com`])).toThrow(/Invalid/)
    expect(() => normalizeReportRecipientUserIds(['member id'])).toThrow(/identifier/)
    expect(() =>
      assertReportRecipientLimit(
        Array.from({ length: REPORT_SCHEDULE_LIMITS.recipientCount }, (_, i) => `user_${i}`),
        ['extra@example.com'],
      ),
    ).toThrow(/at most/)
  })

  it('accepts bounded JSON filters and rejects hostile shapes', () => {
    expect(() => assertBoundedReportFilters({ days: 30, sites: ['one', 'two'] })).not.toThrow()
    expect(() => assertBoundedReportFilters([])).toThrow(/JSON object/)
    expect(() => assertBoundedReportFilters({ ['__proto__']: 'value' })).toThrow(/invalid key/)

    let nested: Record<string, unknown> = { value: true }
    for (let i = 0; i <= REPORT_SCHEDULE_LIMITS.filtersDepth; i += 1) nested = { nested }
    expect(() => assertBoundedReportFilters(nested)).toThrow(/deeply/)

    expect(() =>
      assertBoundedReportFilters({
        values: Array.from({ length: REPORT_SCHEDULE_LIMITS.filtersNodes + 1 }, () => true),
      }),
    ).toThrow(/too many/)
  })
})
