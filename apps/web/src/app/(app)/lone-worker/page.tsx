import Link from 'next/link'
import { Timer } from 'lucide-react'
import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import { lwSessions, orgUnits, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'

export const metadata = { title: 'Lone worker' }

const SORTS = ['started_at', 'next_checkin_due_at', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'missed', label: 'Missed' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default async function LoneWorkerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'started_at', dir: 'desc', perPage: 25, allowedSorts: SORTS })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, activeCount } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (statusFilter) filters.push(eq(lwSessions.status, statusFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'next_checkin_due_at'
        ? [params.dir === 'asc' ? asc(lwSessions.nextCheckinDueAt) : desc(lwSessions.nextCheckinDueAt)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(lwSessions.status) : desc(lwSessions.status)]
          : [params.dir === 'asc' ? asc(lwSessions.startedAt) : desc(lwSessions.startedAt)]

    const [tot] = await tx.select({ c: count() }).from(lwSessions).where(whereClause)
    const data = await tx
      .select({
        session: lwSessions,
        site: orgUnits,
        worker: tenantUsers,
        workerAccount: user,
      })
      .from(lwSessions)
      .leftJoin(orgUnits, eq(orgUnits.id, lwSessions.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, lwSessions.workerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const ss = await tx
      .select({ s: lwSessions.status, c: count() })
      .from(lwSessions)
      .groupBy(lwSessions.status)
    const [activeRow] = await tx
      .select({ c: count() })
      .from(lwSessions)
      .where(eq(lwSessions.status, 'active'))
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      activeCount: Number(activeRow?.c ?? 0),
    }
  })

  const sortProps = { basePath: '/lone-worker', currentParams: sp, dir: params.dir }
  const now = Date.now()

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Lone worker"
            description="Timer-based check-ins with auto-escalation. Workers on solo tasks open a session; the scheduler watches and pages the supervisor on missed check-ins."
            actions={
              <div className="flex items-center gap-2">
                <Link href={buildExportHref('/lone-worker/export.csv', sp)}>
                  <Button variant="outline">Export CSV</Button>
                </Link>
                <Link href="/lone-worker/new">
                  <Button>Start session</Button>
                </Link>
              </div>
            }
          />

          {activeCount > 0 ? (
            <Alert variant="info">
              <AlertTitle>{activeCount} active session{activeCount === 1 ? '' : 's'}</AlertTitle>
              <AlertDescription>
                The scheduled-tick worker checks every minute and escalates any overdue session.
              </AlertDescription>
            </Alert>
          ) : null}

          <FilterChips
            basePath="/lone-worker"
            currentParams={sp}
            paramKey="status"
            label="Status"
            options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Timer size={32} />}
          title={statusFilter ? `No ${statusFilter} sessions` : 'No sessions yet'}
          description="Open a session when a worker is going solo. Missed check-ins escalate to the supervisor automatically."
          action={
            <Link href="/lone-worker/new">
              <Button>Start a session</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Task</TableHead>
                <SortableTh {...sortProps} column="started_at" active={params.sort === 'started_at'}>Started</SortableTh>
                <SortableTh {...sortProps} column="next_checkin_due_at" active={params.sort === 'next_checkin_due_at'}>Next check-in</SortableTh>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>Status</SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ session, site, workerAccount }) => {
                const next = new Date(session.nextCheckinDueAt).getTime()
                const overdue = session.status === 'active' && next < now
                return (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium">
                      <Link href={`/lone-worker/${session.id}`} className="hover:underline">
                        {workerAccount?.name ?? 'Unknown'}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">{session.task ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">
                      {new Date(session.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <span className={overdue ? 'font-medium text-red-700' : 'text-slate-600'}>
                        {new Date(session.nextCheckinDueAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {overdue ? ' (overdue)' : ''}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          session.status === 'active'
                            ? 'success'
                            : session.status === 'missed' || session.status === 'escalated'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {session.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/lone-worker"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
    </ListPageLayout>
  )
}
