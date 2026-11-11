import {
  heatmapPivotSettings,
  pivotAxisLabel,
  pivotConditionalRules,
  pivotDisplayValue,
  resolveCellStyle,
  type FlatResult,
  type PivotResult,
  type VizSettings,
} from '@beaconhs/analytics'
import type { DatasetAnalysis } from '@beaconhs/ai'
import type {
  PivotMatrixDocumentInput,
  PivotMatrixLegendItem,
  PivotMatrixSection,
} from '@beaconhs/forms-pdf'
import type { ReportColumn, ReportGroup, ReportSummaryItem } from '@beaconhs/reports'

function printable(value: unknown): string | number {
  if (value === null || typeof value === 'undefined' || value === '' || value === 'missing') {
    return ''
  }
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function fmtPivotCell(value: unknown, translate: (v: string) => string): string {
  if (value === null || typeof value === 'undefined' || value === '' || value === 'missing') {
    return ''
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
  if (typeof value === 'boolean') return translate(value ? 'Yes' : 'No')
  return translate(String(value))
}

function reportColumn(key: string, label: string, dataType = 'string'): ReportColumn {
  return {
    key,
    label,
    semanticType: dataType === 'number' ? 'number' : dataType === 'date' ? 'date' : 'text',
  }
}

export function flatCardDocument(result: FlatResult): {
  groups: ReportGroup[]
  summary: ReportSummaryItem[]
  rowCount: number
} {
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

export function pivotMatrixDocument(
  result: PivotResult,
  settings: VizSettings = {},
  options: {
    vizType?: string
    searchQuery?: string
    translate?: (value: string) => string
  } = {},
): Pick<PivotMatrixDocumentInput, 'sections' | 'summary' | 'truncatedNotice'> & {
  rowCount: number
} {
  const t = options.translate ?? ((value: string) => value)
  const effectiveSettings =
    options.vizType === 'heatmap' ? heatmapPivotSettings(result, settings) : settings
  const measures =
    typeof effectiveSettings.displayValueField === 'string'
      ? [result.valueMeasures[0] ?? null]
      : result.valueMeasures.length > 0
        ? result.valueMeasures
        : [null]
  const rowHeaderLabel = t(
    result.rowDimensions.find((d) => d.key === effectiveSettings.rowLabelField)?.label ??
      result.rowDimensions.map((d) => d.label).join(' · '),
  )
  const columns = result.columnKeys.map((axis) =>
    t(pivotAxisLabel(axis, result.columnDimensions, effectiveSettings.columnLabelField)),
  )
  const query = (options.searchQuery ?? '').trim().toLocaleLowerCase()
  const matchedRows = result.rowKeys
    .map((axis, index) => ({
      index,
      rawLabel: pivotAxisLabel(axis, result.rowDimensions, effectiveSettings.rowLabelField),
    }))
    .filter((row) => !query || row.rawLabel.toLocaleLowerCase().includes(query))

  const emptyMessage = query ? t('No matching people.') : t('No data for these filters.')

  const sections: PivotMatrixSection[] = measures.map((measure) => {
    const rules = pivotConditionalRules(measure, effectiveSettings)
    const legend: PivotMatrixLegendItem[] | undefined =
      typeof effectiveSettings.displayValueField === 'string' && measure
        ? (['valid', 'expiring', 'expired'] as const).flatMap((status) => {
            const token = resolveCellStyle(status, measure.key, rules).token
            if (!token) return []
            const label =
              status === 'valid' ? 'Valid' : status === 'expiring' ? 'Expiring' : 'Expired'
            return [{ label: t(label), token }]
          })
        : undefined

    return {
      ...(measures.length > 1 && measure?.label ? { title: t(measure.label) } : {}),
      rowHeaderLabel,
      columns,
      rows: matchedRows.map((row) => ({
        label: t(row.rawLabel),
        cells: result.columnKeys.map((_axis, colIndex) => {
          const cell = result.cells[row.index]?.[colIndex] ?? null
          const raw = measure ? (cell?.[measure.key] ?? null) : null
          const display = fmtPivotCell(
            measure ? pivotDisplayValue(cell, measure.key, effectiveSettings) : null,
            t,
          )
          const style = measure ? resolveCellStyle(raw, measure.key, rules) : {}
          return {
            value: display,
            ...(style.token ? { token: style.token } : {}),
            ...(style.backgroundColor ? { backgroundColor: style.backgroundColor } : {}),
          }
        }),
      })),
      ...(legend && legend.length > 0 ? { legend } : {}),
      emptyMessage,
    }
  })

  return {
    sections,
    summary: [
      { label: t('Rows'), value: matchedRows.length },
      { label: t('Columns'), value: columns.length },
    ],
    truncatedNotice: result.truncated
      ? t('This matrix reached its data limit. Use Filters to narrow the results.')
      : null,
    rowCount: matchedRows.length,
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
