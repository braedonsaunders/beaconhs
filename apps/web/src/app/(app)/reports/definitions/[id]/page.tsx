import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'
// Report viewer — a true print preview. Runs the definition in-app (same
// engine and same document template as scheduled PDFs) and paginates it into
// real paper pages with Paged.js, so the screen matches the exported PDF
// page-for-page. The Document tab owns the viewport height; subscriptions,
// run history, and definition details live on the Schedules & activity tab.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, count, desc, eq, ilike, or } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@beaconhs/ui'
import {
  Calendar,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Mail,
  Pencil,
  Trash2,
} from 'lucide-react'
import { reportRuns, reportSchedules } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import {
  buildReportDocumentCss,
  buildReportPageCss,
  isTrainingReportQueryKind,
  normalizeTrainingReportFilters,
  renderReportDocumentBodyHtml,
  resolveReportLayout,
  trainingReportFiltersToRecord,
  type TrainingReportFilters,
} from '@beaconhs/reports'
import { requireRequestContext } from '@/lib/auth'
import { FadeInHeader } from '@/components/page-layout-motion'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { loadDefinitionById } from '../../_definitions'
import {
  DOCUMENT_PREVIEW_MAX_ROWS,
  VIEWER_RANGE_CHOICES,
  loadTenantBranding,
  runReportForViewer,
} from '../../_run'
import { formatCadence, CategoryBadge, KindBadge, StatusBadge } from '../../_format'
import { formatDateTime } from '@/lib/datetime'
import { ReportPagedPreview } from '../../_components/report-paged-preview.client'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { runOnceFromDefinition, deleteDefinition } from './actions'
import { TrainingReportFilterPanel } from '../../_training-report-filters.client'
import { loadTrainingFilterSelections } from '../../_training-filter-data'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0ab5a972fc80fd') }
}
export const dynamic = 'force-dynamic'

const TABS = ['document', 'activity'] as const
const ACTIVITY_SORTS = ['created'] as const
const RUN_SORTS = ['started'] as const
const SCHEDULE_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
] as const
const RUN_STATUS_OPTIONS = [
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
] as const

