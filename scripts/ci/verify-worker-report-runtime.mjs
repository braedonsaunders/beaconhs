// Resolve from the deployed worker, where bundled workspace imports execute.
// A second report-library version can otherwise be hoisted here even though
// the web build and workspace tests use the newer patched dependency.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const workerDirectory = process.argv[2]
assert.ok(workerDirectory, 'Pass the packaged worker directory')
const requireWorker = createRequire(resolve(workerDirectory, 'package.json'))
const { compileCustomReport, customReportResult } = await import(
  pathToFileURL(requireWorker.resolve('@braedonsaunders/appkit-reports')).href
)
const { renderReportDocumentBodyHtml } = await import(
  pathToFileURL(requireWorker.resolve('@braedonsaunders/appkit-reports/document')).href
)
const catalog = {
  entities: [
    {
      key: 'runtime_check',
      label: 'Runtime check',
      category: 'verification',
      table: 'runtime_check',
      columns: [
        { key: 'reference', label: 'Reference', kind: 'text' },
        { key: 'details', label: 'Details', kind: 'text' },
      ],
    },
  ],
}
const compiled = compileCustomReport(
  {
    entity: 'runtime_check',
    columns: ['reference', 'details'],
    columnWidths: { reference: 80, details: 320 },
  },
  '00000000-0000-4000-8000-000000000001',
  catalog,
)
assert.deepEqual(
  compiled.columns.map((column) => column.width),
  [80, 320],
  'Packaged worker must preserve configured report column widths',
)
const result = customReportResult(compiled, [{ reference: 'CHECK', details: 'Runtime check' }], 0)
const html = renderReportDocumentBodyHtml({
  tenantName: 'Runtime check',
  reportName: 'Runtime check',
  dateRangeLabel: '',
  groups: result.groups,
})
assert.ok(html.includes('table-layout:fixed'), 'Worker PDF renderer must use configured widths')
assert.ok(html.includes('<col style="width:20%"><col style="width:80%">'))
console.log('Verified packaged worker report query and PDF column widths')
