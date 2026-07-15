import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_00740d4935c614') }
}
export const dynamic = 'force-dynamic'

const BASE = '/compliance/by-person'
const SORTS = ['kind', 'title', 'status', 'due', 'completed'] as const

export default async function ByPersonPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_096d47f60747b3')}
            description={tGenerated('m_015c1866d10130')}
          />
          <ComplianceSubNav active="by-person" />
        </>
      }
    >
      <div className="space-y-6">
        <PersonPicker selected={personId ?? ''} />

        <GeneratedValue
          value={
            personId ? (
              <TableToolbar>
                <SearchInput placeholder={tGenerated('m_1e16c5f9400e36')} />
                <FilterChips
                  basePath={BASE}
                  currentParams={sp}
                  paramKey="status"
                  label={tGenerated('m_0b9da892d6faf0')}
                  options={PERSON_STATUS_FILTERS.map((filter) => ({
                    ...filter,
                    count: statusCounts[filter.value] ?? 0,
                  }))}
                />
                <FilterChips
                  basePath={BASE}
                  currentParams={sp}
                  paramKey="kind"
                  label={tGenerated('m_1e578efe1574cd')}
                  options={OBLIGATION_KINDS.map((kind) => ({
                    value: kind,
                    label: kindLabel(kind),
                    count: kindCounts[kind] ?? 0,
                  }))}
                />
              </TableToolbar>
            ) : null
          }
        />

        <GeneratedValue
          value={
            !personId ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                <GeneratedText id="m_04856d3476c441" />
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <GeneratedValue
                  value={
                    allRows.length === 0 ? (
                      <GeneratedText id="m_083d499637ae9b" />
                    ) : (
                      <GeneratedText id="m_171a1486034173" />
                    )
                  }
                />
              </div>
            ) : (
              <div className="space-y-4">
                <SummaryStrip
                  percent={percent}
                  totals={totals}
                  title={tGenerated('m_03a532e728943c')}
                />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <GeneratedValue
                        value={[
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
                            <GeneratedValue value={label} />
                          </SortableTh>
                        ))}
                      />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <GeneratedValue
                      value={rows.map((r, i) => (
                        <TableRow key={`${r.obligationId}:${i}`}>
                          <TableCell>
                            <Badge variant="secondary">
                              <GeneratedValue value={kindLabel(r.kind)} />
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-900 dark:text-slate-100">
                            <GeneratedValue value={r.title} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={r.status} />
                          </TableCell>
                          <TableCell className="text-slate-700 dark:text-slate-300">
                            <GeneratedValue value={r.dueOn ?? '—'} />
                          </TableCell>
                          <TableCell className="text-slate-700 dark:text-slate-300">
                            <GeneratedValue value={r.completedOn ?? '—'} />
                          </TableCell>
                        </TableRow>
                      ))}
                    />
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
            )
          }
        />
      </div>
    </ListPageLayout>
  )
}