export default async function ReportViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const ctx = await requireRequestContext()

  const definition = await loadDefinitionById(ctx.tenantId!, id)
  if (!definition) notFound()

  const tab = pickActiveTab(sp, TABS, 'document')
  const daysParam = typeof sp.days === 'string' ? Number(sp.days) : null
  const trainingFilters = isTrainingReportQueryKind(definition.queryKind)
    ? normalizeTrainingReportFilters({
        personIds: sp.personIds,
        departmentIds: sp.departmentIds,
        groupIds: sp.groupIds,
        courseIds: sp.courseIds,
        deliveryTypes: sp.deliveryTypes,
        groupBy: sp.groupBy,
        expiryWindowDays: sp.expiryWindowDays,
        includeExpired: sp.includeExpired,
      })
    : null
  const scheduleParams = parseListParams(
    {
      q: sp.scheduleQ,
      sort: sp.scheduleSort,
      dir: sp.scheduleDir,
      page: sp.schedulePage,
      perPage: sp.schedulePerPage,
    },
    { sort: 'created', dir: 'desc', perPage: 15, allowedSorts: ACTIVITY_SORTS },
  )
  const runParams = parseListParams(
    {
      q: sp.runQ,
      sort: sp.runSort,
      dir: sp.runDir,
      page: sp.runPage,
      perPage: sp.runPerPage,
    },
    { sort: 'started', dir: 'desc', perPage: 15, allowedSorts: RUN_SORTS },
  )
  const requestedScheduleStatus = pickString(sp.scheduleStatus)
  const scheduleStatus =
    requestedScheduleStatus === 'active' || requestedScheduleStatus === 'paused'
      ? requestedScheduleStatus
      : undefined
  const requestedRunStatus = pickString(sp.runStatus)
  const runStatus =
    requestedRunStatus === 'queued' ||
    requestedRunStatus === 'running' ||
    requestedRunStatus === 'succeeded' ||
    requestedRunStatus === 'failed'
      ? requestedRunStatus
      : undefined

  // Counts stay available for the tab badge; table bodies are queried only
  // for the active tab and are bounded independently.
  const activityData = await ctx.db(async (tx) => {
    const scheduleBase = eq(reportSchedules.definitionId, id)
    const scheduleSearch = scheduleParams.q
      ? ilike(reportSchedules.name, `%${scheduleParams.q}%`)
      : undefined
    const scheduleWhere = and(
      scheduleBase,
      scheduleSearch,
      scheduleStatus ? eq(reportSchedules.active, scheduleStatus === 'active') : undefined,
    )
    const runSearch = runParams.q
      ? or(
          ilike(reportSchedules.name, `%${runParams.q}%`),
          ilike(reportRuns.error, `%${runParams.q}%`),
        )
      : undefined
    const runWhere = and(
      scheduleBase,
      runSearch,
      runStatus ? eq(reportRuns.status, runStatus) : undefined,
    )

    const [scheduleTotalRows, runTotalRows] = await Promise.all([
      tx.select({ c: count() }).from(reportSchedules).where(scheduleBase),
      tx
        .select({ c: count() })
        .from(reportRuns)
        .innerJoin(reportSchedules, eq(reportSchedules.id, reportRuns.scheduleId))
        .where(scheduleBase),
    ])
    if (tab !== 'activity') {
      return {
        scheduleRows: [],
        scheduleTotal: Number(scheduleTotalRows[0]?.c ?? 0),
        filteredScheduleTotal: 0,
        runRows: [],
        runTotal: Number(runTotalRows[0]?.c ?? 0),
        filteredRunTotal: 0,
      }
    }

    const [filteredScheduleRows, scheduleRows, filteredRunRows, runRows] = await Promise.all([
      tx.select({ c: count() }).from(reportSchedules).where(scheduleWhere),
      tx
        .select()
        .from(reportSchedules)
        .where(scheduleWhere)
        .orderBy(desc(reportSchedules.createdAt))
        .limit(scheduleParams.perPage)
        .offset((scheduleParams.page - 1) * scheduleParams.perPage),
      tx
        .select({ c: count() })
        .from(reportRuns)
        .innerJoin(reportSchedules, eq(reportSchedules.id, reportRuns.scheduleId))
        .where(runWhere),
      tx
        .select({ run: reportRuns, scheduleName: reportSchedules.name })
        .from(reportRuns)
        .innerJoin(reportSchedules, eq(reportSchedules.id, reportRuns.scheduleId))
        .where(runWhere)
        .orderBy(desc(reportRuns.startedAt))
        .limit(runParams.perPage)
        .offset((runParams.page - 1) * runParams.perPage),
    ])
    return {
      scheduleRows,
      scheduleTotal: Number(scheduleTotalRows[0]?.c ?? 0),
      filteredScheduleTotal: Number(filteredScheduleRows[0]?.c ?? 0),
      runRows,
      runTotal: Number(runTotalRows[0]?.c ?? 0),
      filteredRunTotal: Number(filteredRunRows[0]?.c ?? 0),
    }
  })

  const canSchedule = can(ctx, 'reports.schedule')
  const canBuild = can(ctx, 'reports.builder')
  const isCustom = definition.kind === 'custom'
  // Every report is editable: custom edits in place; a built-in opens an
  // editable copy you own (the original stays in the catalogue).
  const editHref = isCustom
    ? `/reports/definitions/${id}/edit`
    : `/reports/definitions/new?from=${id}`
  const runBound = runOnceFromDefinition.bind(null, id)
  const deleteBound = deleteDefinition.bind(null, id)
  const scheduleUrlParams = new URLSearchParams({ definitionId: definition.id })
  if (trainingFilters) {
    for (const [key, value] of Object.entries(trainingReportFiltersToRecord(trainingFilters))) {
      scheduleUrlParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
    }
  } else if (daysParam) {
    scheduleUrlParams.set('days', String(daysParam))
  }
  const createScheduleHref = `/reports/schedules/new?${scheduleUrlParams.toString()}`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <FadeInHeader className="mx-auto max-w-screen-2xl px-3 pt-3 sm:px-6 sm:pt-5">
          <DetailHeader
            back={{ href: '/reports', label: 'Back to reports' }}
            title={tGeneratedValue(definition.name)}
            subtitle={tGeneratedValue(definition.description ?? undefined)}
            badge={
              <div className="flex items-center gap-1.5">
                <KindBadge kind={definition.kind} />
                <CategoryBadge category={definition.category} />
              </div>
            }
            actions={
              <>
                <GeneratedValue
                  value={
                    canSchedule ? (
                      <form action={runBound}>
                        <input
                          type="hidden"
                          name="filters"
                          value={JSON.stringify(
                            trainingFilters
                              ? trainingReportFiltersToRecord(trainingFilters)
                              : daysParam
                                ? { days: daysParam }
                                : {},
                          )}
                        />
                        <Button type="submit" variant="outline" size="sm">
                          <Mail size={14} className="mr-1.5" />
                          <GeneratedText id="m_172e986a84c411" />
                        </Button>
                      </form>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    canBuild ? (
                      <Link href={editHref as never}>
                        <Button variant="outline" size="sm">
                          <Pencil size={14} className="mr-1.5" />
                          <GeneratedText id="m_03a66f9d34ac7b" />
                        </Button>
                      </Link>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    canSchedule ? (
                      <Link href={createScheduleHref}>
                        <Button size="sm">
                          <Calendar size={14} className="mr-1.5" />
                          <GeneratedText id="m_13104884fca730" />
                        </Button>
                      </Link>
                    ) : null
                  }
                />
              </>
            }
          />
          <TabNav
            basePath={`/reports/definitions/${id}`}
            currentParams={sp}
            active={tab}
            className="mt-2.5 sm:mt-4"
            tabs={[
              { key: 'document', label: 'Document' },
              {
                key: 'activity',
                label: 'Schedules & activity',
                count: activityData.scheduleTotal,
              },
            ]}
          />
        </FadeInHeader>
      </div>

      <GeneratedValue
        value={
          tab === 'document' ? (
            <DocumentTab
              ctx={ctx}
              definition={definition}
              daysParam={daysParam}
              trainingFilters={trainingFilters}
              sp={sp}
            />
          ) : (
            <ActivityTab
              definition={definition}
              activityData={activityData}
              scheduleParams={scheduleParams}
              runParams={runParams}
              currentParams={sp}
              canSchedule={canSchedule}
              canBuild={canBuild}
              isCustom={isCustom}
              editHref={editHref}
              deleteBound={deleteBound}
              timeZone={ctx.timezone}
              locale={ctx.locale}
            />
          )
        }
      />
    </div>
  )
}

