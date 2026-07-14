import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm'
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
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { loadDefinitionById } from '../../_definitions'
import { formatCadence, StatusBadge } from '../../_format'
import { formatDateTime } from '@/lib/datetime'
import { loadScheduleFormData } from '../_data'
import { ScheduleForm } from '../_schedule-form'
import { deleteSchedule, setActive, triggerNow, updateSchedule } from './actions'

export const metadata = { title: 'Report schedule' }
export const dynamic = 'force-dynamic'

const SORTS = ['started'] as const

export default async function ScheduleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const listParams = parseListParams(sp, {
    sort: 'started',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusParam = pickString(sp.status)
  const statusFilter = ['queued', 'running', 'succeeded', 'failed'].includes(statusParam ?? '')
    ? (statusParam as 'queued' | 'running' | 'succeeded' | 'failed')
    : undefined
  const ctx = await requireRequestContext()

  const schedule = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(reportSchedules).where(eq(reportSchedules.id, id)).limit(1)
    return row ?? null
  })
  if (!schedule) notFound()

  const canSchedule = can(ctx, 'reports.schedule')

  const [definition, { definitions, members }, runData] = await Promise.all([
    loadDefinitionById(ctx.tenantId!, schedule.definitionId),
    canSchedule
      ? loadScheduleFormData(ctx)
      : Promise.resolve({ definitions: [] as never[], members: [] as never[] }),
    ctx.db(async (tx) => {
      const search: SQL<unknown> | undefined = listParams.q
        ? sql`(${reportRuns.status}::text ilike ${`%${listParams.q}%`} or ${reportRuns.trigger}::text ilike ${`%${listParams.q}%`} or ${reportRuns.startedAt}::text ilike ${`%${listParams.q}%`})`
        : undefined
      const where = and(
        eq(reportRuns.scheduleId, id),
        search,
        statusFilter ? eq(reportRuns.status, statusFilter) : undefined,
      )
      const [totalRow] = await tx.select({ c: count() }).from(reportRuns).where(where)
      const rows = await tx
        .select()
        .from(reportRuns)
        .where(where)
        .orderBy(desc(reportRuns.startedAt))
        .limit(listParams.perPage)
        .offset((listParams.page - 1) * listParams.perPage)
      return { rows, total: Number(totalRow?.c ?? 0) }
    }),
  ])
  const runs = runData.rows
  const basePath = `/reports/schedules/${id}`

  const triggerBound = triggerNow.bind(null, id)
  const toggleBound = setActive.bind(null, id, !schedule.active)
  const deleteBound = deleteSchedule.bind(null, id)
  const updateBound = updateSchedule.bind(null, id)
  const recipientCount =
    (schedule.recipientUserIds?.length ?? 0) + (schedule.recipientEmails?.length ?? 0)

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
              {canSchedule ? (
                <>
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
              ) : null}
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
            {canSchedule ? (
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
                    <strong>
                      {schedule.nextRunAt
                        ? formatDateTime(new Date(schedule.nextRunAt), ctx.timezone)
                        : '—'}
                    </strong>{' '}
                    · Last run:{' '}
                    <strong>
                      {schedule.lastRunAt
                        ? formatDateTime(new Date(schedule.lastRunAt), ctx.timezone)
                        : 'never'}
                    </strong>
                  </p>
                }
              />
            ) : (
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <ConfigItem label="Report">{definition?.name ?? '—'}</ConfigItem>
                <ConfigItem label="Cadence">
                  {formatCadence(
                    schedule.cadence,
                    schedule.dayOfWeek,
                    schedule.dayOfMonth,
                    schedule.hour,
                    schedule.minute,
                    schedule.timezone,
                  )}
                </ConfigItem>
                <ConfigItem label="Recipients">
                  {recipientCount
                    ? `${recipientCount} recipient${recipientCount === 1 ? '' : 's'}`
                    : '—'}
                </ConfigItem>
                <ConfigItem label="Timezone">{schedule.timezone}</ConfigItem>
                <ConfigItem label="Next run">
                  {schedule.nextRunAt
                    ? formatDateTime(new Date(schedule.nextRunAt), ctx.timezone)
                    : '—'}
                </ConfigItem>
                <ConfigItem label="Last run">
                  {schedule.lastRunAt
                    ? formatDateTime(new Date(schedule.lastRunAt), ctx.timezone)
                    : 'never'}
                </ConfigItem>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Run history ({runData.total})</CardTitle>
          </CardHeader>
          <CardContent>
            <TableToolbar className="mb-3">
              <SearchInput placeholder="Search date, status, or trigger…" />
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="status"
                label="Status"
                options={[
                  { value: 'queued', label: 'Queued' },
                  { value: 'running', label: 'Running' },
                  { value: 'succeeded', label: 'Succeeded' },
                  { value: 'failed', label: 'Failed' },
                ]}
              />
            </TableToolbar>
            {runs.length === 0 ? (
              <EmptyState
                icon={<History size={24} />}
                title={listParams.q || statusFilter ? 'No runs match your filters' : 'No runs'}
                description={
                  listParams.q || statusFilter
                    ? 'Clear the search or status filter to see other runs.'
                    : 'Run now to trigger the first delivery.'
                }
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
                          {formatDateTime(new Date(r.startedAt), ctx.timezone)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-300">
                        {r.finishedAt ? formatDateTime(new Date(r.finishedAt), ctx.timezone) : '—'}
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
            <Pagination
              basePath={basePath}
              currentParams={sp}
              total={runData.total}
              page={listParams.page}
              perPage={listParams.perPage}
            />
          </CardContent>
        </Card>
      </div>
    </DetailPageLayout>
  )
}

function ConfigItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{children}</dd>
    </div>
  )
}
