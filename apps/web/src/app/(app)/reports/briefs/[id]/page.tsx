import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { CalendarPlus } from 'lucide-react'
import {
  Badge,
  Button,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  briefRuns,
  briefSchedules,
  departments,
  personGroups,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { addDays, BRIEF_SOURCES, getBriefTemplate } from '@beaconhs/briefs'
import { DetailPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TabNav } from '@/components/tab-nav'
import { TableToolbar } from '@/components/table-toolbar'
import { BriefView } from '@/components/briefs/brief-view'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { requireRequestContext } from '@/lib/auth'
import { dateIsoInTimeZone, formatDateTime } from '@/lib/datetime'
import { isUuid, mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { canManageBriefs, canReadBriefs } from '@/lib/briefs/access'
import { countDeliveries, loadBrief } from '@/lib/briefs/data'
import {
  BRIEF_RUN_STATUS_LABEL,
  BRIEF_RUN_TRIGGER_LABEL,
  cadenceSummary,
  windowSummary,
} from '@/lib/briefs/labels'
import { BriefStatusButton } from './_brief-status.client'
import { BriefStudio } from './_studio.client'
import { ScheduleDrawer, type ScheduleDraft } from './_schedule-drawer.client'
import { ScheduleRowActions } from './_schedule-row-actions.client'

export const dynamic = 'force-dynamic'

const TABS = ['design', 'schedules', 'runs'] as const
type Tab = (typeof TABS)[number]
const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const
const RUN_TRIGGERS = ['scheduled', 'manual', 'preview', 'api'] as const
const STATUS_VARIANT = {
  queued: 'secondary',
  running: 'warning',
  succeeded: 'success',
  failed: 'destructive',
} as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  const ctx = await requireRequestContext()
  const brief = isUuid(id) ? await loadBrief(ctx, id) : null
  return { title: brief?.name ?? tGenerated('m_13b7eb67d8d34a') }
}

export default async function BriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const ctx = await requireRequestContext()
  if (!canReadBriefs(ctx)) redirect('/reports')
  const canManage = canManageBriefs(ctx)
  const brief = await loadBrief(ctx, id)
  if (!brief) notFound()
  const sp = await searchParams
  const tab: Tab = TABS.find((t) => t === pickString(sp.tab)) ?? 'design'
  const base = `/reports/briefs/${id}`

  const tabs = [
    { key: 'design', label: 'Design' },
    { key: 'schedules', label: 'Schedules' },
    { key: 'runs', label: 'Runs' },
  ]

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/reports/briefs', label: tGenerated('m_1fcc120127ae49') }}
          title={brief.name}
          subtitle={brief.description ?? undefined}
          badge={
            brief.status === 'archived' ? (
              <Badge variant="secondary">
                <GeneratedText id="m_12a687134482ba" />
              </Badge>
            ) : undefined
          }
          actions={
            canManage ? <BriefStatusButton id={brief.id} status={brief.status} /> : undefined
          }
        />
      }
    >
      <TabNav basePath={base} currentParams={{}} tabs={tabs} active={tab} />
      <div className="mt-4">
        {tab === 'design' ? (
          <DesignTab
            ctx={ctx}
            brief={brief}
            canManage={canManage}
            previewId={pickString(sp.preview)}
          />
        ) : tab === 'schedules' ? (
          <SchedulesTab ctx={ctx} brief={brief} canManage={canManage} sp={sp} base={base} />
        ) : (
          <RunsTab ctx={ctx} briefId={brief.id} sp={sp} base={base} />
        )}
      </div>
    </DetailPageLayout>
  )
}

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>
type Brief = NonNullable<Awaited<ReturnType<typeof loadBrief>>>

