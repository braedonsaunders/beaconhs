import { describe, expect, it } from 'vitest'
import {
  isOperationalFilterReportSlug,
  normalizeOperationalReportFilters,
  operationalReportFiltersToRecord,
} from './operational-filters'

const personId = '11111111-1111-4111-8111-111111111111'
const departmentId = '22222222-2222-4222-8222-222222222222'

describe('operational report filters', () => {
  it('normalizes bounded compliance filters and orders an inverted date range', () => {
    expect(
      normalizeOperationalReportFilters('compliance_by_person', {
        personIds: `${personId},not-a-uuid,${personId}`,
        departmentIds: [departmentId],
        sourceModules: 'training,not-real,inspection',
        complianceStatuses: ['overdue', 'not-real', 'completed'],
        fromDate: '2026-12-31',
        toDate: '2026-01-01',
      }),
    ).toMatchObject({
      personIds: [personId],
      departmentIds: [departmentId],
      sourceModules: ['inspection', 'training'],
      complianceStatuses: ['completed', 'overdue'],
      fromDate: '2026-01-01',
      toDate: '2026-12-31',
    })
  })

  it('uses report-specific grouping and expiry defaults', () => {
    const filters = normalizeOperationalReportFilters('ppe_expired_upcoming', {
      groupBy: 'authority',
      expiryWindowDays: 999,
    })

    expect(filters.groupBy).toBe('type')
    expect(filters.expiryWindowDays).toBe(90)
    expect(operationalReportFiltersToRecord('ppe_expired_upcoming', filters)).toEqual({
      groupBy: 'type',
      expiryWindowDays: 90,
    })
  })

  it('recognizes only reports with canonical runtime filtering', () => {
    expect(isOperationalFilterReportSlug('skills_missing')).toBe(true)
    expect(isOperationalFilterReportSlug('equipment_roi')).toBe(false)
    expect(isOperationalFilterReportSlug('training_certificate_matrix')).toBe(false)
  })
})
