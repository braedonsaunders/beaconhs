// Schedules tab — every recurring subscription on this tenant, with status
// filtering and inline pause/resume.

import Link from 'next/link'
import { asc, eq } from 'drizzle-orm'
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
import { CalendarClock, Pause, Play } from 'lucide-react'
import { reportDefinitions, reportSchedules } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { ReportsSubNav } from '../_nav'
import { formatCadence, formatDateTime } from '../_format'
import { setActive } from './[id]/actions'

export const metadata = { title: 'Report schedules' }
export const dynamic = 'force-dynamic'

export default async function SchedulesListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  const sp = await searchParams
  const statusFilter = typeof sp.status === 'string' ? sp.status : undefined

  const rows = await ctx.db(async (tx) =>
    tx
      .select({ schedule: reportSchedules, definition: reportDefinitions })
      .from(reportSchedules)
      .innerJoin(reportDefinitions, eq(reportDefinitions.id, reportSchedules.definitionId))
      .orderBy(asc(reportSchedules.name)),
  )

  const activeCount = rows.filter((r) => r.schedule.active).length
  const filtered = rows.filter((r) =>
    statusFilter === 'active'
      ? r.schedule.active
      : statusFilter === 'paused'
        ? !r.schedule.active
        : true,
  )

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Schedules"
            description="Recurring PDF report deliveries."
            actions={
              <Link href="/reports/schedules/new">
                <Button>New schedule</Button>
              </Link>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <ReportsSubNav active="schedules" />
            <div className="ml-auto">
              <FilterChips
                basePath="/reports/schedules"
                currentParams={sp}
                paramKey="status"
                label="Status"
                options={[
                  { value: 'active', label: 'Active', count: activeCount },
                  { value: 'paused', label: 'Paused', count: rows.length - activeCount },
                ]}
              />
            </div>
          </div>
        </>
      }
    >
      {filtered.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={28} />}
          title={rows.length === 0 ? 'No schedules' : 'No matching schedules'}
          description={
            rows.length === 0
              ? 'Subscribe to a report to schedule recurring email delivery.'
              : 'Adjust the status filter.'
          }
          action={
            rows.length === 0 ? (
              <Link href="/reports/definitions">
                <Button variant="outline">Browse the library</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Report</TableHead>
              <TableHead>Cadence</TableHead>
              <TableHead>Recipients</TableHead>
              <TableHead>Next run</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(({ schedule, definition }) => {
              const toggleBound = setActive.bind(null, schedule.id, !schedule.active)
              const recipientCount =
                (schedule.recipientUserIds?.length ?? 0) + (schedule.recipientEmails?.length ?? 0)
              return (
                <TableRow key={schedule.id}>
                  <TableCell>
                    <Link
                      href={`/reports/schedules/${schedule.id}`}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {schedule.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    <Link
                      href={`/reports/definitions/${definition.id}`}
                      className="hover:underline"
                    >
                      {definition.name}
                    </Link>
                    {definition.kind === 'custom' ? (
                      <Badge variant="outline" className="ml-2">
                        custom
                      </Badge>
                    ) : null}
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
                    {recipientCount || '—'}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    {schedule.nextRunAt && schedule.active
                      ? formatDateTime(schedule.nextRunAt)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    {schedule.lastRunAt ? formatDateTime(schedule.lastRunAt) : 'never'}
                  </TableCell>
                  <TableCell>
                    {schedule.active ? (
                      <Badge variant="success">active</Badge>
                    ) : (
                      <Badge variant="secondary">paused</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <form action={toggleBound}>
                      <Button type="submit" variant="ghost" size="sm">
                        {schedule.active ? <Pause size={14} /> : <Play size={14} />}
                      </Button>
                    </form>
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
