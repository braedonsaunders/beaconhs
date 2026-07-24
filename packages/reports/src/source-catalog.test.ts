import { describe, expect, it } from 'vitest'
import { compileCustomReport } from '@appkit/reports'
import { mergeAuthorizedReportSources, type ReportEntity } from './entities'

const scopedApp: ReportEntity = {
  key: 'form_responses:018f47ba-86c4-7ee2-8d7a-5e7602f2a004',
  label: 'Daily Equipment Check',
  category: 'Apps',
  description: 'Submitted responses for the “Daily Equipment Check” app.',
  table: 'form_responses',
  softDelete: true,
  baseFilter: {
    combinator: 'and',
    rules: [
      {
        field: 'template_id',
        op: 'eq',
        value: '018f47ba-86c4-7ee2-8d7a-5e7602f2a004',
      },
    ],
  },
  columns: [
    { key: 'status', label: 'Status', kind: 'enum' },
    { key: 'template_id', label: 'Template', kind: 'uuid' },
  ],
}

describe('authorized report source catalogue', () => {
  it('keeps the exact authorized source inventory and scoped Builder app predicate', () => {
    const sources = mergeAuthorizedReportSources([scopedApp])

    expect(sources).toEqual([scopedApp])
    expect(sources[0]?.baseFilter).toEqual(scopedApp.baseFilter)
  })

  it('compiles the app scope as an unavoidable query predicate', () => {
    const compiled = compileCustomReport(
      {
        entity: scopedApp.key,
        mode: 'rows',
        columns: ['status'],
        filters: null,
        groupBy: null,
        sort: null,
        sorts: null,
        limit: 100,
      },
      '118f47ba-86c4-7ee2-8d7a-5e7602f2a005',
      { entities: mergeAuthorizedReportSources([scopedApp]) },
    )

    expect(compiled.sql).toContain('"template_id"')
    expect(compiled.params).toContain('018f47ba-86c4-7ee2-8d7a-5e7602f2a004')
  })

  it('retains authored report projections while adopting Insights labels and categories', () => {
    const insightCorrectiveActions: ReportEntity = {
      key: 'corrective_actions',
      label: 'Corrective actions',
      category: 'Corrective actions',
      description: 'Discovered corrective action records.',
      table: 'corrective_actions',
      columns: [{ key: 'title', label: 'Title', kind: 'text' }],
    }

    const [source] = mergeAuthorizedReportSources([insightCorrectiveActions])

    expect(source?.table).toBe('report_corrective_actions')
    expect(source?.columns.some((column) => column.key === 'owner_name')).toBe(true)
    expect(source?.label).toBe(insightCorrectiveActions.label)
    expect(source?.category).toBe(insightCorrectiveActions.category)
  })
})
