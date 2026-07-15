import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a3a0b97daa2bd') }
}
export const dynamic = 'force-dynamic'

const BASE = '/reports/schedules'
const SORTS = ['name', 'report', 'nextRun', 'status'] as const

export default async function SchedulesListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_1da27732d46566')}
            description={tGenerated('m_05188197d6c558')}
            actions={
              canSchedule ? (
                <Link href="/reports/schedules/new">
                  <Button>
                    <GeneratedText id="m_0f2dd0043302a1" />
                  </Button>
                </Link>
              ) : undefined
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <ReportsSubNav active="schedules" />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <SearchInput placeholder={tGenerated('m_0a882d6ebb0bf4')} />
              <FilterChips
                basePath={BASE}
                currentParams={sp}
                paramKey="status"
                label={tGenerated('m_0b9da892d6faf0')}
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
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<CalendarClock size={28} />}
              title={tGeneratedValue(
                !params.q && !statusFilter && total === 0
                  ? tGenerated('m_128e4fb23de822')
                  : tGenerated('m_0be2fe2e4f2864'),
              )}
              description={tGeneratedValue(
                !params.q && !statusFilter && total === 0
                  ? tGenerated('m_1af456805c3509')
                  : tGenerated('m_04e165953b7462'),
              )}
              action={
                !params.q && !statusFilter && total === 0 ? (
                  <Link href="/reports">
                    <Button variant="outline">
                      <GeneratedText id="m_180106a8c3ff04" />
                    </Button>
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
                      <GeneratedText id="m_02b18d5c7f6f2d" />
                    </SortableTh>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="report"
                      active={params.sort === 'report'}
                    >
                      <GeneratedText id="m_0ab5a972fc80fd" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_1151ed0308b6d1" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0d99b2b56f8b5d" />
                    </TableHead>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="nextRun"
                      active={params.sort === 'nextRun'}
                    >
                      <GeneratedText id="m_05e650592b7158" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_1236782a321d73" />
                    </TableHead>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="status"
                      active={params.sort === 'status'}
                    >
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </SortableTh>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ schedule, definition }) => {
                      const toggleBound = setActive.bind(null, schedule.id, !schedule.active)
                      const recipientCount =
                        (schedule.recipientUserIds?.length ?? 0) +
                        (schedule.recipientEmails?.length ?? 0)
                      return (
                        <TableRow key={schedule.id}>
                          <TableCell>
                            <Link
                              href={`/reports/schedules/${schedule.id}`}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={schedule.name} />
                            </Link>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <Link
                              href={`/reports/definitions/${definition.id}`}
                              className="hover:underline"
                            >
                              <GeneratedValue value={definition.name} />
                            </Link>
                            <GeneratedValue
                              value={
                                definition.kind === 'custom' ? (
                                  <Badge variant="outline" className="ml-2">
                                    <GeneratedText id="m_0abce084240d5f" />
                                  </Badge>
                                ) : null
                              }
                            />
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue
                              value={formatCadence(
                                schedule.cadence,
                                schedule.dayOfWeek,
                                schedule.dayOfMonth,
                                schedule.hour,
                                schedule.minute,
                                schedule.timezone,
                              )}
                            />
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue value={recipientCount || '—'} />
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue
                              value={
                                schedule.nextRunAt && schedule.active
                                  ? formatDateTime(
                                      new Date(schedule.nextRunAt),
                                      ctx.timezone,
                                      ctx.locale,
                                    )
                                  : '—'
                              }
                            />
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue
                              value={
                                schedule.lastRunAt ? (
                                  formatDateTime(
                                    new Date(schedule.lastRunAt),
                                    ctx.timezone,
                                    ctx.locale,
                                  )
                                ) : (
                                  <GeneratedText id="m_069a3d1a5f8ba4" />
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                schedule.active ? (
                                  <Badge variant="success">
                                    <GeneratedText id="m_0af64d5dc843c0" />
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_18a9844f041430" />
                                  </Badge>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                canSchedule ? (
                                  <form action={toggleBound}>
                                    <Button
                                      type="submit"
                                      variant="ghost"
                                      size="sm"
                                      aria-label={tGeneratedValue(
                                        schedule.active
                                          ? tGenerated('m_15f68d81e0bf4a')
                                          : tGenerated('m_1fd7f9ce965029'),
                                      )}
                                    >
                                      <GeneratedValue
                                        value={
                                          schedule.active ? <Pause size={14} /> : <Play size={14} />
                                        }
                                      />
                                    </Button>
                                  </form>
                                ) : null
                              }
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  />
                </TableBody>
              </Table>
            </div>
          )
        }
      />
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