async function DesignTab({
  ctx,
  brief,
  canManage,
  previewId,
}: {
  ctx: Ctx
  brief: Brief
  canManage: boolean
  previewId: string | undefined
}) {
  const [preview] = await ctx.db((tx) =>
    tx
      .select({
        id: briefRuns.id,
        status: briefRuns.status,
        error: briefRuns.error,
        result: briefRuns.result,
        evidence: briefRuns.evidence,
        windowLabel: briefRuns.windowLabel,
        specVersion: briefRuns.specVersion,
        aiMeta: briefRuns.aiMeta,
      })
      .from(briefRuns)
      .where(
        and(
          eq(briefRuns.briefId, brief.id),
          eq(briefRuns.trigger, 'preview'),
          previewId && isUuid(previewId) ? eq(briefRuns.id, previewId) : undefined,
        ),
      )
      .orderBy(desc(briefRuns.createdAt))
      .limit(1),
  )
  const sources = BRIEF_SOURCES.map((source) => ({
    key: source.key,
    label: source.label,
    description: source.description,
    paramFields: source.paramFields,
    readable: source.canRead(ctx),
  }))
  const yesterday = addDays(dateIsoInTimeZone(new Date(), ctx.timezone), -1)
  return (
    <BriefStudio
      brief={{
        id: brief.id,
        name: brief.name,
        description: brief.description ?? '',
        spec: brief.spec,
        specVersion: brief.specVersion,
      }}
      sources={sources}
      canManage={canManage && brief.status === 'active'}
      defaultDay={yesterday}
      previewWindow={preview?.windowLabel ?? null}
      preview={
        preview ? (
          preview.status === 'failed' ? (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <GeneratedValue value={preview.error ?? 'The preview failed.'} />
            </p>
          ) : preview.result && preview.evidence ? (
            <div className="space-y-2">
              {preview.specVersion !== brief.specVersion ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  <GeneratedText id="m_187b1145f02ac2" />
                </p>
              ) : null}
              <BriefView result={preview.result} evidence={preview.evidence} />
            </div>
          ) : null
        ) : null
      }
    />
  )
}

