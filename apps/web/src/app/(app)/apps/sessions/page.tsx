import Link from 'next/link'
import { Timer } from 'lucide-react'
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  Badge,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { formResponses, formTemplates, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { parseListParams } from '@/lib/list-params'
import { SortableTh } from '@/components/sortable-th'
import { ListPageLayout } from '@/components/page-layout'

// Monitored sessions = any Builder-app response with a live monitor (recurring
// check-ins + automatic overdue escalation). This dashboard is app-agnostic: it
// spans EVERY monitored response the caller may see and assumes no specific app
// (e.g. Lone Worker) exists — deployments without a monitored app just see the
// empty state. A session's live monitor lives on its response page. See
// docs/monitored-sessions-design.md.

export const metadata = { title: 'Monitored sessions' }
export const dynamic = 'force-dynamic'

const SORTS = ['live', 'worker', 'app', 'status', 'started', 'next_checkin'] as const

const STATUS_BADGE: Record<
  string,
  { label: string; variant: 'success' | 'destructive' | 'secondary' | 'outline' }
> = {
  active: { label: 'Active', variant: 'success' },
  escalated: { label: 'Escalated', variant: 'destructive' },
  missed: { label: 'Missed', variant: 'destructive' },
  completed: { label: 'Completed', variant: 'secondary' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
}

export default async function MonitoredSessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'live',
    dir: 'asc',
    allowedSorts: SORTS,
  })
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    // Per-user record visibility (same tiers as /apps/responses): read.all →
    // every session; read.site → sessions at my sites + my own; else → my own.
    // Without this any tenant member could see every worker's live lone-worker
    // roster and check-in schedule.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'forms.response',
      ownerCols: [formResponses.submittedBy],
      personCol: formResponses.subjectPersonId,
      siteCol: formResponses.siteOrgUnitId,
    })
    const dir = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'worker'
        ? [dir(tenantUsers.displayName)]
        : params.sort === 'app'
          ? [dir(formTemplates.name)]
          : params.sort === 'status'
            ? [dir(formResponses.monitorStatus)]
            : params.sort === 'started'
              ? [dir(formResponses.submittedAt)]
              : params.sort === 'next_checkin'
                ? [dir(formResponses.nextCheckinDueAt)]
                : // Default: live sessions (active/escalated/missed) first, then
                  // by next check-in due.
                  [
                    sql`case when ${formResponses.monitorStatus} in ('active','escalated','missed') then 0 else 1 end`,
                    asc(formResponses.nextCheckinDueAt),
                  ]
    return tx
      .select({
        id: formResponses.id,
        monitorStatus: formResponses.monitorStatus,
        nextCheckinDueAt: formResponses.nextCheckinDueAt,
        submittedAt: formResponses.submittedAt,
        appName: formTemplates.name,
        worker: tenantUsers.displayName,
        workerAccount: user.name,
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, formResponses.submittedBy))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(
        and(
          eq(formResponses.tenantId, ctx.tenantId),
          isNotNull(formResponses.monitorStatus),
          isNull(formResponses.deletedAt),
          vis,
        ),
      )
      .orderBy(...orderBy)
      .limit(200)
  })

  const now = Date.now()
  const fmt = (d: Date) => d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
  const sortProps = { basePath: '/apps/sessions', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <PageHeader
          title="Monitored sessions"
          description="Live timed sessions across every monitored app — recurring check-ins with automatic overdue escalation."
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Timer size={32} />}
          title="No monitored sessions"
          description="When a worker starts a session on a monitored app, it appears here — they check in on an interval and a missed check-in escalates to supervisors automatically."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTh {...sortProps} column="worker" active={params.sort === 'worker'}>
                Worker
              </SortableTh>
              <SortableTh {...sortProps} column="app" active={params.sort === 'app'}>
                App
              </SortableTh>
              <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                Status
              </SortableTh>
              <SortableTh {...sortProps} column="started" active={params.sort === 'started'}>
                Started
              </SortableTh>
              <SortableTh
                {...sortProps}
                column="next_checkin"
                active={params.sort === 'next_checkin'}
              >
                Next check-in
              </SortableTh>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const badge = STATUS_BADGE[r.monitorStatus ?? ''] ?? {
                label: r.monitorStatus ?? '—',
                variant: 'outline' as const,
              }
              const live = r.monitorStatus === 'active'
              const overdue =
                live && r.nextCheckinDueAt && new Date(r.nextCheckinDueAt).getTime() < now
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      href={`/apps/responses/${r.id}`}
                      className="font-medium text-teal-700 hover:underline dark:text-teal-300"
                    >
                      {r.worker ?? r.workerAccount ?? 'Session'}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {r.appName ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-600 tabular-nums dark:text-slate-400">
                    {r.submittedAt ? fmt(new Date(r.submittedAt)) : '—'}
                  </TableCell>
                  <TableCell
                    className={
                      overdue
                        ? 'font-medium text-red-600 tabular-nums dark:text-red-400'
                        : 'text-slate-600 tabular-nums dark:text-slate-400'
                    }
                  >
                    {r.nextCheckinDueAt ? fmt(new Date(r.nextCheckinDueAt)) : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
