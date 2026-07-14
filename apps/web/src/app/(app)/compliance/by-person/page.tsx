import { Badge, PageHeader, Table, TableBody, TableCell, TableHeader, TableRow } from '@beaconhs/ui'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { kindLabel, personCompliance } from '../_hub'
import {
  filterAndSortPersonRows,
  isPersonStatusFilter,
  PERSON_STATUS_FILTERS,
  personRowMatchesStatus,
} from '../_person-list'
import { StatusBadge, SummaryStrip } from '../_shared'
import { ComplianceSubNav } from '../_sub-nav'
import { OBLIGATION_KINDS, type ObligationKind } from '../obligations/_meta'
import { PersonPicker } from './_person-picker'

export const metadata = { title: 'Compliance · By person' }
export const dynamic = 'force-dynamic'

const BASE = '/compliance/by-person'
const SORTS = ['kind', 'title', 'status', 'due', 'completed'] as const

export default async function ByPersonPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.read')
  const personId = pickString(sp.person)
  const statusParam = pickString(sp.status)
  const statusFilter = isPersonStatusFilter(statusParam) ? statusParam : undefined
  const kindParam = pickString(sp.kind)
  const kindFilter = OBLIGATION_KINDS.includes(kindParam as ObligationKind)
    ? (kindParam as ObligationKind)
    : undefined
  const params = parseListParams(sp, {
    sort: 'status',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })

  const allRows = personId ? await personCompliance(ctx, personId) : []
  const isOverdue = (s: string) => s === 'overdue' || s === 'expiring'
  const totals = {
    total: allRows.length,
    completed: allRows.filter((r) => r.status === 'completed').length,
    overdue: allRows.filter((r) => isOverdue(r.status)).length,
    pending: allRows.filter((r) => r.status === 'pending' || r.status === 'in_progress').length,
  }
  const percent = totals.total === 0 ? 0 : Math.round((totals.completed / totals.total) * 100)
  const filtered = filterAndSortPersonRows(allRows, {
    q: params.q,
    status: statusFilter,
    kind: kindFilter,
    sort: params.sort,
    dir: params.dir,
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / params.perPage))
  const page = Math.min(params.page, pageCount)
  const rows = filtered.slice((page - 1) * params.perPage, page * params.perPage)
  const statusCounts = Object.fromEntries(
    PERSON_STATUS_FILTERS.map((filter) => [
      filter.value,
      allRows.filter((row) => personRowMatchesStatus(row, filter.value)).length,
    ]),
  )
  const kindCounts = Object.fromEntries(
    OBLIGATION_KINDS.map((kind) => [kind, allRows.filter((row) => row.kind === kind).length]),
  )

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Compliance"
            description="Every obligation one person is responsible for, across every kind."
          />
          <ComplianceSubNav active="by-person" />
        </>
      }
    >
      <div className="space-y-6">
        <PersonPicker selected={personId ?? ''} />

        {personId ? (
          <TableToolbar>
            <SearchInput placeholder="Search obligation, kind, or status…" />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={PERSON_STATUS_FILTERS.map((filter) => ({
                ...filter,
                count: statusCounts[filter.value] ?? 0,
              }))}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="kind"
              label="Kind"
              options={OBLIGATION_KINDS.map((kind) => ({
                value: kind,
                label: kindLabel(kind),
                count: kindCounts[kind] ?? 0,
              }))}
            />
          </TableToolbar>
        ) : null}

        {!personId ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
            Pick a person above to see every obligation they are scoped into.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            {allRows.length === 0
              ? "This person isn't a subject of any active obligation."
              : 'No obligations match the search or filters.'}
          </div>
        ) : (
          <div className="space-y-4">
            <SummaryStrip percent={percent} totals={totals} title="Across all kinds" />
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    ['kind', 'Kind'],
                    ['title', 'Obligation'],
                    ['status', 'Status'],
                    ['due', 'Due'],
                    ['completed', 'Completed'],
                  ].map(([column, label]) => (
                    <SortableTh
                      key={column}
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column={column!}
                      active={params.sort === column}
                    >
                      {label}
                    </SortableTh>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.obligationId}:${i}`}>
                    <TableCell>
                      <Badge variant="secondary">{kindLabel(r.kind)}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-900 dark:text-slate-100">{r.title}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-slate-700 dark:text-slate-300">
                      {r.dueOn ?? '—'}
                    </TableCell>
                    <TableCell className="text-slate-700 dark:text-slate-300">
                      {r.completedOn ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              basePath={BASE}
              currentParams={sp}
              total={filtered.length}
              page={page}
              perPage={params.perPage}
            />
          </div>
        )}
      </div>
    </ListPageLayout>
  )
}
