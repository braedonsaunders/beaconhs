// Reports hub (Overview tab) — stat cards, the tenant's schedules, recent
// deliveries, and a library teaser. Library and Schedules get their own tabs.

import Link from 'next/link'
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
import { ArrowRight, Calendar, FileText, History, Plus, Sparkles } from 'lucide-react'
import { reportDefinitions, reportRuns, reportSchedules } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { loadVisibleDefinitions } from './_definitions'
import { ReportsSubNav } from './_nav'
import { formatCadence, formatDateTime, StatusBadge } from './_format'

export const metadata = { title: 'Reports' }
export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const ctx = await requireRequestContext()

  const definitions = await loadVisibleDefinitions(ctx.tenantId!)

  const [schedules, lastRuns] = await ctx.db(async (tx) => {
    const s = await tx
      .select({ schedule: reportSchedules, definition: reportDefinitions })
      .from(reportSchedules)
      .innerJoin(reportDefinitions, eq(reportDefinitions.id, reportSchedules.definitionId))
      .orderBy(asc(reportSchedules.name))
    const r = await tx
      .select({ run: reportRuns, schedule: reportSchedules, definition: reportDefinitions })
      .from(reportRuns)
      .innerJoin(reportSchedules, eq(reportSchedules.id, reportRuns.scheduleId))
      .innerJoin(reportDefinitions, eq(reportDefinitions.id, reportSchedules.definitionId))
      .orderBy(desc(reportRuns.startedAt))
      .limit(8)
    return [s, r] as const
  })

  const customCount = definitions.filter((d) => d.kind === 'custom').length
  const builtInCount = definitions.length - customCount
  const activeSchedules = schedules.filter((s) => s.schedule.active)
  const featured = definitions.slice(0, 6)

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description="Run, export, and schedule PDF reports across every module."
          actions={
            <div className="flex gap-2">
              <Link href={'/reports/definitions/new' as never}>
                <Button variant="outline">
                  <Sparkles size={14} className="mr-1.5" />
                  New report
                </Button>
              </Link>
              <Link href="/reports/schedules/new">
                <Button>
                  <Plus size={14} className="mr-1.5" />
                  New schedule
                </Button>
              </Link>
            </div>
          }
        />

        <ReportsSubNav active="overview" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <StatCard
            label="Active schedules"
            value={activeSchedules.length}
            href="/reports/schedules?status=active"
            icon={<Calendar size={16} />}
          />
          <StatCard
            label="Built-in reports"
            value={builtInCount}
            href="/reports/definitions?kind=built_in"
            icon={<FileText size={16} />}
          />
          <StatCard
            label="Custom reports"
            value={customCount}
            href="/reports/definitions?kind=custom"
            icon={<Sparkles size={16} />}
          />
          <StatCard
            label="Recent deliveries"
            value={lastRuns.length}
            href="/reports/schedules"
            icon={<History size={16} />}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Your schedules</CardTitle>
              <Link
                href="/reports/schedules"
                className="flex items-center gap-1 text-xs text-teal-700 hover:underline dark:text-teal-300"
              >
                View all <ArrowRight size={12} />
              </Link>
            </CardHeader>
            <CardContent>
              {schedules.length === 0 ? (
                <EmptyState
                  icon={<Calendar size={24} />}
                  title="No schedules"
                  description="Subscribe to a report to receive it by email on a recurring schedule."
                  action={
                    <Link href="/reports/definitions">
                      <Button variant="outline" size="sm">
                        Browse the library
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Cadence</TableHead>
                      <TableHead>Next run</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedules.slice(0, 6).map(({ schedule, definition }) => (
                      <TableRow key={schedule.id}>
                        <TableCell>
                          <Link
                            href={`/reports/schedules/${schedule.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            {schedule.name}
                          </Link>
                          <div className="text-xs text-slate-400">{definition.name}</div>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          {formatCadence(
                            schedule.cadence,
                            schedule.dayOfWeek,
                            schedule.dayOfMonth,
                            schedule.hour,
                            schedule.minute,
                            schedule.timezone,
                          )}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          {schedule.nextRunAt && schedule.active
                            ? formatDateTime(schedule.nextRunAt)
                            : '—'}
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
              <CardTitle>Recent deliveries</CardTitle>
            </CardHeader>
            <CardContent>
              {lastRuns.length === 0 ? (
                <EmptyState
                  icon={<History size={24} />}
                  title="No deliveries"
                  description="Completed runs and their PDFs appear here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Report</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Rows</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lastRuns.map(({ run, schedule, definition }) => (
                      <TableRow key={run.id}>
                        <TableCell>
                          <Link
                            href={`/reports/schedules/${run.scheduleId}/runs/${run.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            {definition.name}
                          </Link>
                          <div className="text-xs text-slate-400">{schedule.name}</div>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          {formatDateTime(run.startedAt)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          {run.rowCount ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>From the library</CardTitle>
            <Link
              href="/reports/definitions"
              className="flex items-center gap-1 text-xs text-teal-700 hover:underline dark:text-teal-300"
            >
              All {definitions.length} reports <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>
            {featured.length === 0 ? (
              <EmptyState
                icon={<FileText size={24} />}
                title="No reports available"
                description="Create a report to get started."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {featured.map((d) => (
                  <div
                    key={d.id}
                    className="flex flex-col rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/reports/definitions/${d.id}` as never}
                        className="text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {d.name}
                      </Link>
                      {d.kind === 'custom' ? <Badge variant="secondary">custom</Badge> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 flex-1 text-xs text-slate-500 dark:text-slate-400">
                      {d.description ?? ''}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Link href={`/reports/definitions/${d.id}` as never}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </Link>
                      <Link href={`/reports/schedules/new?definitionId=${d.id}`}>
                        <Button variant="ghost" size="sm">
                          Subscribe
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
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
    <Link href={href as never}>
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="tracking-wide uppercase">{label}</span>
            <span className="text-slate-400">{icon}</span>
          </div>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
        </CardContent>
      </Card>
    </Link>
  )
}
