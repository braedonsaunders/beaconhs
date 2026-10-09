import { describe, expect, it } from 'vitest'
import { compileCustomReport, customReportResult } from '@braedonsaunders/appkit-reports'
import { BEACON_REPORT_CATALOG } from './entities'
import { extractReportCounts, reportCountProjection } from './presentation-counts'
import { presentReportResult, validateReportPresentation } from './presentation'

it('counts distinct people with identical names without exposing their IDs', () => {
  const catalog = {
    entities: BEACON_REPORT_CATALOG.entities.map((entity) => ({
      ...entity,
      columns: entity.columns.map((column) => ({ ...column, hidden: column.kind === 'uuid' })),
    })),
  }
  const query = {
    entity: 'skill_assignments',
    columns: ['person_name'],
    filters: {
      combinator: 'and' as const,
      rules: [{ field: 'outcome', op: 'eq' as const, value: 'complete' }],
    },
    limit: 2,
  }
  const presentation = { version: 1 as const, groupSubtitle: 'People: {{count.person_id}}' }
  validateReportPresentation(presentation, query, catalog)
  expect(() =>
    compileCustomReport({ ...query, columns: ['person_id'] }, 'tenant-a', catalog),
  ).toThrow()
  const original = compileCustomReport(query, 'tenant-a', catalog)
  const { compiled, fields } = reportCountProjection(original, query.entity, catalog, presentation)
  expect(compiled.params).toEqual(original.params)
  expect(compiled.sql.slice(compiled.sql.indexOf('\nFROM'))).toBe(
    original.sql.slice(original.sql.indexOf('\nFROM')),
  )
  const result = customReportResult(
    compiled,
    [
      { person_name: 'Same Name', __report_count_0: 'person-a' },
      { person_name: 'Same Name', __report_count_0: 'person-b' },
      { person_name: 'Same Name', __report_count_0: 'person-c' },
    ],
    1,
  )
  const extracted = extractReportCounts(result, fields)
  const output = presentReportResult(
    extracted.result,
    presentation,
    { name: 'Tenant', companyName: 'Tenant', companyAddress: '' },
    new Date(),
    extracted.counts,
  )
  expect(output.groups[0]!.subtitle).toBe('People: 2')
  expect(output.truncated).toBe(true)
  expect(JSON.stringify(output)).not.toContain('person-a')
  expect(JSON.stringify(output)).not.toContain('__report_count')
})

describe('report count projection', () => {
  it('leaves ordinary reports unchanged', () => {
    const compiled = compileCustomReport(
      { entity: 'skill_assignments', columns: ['person_name'] },
      'tenant-a',
      BEACON_REPORT_CATALOG,
    )
    expect(
      reportCountProjection(compiled, 'skill_assignments', BEACON_REPORT_CATALOG, undefined),
    ).toEqual({ compiled, fields: [] })
  })
})