// --- Document tab (print preview) -------------------------------------------

async function DocumentTab({
  ctx,
  definition,
  daysParam,
  trainingFilters,
  sp,
}: {
  ctx: Awaited<ReturnType<typeof requireRequestContext>>
  definition: NonNullable<Awaited<ReturnType<typeof loadDefinitionById>>>
  daysParam: number | null
  trainingFilters: TrainingReportFilters | null
  sp: Record<string, string | string[] | undefined>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const [run, branding, trainingSelections] = await Promise.all([
    runReportForViewer(ctx, definition, {
      days: daysParam,
      ...(trainingFilters ? { filters: trainingReportFiltersToRecord(trainingFilters) } : {}),
    }),
    loadTenantBranding(ctx),
    trainingFilters ? loadTrainingFilterSelections(ctx, trainingFilters) : null,
  ])

  const layout = resolveReportLayout(definition.layout)
  const bodyHtml = renderReportDocumentBodyHtml({
    tenantName: branding.name,
    tenantLogoUrl: branding.logoUrl,
    primaryColor: branding.primaryColor,
    reportName: definition.name,
    dateRangeLabel: run.rangeLabel,
    generatedAt: new Date(),
    summary: layout.showSummary ? run.result.summary : undefined,
    groups: run.result.groups,
    translate: tGeneratedValue,
  })
  const css =
    buildReportPageCss(layout, {
      marginBoxes: { footerLeft: `${branding.name} — ${definition.name}` },
    }) + buildReportDocumentCss(branding.primaryColor, layout.density)
  const truncated = run.result.rowCount >= DOCUMENT_PREVIEW_MAX_ROWS

  const exportParams = new URLSearchParams()
  if (run.days) exportParams.set('days', String(run.days))
  if (trainingFilters) {
    for (const [key, value] of Object.entries(trainingReportFiltersToRecord(trainingFilters))) {
      exportParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
    }
  }
  const exportBase = `/reports/definitions/${definition.id}/export?${exportParams.toString()}`
  const exportJoin = exportParams.size ? '&' : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
        <GeneratedValue
          value={
            trainingFilters &&
            trainingSelections &&
            isTrainingReportQueryKind(definition.queryKind) ? (
              <div className="mx-auto max-w-screen-2xl">
                <TrainingReportFilterPanel
                  key={JSON.stringify(trainingFilters)}
                  queryKind={definition.queryKind}
                  filters={trainingFilters}
                  selections={trainingSelections}
                />
              </div>
            ) : null
          }
        />
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-2">
          <GeneratedValue
            value={
              run.rangeMode === 'as_of' ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={run.rangeLabel} />
                </p>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                    <GeneratedValue
                      value={
                        run.rangeMode === 'lookahead' ? (
                          <GeneratedText id="m_08b5fa148b2af7" />
                        ) : (
                          <GeneratedText id="m_071a21cf92e7e2" />
                        )
                      }
                    />
                  </span>
                  <GeneratedValue
                    value={VIEWER_RANGE_CHOICES.map((d) => {
                      const active =
                        (run.days ?? null) === d ||
                        (!run.days && isDefaultChoice(d, run.rangeLabel))
                      return (
                        <Link
                          key={d}
                          href={
                            `/reports/definitions/${definition.id}?days=${d}${typeof sp.tab === 'string' ? `&tab=${sp.tab}` : ''}` as never
                          }
                          className={cn(
                            'inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors',
                            active
                              ? 'border-teal-700 bg-teal-700 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60',
                          )}
                        >
                          <GeneratedValue value={d} /> <GeneratedText id="m_169a4282447292" />
                        </Link>
                      )
                    })}
                  />
                </div>
              )
            }
          />
          <div className="flex items-center gap-2">
            <p className="text-xs text-slate-400">
              <GeneratedValue value={run.result.rowCount} /> <GeneratedText id="m_18c766569d99e9" />
              <GeneratedValue
                value={run.result.rowCount === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
              />
            </p>
            <a href={`${exportBase}${exportJoin}format=csv`}>
              <Button variant="outline" size="sm">
                <Download size={14} className="mr-1.5" />
                <GeneratedText id="m_13bc18467bfb44" />
              </Button>
            </a>
            <a href={`${exportBase}${exportJoin}format=xlsx`}>
              <Button variant="outline" size="sm">
                <FileSpreadsheet size={14} className="mr-1.5" />
                <GeneratedText id="m_0c81eece17490f" />
              </Button>
            </a>
            <a href={`${exportBase}${exportJoin}format=pdf`}>
              <Button variant="outline" size="sm">
                <FileText size={14} className="mr-1.5" />
                <GeneratedText id="m_1a2b2ed6729166" />
              </Button>
            </a>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <GeneratedValue
          value={
            run.error ? (
              <div className="mx-auto max-w-screen-2xl p-3 sm:p-6">
                <Alert variant="destructive">
                  <AlertTitle>
                    <GeneratedText id="m_1cb092500d5ac1" />
                  </AlertTitle>
                  <AlertDescription>
                    <GeneratedValue value={run.error} />
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <ReportPagedPreview
                bodyHtml={bodyHtml}
                css={css}
                caption={tGeneratedValue(
                  truncated
                    ? tGenerated('m_12918bef45dd52', { value0: DOCUMENT_PREVIEW_MAX_ROWS })
                    : null,
                )}
              />
            )
          }
        />
      </div>
    </div>
  )
}

