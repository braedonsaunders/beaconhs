import Link from 'next/link'
import { FileText, Calendar } from 'lucide-react'
import { asc, desc, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { reportDefinitions, reportSchedules, reportRuns } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { db, withSuperAdmin } from '@beaconhs/db'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Reports' }

export default async function ReportsPage() {
  const ctx = await requireRequestContext()

  // Definitions live outside RLS (no tenant_id) — read with super-admin bypass.
  const definitions = await withSuperAdmin(db, (tx) =>
    tx.select().from(reportDefinitions).orderBy(asc(reportDefinitions.category), asc(reportDefinitions.name)),
  )

  const [schedules, lastRuns] = await ctx.db(async (tx) => {
    const s = await tx
      .select({
        schedule: reportSchedules,
        definition: reportDefinitions,
      })
      .from(reportSchedules)
      .innerJoin(reportDefinitions, eq(reportDefinitions.id, reportSchedules.definitionId))
      .orderBy(asc(reportSchedules.name))
    const r = await tx
      .select()
      .from(reportRuns)
      .orderBy(desc(reportRuns.startedAt))
      .limit(10)
    return [s, r] as const
  })

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description="Subscribe to recurring report emails. Each run renders a PDF and emails it to the recipients."
          actions={
            <Link href="/reports/schedules/new">
              <Button>Create schedule</Button>
            </Link>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>Your schedules ({schedules.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {schedules.length === 0 ? (
              <EmptyState
                icon={<Calendar size={28} />}
                title="No scheduled reports yet"
                description="Subscribe to one of the report definitions below to receive it on a recurring email."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Report</TableHead>
                    <TableHead>Cadence</TableHead>
                    <TableHead>Next run</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map(({ schedule, definition }) => (
                    <TableRow key={schedule.id}>
                      <TableCell>
                        <Link
                          href={`/reports/schedules/${schedule.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {schedule.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600">{definition.name}</TableCell>
                      <TableCell className="text-slate-600">
                        {formatCadence(schedule.cadence, schedule.dayOfWeek, schedule.dayOfMonth, schedule.hour, schedule.minute, schedule.timezone)}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : '—'}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {schedule.lastRunAt ? formatDateTime(schedule.lastRunAt) : 'never'}
                      </TableCell>
                      <TableCell>
                        {schedule.active ? (
                          <Badge variant="success">active</Badge>
                        ) : (
                          <Badge variant="secondary">paused</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Available reports ({definitions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {definitions.length === 0 ? (
              <EmptyState
                icon={<FileText size={28} />}
                title="No report definitions"
                description="Run the seed to populate the catalogue of available reports."
              />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {definitions.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-start justify-between gap-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{d.name}</span>
                        {d.category ? (
                          <Badge variant="outline">{d.category}</Badge>
                        ) : null}
                      </div>
                      {d.description ? (
                        <p className="mt-0.5 text-xs text-slate-500">{d.description}</p>
                      ) : null}
                    </div>
                    <Link
                      href={`/reports/schedules/new?definitionId=${d.id}`}
                      className="shrink-0"
                    >
                      <Button variant="outline" size="sm">
                        Subscribe
                      </Button>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
          </CardHeader>
          <CardContent>
            {lastRuns.length === 0 ? (
              <p className="text-sm text-slate-500">No runs yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Schedule</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lastRuns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-slate-600">
                        <Link
                          href={`/reports/schedules/${r.scheduleId}/runs/${r.id}`}
                          className="hover:underline"
                        >
                          {formatDateTime(r.startedAt)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-slate-600">{r.rowCount ?? '—'}</TableCell>
                      <TableCell className="text-slate-600">
                        <Link
                          href={`/reports/schedules/${r.scheduleId}`}
                          className="hover:underline"
                        >
                          {r.scheduleId.slice(0, 8)}…
                        </Link>
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

function formatCadence(
  cadence: 'daily' | 'weekly' | 'monthly',
  dow: number | null,
  dom: number | null,
  hour: number,
  minute: number,
  tz: string,
): string {
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  if (cadence === 'daily') return `Daily @ ${time} ${tz}`
  if (cadence === 'weekly') return `Weekly · ${days[dow ?? 1]} @ ${time} ${tz}`
  return `Monthly · day ${dom ?? 1} @ ${time} ${tz}`
}

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function StatusBadge({ status }: { status: 'queued' | 'running' | 'succeeded' | 'failed' }) {
  const variant =
    status === 'succeeded'
      ? 'success'
      : status === 'failed'
        ? 'destructive'
        : status === 'running'
          ? 'warning'
          : 'secondary'
  return <Badge variant={variant as any}>{status}</Badge>
}
