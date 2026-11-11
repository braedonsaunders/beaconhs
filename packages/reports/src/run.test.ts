import { describe, expect, it } from 'vitest'
import { compileCustomReport } from '@braedonsaunders/appkit-reports'
import { BEACON_REPORT_CATALOG } from './entities'
import { normalizeGroupedRowSorts } from './run'

describe('normalizeGroupedRowSorts', () => {
  it('anchors groupBy first when a grouped row report sorts by a nullable secondary column', () => {
    const normalized = normalizeGroupedRowSorts({
      entity: 'training_matrix',
      mode: 'rows',
      columns: ['person_name', 'course_name', 'expires_on', 'booking_coverage_status'],
      groupBy: 'person_name',
      sorts: [{ column: 'expires_on', direction: 'asc' }],
    })

    expect(normalized.sorts).toEqual([
      { column: 'person_name', direction: 'asc' },
      { column: 'expires_on', direction: 'asc' },
    ])

    const compiled = compileCustomReport(
      normalized,
      '00000000-0000-4000-8000-000000000001',
      BEACON_REPORT_CATALOG,
    )
    expect(compiled.sql).toContain(
      'ORDER BY "report_training_matrix"."person_name" ASC NULLS LAST, "report_training_matrix"."expires_on" ASC NULLS LAST',
    )
  })

  it('preserves an explicit descending sort on the groupBy column itself', () => {
    const normalized = normalizeGroupedRowSorts({
      entity: 'training_matrix',
      mode: 'rows',
      columns: ['person_name', 'course_name'],
      groupBy: 'person_name',
      sorts: [
        { column: 'person_name', direction: 'desc' },
        { column: 'course_name', direction: 'asc' },
      ],
    })

    expect(normalized.sorts).toEqual([
      { column: 'person_name', direction: 'desc' },
      { column: 'course_name', direction: 'asc' },
    ])
  })

  it('leaves ungrouped and summarize queries untouched', () => {
    const ungrouped = {
      entity: 'training_matrix',
      mode: 'rows' as const,
      columns: ['person_name', 'course_name'],
      groupBy: null,
      sorts: [{ column: 'expires_on', direction: 'asc' as const }],
    }
    expect(normalizeGroupedRowSorts(ungrouped)).toBe(ungrouped)
  })
})
