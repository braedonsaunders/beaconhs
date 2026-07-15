import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_139cbab03e8662') }
}
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
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_0b431c25bd1c60')}
            description={tGenerated('m_17f94d9426ead1')}
          />
          <ComplianceSubNav active="mine" canReadAll={canReadAll} />
        </>
      }
    >
      <div className="space-y-6">
        <GeneratedValue
          value={
            !person ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <GeneratedText id="m_07c49bba9a0223" />
              </div>
            ) : allRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                <GeneratedText id="m_04119ff0e5a344" />
              </div>
            ) : (
              <div className="space-y-3">
                <SummaryStrip
                  percent={percent}
                  totals={totals}
                  title={tGenerated('m_17f7f13a1100a2')}
                />
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
                <GeneratedValue
                  value={
                    rows.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
                        <GeneratedText id="m_171a1486034173" />
                      </div>
                    ) : (
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
                            <TableHead className="text-right">
                              <GeneratedText id="m_0bad495a7046e9" />
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <GeneratedValue
                            value={rows.map((r, i) => {
                              const link = resolveComplianceLink(r.kind, r.targetRef, {
                                personId: person.id,
                                obligationId: r.obligationId,
                                responseId:
                                  r.status === 'completed' && r.kind === 'form'
                                    ? (r.subjectRef?.responseId ?? null)
                                    : null,
                              })
                              const done = r.status === 'completed'
                              return (
                                <TableRow key={`${r.obligationId}:${i}`}>
                                  <TableCell>
                                    <Badge variant="secondary">
                                      <GeneratedValue value={kindLabel(r.kind)} />
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-slate-900 dark:text-slate-100">
                                    <GeneratedValue
                                      value={
                                        link ? (
                                          <Link
                                            href={link.href as never}
                                            prefetch={link.prefetch}
                                            className="font-medium hover:underline"
                                          >
                                            {r.title}
                                          </Link>
                                        ) : (
                                          r.title
                                        )
                                      }
                                    />
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
                                  <TableCell className="text-right">
                                    <GeneratedValue
                                      value={
                                        link ? (
                                          <Link
                                            href={link.href as never}
                                            prefetch={link.prefetch}
                                            className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline dark:text-teal-300"
                                          >
                                            {done ? (
                                              <GeneratedText id="m_0e315ebf127b18" />
                                            ) : (
                                              complianceActionLabel(r.kind)
                                            )}
                                            <ChevronRight size={14} />
                                          </Link>
                                        ) : (
                                          <span className="text-slate-400">—</span>
                                        )
                                      }
                                    />
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          />
                        </TableBody>
                      </Table>
                    )
                  }
                />
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
