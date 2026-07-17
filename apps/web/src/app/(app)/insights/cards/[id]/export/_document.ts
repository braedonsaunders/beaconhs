import type { BhqlResult } from '@beaconhs/analytics'
import type { DatasetAnalysis } from '@beaconhs/ai'
import type { ReportGroup, ReportSummaryItem } from '@beaconhs/reports'

const PIVOT_COLUMNS_PER_GROUP = 8

function printable(value: unknown): string | number {
  if (value === null || typeof value === 'undefined' || value === '' || value === 'missing') {
    return ''
  }
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

export function cardResultDocument(result: BhqlResult): {
  groups: ReportGroup[]
  summary: ReportSummaryItem[]
  rowCount: number
} {
  if (result.shape === 'flat') {
    const rowCount = result.rows.length
    return {
      rowCount,
      summary: [{ label: 'Rows', value: rowCount }],
      groups: [
        {
          title: 'Results',
          subtitle: result.truncated
            ? `Showing the first ${rowCount.toLocaleString()} rows`
            : undefined,
          columns: result.columns.map((column) => column.label),
          rows: result.rows.map((row) =>
            result.columns.map((column) => printable(row[column.key])),
          ),
          isEmpty: rowCount === 0,
        },
      ],
    }
  }

  const groups: ReportGroup[] = []
  const measures = result.valueMeasures.length > 0 ? result.valueMeasures : [null]
  for (const measure of measures) {
    for (let start = 0; start < result.columnKeys.length; start += PIVOT_COLUMNS_PER_GROUP) {
      const columnKeys = result.columnKeys.slice(start, start + PIVOT_COLUMNS_PER_GROUP)
      const end = start + columnKeys.length
      groups.push({
        title: measure?.label ?? 'Results',
        subtitle:
          result.columnKeys.length > PIVOT_COLUMNS_PER_GROUP
            ? `Columns ${(start + 1).toLocaleString()}-${end.toLocaleString()} of ${result.columnKeys.length.toLocaleString()}`
            : undefined,
        columns: [
          ...result.rowDimensions.map((dimension) => dimension.label),
          ...columnKeys.map((key) => key.labels.join(' · ')),
        ],
        rows: result.rowKeys.map((rowKey, rowIndex) => [
          ...rowKey.labels,
          ...columnKeys.map((_key, offset) => {
            const cell = result.cells[rowIndex]?.[start + offset]
            return printable(measure && cell ? cell[measure.key] : null)
          }),
        ]),
        isEmpty: result.rowKeys.length === 0 || columnKeys.length === 0,
      })
    }
  }

  if (groups.length === 0) {
    groups.push({ title: 'Results', columns: [], rows: [], isEmpty: true })
  }

  return {
    groups,
    summary: [
      { label: 'Rows', value: result.rowKeys.length },
      { label: 'Columns', value: result.columnKeys.length },
    ],
    rowCount: result.rowKeys.length,
  }
}

export function aiCardDocument(
  analysis: DatasetAnalysis,
  rowCount: number,
): {
  groups: ReportGroup[]
  summary: ReportSummaryItem[]
  rowCount: number
} {
  return {
    rowCount,
    summary: [{ label: 'Rows analysed', value: rowCount }],
    groups: [
      {
        title: 'Summary',
        columns: ['Analysis'],
        rows: [[analysis.summary]],
      },
      {
        title: 'Key points',
        columns: ['Tone', 'Point', 'Detail'],
        rows: analysis.points.map((point) => [point.tone, point.title, point.detail]),
        isEmpty: analysis.points.length === 0,
      },
    ],
  }
}

export function cardExportFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'card'
  )
}
