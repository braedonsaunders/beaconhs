export type ExportColumn = {
  key: string
  label: string
  description?: string
  defaultSelected?: boolean
}

export type CsvColumn = {
  key: string
  header: string
}

export function exportColumnKey(label: string): string {
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'column'
}

export function exportColumns(labels: readonly string[]): ExportColumn[] {
  const seen = new Map<string, number>()
  return labels.map((label) => {
    const base = exportColumnKey(label)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return {
      key: count === 0 ? base : `${base}_${count + 1}`,
      label,
    }
  })
}

export function csvColumns(labels: readonly string[]): CsvColumn[] {
  return exportColumns(labels).map((column) => ({
    key: column.key,
    header: column.label,
  }))
}

export function selectCsvColumns(
  searchParams: URLSearchParams,
  columns: readonly CsvColumn[],
): {
  headers: string[]
  project: (row: (string | number | null | undefined)[]) => (string | number | null | undefined)[]
} {
  const requested = searchParams.getAll('columns').filter(Boolean)
  const requestedSet = new Set(requested)
  const indexed = columns.map((column, index) => ({ column, index }))
  const selected =
    requested.length > 0 ? indexed.filter(({ column }) => requestedSet.has(column.key)) : indexed
  const active = selected.length > 0 ? selected : indexed
  return {
    headers: active.map(({ column }) => column.header),
    project: (row) => active.map(({ index }) => row[index]),
  }
}
