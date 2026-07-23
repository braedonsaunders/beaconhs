import type { BhqlResult } from '@beaconhs/analytics'
import type { DatasetAnalysis } from '@beaconhs/ai'
import type { ReportColumn, ReportGroup, ReportSummaryItem } from '@beaconhs/reports'

const PIVOT_COLUMNS_PER_GROUP = 8

function printable(value: unknown): string | number {
  if (value === null || typeof value === 'undefined' || value === '' || value === 'missing') {
    return ''
  }
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function reportColumn(key: string, label: string, dataType = 'string'): ReportColumn {
  return {
    key,
    label,
    semanticType: dataType === 'number' ? 'number' : dataType === 'date' ? 'date' : 'text',
  }
}

function rowFromValues(columns: ReportColumn[], values: unknown[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column, index) => [column.key, values[index] ?? '']))
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
      summary: [{ key: 'rows', label: 'Rows', value: rowCount }],
      groups: [
        {
          kind: 'results',
          title: 'Results',
          subtitle: result.truncated
            ? `Showing the first ${rowCount.toLocaleString()} rows`
            : undefined,
          columns: result.columns.map((column) =>
            reportColumn(column.key, column.label, column.dataType),
          ),
          rows: result.rows.map((row) =>
            Object.fromEntries(
              result.columns.map((column) => [column.key, printable(row[column.key])]),
            ),
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
      const columns = [
        ...result.rowDimensions.map((dimension) =>
          reportColumn(`row_${dimension.key}`, dimension.label, dimension.dataType),
        ),
        ...columnKeys.map((key, index) =>
          reportColumn(`value_${start + index}`, key.labels.join(' · '), measure?.dataType),
        ),
      ]
      groups.push({
        kind: 'results',
        title: measure?.label ?? 'Results',
        subtitle:
          result.columnKeys.length > PIVOT_COLUMNS_PER_GROUP
            ? `Columns ${(start + 1).toLocaleString()}-${end.toLocaleString()} of ${result.columnKeys.length.toLocaleString()}`
            : undefined,
        columns,
        rows: result.rowKeys.map((rowKey, rowIndex) =>
          rowFromValues(columns, [
            ...rowKey.labels,
            ...columnKeys.map((_key, offset) => {
              const cell = result.cells[rowIndex]?.[start + offset]
              return printable(measure && cell ? cell[measure.key] : null)
            }),
          ]),
        ),
        isEmpty: result.rowKeys.length === 0 || columnKeys.length === 0,
      })
    }
  }

  if (groups.length === 0) {
    groups.push({ kind: 'results', title: 'Results', columns: [], rows: [], isEmpty: true })
  }

  return {
    groups,
    summary: [
      { key: 'rows', label: 'Rows', value: result.rowKeys.length },
      { key: 'columns', label: 'Columns', value: result.columnKeys.length },
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
    summary: [{ key: 'rows-analysed', label: 'Rows analysed', value: rowCount }],
    groups: [
      {
        kind: 'summary',
        title: 'Summary',
        columns: [reportColumn('analysis', 'Analysis')],
        rows: [{ analysis: analysis.summary }],
      },
      {
        kind: 'results',
        title: 'Key points',
        columns: [
          reportColumn('tone', 'Tone'),
          reportColumn('point', 'Point'),
          reportColumn('detail', 'Detail'),
        ],
        rows: analysis.points.map((point) => ({
          tone: point.tone,
          point: point.title,
          detail: point.detail,
        })),
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
