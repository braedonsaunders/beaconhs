import { describe, expect, it } from 'vitest'
import { compileCustomReport, customReportResult } from '@braedonsaunders/appkit-reports'
import { BEACON_REPORT_CATALOG } from './entities'
import { skillAdditionalColumnKey, skillAdditionalReportColumns } from './skill-additional-columns'

describe('tenant skill additional report fields', () => {
  it('supports grouping and filtering any discovered field using its own values', () => {
    const columns = skillAdditionalReportColumns('report_skill_assignments', [
      { key: 'license class', label: 'License class', values: ['A', 'B'] },
    ])
    const key = columns[0]!.key
    const catalog = {
      entities: BEACON_REPORT_CATALOG.entities.map((entity) =>
        entity.key === 'skill_assignments'
          ? { ...entity, columns: [...entity.columns, ...columns] }
          : entity,
      ),
    }
    const compiled = compileCustomReport(
      {
        entity: 'skill_assignments',
        columns: ['person_name'],
        groupBy: key,
        filters: { combinator: 'and', rules: [{ field: key, op: 'eq', value: 'A' }] },
      },
      '00000000-0000-4000-8000-000000000001',
      catalog,
    )
    expect(compiled.sql).toContain(
      `"report_skill_assignments"."additional_fields"->>'license class'`,
    )
    expect(compiled.params).toContain('A')
    expect(columns[0]!.filterOptions).toEqual([
      { value: 'A', label: 'A' },
      { value: 'B', label: 'B' },
    ])
    const result = customReportResult(compiled, [{ person_name: 'A Person', [key]: 'A' }], 1)
    expect(result.groups[0]!.title).toBe('A')
  })

  it('keeps field names and SQL identifiers safe without collisions or truncation', () => {
    const labels = ['A-B', 'A B', "Inspector's comment", 'Québec – qualification', 'x'.repeat(200)]
    const columns = skillAdditionalReportColumns(
      'report_skill_coverage',
      labels.map((key) => ({ key, label: key, values: [] })),
    )
    expect(new Set(columns.map((column) => column.key)).size).toBe(labels.length)
    for (const column of columns) expect(column.key).toMatch(/^af_[a-f0-9]{32}$/)
    expect(columns[2]!.expression).toContain("Inspector''s comment")
    expect(skillAdditionalColumnKey('STANDARD')).toBe(skillAdditionalColumnKey('standard'))
    expect(
      skillAdditionalReportColumns('not_an_allowed_table', [{ key: 'x', label: 'x', values: [] }]),
    ).toEqual([])
  })

  it('has no industry fields in the shared catalog and does not mutate it when augmenting', () => {
    const columns = BEACON_REPORT_CATALOG.entities.find(
      (entity) => entity.key === 'skill_assignments',
    )!.columns
    expect(
      columns.some((column) => /cwb|shop_field_layoff/i.test(`${column.key} ${column.label}`)),
    ).toBe(false)
    skillAdditionalReportColumns('report_skill_assignments', [
      { key: 'standard', label: 'Standard', values: ['Customer standard'] },
    ])
    expect(columns.some((column) => column.key.startsWith('af_'))).toBe(false)
  })
})
