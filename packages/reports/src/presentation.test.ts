import { describe, expect, it } from 'vitest'
import type { ReportRunResult, ReportCustomQuery } from '@braedonsaunders/appkit-reports'
import { BEACON_REPORT_CATALOG } from './entities'
import {
  presentReportResult,
  reportPresentationFromLayout,
  validateReportPresentation,
} from './presentation'

const query: ReportCustomQuery = {
  entity: 'skill_assignments',
  columns: ['person_name', 'employee_no', 'department_name', 'person_status'],
}
const tenant = {
  name: 'Example Contractor',
  companyName: 'Example Contractor Ltd.',
  companyAddress: '123 Main Street',
}
const input: ReportRunResult = {
  groups: [
    {
      kind: 'results',
      title: 'License A',
      columns: [{ key: 'person_name', label: 'Person', semanticType: 'category' }],
      rows: [
        {
          person_name: 'Person One',
          employee_no: '001',
          department_name: 'Shop',
          person_status: 'active',
        },
        {
          person_name: 'Person One',
          employee_no: '001',
          department_name: 'Shop',
          person_status: 'active',
        },
        {
          person_name: 'Person Two',
          employee_no: '002',
          department_name: 'Field',
          person_status: 'inactive',
        },
      ],
    },
  ],
  summary: [{ key: 'rows', label: 'Rows', value: 3 }],
  rowCount: 3,
  truncated: false,
  durationMs: 1,
}

describe('saved tenant report content', () => {
  it('renders tenant headers, group counts, dates, mapped values, and signature sections through native groups', () => {
    const presentation = reportPresentationFromLayout({
      presentation: {
        version: 1,
        timezone: 'America/Vancouver',
        hideSummary: true,
        before: [
          {
            title: 'Qualification register',
            fields: [{ label: 'Company', value: '{{tenant.companyName}}', uppercase: true }],
          },
        ],
        groupTitle: 'Qualification — {{group.title}}',
        groupSubtitle: 'People: {{count.employee_no}} · {{date.month}}/{{date.year}}',
        rowNumberLabel: 'No.',
        columns: [
          { key: 'person_name', label: 'Employee' },
          {
            key: 'work_location',
            rules: [
              { column: 'person_status', notEquals: 'active', value: 'L' },
              { column: 'department_name', equals: 'shop', value: 'S' },
            ],
            defaultValue: 'F',
          },
        ],
        afterEachGroup: [
          {
            title: 'Supervisor approval',
            fields: [{ label: 'Signature', value: '________________' }],
          },
        ],
      },
    })!
    validateReportPresentation(presentation, query, BEACON_REPORT_CATALOG)
    const result = presentReportResult(
      input,
      presentation,
      tenant,
      new Date('2026-01-01T02:00:00Z'),
    )
    expect(result.groups).toHaveLength(3)
    expect(result.groups[0]!.rows[0]!.field_0).toBe('EXAMPLE CONTRACTOR LTD.')
    expect(result.groups[1]!.subtitle).toBe('People: 2 · 12/2025')
    expect(result.groups[1]!.rows.map((row) => row.row_number)).toEqual([1, 2, 3])
    expect(result.groups[1]!.rows.map((row) => row.work_location)).toEqual(['S', 'S', 'L'])
    expect(result.groups[1]!.columns.map((column) => column.key)).toEqual([
      'row_number',
      'person_name',
      'work_location',
    ])
    expect(result.rowCount).toBe(3)
    expect(result.summary).toEqual([])
    expect(input.groups).toHaveLength(1)
    expect(input.groups[0]!.rows[0]).not.toHaveProperty('row_number')
  })

  it('does not disclose tenant settings or columns outside the authorized query', () => {
    for (const value of [
      '{{tenant.mailPassword}}',
      '{{value.authority_code}}',
      '{{value.person_id}}',
      '{{count.unknown_id}}',
      '{{unknown.name}}',
      '{{tenant.name',
    ]) {
      const presentation = reportPresentationFromLayout({
        presentation: { version: 1, groupSubtitle: value },
      })
      expect(() => validateReportPresentation(presentation, query, BEACON_REPORT_CATALOG)).toThrow()
    }
    const presentation = reportPresentationFromLayout({
      presentation: {
        version: 1,
        columns: [
          {
            key: 'secret',
            rules: [{ column: 'authority_code', equals: 'anything', value: 'secret' }],
          },
        ],
      },
    })
    expect(() => validateReportPresentation(presentation, query, BEACON_REPORT_CATALOG)).toThrow()
  })

  it('rejects corrupt or unbounded configuration and invalid timezones', () => {
    for (const presentation of [
      { version: 2 },
      { version: 1, timezone: 'Bad/Zone' },
      { version: 1, hideSummary: 'true' },
      { version: 1, before: new Array(13).fill({ title: '', fields: [] }) },
      { version: 1, columns: [{ key: 'unsafe"' }] },
      {
        version: 1,
        columns: [
          {
            key: 'x',
            rules: [{ column: 'person_status', equals: 'active', notEquals: 'active', value: '' }],
          },
        ],
      },
    ])
      expect(() => reportPresentationFromLayout({ presentation })).toThrow()
    expect(reportPresentationFromLayout({})).toBeUndefined()
    expect(reportPresentationFromLayout({ presentation: null })).toBeUndefined()
  })

  it('preserves new author-selected columns while hiding template support fields', () => {
    const result = presentReportResult(
      {
        ...input,
        groups: [
          {
            ...input.groups[0]!,
            columns: [
              ...input.groups[0]!.columns,
              { key: 'employee_no', label: 'Employee number', semanticType: 'category' },
              { key: 'new_field', label: 'New additional field', semanticType: 'category' },
            ],
          },
        ],
      },
      {
        version: 1,
        hiddenColumns: ['employee_no'],
        columns: [{ key: 'person_name', label: 'Employee' }],
      },
      tenant,
    )
    expect(result.groups[0]!.columns.map((column) => column.key)).toEqual([
      'person_name',
      'new_field',
    ])
    expect(result.groups[0]!.columns[0]!.label).toBe('Employee')
  })

  it('resolves type values across all rows rather than depending on the first qualification', () => {
    const result = presentReportResult(
      input,
      { version: 1, groupSubtitle: '{{value.department_name}} · {{tenant.companyAddress}}' },
      tenant,
    )
    expect(result.groups[0]!.subtitle).toBe('Shop, Field · 123 Main Street')
    expect(result.summary).toEqual(input.summary)
  })
})
