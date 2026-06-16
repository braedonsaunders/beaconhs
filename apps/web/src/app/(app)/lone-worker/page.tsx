import Link from 'next/link'
import { Timer } from 'lucide-react'
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
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
import { formResponses, formTemplates, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'

// Lone Worker now runs on the Builder "Lone Worker" app (a monitored session).
// This page is a thin dashboard over that app's monitored responses; starting a
// session opens the app's filler, and each row opens the live monitor on the
// response page. See docs/monitored-sessions-design.md.

export const metadata = { title: 'Lone worker' }
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

export default async function LoneWorkerPage() {
  const ctx = await requireRequestContext()

  const { app, rows } = await ctx.db(async (tx) => {
    const [appRow] = await tx
      .select({ id: formTemplates.id })
      .from(formTemplates)
      .where(and(eq(formTemplates.key, 'lone_worker'), eq(formTemplates.tenantId, ctx.tenantId)))
      .limit(1)
    if (!appRow) return { app: null, rows: [] }
    const data = await tx
      .select({
        id: formResponses.id,
        monitorStatus: formResponses.monitorStatus,
        nextCheckinDueAt: formResponses.nextCheckinDueAt,
        submittedAt: formResponses.submittedAt,
        worker: tenantUsers.displayName,
        workerAccount: user.name,
      })
      .from(formResponses)
      .leftJoin(tenantUsers, eq(tenantUsers.id, formResponses.submittedBy))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(and(eq(formResponses.templateId, appRow.id), isNotNull(formResponses.monitorStatus)))
      // Live sessions (active/escalated/missed) first, then by next check-in.
      .orderBy(
        sql`case when ${formResponses.monitorStatus} in ('active','escalated','missed') then 0 else 1 end`,
        asc(formResponses.nextCheckinDueAt),
      )
      .limit(200)
    return { app: appRow, rows: data }
  })

  const startHref = app ? `/forms/templates/${app.id}/fill` : '/forms'
  const now = Date.now()

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Lone Worker"
            description="Monitored lone-worker sessions — recurring check-ins with automatic overdue escalation."
            actions={
              <Link href={startHref}>
                <Button>Start session</Button>
              </Link>
            }
          />
          <Alert>
            <AlertTitle>Runs on the Lone Worker app</AlertTitle>
            <AlertDescription>
              Sessions are built on the Lone Worker Builder app. The monitor scan escalates any
              session whose check-in is overdue past its grace period.
            </AlertDescription>
          </Alert>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Timer size={32} />}
          title="No sessions yet"
          description="Start a monitored lone-worker session — the worker checks in on an interval and a missed check-in escalates to supervisors automatically."
          action={
            <Link href={startHref}>
              <Button>Start session</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Worker</TableHead>
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
                      href={`/forms/responses/${r.id}`}
                      className="font-medium text-teal-700 hover:underline dark:text-teal-300"
                    >
                      {r.worker ?? r.workerAccount ?? 'Session'}
                    </Link>
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
