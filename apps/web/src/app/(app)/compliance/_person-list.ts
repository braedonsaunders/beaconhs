import type { PersonStatusRow } from './_hub'
import { kindLabel, type ObligationKind } from './obligations/_meta'

export const PERSON_STATUS_FILTERS = [
  { value: 'urgent', label: 'Overdue / expiring' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'completed', label: 'Completed' },
] as const

type PersonStatusFilter = (typeof PERSON_STATUS_FILTERS)[number]['value']
type PersonComplianceSort = 'kind' | 'title' | 'status' | 'due' | 'completed'

export function isPersonStatusFilter(value: string | undefined): value is PersonStatusFilter {
  return PERSON_STATUS_FILTERS.some((option) => option.value === value)
}

export function personRowMatchesStatus(
  row: PersonStatusRow,
  filter: PersonStatusFilter | undefined,
): boolean {
  if (!filter) return true
  if (filter === 'urgent') return row.status === 'overdue' || row.status === 'expiring'
  if (filter === 'outstanding') return row.status !== 'completed'
  return row.status === 'completed'
}

export function filterAndSortPersonRows(
  rows: PersonStatusRow[],
  options: {
    q?: string
    status?: PersonStatusFilter
    kind?: ObligationKind
    sort: PersonComplianceSort
    dir: 'asc' | 'desc'
  },
): PersonStatusRow[] {
  const query = options.q?.trim().toLowerCase()
  const filtered = rows.filter((row) => {
    if (!personRowMatchesStatus(row, options.status)) return false
    if (options.kind && row.kind !== options.kind) return false
    if (!query) return true
    return [kindLabel(row.kind), row.title, row.status, row.dueOn ?? '', row.completedOn ?? '']
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

  const statusRank = (status: string) =>
    status === 'overdue'
      ? 0
      : status === 'expiring'
        ? 1
        : status === 'pending'
          ? 2
          : status === 'in_progress'
            ? 3
            : 4
  const mult = options.dir === 'asc' ? 1 : -1
  return filtered.sort((a, b) => {
    const comparison =
      options.sort === 'kind'
        ? kindLabel(a.kind).localeCompare(kindLabel(b.kind))
        : options.sort === 'title'
          ? a.title.localeCompare(b.title)
          : options.sort === 'due'
            ? (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31')
            : options.sort === 'completed'
              ? (a.completedOn ?? '9999-12-31').localeCompare(b.completedOn ?? '9999-12-31')
              : statusRank(a.status) - statusRank(b.status)
    return comparison * mult || a.title.localeCompare(b.title)
  })
}
