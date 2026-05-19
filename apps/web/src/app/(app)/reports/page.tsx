import Link from 'next/link'
import { FileText, Calendar, Sparkles, LayoutDashboard } from 'lucide-react'
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
import { PageContainer } from '@/components/page-layout'
import { loadVisibleDefinitions } from './_definitions'

export const metadata = { title: 'Reports' }
export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const ctx = await requireRequestContext()

  const definitions = await loadVisibleDefinitions(ctx.tenantId!)

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

  const customCount = definitions.filter((d) => d.kind === 'custom').length
  const builtInCount = definitions.length - customCount

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description="Subscribe to recurring email reports, browse the built-in catalogue, and build your own custom report from any module."
          actions={
            <div className="flex gap-2">
              <Link href={'/reports/definitions' as any}>
                <Button variant="outline">Browse definitions</Button>
              </Link>
              <Link href={'/reports/definitions/new' as any}>
                <Button variant="outline">
                  <Sparkles size={14} className="mr-1.5" />
                  New custom report
                </Button>
              </Link>
              <Link href="/reports/schedules/new">
                <Button>Create schedule</Button>
              </Link>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <StatCard
            label="Schedules"
            value={schedules.length}
            href="/reports"
            icon={<Calendar size={16} />}
          />
          <StatCard
            label="Built-in reports"
            value={builtInCount}
            href="/reports/definitions"
            icon={<FileText size={16} />}
          />
          <StatCard
            label="Custom reports"
            value={customCount}
            href="/reports/definitions?kind=custom"
            icon={<Sparkles size={16} />}
          />
          <StatCard
            label="Recent runs"
            value={lastRuns.length}
            href="/reports"
            icon={<LayoutDashboard size={16} />}
          />
        </div>

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
                      <TableCell className="text-slate-600">
                        <span>{definition.name}</span>
                        {definition.kind === 'custom' ? (
                          <Badge variant="outline" className="ml-2">
                            custom
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {formatCadence(
                          schedule.cadence,
                          schedule.dayOfWeek,
                          schedule.dayOfMonth,
                          schedule.hour,
                          schedule.minute,
                          schedule.timezone,
                        )}
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
                        <Link
                          href={`/reports/definitions/${d.id}` as any}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {d.name}
                        </Link>
                        {d.category ? (
                          <Badge variant="outline">{d.category.replace(/_/g, ' ')}</Badge>
                        ) : null}
                        {d.kind === 'custom' ? (
                          <Badge variant="secondary">custom</Badge>
                        ) : null}
                      </div>
                      {d.description ? (
                        <p className="mt-0.5 text-xs text-slate-500">{d.description}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link href={`/reports/definitions/${d.id}` as any}>
                        <Button variant="ghost" size="sm">
                          Preview
                        </Button>
                      </Link>
                      <Link href={`/reports/schedules/new?definitionId=${d.id}`}>
                        <Button variant="outline" size="sm">
                          Subscribe
                        </Button>
                      </Link>
                    </div>
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

function StatCard({
  label,
  value,
  href,
  icon,
}: {
  label: string
  value: number
  href: string
  icon: React.ReactNode
}) {
  return (
    <Link href={href as any}>
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="uppercase tracking-wide">{label}</span>
            <span className="text-slate-400">{icon}</span>
          </div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
        </CardContent>
      </Card>
    </Link>
  )
}

export function formatCadence(
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

export function formatDateTime(d: Date): string {
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
