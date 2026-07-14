// Schedules tab — every recurring subscription on this tenant, with status
// filtering and inline pause/resume.

import Link from 'next/link'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
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
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { parseListParams, pickString } from '@/lib/list-params'
import { ReportsSubNav } from '../_nav'
import { formatCadence } from '../_format'
import { formatDateTime } from '@/lib/datetime'
import { setActive } from './[id]/actions'

export const metadata = { title: 'Report schedules' }
export const dynamic = 'force-dynamic'

const BASE = '/reports/schedules'
const SORTS = ['name', 'report', 'nextRun', 'status'] as const

export default async function SchedulesListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  const sp = await searchParams
  const statusParam = pickString(sp.status)
  const statusFilter =
    statusParam === 'active' || statusParam === 'paused' ? statusParam : undefined
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const canSchedule = can(ctx, 'reports.schedule')

  const { rows, total, activeCount, pausedCount } = await ctx.db(async (tx) => {
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(reportSchedules.name, `%${params.q}%`),
          ilike(reportDefinitions.name, `%${params.q}%`),
        )
      : undefined
    const status =
      statusFilter === 'active'
        ? eq(reportSchedules.active, true)
        : statusFilter === 'paused'
          ? eq(reportSchedules.active, false)
          : undefined
    const where = and(search, status)
    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'report'
        ? [dirFn(reportDefinitions.name), asc(reportSchedules.name)]
        : params.sort === 'nextRun'
          ? [dirFn(reportSchedules.nextRunAt), asc(reportSchedules.name)]
          : params.sort === 'status'
            ? [dirFn(reportSchedules.active), asc(reportSchedules.name)]
            : [dirFn(reportSchedules.name)]

    const baseCount = () =>
      tx
        .select({ c: count() })
        .from(reportSchedules)
        .innerJoin(reportDefinitions, eq(reportDefinitions.id, reportSchedules.definitionId))

    const [totalRow, activeRow, pausedRow, result] = await Promise.all([
      baseCount().where(where),
      baseCount().where(and(search, eq(reportSchedules.active, true))),
      baseCount().where(and(search, eq(reportSchedules.active, false))),
      tx
        .select({ schedule: reportSchedules, definition: reportDefinitions })
        .from(reportSchedules)
        .innerJoin(reportDefinitions, eq(reportDefinitions.id, reportSchedules.definitionId))
        .where(where)
        .orderBy(...orderBy)
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage),
    ])
    return {
      rows: result,
      total: Number(totalRow[0]?.c ?? 0),
      activeCount: Number(activeRow[0]?.c ?? 0),
      pausedCount: Number(pausedRow[0]?.c ?? 0),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Schedules"
            description="Recurring PDF report deliveries."
            actions={
              canSchedule ? (
                <Link href="/reports/schedules/new">
                  <Button>New schedule</Button>
                </Link>
              ) : undefined
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <ReportsSubNav active="schedules" />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <SearchInput placeholder="Search schedules and reports…" />
              <FilterChips
                basePath={BASE}
                currentParams={sp}
                paramKey="status"
                label="Status"
                options={[
                  { value: 'active', label: 'Active', count: activeCount },
                  { value: 'paused', label: 'Paused', count: pausedCount },
                ]}
              />
            </div>
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={28} />}
          title={
            !params.q && !statusFilter && total === 0 ? 'No schedules' : 'No matching schedules'
          }
          description={
            !params.q && !statusFilter && total === 0
              ? 'Subscribe to a report to schedule recurring email delivery.'
              : 'Adjust the search or status filter.'
          }
          action={
            !params.q && !statusFilter && total === 0 ? (
              <Link href="/reports">
                <Button variant="outline">Browse reports</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="name"
                  active={params.sort === 'name'}
                >
                  Name
                </SortableTh>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="report"
                  active={params.sort === 'report'}
                >
                  Report
                </SortableTh>
                <TableHead>Cadence</TableHead>
                <TableHead>Recipients</TableHead>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="nextRun"
                  active={params.sort === 'nextRun'}
                >
                  Next run
                </SortableTh>
                <TableHead>Last run</TableHead>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="status"
                  active={params.sort === 'status'}
                >
                  Status
                </SortableTh>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ schedule, definition }) => {
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
                        ? formatDateTime(new Date(schedule.nextRunAt), ctx.timezone, ctx.locale)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {schedule.lastRunAt
                        ? formatDateTime(new Date(schedule.lastRunAt), ctx.timezone, ctx.locale)
                        : 'never'}
                    </TableCell>
                    <TableCell>
                      {schedule.active ? (
                        <Badge variant="success">active</Badge>
                      ) : (
                        <Badge variant="secondary">paused</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {canSchedule ? (
                        <form action={toggleBound}>
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            aria-label={schedule.active ? 'Pause schedule' : 'Resume schedule'}
                          >
                            {schedule.active ? <Pause size={14} /> : <Play size={14} />}
                          </Button>
                        </form>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={total}
        page={params.page}
        perPage={params.perPage}
      />
    </ListPageLayout>
  )
}
