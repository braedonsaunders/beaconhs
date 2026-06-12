import Link from 'next/link'
import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { History, Pause, Play, Trash2, Zap } from 'lucide-react'
import { reportRuns, reportSchedules } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { loadDefinitionById } from '../../_definitions'
import { formatDateTime, StatusBadge } from '../../_format'
import { loadScheduleFormData } from '../_data'
import { ScheduleForm } from '../_schedule-form'
import { deleteSchedule, setActive, triggerNow, updateSchedule } from './actions'

export const metadata = { title: 'Report schedule' }
export const dynamic = 'force-dynamic'

export default async function ScheduleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const schedule = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(reportSchedules).where(eq(reportSchedules.id, id)).limit(1)
    return row ?? null
  })
  if (!schedule) notFound()

  const [definition, { definitions, members }, runs] = await Promise.all([
    loadDefinitionById(ctx.tenantId!, schedule.definitionId),
    loadScheduleFormData(ctx),
    ctx.db(async (tx) =>
      tx
        .select()
        .from(reportRuns)
        .where(eq(reportRuns.scheduleId, id))
        .orderBy(desc(reportRuns.startedAt))
        .limit(50),
    ),
  ])

  const triggerBound = triggerNow.bind(null, id)
  const toggleBound = setActive.bind(null, id, !schedule.active)
  const deleteBound = deleteSchedule.bind(null, id)
  const updateBound = updateSchedule.bind(null, id)

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/reports/schedules', label: 'Back to schedules' }}
          title={schedule.name}
          subtitle={
            definition
              ? `Delivers “${definition.name}” as a PDF email`
              : 'The underlying report definition no longer exists'
          }
          badge={
            schedule.active ? (
              <Badge variant="success">active</Badge>
            ) : (
              <Badge variant="secondary">paused</Badge>
            )
          }
          actions={
            <>
              {definition ? (
                <Link href={`/reports/definitions/${definition.id}`}>
                  <Button variant="outline" size="sm">
                    View report
                  </Button>
                </Link>
              ) : null}
              <form action={triggerBound}>
                <Button type="submit" variant="outline" size="sm">
                  <Zap size={14} className="mr-1.5" />
                  Run now
                </Button>
              </form>
              <form action={toggleBound}>
                <Button type="submit" variant="outline" size="sm">
                  {schedule.active ? (
                    <>
                      <Pause size={14} className="mr-1.5" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play size={14} className="mr-1.5" />
                      Resume
                    </>
                  )}
                </Button>
              </form>
              <form action={deleteBound}>
                <Button type="submit" variant="destructive" size="sm">
                  <Trash2 size={14} className="mr-1.5" />
                  Delete
                </Button>
              </form>
            </>
          }
        />
      }
    >
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <ScheduleForm
              definitions={definitions}
              members={members}
              initial={{
                definitionId: schedule.definitionId,
                name: schedule.name,
                cadence: schedule.cadence,
                dayOfWeek: schedule.dayOfWeek,
                dayOfMonth: schedule.dayOfMonth,
                hour: schedule.hour,
                minute: schedule.minute,
                timezone: schedule.timezone,
                recipientUserIds: schedule.recipientUserIds ?? [],
                recipientEmails: schedule.recipientEmails ?? [],
                filters: schedule.filters ?? {},
              }}
              submitLabel="Save changes"
              action={updateBound}
              extraFooter={
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Next run:{' '}
                  <strong>{schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : '—'}</strong> ·
                  Last run:{' '}
                  <strong>
                    {schedule.lastRunAt ? formatDateTime(schedule.lastRunAt) : 'never'}
                  </strong>
                </p>
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Run history ({runs.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <EmptyState
                icon={<History size={24} />}
                title="No runs"
                description="Run now to trigger the first delivery."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Finished</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-slate-600 dark:text-slate-300">
                        <Link
                          href={`/reports/schedules/${id}/runs/${r.id}`}
                          className="hover:underline"
                        >
                          {formatDateTime(r.startedAt)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-300">
                        {r.finishedAt ? formatDateTime(r.finishedAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-300">
                        {r.rowCount ?? '—'}
                      </TableCell>
                      <TableCell>
                        {r.pdfAttachmentId ? (
                          <a
                            href={`/reports/schedules/${id}/runs/${r.id}/pdf`}
                            className="text-teal-700 hover:underline dark:text-teal-300"
                          >
                            Download
                          </a>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DetailPageLayout>
  )
}
