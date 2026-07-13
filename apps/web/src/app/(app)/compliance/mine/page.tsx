import Link from 'next/link'
import { and, eq, isNull } from 'drizzle-orm'
import { ChevronRight } from 'lucide-react'
import {
  Badge,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { people } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { parseListParams, pickString } from '@/lib/list-params'
import { kindLabel, personCompliance } from '../_hub'
import {
  filterAndSortPersonRows,
  isPersonStatusFilter,
  PERSON_STATUS_FILTERS,
  personRowMatchesStatus,
} from '../_person-list'
import { complianceActionLabel, resolveComplianceLink } from '../_resolve-link'
import { StatusBadge, SummaryStrip } from '../_shared'
import { ComplianceSubNav } from '../_sub-nav'
import { OBLIGATION_KINDS, type ObligationKind } from '../obligations/_meta'

export const metadata = { title: 'Compliance · Mine' }
export const dynamic = 'force-dynamic'

const BASE = '/compliance/mine'
const SORTS = ['kind', 'title', 'status', 'due', 'completed'] as const

// Self-scoped: any authenticated user sees what THEY owe (no compliance.read
// gate). Cross-module due/expiring lives on its own "Due & expiring" tab — Mine
// shows only the obligations assigned to this person, each linking straight to
// where it is completed or reviewed.
export default async function MyCompliancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const ctx = await requireRequestContext()
  const canReadAll = can(ctx, 'compliance.read')
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

  const [person] = await ctx.db((tx) =>
    tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
      .limit(1),
  )

  const allRows = person ? await personCompliance(ctx, person.id) : []

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
            title="My compliance"
            description="Obligations assigned to you. Open a row to complete or review it."
          />
          <ComplianceSubNav active="mine" canReadAll={canReadAll} />
        </>
      }
    >
      <div className="space-y-6">
        {!person ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            Your account is not linked to a person record, so there is nothing to show.
          </div>
        ) : allRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
            Nothing assigned to you — you’re all caught up.
          </div>
        ) : (
          <div className="space-y-3">
            <SummaryStrip percent={percent} totals={totals} title="My obligations" />
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
            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                No obligations match the search or filters.
              </div>
            ) : (
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
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => {
                    const link = resolveComplianceLink(r.kind, r.targetRef, { personId: person.id })
                    const done = r.status === 'completed'
                    return (
                      <TableRow key={`${r.obligationId}:${i}`}>
                        <TableCell>
                          <Badge variant="secondary">{kindLabel(r.kind)}</Badge>
                        </TableCell>
                        <TableCell className="text-slate-900 dark:text-slate-100">
                          {link ? (
                            <Link
                              href={link.href as never}
                              prefetch={link.prefetch}
                              className="font-medium hover:underline"
                            >
                              {r.title}
                            </Link>
                          ) : (
                            r.title
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">
                          {r.dueOn ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">
                          {r.completedOn ?? '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {link ? (
                            <Link
                              href={link.href as never}
                              prefetch={link.prefetch}
                              className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline dark:text-teal-300"
                            >
                              {done ? 'Review' : complianceActionLabel(r.kind)}
                              <ChevronRight size={14} />
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
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
