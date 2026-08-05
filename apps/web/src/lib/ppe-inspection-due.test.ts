import { describe, expect, it } from 'vitest'
import { nextPpeInspectionDue, resolvePpeInspectionDue } from './ppe-inspection-due'

describe('PPE inspection due state', () => {
  it('uses the configured pre-use cadence instead of a hard-coded interval', () => {
    expect(nextPpeInspectionDue('pre_use', '2026-08-05', { everyDays: 14 })).toBe('2026-08-19')
    expect(nextPpeInspectionDue('pre_use', '2026-08-05', null)).toBeNull()
  })

  it('keeps annual inspections on a calendar-year cadence', () => {
    expect(nextPpeInspectionDue('annual', '2024-02-29', null)).toBe('2025-03-01')
  })

  it('makes a configured never-completed checklist actionable', () => {
    expect(
      resolvePpeInspectionDue({
        todayIso: '2026-08-05',
        isInspectable: true,
        preUseCriteriaCount: 4,
        annualCriteriaCount: 0,
        lastInspectionOn: null,
        nextInspectionDue: null,
        lastAnnualInspectionOn: null,
        nextAnnualInspectionDue: null,
      }),
    ).toEqual({ kind: 'pre_use', dueOn: null, state: 'never_inspected', actionable: true })
  })

  it('chooses the earliest applicable checklist and ignores future-only items', () => {
    expect(
      resolvePpeInspectionDue({
        todayIso: '2026-08-05',
        isInspectable: true,
        preUseCriteriaCount: 3,
        annualCriteriaCount: 2,
        lastInspectionOn: '2026-08-01',
        nextInspectionDue: '2026-08-20',
        lastAnnualInspectionOn: '2025-08-05',
        nextAnnualInspectionDue: '2026-08-05',
      }),
    ).toEqual({ kind: 'annual', dueOn: '2026-08-05', state: 'due_today', actionable: true })
  })

  it('marks types without a checklist as not required', () => {
    expect(
      resolvePpeInspectionDue({
        todayIso: '2026-08-05',
        isInspectable: false,
        preUseCriteriaCount: 0,
        annualCriteriaCount: 0,
        lastInspectionOn: null,
        nextInspectionDue: null,
        lastAnnualInspectionOn: null,
        nextAnnualInspectionDue: null,
      }).state,
    ).toBe('not_required')
  })
})
