import { describe, expect, it } from 'vitest'
import { formComplianceBoundaryDue } from './form-compliance-schedule'

describe('form compliance scan boundaries', () => {
  const recurrence = { kind: 'cron' as const, cron: '0 7 * * 1-5', dueOffsetMinutes: 120 }

  it('runs at the exact fire and first overdue minute', () => {
    expect(
      formComplianceBoundaryDue(recurrence, new Date('2026-07-13T11:00:00Z'), 'America/Toronto'),
    ).toBe(true)
    expect(
      formComplianceBoundaryDue(recurrence, new Date('2026-07-13T13:01:00Z'), 'America/Toronto'),
    ).toBe(true)
  })

  it('does not run between schedule boundaries', () => {
    expect(
      formComplianceBoundaryDue(recurrence, new Date('2026-07-13T12:00:00Z'), 'America/Toronto'),
    ).toBe(false)
  })

  it('honors the canonical day offset when supplied by imported policy', () => {
    expect(
      formComplianceBoundaryDue(
        { kind: 'cron', cron: '0 7 * * 1', dueOffsetDays: 1 },
        new Date('2026-07-14T11:01:00Z'),
        'America/Toronto',
      ),
    ).toBe(true)
  })
})
