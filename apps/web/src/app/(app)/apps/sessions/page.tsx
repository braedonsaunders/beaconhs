import Link from 'next/link'
import { Timer } from 'lucide-react'
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import {
  Badge,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { formResponses, formTemplates, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'

// Monitored sessions = any Builder-app response with a live monitor (recurring
// check-ins + automatic overdue escalation). This dashboard is app-agnostic: it
// spans EVERY monitored response in the tenant and assumes no specific app
// (e.g. Lone Worker) exists — deployments without a monitored app just see the
// empty state. A session's live monitor lives on its response page. See
// docs/monitored-sessions-design.md.

export const metadata = { title: 'Monitored sessions' }
export const dynamic = 'force-dynamic'

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

export default async function MonitoredSessionsPage() {
  const ctx = await requireRequestContext()

  const rows = await ctx.db((tx) =>
    tx
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
      .where(and(eq(formResponses.tenantId, ctx.tenantId), isNotNull(formResponses.monitorStatus)))
      // Live sessions (active/escalated/missed) first, then by next check-in.
      .orderBy(
        sql`case when ${formResponses.monitorStatus} in ('active','escalated','missed') then 0 else 1 end`,
        asc(formResponses.nextCheckinDueAt),
      )
      .limit(200),
  )

  const now = Date.now()

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
              <TableHead>Worker</TableHead>
              <TableHead>App</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Next check-in</TableHead>
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
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {r.submittedAt
                      ? new Date(r.submittedAt).toISOString().slice(0, 16).replace('T', ' ')
                      : '—'}
                  </TableCell>
                  <TableCell
                    className={
                      overdue
                        ? 'font-medium text-red-600 dark:text-red-400'
                        : 'text-slate-600 dark:text-slate-400'
                    }
                  >
                    {r.nextCheckinDueAt
                      ? new Date(r.nextCheckinDueAt).toISOString().slice(0, 16).replace('T', ' ')
                      : '—'}
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
