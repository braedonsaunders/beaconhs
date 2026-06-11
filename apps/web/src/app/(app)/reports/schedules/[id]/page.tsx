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
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import { reportDefinitions, reportRuns, reportSchedules } from '@beaconhs/db/schema'
import { db, withSuperAdmin } from '@beaconhs/db'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { deleteSchedule, setActive, triggerNow, updateSchedule } from './actions'
import { StatusBadge } from '../../page'

export const metadata = { title: 'Report schedule' }

export default async function ScheduleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()

  const schedule = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(reportSchedules).where(eq(reportSchedules.id, id)).limit(1)
    return row ?? null
  })
  if (!schedule) notFound()

  const [definition] = await withSuperAdmin(db, (tx) =>
    tx
      .select()
      .from(reportDefinitions)
      .where(eq(reportDefinitions.id, schedule.definitionId))
      .limit(1),
  )

  const runs = await ctx.db(async (tx) =>
    tx
      .select()
      .from(reportRuns)
      .where(eq(reportRuns.scheduleId, id))
      .orderBy(desc(reportRuns.startedAt))
      .limit(50),
  )

  const triggerBound = triggerNow.bind(null, id)
  const toggleBound = setActive.bind(null, id, !schedule.active)
  const deleteBound = deleteSchedule.bind(null, id)
  const updateBound = updateSchedule.bind(null, id)

  return (
    <PageContainer>
      <div className="space-y-6">
        <DetailHeader
          back={{ href: '/reports', label: 'Back to reports' }}
          title={schedule.name}
          subtitle={definition?.name ?? 'Unknown report'}
          badge={
            schedule.active ? (
              <Badge variant="success">active</Badge>
            ) : (
              <Badge variant="secondary">paused</Badge>
            )
          }
          actions={
            <>
              <form action={triggerBound}>
                <Button type="submit" variant="outline">
                  Run now
                </Button>
              </form>
              <form action={toggleBound}>
                <Button type="submit" variant="outline">
                  {schedule.active ? 'Pause' : 'Resume'}
                </Button>
              </form>
              <form action={deleteBound}>
                <Button type="submit" variant="destructive">
                  Delete
                </Button>
              </form>
            </>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateBound} className="space-y-4">
              <Field label="Schedule name" required>
                <Input name="name" required defaultValue={schedule.name} />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cadence" required>
                  <Select name="cadence" defaultValue={schedule.cadence}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </Select>
                </Field>
                <Field label="Timezone" required>
                  <Input name="timezone" required defaultValue={schedule.timezone} />
                </Field>
                <Field label="Day of week (weekly)">
                  <Select name="dayOfWeek" defaultValue={String(schedule.dayOfWeek ?? 1)}>
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </Select>
                </Field>
                <Field label="Day of month (monthly)">
                  <Input
                    name="dayOfMonth"
                    type="number"
                    min={1}
                    max={31}
                    defaultValue={schedule.dayOfMonth ?? 1}
                  />
                </Field>
                <Field label="Hour (0-23)" required>
                  <Input
                    name="hour"
                    type="number"
                    min={0}
                    max={23}
                    defaultValue={schedule.hour}
                    required
                  />
                </Field>
                <Field label="Minute (0-59)" required>
                  <Input
                    name="minute"
                    type="number"
                    min={0}
                    max={59}
                    defaultValue={schedule.minute}
                    required
                  />
                </Field>
              </div>

              <Field label="Recipient emails (one per line, or comma-separated)">
                <Textarea
                  name="recipientEmails"
                  rows={3}
                  defaultValue={(schedule.recipientEmails ?? []).join('\n')}
                />
              </Field>

              <Field label="Recipient user IDs (resolved to emails at send)">
                <Textarea
                  name="recipientUserIds"
                  rows={2}
                  defaultValue={(schedule.recipientUserIds ?? []).join('\n')}
                />
              </Field>

              <Field label="Filters (JSON)">
                <Textarea
                  name="filters"
                  rows={3}
                  defaultValue={JSON.stringify(schedule.filters ?? {}, null, 2)}
                />
              </Field>

              <div className="flex items-center justify-between text-xs text-slate-500">
                <div>
                  Next run:{' '}
                  <strong>
                    {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : '—'}
                  </strong>{' '}
                  · Last run:{' '}
                  <strong>
                    {schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : 'never'}
                  </strong>
                </div>
                <Button type="submit">Save changes</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Run history ({runs.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-sm text-slate-500">
                No runs yet. Click <em>Run now</em> to trigger one manually.
              </p>
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
                      <TableCell className="text-slate-600">
                        <Link
                          href={`/reports/schedules/${id}/runs/${r.id}`}
                          className="hover:underline"
                        >
                          {new Date(r.startedAt).toLocaleString()}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {r.finishedAt ? new Date(r.finishedAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-slate-600">{r.rowCount ?? '—'}</TableCell>
                      <TableCell>
                        {r.pdfAttachmentId ? (
                          <Link
                            href={`/reports/schedules/${id}/runs/${r.id}`}
                            className="text-teal-700 hover:underline"
                          >
                            View
                          </Link>
                        ) : (
                          '—'
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
    </PageContainer>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
