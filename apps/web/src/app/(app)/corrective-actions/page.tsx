import Link from 'next/link'
import { ListChecks } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { correctiveActions, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'

export const metadata = { title: 'Corrective Actions' }

const SORTS = ['reference', 'title', 'severity', 'status', 'due_on', 'assigned_on'] as const

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'pending_verification', label: 'Pending verification' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

export default async function CorrectiveActionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'due_on', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  const statusFilter = pickString(sp.status)
  const sevFilter = pickString(sp.severity)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, sevCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(correctiveActions.reference, term),
        ilike(correctiveActions.title, term),
        ilike(correctiveActions.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(correctiveActions.status, statusFilter as any))
    if (sevFilter) filters.push(eq(correctiveActions.severity, sevFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [params.dir === 'asc' ? asc(correctiveActions.reference) : desc(correctiveActions.reference)]
        : params.sort === 'title'
          ? [params.dir === 'asc' ? asc(correctiveActions.title) : desc(correctiveActions.title)]
          : params.sort === 'severity'
            ? [params.dir === 'asc' ? asc(correctiveActions.severity) : desc(correctiveActions.severity)]
            : params.sort === 'status'
              ? [params.dir === 'asc' ? asc(correctiveActions.status) : desc(correctiveActions.status)]
              : params.sort === 'assigned_on'
                ? [params.dir === 'asc' ? asc(correctiveActions.assignedOn) : desc(correctiveActions.assignedOn)]
                : [params.dir === 'asc' ? asc(correctiveActions.dueOn) : desc(correctiveActions.dueOn)]

    const [tot] = await tx.select({ c: count() }).from(correctiveActions).where(whereClause)
    const data = await tx
      .select({ ca: correctiveActions, site: orgUnits })
      .from(correctiveActions)
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ss = await tx
      .select({ s: correctiveActions.status, c: count() })
      .from(correctiveActions)
      .groupBy(correctiveActions.status)
    const sv = await tx
      .select({ s: correctiveActions.severity, c: count() })
      .from(correctiveActions)
      .groupBy(correctiveActions.severity)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      sevCounts: Object.fromEntries(sv.map((x) => [x.s, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/corrective-actions', currentParams: sp, dir: params.dir }
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Corrective Actions"
        description="Standalone records, linkable to incidents, inspections, audits, JSHAs."
        actions={
          <Link href="/corrective-actions/new">
            <Button>New action</Button>
          </Link>
        }
      />
      <div className="flex items-center gap-3">
        <SearchInput placeholder="Search reference, title, description…" />
      </div>
      <div className="space-y-2">
        <FilterChips
          basePath="/corrective-actions"
          currentParams={sp}
          paramKey="status"
          label="Status"
          options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
        />
        <FilterChips
          basePath="/corrective-actions"
          currentParams={sp}
          paramKey="severity"
          label="Severity"
          options={SEVERITY_OPTIONS.map((o) => ({ ...o, count: sevCounts[o.value] }))}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<ListChecks size={32} />} title="No corrective actions match these filters" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="reference" active={params.sort === 'reference'}>Ref</SortableTh>
                <SortableTh {...sortProps} column="title" active={params.sort === 'title'}>Title</SortableTh>
                <SortableTh {...sortProps} column="severity" active={params.sort === 'severity'}>Severity</SortableTh>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>Status</SortableTh>
                <SortableTh {...sortProps} column="due_on" active={params.sort === 'due_on'}>Due</SortableTh>
                <TableHead>Site</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ ca, site }) => {
                const overdue = ca.dueOn && ca.dueOn < today && !['closed', 'cancelled'].includes(ca.status)
                return (
                  <TableRow key={ca.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/corrective-actions/${ca.id}`} className="hover:underline">
                        {ca.reference}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/corrective-actions/${ca.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {ca.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          ca.severity === 'critical' || ca.severity === 'high'
                            ? 'destructive'
                            : ca.severity === 'medium'
                              ? 'warning'
                              : 'secondary'
                        }
                      >
                        {ca.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          ca.status === 'closed'
                            ? 'success'
                            : ca.status === 'cancelled'
                              ? 'secondary'
                              : 'warning'
                        }
                      >
                        {ca.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className={overdue ? 'font-medium text-red-700' : ''}>
                        {ca.dueOn ?? '—'}
                        {overdue ? ' (overdue)' : ''}
                      </span>
                    </TableCell>
                    <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/corrective-actions"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
    </div>
  )
}