// --- Schedules & activity tab -------------------------------------------------

function ActivityTab({
  definition,
  activityData,
  scheduleParams,
  runParams,
  currentParams,
  canSchedule,
  canBuild,
  isCustom,
  editHref,
  deleteBound,
  timeZone,
  locale,
}: {
  definition: NonNullable<Awaited<ReturnType<typeof loadDefinitionById>>>
  activityData: {
    scheduleRows: (typeof reportSchedules.$inferSelect)[]
    scheduleTotal: number
    filteredScheduleTotal: number
    runRows: { run: typeof reportRuns.$inferSelect; scheduleName: string }[]
    runTotal: number
    filteredRunTotal: number
  }
  scheduleParams: {
    q: string | undefined
    sort: (typeof ACTIVITY_SORTS)[number]
    dir: 'asc' | 'desc'
    page: number
    perPage: number
  }
  runParams: {
    q: string | undefined
    sort: (typeof RUN_SORTS)[number]
    dir: 'asc' | 'desc'
    page: number
    perPage: number
  }
  currentParams: Record<string, string | string[] | undefined>
  canSchedule: boolean
  canBuild: boolean
  isCustom: boolean
  editHref: string
  deleteBound: () => Promise<void>
  timeZone: string
  locale: Awaited<ReturnType<typeof requireRequestContext>>['locale']
}) {
  const tGenerated = useGeneratedTranslations()
  const {
    scheduleRows,
    scheduleTotal,
    filteredScheduleTotal,
    runRows,
    runTotal,
    filteredRunTotal,
  } = activityData
  const basePath = `/reports/definitions/${definition.id}`
  return (
    <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-screen-2xl space-y-4 p-3 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                <GeneratedText id="m_132834dfa8b616" />
                <GeneratedValue value={scheduleTotal} />)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TableToolbar className="mb-3">
                <SearchInput
                  placeholder={tGenerated('m_1f73404a759f2f')}
                  paramKey="scheduleQ"
                  pageParamKey="schedulePage"
                />
                <FilterChips
                  basePath={basePath}
                  currentParams={currentParams}
                  paramKey="scheduleStatus"
                  pageParamKey="schedulePage"
                  label={tGenerated('m_0b9da892d6faf0')}
                  options={[...SCHEDULE_STATUS_OPTIONS]}
                />
              </TableToolbar>
              <GeneratedValue
                value={
                  scheduleRows.length === 0 ? (
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        <GeneratedValue
                          value={
                            scheduleParams.q || scheduleStatusFromParams(currentParams) ? (
                              <GeneratedText id="m_19447dbf0896a3" />
                            ) : (
                              <GeneratedText id="m_145ac584dfa96b" />
                            )
                          }
                        />
                        <GeneratedValue
                          value={
                            canSchedule ? (
                              <>
                                <GeneratedValue value={' '} />
                                <Link
                                  href={`/reports/schedules/new?definitionId=${definition.id}`}
                                  className="text-teal-700 hover:underline dark:text-teal-300"
                                >
                                  <GeneratedText id="m_1c516d834dca35" />
                                </Link>
                              </>
                            ) : null
                          }
                        />
                      </p>
                      <GeneratedValue
                        value={
                          filteredScheduleTotal > 0 ? (
                            <Pagination
                              basePath={basePath}
                              currentParams={currentParams}
                              total={filteredScheduleTotal}
                              page={scheduleParams.page}
                              perPage={scheduleParams.perPage}
                              pageParamKey="schedulePage"
                            />
                          ) : null
                        }
                      />
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <GeneratedText id="m_16faf7a86922c4" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_1151ed0308b6d1" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_05e650592b7158" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_0b9da892d6faf0" />
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <GeneratedValue
                            value={scheduleRows.map((s) => (
                              <TableRow key={s.id}>
                                <TableCell>
                                  <Link
                                    href={`/reports/schedules/${s.id}`}
                                    className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                                  >
                                    <GeneratedValue value={s.name} />
                                  </Link>
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-300">
                                  <GeneratedValue
                                    value={formatCadence(
                                      s.cadence,
                                      s.dayOfWeek,
                                      s.dayOfMonth,
                                      s.hour,
                                      s.minute,
                                      s.timezone,
                                    )}
                                  />
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-300">
                                  <GeneratedValue
                                    value={
                                      s.nextRunAt
                                        ? formatDateTime(new Date(s.nextRunAt), timeZone, locale)
                                        : '—'
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <GeneratedValue
                                    value={
                                      s.active ? (
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
                              </TableRow>
                            ))}
                          />
                        </TableBody>
                      </Table>
                      <Pagination
                        basePath={basePath}
                        currentParams={currentParams}
                        total={filteredScheduleTotal}
                        page={scheduleParams.page}
                        perPage={scheduleParams.perPage}
                        pageParamKey="schedulePage"
                      />
                    </div>
                  )
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                <GeneratedText id="m_171b06e0afee3f" />
                <GeneratedValue value={runTotal} />)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TableToolbar className="mb-3">
                <SearchInput
                  placeholder={tGenerated('m_17c7a03117af61')}
                  paramKey="runQ"
                  pageParamKey="runPage"
                />
                <FilterChips
                  basePath={basePath}
                  currentParams={currentParams}
                  paramKey="runStatus"
                  pageParamKey="runPage"
                  label={tGenerated('m_0b9da892d6faf0')}
                  options={[...RUN_STATUS_OPTIONS]}
                />
              </TableToolbar>
              <GeneratedValue
                value={
                  runRows.length === 0 ? (
                    <div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        <GeneratedValue
                          value={
                            runParams.q || pickString(currentParams.runStatus) ? (
                              <GeneratedText id="m_0df40b8e9c9440" />
                            ) : (
                              <GeneratedText id="m_18b1072d8a0cd7" />
                            )
                          }
                        />
                      </p>
                      <GeneratedValue
                        value={
                          filteredRunTotal > 0 ? (
                            <Pagination
                              basePath={basePath}
                              currentParams={currentParams}
                              total={filteredRunTotal}
                              page={runParams.page}
                              perPage={runParams.perPage}
                              pageParamKey="runPage"
                            />
                          ) : null
                        }
                      />
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <GeneratedText id="m_1922c581498469" />
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
                            value={runRows.map(({ run: r }) => (
                              <TableRow key={r.id}>
                                <TableCell>
                                  <Link
                                    href={`/reports/schedules/${r.scheduleId}/runs/${r.id}`}
                                    className="text-slate-700 hover:underline dark:text-slate-200"
                                  >
                                    <GeneratedValue
                                      value={formatDateTime(
                                        new Date(r.startedAt),
                                        timeZone,
                                        locale,
                                      )}
                                    />
                                  </Link>
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
                                          href={`/reports/schedules/${r.scheduleId}/runs/${r.id}/pdf`}
                                          className="text-teal-700 hover:underline dark:text-teal-300"
                                        >
                                          <GeneratedText id="m_0fcb9c63d263d1" />
                                        </a>
                                      ) : (
                                        <span className="text-slate-300 dark:text-slate-600">
                                          —
                                        </span>
                                      )
                                    }
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          />
                        </TableBody>
                      </Table>
                      <Pagination
                        basePath={basePath}
                        currentParams={currentParams}
                        total={filteredRunTotal}
                        page={runParams.page}
                        perPage={runParams.perPage}
                        pageParamKey="runPage"
                      />
                    </div>
                  )
                }
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              <GeneratedText id="m_0805e8582f3931" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
              <MetaItem label={tGenerated('m_0c70a274b9df45')}>
                <span className="font-mono text-xs">
                  <GeneratedValue value={definition.slug} />
                </span>
              </MetaItem>
              <MetaItem label={tGenerated('m_0de2b4cbb409e6')}>
                <span className="font-mono text-xs">
                  <GeneratedValue value={definition.queryKind} />
                </span>
              </MetaItem>
              <MetaItem label={tGenerated('m_10cbe051fb5e05')}>
                <GeneratedValue
                  value={formatDateTime(new Date(definition.createdAt), timeZone, locale)}
                />
              </MetaItem>
              <MetaItem label={tGenerated('m_014ca61c68ab13')}>
                <GeneratedValue
                  value={formatDateTime(new Date(definition.updatedAt), timeZone, locale)}
                />
              </MetaItem>
            </dl>
            <GeneratedValue
              value={
                canBuild ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                    <Link href={editHref as never}>
                      <Button variant="outline" size="sm">
                        <Pencil size={14} className="mr-1.5" />
                        <GeneratedValue
                          value={
                            isCustom ? (
                              <GeneratedText id="m_186e85e2d4fd61" />
                            ) : (
                              <GeneratedText id="m_0fde1ff7b7eaf9" />
                            )
                          }
                        />
                      </Button>
                    </Link>
                    <Link href={`/reports/definitions/new?from=${definition.id}` as never}>
                      <Button variant="outline" size="sm">
                        <Copy size={14} className="mr-1.5" />
                        <GeneratedText id="m_13fa26360f0fe9" />
                      </Button>
                    </Link>
                    <GeneratedValue
                      value={
                        isCustom ? (
                          <form action={deleteBound}>
                            <Button type="submit" variant="destructive" size="sm">
                              <Trash2 size={14} className="mr-1.5" />
                              <GeneratedText id="m_11773f3c3f7558" />
                            </Button>
                          </form>
                        ) : null
                      }
                    />
                  </div>
                ) : null
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function scheduleStatusFromParams(
  params: Record<string, string | string[] | undefined>,
): 'active' | 'paused' | undefined {
  const value = pickString(params.scheduleStatus)
  return value === 'active' || value === 'paused' ? value : undefined
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
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

/** When no explicit ?days= is set the engine used the queryKind default —
 *  highlight the matching pill by reading the computed label. */
function isDefaultChoice(d: number, rangeLabel: string): boolean {
  return rangeLabel.includes(`${d} days`)
}
