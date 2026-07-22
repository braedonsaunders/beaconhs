import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
import {
  isOperationalFilterReportSlug,
  isTrainingReportQueryKind,
  normalizeOperationalReportFilters,
  normalizeTrainingReportFilters,
} from '@beaconhs/reports'
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
import { loadTrainingFilterSelections } from '../../_training-filter-data'
import { loadOperationalFilterSelections } from '../../_operational-filter-data'
import { deleteSchedule, setActive, triggerNow, updateSchedule } from './actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0d9fe5e16e9812') }
}
export const dynamic = 'force-dynamic'

const SORTS = ['started'] as const

export default async function ScheduleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
  const trainingFilterSelections =
    canSchedule && definition && isTrainingReportQueryKind(definition.queryKind)
      ? await loadTrainingFilterSelections(
          ctx,
          normalizeTrainingReportFilters(schedule.filters ?? {}),
        )
      : undefined
  const operationalFilterSelections =
    canSchedule && definition && isOperationalFilterReportSlug(definition.slug)
      ? await loadOperationalFilterSelections(
          ctx,
          normalizeOperationalReportFilters(definition.slug, schedule.filters ?? {}),
        )
      : undefined
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
          title={tGeneratedValue(schedule.name)}
          subtitle={tGeneratedValue(
            definition
              ? tGenerated('m_0d395c74ffad3e', { value0: definition.name })
              : tGenerated('m_0b1c499d0b9255'),
          )}
          badge={
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
          actions={
            <>
              <GeneratedValue
                value={
                  definition ? (
                    <Link href={`/reports/definitions/${definition.id}`}>
                      <Button variant="outline" size="sm">
                        <GeneratedText id="m_0a0fa830980e0c" />
                      </Button>
                    </Link>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  canSchedule ? (
                    <>
                      <form action={triggerBound}>
                        <Button type="submit" variant="outline" size="sm">
                          <Zap size={14} className="mr-1.5" />
                          <GeneratedText id="m_088d61d7784bcf" />
                        </Button>
                      </form>
                      <form action={toggleBound}>
                        <Button type="submit" variant="outline" size="sm">
                          <GeneratedValue
                            value={
                              schedule.active ? (
                                <>
                                  <Pause size={14} className="mr-1.5" />
                                  <GeneratedText id="m_18a541e86f31d8" />
                                </>
                              ) : (
                                <>
                                  <Play size={14} className="mr-1.5" />
                                  <GeneratedText id="m_0607d4d4be574c" />
                                </>
                              )
                            }
                          />
                        </Button>
                      </form>
                      <form action={deleteBound}>
                        <Button type="submit" variant="destructive" size="sm">
                          <Trash2 size={14} className="mr-1.5" />
                          <GeneratedText id="m_11773f3c3f7558" />
                        </Button>
                      </form>
                    </>
                  ) : null
                }
              />
            </>
          }
        />
      }
    >
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              <GeneratedText id="m_091d9cc13438f5" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GeneratedValue
              value={
                canSchedule ? (
                  <ScheduleForm
                    definitions={definitions}
                    members={members}
                    initial={{
                      definitionId: schedule.definitionId,
                      name: schedule.name,
                      cadence: schedule.cadence,
                      repeatEvery: schedule.repeatEvery,
                      dayOfWeek: schedule.dayOfWeek,
                      dayOfMonth: schedule.dayOfMonth,
                      weekOfMonth: schedule.weekOfMonth,
                      hour: schedule.hour,
                      minute: schedule.minute,
                      timezone: schedule.timezone,
                      startsOn: schedule.startsOn,
                      endsOn: schedule.endsOn,
                      recipientUserIds: schedule.recipientUserIds ?? [],
                      recipientEmails: schedule.recipientEmails ?? [],
                      filters: schedule.filters ?? {},
                      emailSubject: schedule.emailSubject,
                      emailMessage: schedule.emailMessage,
                    }}
                    submitLabel={tGenerated('m_1ab9025ed1067c')}
                    action={updateBound}
                    initialTrainingSelections={trainingFilterSelections}
                    initialOperationalSelections={operationalFilterSelections}
                    extraFooter={
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedText id="m_055eaa561d8421" />
                        <GeneratedValue value={' '} />
                        <strong>
                          <GeneratedValue
                            value={
                              schedule.nextRunAt
                                ? formatDateTime(
                                    new Date(schedule.nextRunAt),
                                    ctx.timezone,
                                    ctx.locale,
                                  )
                                : '—'
                            }
                          />
                        </strong>
                        <GeneratedValue value={' '} />
                        <GeneratedText id="m_042f569ce77fcd" />
                        <GeneratedValue value={' '} />
                        <strong>
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
                        </strong>
                      </p>
                    }
                  />
                ) : (
                  <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                    <ConfigItem label={tGenerated('m_0ab5a972fc80fd')}>
                      <GeneratedValue value={definition?.name ?? '—'} />
                    </ConfigItem>
                    <ConfigItem label={tGenerated('m_1151ed0308b6d1')}>
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
                    </ConfigItem>
                    <ConfigItem label={tGenerated('m_0d99b2b56f8b5d')}>
                      <GeneratedValue
                        value={
                          recipientCount ? (
                            <GeneratedText
                              id="m_1ed3e2228b6ce2"
                              values={{
                                value0: recipientCount,
                                value1: recipientCount === 1 ? '' : 's',
                              }}
                            />
                          ) : (
                            '—'
                          )
                        }
                      />
                    </ConfigItem>
                    <ConfigItem label={tGenerated('m_14c7a1feb33b17')}>
                      <GeneratedValue value={schedule.timezone} />
                    </ConfigItem>
                    <ConfigItem label={tGenerated('m_05e650592b7158')}>
                      <GeneratedValue
                        value={
                          schedule.nextRunAt
                            ? formatDateTime(new Date(schedule.nextRunAt), ctx.timezone, ctx.locale)
                            : '—'
                        }
                      />
                    </ConfigItem>
                    <ConfigItem label={tGenerated('m_1236782a321d73')}>
                      <GeneratedValue
                        value={
                          schedule.lastRunAt ? (
                            formatDateTime(new Date(schedule.lastRunAt), ctx.timezone, ctx.locale)
                          ) : (
                            <GeneratedText id="m_069a3d1a5f8ba4" />
                          )
                        }
                      />
                    </ConfigItem>
                  </dl>
                )
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              <GeneratedText id="m_0c0abeaa90bac6" />
              <GeneratedValue value={runData.total} />)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TableToolbar className="mb-3">
              <SearchInput placeholder={tGenerated('m_0a26915cb2ee54')} />
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="status"
                label={tGenerated('m_0b9da892d6faf0')}
                options={[
                  { value: 'queued', label: 'Queued' },
                  { value: 'running', label: 'Running' },
                  { value: 'succeeded', label: 'Succeeded' },
                  { value: 'failed', label: 'Failed' },
                ]}
              />
            </TableToolbar>
            <GeneratedValue
              value={
                runs.length === 0 ? (
                  <EmptyState
                    icon={<History size={24} />}
                    title={tGeneratedValue(
                      listParams.q || statusFilter
                        ? tGenerated('m_1dc097ef89ae5f')
                        : tGenerated('m_00bdcdd0c9471c'),
                    )}
                    description={tGeneratedValue(
                      listParams.q || statusFilter
                        ? tGenerated('m_1ebae737f8b478')
                        : tGenerated('m_17dca5b3eaf18e'),
                    )}
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          <GeneratedText id="m_1922c581498469" />
                        </TableHead>
                        <TableHead>
                          <GeneratedText id="m_0b4f952ff360b5" />
                        </TableHead>
                        <TableHead>
                          <GeneratedText id="m_0b9da892d6faf0" />
                        </TableHead>
                        <TableHead>
                          <GeneratedText id="m_03be2202673df4" />
                        </TableHead>
                        <TableHead>
                          <GeneratedText id="m_1a2b2ed6729166" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <GeneratedValue
                        value={runs.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-slate-600 dark:text-slate-300">
                              <Link
                                href={`/reports/schedules/${id}/runs/${r.id}`}
                                className="hover:underline"
                              >
                                <GeneratedValue
                                  value={formatDateTime(
                                    new Date(r.startedAt),
                                    ctx.timezone,
                                    ctx.locale,
                                  )}
                                />
                              </Link>
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-300">
                              <GeneratedValue
                                value={
                                  r.finishedAt
                                    ? formatDateTime(
                                        new Date(r.finishedAt),
                                        ctx.timezone,
                                        ctx.locale,
                                      )
                                    : '—'
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={r.status} />
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-300">
                              <GeneratedValue value={r.rowCount ?? '—'} />
                            </TableCell>
                            <TableCell>
                              <GeneratedValue
                                value={
                                  r.pdfAttachmentId ? (
                                    <a
                                      href={`/reports/schedules/${id}/runs/${r.id}/pdf`}
                                      className="text-teal-700 hover:underline dark:text-teal-300"
                                    >
                                      <GeneratedText id="m_0fcb9c63d263d1" />
                                    </a>
                                  ) : (
                                    <span className="text-slate-300 dark:text-slate-600">—</span>
                                  )
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      />
                    </TableBody>
                  </Table>
                )
              }
            />
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
        <GeneratedValue value={label} />
      </dt>
      <dd className="mt-0.5 text-slate-900 dark:text-slate-100">
        <GeneratedValue value={children} />
      </dd>
    </div>
  )
}
