import { describe, expect, it } from 'vitest'
import {
  compileCustomReport,
  customReportResult,
  type ReportCustomQuery,
} from '@braedonsaunders/appkit-reports'
import { renderReportDocumentBodyHtml } from '@braedonsaunders/appkit-reports/document'
import { BEACON_REPORT_CATALOG } from './entities'

const query: ReportCustomQuery = {
  entity: 'incidents',
  columns: ['reference', 'title'],
  columnLabels: { title: 'Details' },
  columnWidths: { reference: 80, title: 320 },
}
const compile = (value: ReportCustomQuery) =>
  compileCustomReport(value, '00000000-0000-4000-8000-000000000001', BEACON_REPORT_CATALOG)
describe('report column widths', () => {
  it('keeps widths with column keys when saving and reordering, through preview/PDF data', () => {
    const saved = JSON.parse(JSON.stringify(query)) as ReportCustomQuery
    const compiled = compile({ ...saved, columns: ['title', 'reference'] })
    expect(compiled.columns.map((c) => [c.key, c.label, c.width])).toEqual([
      ['title', 'Details', 320],
      ['reference', 'Reference', 80],
    ])
    const result = customReportResult(
      compiled,
      [{ reference: 'INC-1', title: 'Long description' }],
      0,
    )
    const html = renderReportDocumentBodyHtml({
      tenantName: 'Test',
      reportName: 'Widths',
      dateRangeLabel: '',
      groups: result.groups,
    })
    expect(html).toContain('table-layout:fixed')
    expect(html).toContain('<col style="width:80%"><col style="width:20%">')
  })
  it('leaves old reports on automatic layout and clears widths without affecting labels', () => {
    const compiled = compile({ ...query, columnWidths: {} })
    expect(compiled.columns.map((c) => c.width)).toEqual([undefined, undefined])
    const html = renderReportDocumentBodyHtml({
      tenantName: 'Test',
      reportName: 'Auto',
      dateRangeLabel: '',
      groups: [
        { title: '', columns: compiled.columns, rows: [{ reference: 'INC-1', title: 'Details' }] },
      ],
    })
    expect(html).not.toContain('<colgroup>')
  })
  it('rejects malformed widths before query execution', () => {
    for (const width of [0, 39, 1201, NaN, Infinity, 80.5, '100', '100%;color:red']) {
      expect(() => compile({ ...query, columnWidths: { title: width as number } })).toThrow(
        'Column width',
      )
    }
  })
})
