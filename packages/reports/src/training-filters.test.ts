import { describe, expect, it } from 'vitest'
import {
  isTrainingReportQueryKind,
  normalizeTrainingReportFilters,
  trainingReportFiltersToRecord,
} from './training-filters'
import { rangeModeFor } from './run'

const personId = '11111111-1111-4111-8111-111111111111'
const courseId = '22222222-2222-4222-8222-222222222222'

describe('training report filters', () => {
  it('normalizes bounded runtime filters and drops untrusted values', () => {
    expect(
      normalizeTrainingReportFilters({
        personIds: `${personId},not-a-uuid,${personId}`,
        courseIds: [courseId],
        courseTypes: [' Orientation ', '', 'Orientation', 'Safety'],
        deliveryTypes: 'classroom,not-real,online',
        groupBy: 'employee',
        expiryWindowDays: '180',
        includeExpired: 'false',
      }),
    ).toEqual({
      personIds: [personId],
      departmentIds: [],
      groupIds: [],
      courseIds: [courseId],
      courseTypes: ['Orientation', 'Safety'],
      deliveryTypes: ['classroom', 'online'],
      groupBy: 'employee',
      expiryWindowDays: 180,
      includeExpired: false,
    })
  })

  it('uses production defaults and stores only canonical keys', () => {
    const normalized = normalizeTrainingReportFilters({ expiryWindowDays: 999 })
    expect(normalized.groupBy).toBe('course')
    expect(normalized.expiryWindowDays).toBe(90)
    expect(normalized.includeExpired).toBe(true)
    expect(trainingReportFiltersToRecord(normalized)).toEqual({
      groupBy: 'course',
      expiryWindowDays: 90,
      includeExpired: true,
    })
  })

  it('recognizes only the canonical training report runners', () => {
    expect(isTrainingReportQueryKind('training_missing')).toBe(true)
    expect(isTrainingReportQueryKind('training_expiring')).toBe(false)
    expect(rangeModeFor('training_missing')).toBe('as_of')
  })
})