async function SchedulesTab({
  ctx,
  brief,
  canManage,
  sp,
  base,
}: {
  ctx: Ctx
  brief: Brief
  canManage: boolean
  sp: Record<string, string | string[] | undefined>
  base: string
}) {
  const tGenerated = await getGeneratedTranslations()
  const list = parseListParams(
    { q: sp.scheduleQ, page: sp.schedulePage, perPage: sp.schedulePerPage },
    { sort: 'name', perPage: 10, allowedSorts: ['name'] },
  )
  const status = pickString(sp.scheduleStatus)
  const where = and(
    eq(briefSchedules.briefId, brief.id),
    status === 'active' || status === 'paused'
      ? eq(briefSchedules.active, status === 'active')
      : undefined,
    list.q ? ilike(briefSchedules.name, `%${list.q}%`) : undefined,
  )
  const { rows, total } = await ctx.db(async (tx) => {
    const [tot] = await tx.select({ n: count() }).from(briefSchedules).where(where)
    const rows = await tx
      .select()
      .from(briefSchedules)
      .where(where)
      .orderBy(asc(briefSchedules.name), asc(briefSchedules.id))
      .limit(list.perPage)
      .offset((list.page - 1) * list.perPage)
    return { rows, total: Number(tot?.n ?? 0) }
  })

  // The drawer edits one schedule (or a new one) chosen by ?schedule=.
  const scheduleParam = pickString(sp.schedule)
  const editing =
    scheduleParam && isUuid(scheduleParam)
      ? ((
          await ctx.db((tx) =>
            tx
              .select()
              .from(briefSchedules)
              .where(
                and(eq(briefSchedules.id, scheduleParam), eq(briefSchedules.briefId, brief.id)),
              )
              .limit(1),
          )
        )[0] ?? null)
      : null
  let draft: ScheduleDraft | null = null
  if (canManage && (scheduleParam === 'new' || editing)) {
    const userIds = editing?.recipientUserIds ?? []
    const groupIds = editing?.recipientGroupIds ?? []
    const [userOptions, groupOptions] = await ctx.db(async (tx) => [
      userIds.length
        ? await tx
            .select({
              value: users.id,
              label: sql<string>`coalesce(${tenantUsers.displayName}, ${users.name}, ${users.email})`,
              hint: users.email,
            })
            .from(users)
            .innerJoin(tenantUsers, eq(tenantUsers.userId, users.id))
            .where(inArray(users.id, userIds))
        : [],
      groupIds.length
        ? await tx
            .select({ value: personGroups.id, label: personGroups.name })
            .from(personGroups)
            .where(inArray(personGroups.id, groupIds))
        : [],
    ])
    const template = brief.templateKey ? getBriefTemplate(brief.templateKey) : null
    const defaults = template?.schedule
    draft = editing
      ? {
          id: editing.id,
          name: editing.name,
          cadence: editing.cadence,
          repeatEvery: editing.repeatEvery,
          weekdaysOnly: editing.weekdaysOnly,
          dayOfWeek: editing.dayOfWeek,
          dayOfMonth: editing.dayOfMonth,
          hour: editing.hour,
          minute: editing.minute,
          timezone: editing.timezone,
          window: editing.window,
          split: editing.split,
          users: userOptions.map((u) => ({
            value: u.value,
            label: u.label,
            hint: u.hint ?? undefined,
          })),
          groups: groupOptions,
          emails: editing.recipientEmails,
          emailSubject: editing.emailSubject ?? '',
          active: editing.active,
        }
      : {
          id: null,
          name: brief.name,
          cadence: defaults?.cadence ?? 'daily',
          repeatEvery: 1,
          weekdaysOnly: defaults?.weekdaysOnly ?? true,
          dayOfWeek: defaults?.dayOfWeek ?? 1,
          dayOfMonth: defaults?.dayOfMonth ?? 1,
          hour: defaults?.hour ?? 7,
          minute: defaults?.minute ?? 0,
          timezone: ctx.timezone,
          window: defaults?.window ?? { mode: 'previous_business_day' },
          split: defaults?.split ?? 'none',
          users: [],
          groups: [],
          emails: [],
          emailSubject: '',
          active: true,
        }
  }
  const closeHref = mergeHref(base, sp, { schedule: undefined })

  return (
    <div className="space-y-3">
      <TableToolbar>
        <SearchInput
          placeholder={tGenerated('m_0c112a1d235c39')}
          paramKey="scheduleQ"
          pageParamKey="schedulePage"
        />
        <FilterChips
          basePath={base}
          currentParams={sp}
          paramKey="scheduleStatus"
          pageParamKey="schedulePage"
          label={tGenerated('m_0b9da892d6faf0')}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'paused', label: 'Paused' },
          ]}
        />
        {canManage && brief.status === 'active' ? (
          <Link
            href={mergeHref(base, sp, { tab: 'schedules', schedule: 'new' }) as never}
            scroll={false}
          >
            <Button>
              <CalendarPlus size={14} /> <GeneratedText id="m_0f2dd0043302a1" />
            </Button>
          </Link>
        ) : null}
      </TableToolbar>
      {rows.length === 0 ? (
        <EmptyState
          title={tGenerated('m_128e4fb23de822')}
          description={tGenerated('m_053a572798737b')}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <GeneratedText id="m_16faf7a86922c4" />
                </TableHead>
                <TableHead>
                  <GeneratedText id="m_0f5d896d9fdd8b" />
                </TableHead>
                <TableHead>
                  <GeneratedText id="m_0d99b2b56f8b5d" />
                </TableHead>
                <TableHead>
                  <GeneratedText id="m_1f0c3a18593f84" />
                </TableHead>
                <TableHead>
                  <GeneratedText id="m_0b9da892d6faf0" />
                </TableHead>
                {canManage ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((schedule) => (
                <TableRow key={schedule.id}>
                  <TableCell>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      <GeneratedValue value={schedule.name} />
                    </p>
                    <p className="text-xs text-slate-500">
                      <GeneratedValue value={cadenceSummary(schedule)} />
                    </p>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600 dark:text-slate-300">
                    <GeneratedValue value={windowSummary(schedule.window)} />
                    {schedule.split === 'department' ? (
                      <p className="text-xs text-slate-500">
                        <GeneratedText id="m_0e5d7ed20f8ad7" />
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600 dark:text-slate-300">
                    <GeneratedValue
                      value={[
                        schedule.recipientUserIds.length
                          ? `${schedule.recipientUserIds.length} member(s)`
                          : null,
                        schedule.recipientGroupIds.length
                          ? `${schedule.recipientGroupIds.length} group(s)`
                          : null,
                        schedule.recipientEmails.length
                          ? `${schedule.recipientEmails.length} email(s)`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap text-slate-600 dark:text-slate-300">
                    <GeneratedValue
                      value={
                        schedule.nextRunAt
                          ? formatDateTime(schedule.nextRunAt, ctx.timezone, ctx.locale)
                          : '—'
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant={schedule.active ? 'success' : 'secondary'}>
                      {schedule.active ? (
                        <GeneratedText id="m_1e1b1fdb7dd78e" />
                      ) : (
                        <GeneratedText id="m_081fa5c9b91061" />
                      )}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <ScheduleRowActions
                        id={schedule.id}
                        active={schedule.active}
                        editHref={mergeHref(base, sp, { tab: 'schedules', schedule: schedule.id })}
                        canRun={brief.status === 'active'}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        basePath={base}
        currentParams={sp}
        total={total}
        page={list.page}
        perPage={list.perPage}
        pageParamKey="schedulePage"
      />
      {draft ? <ScheduleDrawer briefId={brief.id} draft={draft} closeHref={closeHref} /> : null}
    </div>
  )
}

async function RunsTab({
  ctx,
  briefId,
  sp,
  base,
}: {
  ctx: Ctx
  briefId: string
  sp: Record<string, string | string[] | undefined>
  base: string
}) {
  const tGenerated = await getGeneratedTranslations()
  const list = parseListParams(
    { q: sp.runQ, page: sp.runPage, perPage: sp.runPerPage },
    { sort: 'created', perPage: 25, allowedSorts: ['created'] },
  )
  const status = RUN_STATUSES.find((s) => s === pickString(sp.runStatus))
  const trigger = RUN_TRIGGERS.find((t) => t === pickString(sp.runTrigger))
  const where = and(
    eq(briefRuns.briefId, briefId),
    status ? eq(briefRuns.status, status) : undefined,
    trigger ? eq(briefRuns.trigger, trigger) : undefined,
    list.q
      ? or(ilike(briefRuns.windowLabel, `%${list.q}%`), ilike(departments.name, `%${list.q}%`))
      : undefined,
  )
  const { rows, total } = await ctx.db(async (tx) => {
    const [tot] = await tx
      .select({ n: count() })
      .from(briefRuns)
      .leftJoin(departments, eq(departments.id, briefRuns.departmentId))
      .where(where)
    const rows = await tx
      .select({
        id: briefRuns.id,
        trigger: briefRuns.trigger,
        status: briefRuns.status,
        windowLabel: briefRuns.windowLabel,
        createdAt: briefRuns.createdAt,
        finishedAt: briefRuns.finishedAt,
        records: sql<number | null>`jsonb_array_length(${briefRuns.evidence} -> 'records')`,
        departmentName: departments.name,
      })
      .from(briefRuns)
      .leftJoin(departments, eq(departments.id, briefRuns.departmentId))
      .where(where)
      .orderBy(desc(briefRuns.createdAt), desc(briefRuns.id))
      .limit(list.perPage)
      .offset((list.page - 1) * list.perPage)
    return { rows, total: Number(tot?.n ?? 0) }
  })
  const deliveries = await countDeliveries(
    ctx,
    rows.map((r) => r.id),
  )
  return (
    <div className="space-y-3">
      <TableToolbar>
        <SearchInput
          placeholder={tGenerated('m_1f7a892d613b7d')}
          paramKey="runQ"
          pageParamKey="runPage"
        />
        <FilterChips
          basePath={base}
          currentParams={sp}
          paramKey="runStatus"
          pageParamKey="runPage"
          label={tGenerated('m_0b9da892d6faf0')}
          options={[
            { value: 'succeeded', label: 'Succeeded' },
            { value: 'failed', label: 'Failed' },
            { value: 'running', label: 'Running' },
            { value: 'queued', label: 'Queued' },
          ]}
        />
        <FilterChips
          basePath={base}
          currentParams={sp}
          paramKey="runTrigger"
          pageParamKey="runPage"
          label={tGenerated('m_1db1e5c9ca41ce')}
          options={[
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'manual', label: 'Run now' },
            { value: 'preview', label: 'Preview' },
            { value: 'api', label: 'API' },
          ]}
        />
      </TableToolbar>
      {rows.length === 0 ? (
        <EmptyState
          title={tGenerated('m_05b739a408377a')}
          description={tGenerated('m_17a86014864a4b')}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <GeneratedText id="m_0f5d896d9fdd8b" />
                </TableHead>
                <TableHead>
                  <GeneratedText id="m_1db1e5c9ca41ce" />
                </TableHead>
                <TableHead>
                  <GeneratedText id="m_0b9da892d6faf0" />
                </TableHead>
                <TableHead>
                  <GeneratedText id="m_14fd485e580165" />
                </TableHead>
                <TableHead>
                  <GeneratedText id="m_0d99b2b56f8b5d" />
                </TableHead>
                <TableHead>
                  <GeneratedText id="m_10cbe051fb5e05" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link
                      href={`${base}/runs/${run.id}`}
                      className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                    >
                      <GeneratedValue value={run.windowLabel} />
                    </Link>
                    {run.departmentName ? (
                      <p className="text-xs text-slate-500">
                        <GeneratedValue value={run.departmentName} />
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">
                    <GeneratedValue value={BRIEF_RUN_TRIGGER_LABEL[run.trigger]} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[run.status]}>
                      <GeneratedValue value={BRIEF_RUN_STATUS_LABEL[run.status]} />
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{run.records ?? '—'}</TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {deliveries.get(run.id) ?? 0}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap text-slate-500">
                    <GeneratedValue
                      value={formatDateTime(run.createdAt, ctx.timezone, ctx.locale)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        basePath={base}
        currentParams={sp}
        total={total}
        page={list.page}
        perPage={list.perPage}
        pageParamKey="runPage"
      />
    </div>
  )
}
